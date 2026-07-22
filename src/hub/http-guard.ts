/**
 * HTTP 控制面防护：可选 token、body 上限、滑动窗口限流、诊断脱敏。
 */

import type http from "node:http";

export const DEFAULT_HTTP_BODY_MAX_BYTES = 64 * 1024;
export const DEFAULT_HTTP_RATE_LIMIT = 60;
export const DEFAULT_HTTP_RATE_WINDOW_MS = 60_000;

export type ControlHttpOptions = {
	/** 非空时除 /health 外需匹配 */
	controlToken?: string;
	bodyMaxBytes?: number;
	rateLimit?: number;
	rateWindowMs?: number;
};

export type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

/** 固定窗口计数限流（单进程足够） */
export class FixedWindowRateLimiter {
	private windowStart = 0;
	private count = 0;
	private readonly limit: number;
	private readonly windowMs: number;
	private readonly now: () => number;

	constructor(options?: { limit?: number; windowMs?: number; now?: () => number }) {
		this.limit = options?.limit ?? DEFAULT_HTTP_RATE_LIMIT;
		this.windowMs = options?.windowMs ?? DEFAULT_HTTP_RATE_WINDOW_MS;
		this.now = options?.now ?? (() => Date.now());
		this.windowStart = this.now();
	}

	tryConsume(n = 1): RateLimitResult {
		const t = this.now();
		if (t - this.windowStart >= this.windowMs) {
			this.windowStart = t;
			this.count = 0;
		}
		if (this.count + n > this.limit) {
			const retryAfterMs = Math.max(0, this.windowMs - (t - this.windowStart));
			return { ok: false, retryAfterMs };
		}
		this.count += n;
		return { ok: true };
	}
}

export function extractControlToken(req: http.IncomingMessage): string | undefined {
	const auth = header(req, "authorization");
	if (auth) {
		const m = auth.match(/^Bearer\s+(.+)$/i);
		if (m?.[1]) return m[1].trim();
	}
	const x = header(req, "x-lark-hub-token");
	return x?.trim() || undefined;
}

function header(req: http.IncomingMessage, name: string): string | undefined {
	const v = req.headers[name];
	if (Array.isArray(v)) return v[0];
	return typeof v === "string" ? v : undefined;
}

/**
 * 校验控制 token。expected 为空则放行（本机默认低摩擦）。
 * path 为 /health 时始终放行。
 */
export function authorizeControlHttp(input: {
	pathname: string;
	expectedToken?: string;
	providedToken?: string;
}): { ok: true } | { ok: false; status: 401; error: string } {
	if (input.pathname === "/health") return { ok: true };
	const expected = input.expectedToken?.trim();
	if (!expected) return { ok: true };
	const provided = input.providedToken?.trim();
	if (!provided || provided !== expected) {
		return { ok: false, status: 401, error: "unauthorized: missing or invalid control token" };
	}
	return { ok: true };
}

export class BodyTooLargeError extends Error {
	readonly code = "BODY_TOO_LARGE";
	constructor(public readonly maxBytes: number) {
		super(`request body exceeds ${maxBytes} bytes`);
		this.name = "BodyTooLargeError";
	}
}

export function readBodyLimited(
	req: http.IncomingMessage,
	maxBytes = DEFAULT_HTTP_BODY_MAX_BYTES,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let total = 0;
		let settled = false;
		const fail = (err: Error) => {
			if (settled) return;
			settled = true;
			req.destroy();
			reject(err);
		};
		req.on("data", (c) => {
			const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
			total += buf.length;
			if (total > maxBytes) {
				fail(new BodyTooLargeError(maxBytes));
				return;
			}
			chunks.push(buf);
		});
		req.on("end", () => {
			if (settled) return;
			settled = true;
			resolve(Buffer.concat(chunks).toString("utf8"));
		});
		req.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
	});
}

/** 诊断接口脱敏：截断长字符串，去掉疑似 secret 字段名 */
export function redactDiagnosticValue(value: unknown, depth = 0): unknown {
	if (depth > 6) return "[…]";
	if (value == null) return value;
	if (typeof value === "string") {
		if (value.length > 240) return `${value.slice(0, 120)}…（已截断 ${value.length} 字）`;
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value)) {
		return value.slice(0, 50).map((v) => redactDiagnosticValue(v, depth + 1));
	}
	if (typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (/secret|token|password|appsecret|client_secret/i.test(k)) {
				out[k] = "[已脱敏]";
				continue;
			}
			if (k === "body" && typeof v === "string" && v.length > 200) {
				out[k] = `${v.slice(0, 100)}…（已截断）`;
				continue;
			}
			if (k === "cwd" && typeof v === "string" && v.length > 80) {
				out[k] = `…${v.slice(-60)}`;
				continue;
			}
			out[k] = redactDiagnosticValue(v, depth + 1);
		}
		return out;
	}
	return String(value);
}
