/**
 * 可选：lark-cli event consume 入站（im.message.receive_v1）。
 * 启动失败只告警，不拖垮 Hub；HTTP /control/* 仍可用。
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { ApprovalDecision } from "../protocol.js";

export type InboundControlHandlers = {
	/** 与 HTTP POST /control/message 等价 */
	onMessage: (input: {
		text: string;
		openId?: string;
		replyToMessageId?: string;
	}) => Promise<{ ok: boolean; reply: string }>;
	/** 与 HTTP POST /control/approval 等价（若文本未覆盖） */
	onApproval?: (input: {
		requestId: string;
		decision: ApprovalDecision;
		openId?: string;
	}) => Promise<{ ok: boolean; reply: string }>;
	/** 将 Hub 回复发回飞书（可选；无则仅 log） */
	replyToUser?: (text: string) => Promise<void>;
};

export type FeishuInboundOptions = {
	as?: "bot" | "user" | "auto";
	/** 默认 lark-cli */
	cliPath?: string;
	/** 事件 key，默认 im.message.receive_v1 */
	eventKey?: string;
	handlers: InboundControlHandlers;
	log?: (line: string) => void;
	/** 注入 spawn（测试） */
	spawnFn?: typeof spawn;
	/** 忽略自身 bot 消息等：返回 true 则跳过 */
	shouldSkip?: (event: ParsedInboundMessage) => boolean;
};

export type ParsedInboundMessage = {
	openId?: string;
	text: string;
	messageId?: string;
	/** 若事件带父消息/被回复 id，用于 reply 路由 */
	replyToMessageId?: string;
	chatId?: string;
	chatType?: string;
	raw: unknown;
};

export type FeishuInboundConsumer = {
	/** 进程是否仍在尝试运行 */
	running: boolean;
	/** 启动是否已确认 ready（stderr marker） */
	ready: boolean;
	stop: () => void;
};

const QUIET_ENV: NodeJS.ProcessEnv = {
	LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
	LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
};

/**
 * 后台启动 event consume。失败仅 log，返回 running=false 的 handle。
 * 注意：无界 consume 需要保持 stdin 打开；此处用 IPC 管道占位避免立即 EOF。
 */
export function startFeishuInbound(
	options: FeishuInboundOptions,
): FeishuInboundConsumer {
	const log = options.log ?? ((line: string) => console.log(line));
	const cliPath = options.cliPath ?? "lark-cli";
	const eventKey = options.eventKey ?? "im.message.receive_v1";
	const as = options.as ?? "bot";
	const spawnFn = options.spawnFn ?? spawn;

	let child: ChildProcess | null = null;
	let stopped = false;
	let ready = false;
	let lineBuf = "";

	const handle: FeishuInboundConsumer = {
		get running() {
			return Boolean(child && !stopped && child.exitCode === null);
		},
		get ready() {
			return ready;
		},
		stop: () => {
			stopped = true;
			if (child) {
				try {
					// 优先 SIGTERM，避免 kill -9 泄漏订阅
					child.kill("SIGTERM");
				} catch {
					// ignore
				}
				// 关闭 stdin 作为优雅退出信号
				try {
					child.stdin?.end();
				} catch {
					// ignore
				}
				child = null;
			}
		},
	};

	try {
		// stdin: pipe 保持打开，避免无界 consume 因 EOF 立即退出
		child = spawnFn(
			cliPath,
			["event", "consume", eventKey, "--as", as],
			{
				env: { ...process.env, ...QUIET_ENV },
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			},
		);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		log(`[feishu-inbound] 无法启动 event consume: ${msg}；仅 HTTP 控制面可用`);
		return handle;
	}

	child.on("error", (err) => {
		log(
			`[feishu-inbound] 进程错误: ${err.message}。请确认 lark-cli 已安装且 auth 有效；将继续仅使用 HTTP /control/*`,
		);
	});

	child.stderr?.on("data", (chunk: Buffer | string) => {
		const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
		for (const line of text.split(/\r?\n/)) {
			if (!line.trim()) continue;
			if (line.includes("[event] ready")) {
				ready = true;
				log(`[feishu-inbound] ready event_key=${eventKey}`);
			} else if (line.includes('"ok":false') || /error|Error|failed/i.test(line)) {
				log(`[feishu-inbound][stderr] ${line.slice(0, 500)}`);
			}
		}
	});

	child.stdout?.on("data", (chunk: Buffer | string) => {
		const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
		lineBuf += text;
		const parts = lineBuf.split(/\r?\n/);
		lineBuf = parts.pop() ?? "";
		for (const line of parts) {
			void processNdjsonLine(line, options, log);
		}
	});

	child.on("close", (code, signal) => {
		if (stopped) return;
		log(
			`[feishu-inbound] event consume 已退出 code=${code} signal=${signal ?? "-"}；HTTP /control/* 仍可用。可用 curl 模拟入站或检查：lark-cli event list`,
		);
		child = null;
		ready = false;
	});

	log(
		`[feishu-inbound] 已启动: ${cliPath} event consume ${eventKey} --as ${as}`,
	);
	return handle;
}

async function processNdjsonLine(
	line: string,
	options: FeishuInboundOptions,
	log: (line: string) => void,
): Promise<void> {
	const trimmed = line.trim();
	if (!trimmed) return;

	let raw: unknown;
	try {
		raw = JSON.parse(trimmed);
	} catch {
		log(`[feishu-inbound] 跳过非 JSON 行: ${trimmed.slice(0, 120)}`);
		return;
	}

	const parsed = parseInboundEvent(raw);
	if (!parsed || !parsed.text.trim()) {
		return;
	}

	if (options.shouldSkip?.(parsed)) {
		return;
	}

	log(
		`[feishu-inbound] message openId=${parsed.openId ?? "-"} replyTo=${parsed.replyToMessageId ?? "-"} text=${parsed.text.slice(0, 80)}`,
	);

	try {
		const result = await options.handlers.onMessage({
			text: parsed.text,
			openId: parsed.openId,
			replyToMessageId: parsed.replyToMessageId,
		});
		if (result.reply && options.handlers.replyToUser) {
			await options.handlers.replyToUser(result.reply);
		} else if (result.reply) {
			log(`[feishu-inbound] hub 回复（未回写飞书）: ${result.reply.slice(0, 200)}`);
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		log(`[feishu-inbound] 处理消息失败: ${msg}`);
	}
}

/**
 * 解析 event consume 输出。字段以 schema 为准；额外尝试 parent/root 以支持回复绑定。
 */
export function parseInboundEvent(raw: unknown): ParsedInboundMessage | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;

	// 兼容 { event: {...} } 与扁平
	const event =
		obj.event && typeof obj.event === "object"
			? (obj.event as Record<string, unknown>)
			: obj;

	const message =
		event.message && typeof event.message === "object"
			? (event.message as Record<string, unknown>)
			: event;

	const text = extractText(event, message);
	if (text === null) return null;

	const openId =
		pickString(event, ["sender_id", "open_id", "senderId"]) ??
		pickNestedOpenId(event) ??
		pickNestedOpenId(message);

	const messageId =
		pickString(event, ["message_id", "messageId", "id"]) ??
		pickString(message, ["message_id", "message_id", "messageId", "id"]);

	const replyToMessageId =
		pickString(event, [
			"parent_id",
			"parentId",
			"root_id",
			"rootId",
			"reply_message_id",
			"replyToMessageId",
			"upper_message_id",
		]) ??
		pickString(message, [
			"parent_id",
			"parentId",
			"root_id",
			"rootId",
			"upper_message_id",
		]);

	const chatId =
		pickString(event, ["chat_id", "chatId"]) ??
		pickString(message, ["chat_id", "chatId"]);
	const chatType =
		pickString(event, ["chat_type", "chatType"]) ??
		pickString(message, ["chat_type", "chatType"]);

	return {
		openId: openId || undefined,
		text: text.trim(),
		messageId: messageId || undefined,
		replyToMessageId: replyToMessageId || undefined,
		chatId: chatId || undefined,
		chatType: chatType || undefined,
		raw,
	};
}

function extractText(
	event: Record<string, unknown>,
	message: Record<string, unknown>,
): string | null {
	// lark-cli process hook：content 多为纯文本
	const content =
		pickString(event, ["content"]) ?? pickString(message, ["content"]);
	if (content !== undefined) {
		// interactive 可能是 JSON；尝试解析 text 字段，否则原样
		const t = content.trim();
		if (t.startsWith("{")) {
			try {
				const j = JSON.parse(t) as { text?: string };
				if (typeof j.text === "string") return j.text;
			} catch {
				// keep as-is
			}
		}
		return content;
	}

	const body = message.body;
	if (body && typeof body === "object") {
		const b = body as Record<string, unknown>;
		if (typeof b.content === "string") {
			try {
				const j = JSON.parse(b.content) as { text?: string };
				if (typeof j.text === "string") return j.text;
			} catch {
				return b.content;
			}
			return b.content;
		}
	}

	if (typeof event.text === "string") return event.text;
	return null;
}

function pickString(
	obj: Record<string, unknown>,
	keys: string[],
): string | undefined {
	for (const k of keys) {
		const v = obj[k];
		if (typeof v === "string" && v.trim()) return v.trim();
	}
	return undefined;
}

function pickNestedOpenId(obj: Record<string, unknown>): string | undefined {
	const sender = obj.sender;
	if (sender && typeof sender === "object") {
		const s = sender as Record<string, unknown>;
		const id = s.sender_id ?? s.id;
		if (id && typeof id === "object") {
			const ids = id as Record<string, unknown>;
			if (typeof ids.open_id === "string") return ids.open_id;
		}
		if (typeof s.open_id === "string") return s.open_id;
	}
	return undefined;
}
