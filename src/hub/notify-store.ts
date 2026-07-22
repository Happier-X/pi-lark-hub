/**
 * Hub 出站 notify 幂等状态机：同 piId+requestId+event 单飞、历史可查、failed 可显式重试。
 * retryPayload 仅内存，不得进入诊断 API 全文 body。
 */

import { createHash } from "node:crypto";

export type NotifyKeyParts = {
	piId: string;
	requestId: string;
	event: string;
};

export type NotifyPayload = NotifyKeyParts & {
	title: string;
	body: string;
	actions?: string[];
	timeoutMs?: number;
};

export type NotifyRecordStatus = "sending" | "sent" | "failed";

/** 对外/诊断用视图（无 retryPayload / 无 body） */
export type NotifyRecordView = {
	key: string;
	piId: string;
	requestId: string;
	event: string;
	payloadHash: string;
	status: NotifyRecordStatus;
	messageId?: string;
	messageIds?: string[];
	error?: string;
	titlePreview?: string;
	createdAt: number;
	updatedAt: number;
	/** 是否可本地重试（有 payload 且 failed） */
	retryable: boolean;
};

type NotifyRecordInternal = NotifyRecordView & {
	retryPayload?: NotifyPayload;
};

export type NotifySendResult = {
	messageId: string;
	messageIds?: string[];
};

/** 分批部分成功后失败：携带已发送 messageIds 供历史观测，不续发 */
export class NotifyPartialSendError extends Error {
	readonly messageIds: string[];
	constructor(message: string, messageIds: string[]) {
		super(message);
		this.name = "NotifyPartialSendError";
		this.messageIds = messageIds;
	}
}

export function notifyKey(parts: NotifyKeyParts): string {
	return `${parts.piId}|${parts.requestId}|${parts.event}`;
}

export function hashNotifyPayload(payload: NotifyPayload): string {
	const stable = JSON.stringify({
		piId: payload.piId,
		requestId: payload.requestId,
		event: payload.event,
		title: payload.title,
		body: payload.body,
		actions: payload.actions ?? [],
		timeoutMs: payload.timeoutMs ?? null,
	});
	return createHash("sha256").update(stable).digest("hex");
}

function titlePreview(title: string): string {
	const t = title.trim();
	if (t.length <= 80) return t;
	return `${t.slice(0, 80)}…`;
}

function truncateError(err: string): string {
	const s = err.replace(/app_secret|client_secret|secret/gi, "密钥");
	return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

function toView(r: NotifyRecordInternal): NotifyRecordView {
	return {
		key: r.key,
		piId: r.piId,
		requestId: r.requestId,
		event: r.event,
		payloadHash: r.payloadHash,
		status: r.status,
		messageId: r.messageId,
		messageIds: r.messageIds ? [...r.messageIds] : undefined,
		error: r.error,
		titlePreview: r.titlePreview,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		retryable: r.status === "failed" && Boolean(r.retryPayload),
	};
}

export type NotifyStoreOptions = {
	maxRecords?: number;
	ttlMs?: number;
	now?: () => number;
};

export class NotifyStore {
	private readonly records = new Map<string, NotifyRecordInternal>();
	private readonly inflight = new Map<string, Promise<NotifySendResult>>();
	private readonly maxRecords: number;
	private readonly ttlMs: number;
	private readonly now: () => number;

	constructor(options?: NotifyStoreOptions) {
		this.maxRecords = options?.maxRecords ?? 500;
		this.ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000;
		this.now = options?.now ?? (() => Date.now());
	}

	get(key: string): NotifyRecordView | undefined {
		this.purgeExpired();
		const r = this.records.get(key);
		return r ? toView(r) : undefined;
	}

	/** 按 requestId 精确或唯一前缀匹配 */
	findByRequestId(idOrPrefix: string): NotifyRecordView | undefined {
		this.purgeExpired();
		const q = idOrPrefix.trim();
		if (!q) return undefined;
		const matches = [...this.records.values()].filter(
			(r) => r.requestId === q || r.requestId.startsWith(q),
		);
		if (matches.length !== 1) return undefined;
		return toView(matches[0]!);
	}

	getInternalForRetry(requestIdPrefix: string): NotifyRecordInternal | undefined {
		this.purgeExpired();
		const q = requestIdPrefix.trim();
		if (!q) return undefined;
		const matches = [...this.records.values()].filter(
			(r) => r.requestId === q || r.requestId.startsWith(q),
		);
		if (matches.length !== 1) return undefined;
		return matches[0];
	}

	findByMessageId(messageId: string): NotifyRecordView | undefined {
		this.purgeExpired();
		const id = messageId.trim();
		if (!id) return undefined;
		for (const r of this.records.values()) {
			if (r.messageId === id || r.messageIds?.includes(id)) return toView(r);
		}
		return undefined;
	}

	list(limit = 100): NotifyRecordView[] {
		this.purgeExpired();
		return [...this.records.values()]
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.slice(0, Math.max(1, limit))
			.map(toView);
	}

	/**
	 * 若已 sent 且 hash 匹配 → 返回 messageId；
	 * hash 冲突 → throw；
	 * failed 且 hash 匹配 → 允许再次发送；
	 * 否则执行 sendOnce 单飞。
	 */
	async sendIdempotent(
		payload: NotifyPayload,
		sendOnce: () => Promise<NotifySendResult | string>,
	): Promise<{ messageId: string; messageIds?: string[]; reused: boolean }> {
		const key = notifyKey(payload);
		const hash = hashNotifyPayload(payload);
		const existing = this.records.get(key);

		if (existing) {
			if (existing.payloadHash !== hash) {
				throw new Error("notify 冲突：相同 requestId 但内容或归属不一致");
			}
			if (existing.status === "sent" && existing.messageId) {
				return {
					messageId: existing.messageId,
					messageIds: existing.messageIds,
					reused: true,
				};
			}
			const pending = this.inflight.get(key);
			if (pending) {
				const r = await pending;
				return { messageId: r.messageId, messageIds: r.messageIds, reused: true };
			}
			// failed：允许重试，落到下方发送路径
		}

		const t = this.now();
		this.records.set(key, {
			key,
			piId: payload.piId,
			requestId: payload.requestId,
			event: payload.event,
			payloadHash: hash,
			status: "sending",
			titlePreview: titlePreview(payload.title),
			retryPayload: { ...payload, actions: payload.actions ? [...payload.actions] : undefined },
			messageIds: existing?.messageIds,
			createdAt: existing?.createdAt ?? t,
			updatedAt: t,
			retryable: false,
		});
		this.evictIfNeeded();

		const promise = (async (): Promise<NotifySendResult> => {
			try {
				const raw = await sendOnce();
				const result: NotifySendResult =
					typeof raw === "string" ? { messageId: raw } : raw;
				const rec = this.records.get(key);
				if (rec) {
					rec.status = "sent";
					rec.messageId = result.messageId;
					rec.messageIds = result.messageIds?.length
						? [...result.messageIds]
						: [result.messageId];
					rec.updatedAt = this.now();
					rec.error = undefined;
					rec.retryable = false;
				}
				return result;
			} catch (error) {
				const rec = this.records.get(key);
				if (rec) {
					rec.status = "failed";
					rec.error = truncateError(
						error instanceof Error ? error.message : String(error),
					);
					rec.updatedAt = this.now();
					rec.retryable = Boolean(rec.retryPayload);
					if (error instanceof NotifyPartialSendError && error.messageIds.length > 0) {
						rec.messageIds = [...error.messageIds];
						rec.messageId = error.messageIds[0];
					}
				}
				throw error;
			} finally {
				this.inflight.delete(key);
			}
		})();

		this.inflight.set(key, promise);
		const result = await promise;
		return {
			messageId: result.messageId,
			messageIds: result.messageIds,
			reused: false,
		};
	}

	clear(): void {
		this.records.clear();
		this.inflight.clear();
	}

	private purgeExpired(): void {
		if (this.ttlMs <= 0) return;
		const now = this.now();
		for (const [key, rec] of [...this.records.entries()]) {
			if (rec.status === "sending") continue;
			if (now - rec.updatedAt > this.ttlMs) this.records.delete(key);
		}
	}

	private evictIfNeeded(): void {
		this.purgeExpired();
		if (this.records.size <= this.maxRecords) return;
		const victims = [...this.records.entries()]
			.filter(([, r]) => r.status !== "sending")
			.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
		for (const [key] of victims) {
			this.records.delete(key);
			if (this.records.size <= this.maxRecords) return;
		}
	}
}
