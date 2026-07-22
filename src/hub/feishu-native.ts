import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuCredentials } from "./credentials.js";
import type { InboundControlHandlers } from "./feishu-native-inbound.js";
import { parseCardActionTrigger, parseInboundEvent } from "./feishu-native-inbound.js";
import {
	buildInteractiveCardContents,
	buildPlainTextContents,
	templateForEvent,
} from "./feishu-outbound-format.js";
import type { FeishuOutboundMessage, FeishuSendResult, FeishuTransport } from "./feishu-transport.js";

export type NativeClientLike = {
	im: { message: { create(input: unknown): Promise<any> } };
	request?(input: unknown): Promise<any>;
};

function redactSecrets(text: string, secret?: string): string {
	let out = text;
	if (secret && secret.length > 0) {
		out = out.split(secret).join("[已脱敏]");
	}
	// 避免偶发把 app_secret 字段值原样抛出
	out = out.replace(/app[_-]?secret["\s:=]+[^\s"',}]+/gi, "app_secret=[已脱敏]");
	return out;
}

function errorMessage(e: unknown, secret?: string): string {
	const raw = e instanceof Error ? e.message : String(e);
	return redactSecrets(raw, secret);
}

function extractMessageId(response: any): string | undefined {
	const id = response?.data?.message_id ?? response?.message_id;
	return typeof id === "string" && id.length > 0 ? id : undefined;
}

export class NativeFeishuTransport implements FeishuTransport {
	private userId?: string;
	private chatId?: string;
	private client: NativeClientLike;

	constructor(
		private credentials: FeishuCredentials,
		options: { userId?: string; chatId?: string; client?: NativeClientLike } = {},
	) {
		this.userId = options.userId;
		this.chatId = options.chatId;
		this.client =
			options.client ??
			(new Lark.Client({
				appId: credentials.appId,
				appSecret: credentials.appSecret,
				appType: Lark.AppType.SelfBuild,
				domain: credentials.brand === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu,
			}) as unknown as NativeClientLike);
	}

	setRecipient(input: { userId?: string; chatId?: string }) {
		if (input.userId && input.chatId) throw new Error("原生飞书收件人不能同时设置 userId/chatId");
		this.userId = input.userId;
		this.chatId = input.chatId;
	}

	async send(message: FeishuOutboundMessage): Promise<FeishuSendResult> {
		const receiveId = this.userId ?? this.chatId;
		if (!receiveId) throw new Error("原生飞书尚未绑定主人，请执行 /lark");

		const receiveIdType = this.userId ? "open_id" : "chat_id";
		const base = {
			params: { receive_id_type: receiveIdType },
			data: { receive_id: receiveId },
		};

		const decisions = (message.actions ?? []).filter(
			(a): a is "approve" | "reject" => a === "approve" || a === "reject",
		);
		const cardContents = buildInteractiveCardContents(message.title, message.body, {
			template: templateForEvent(message.event),
			approvalActions:
				message.event === "approval" && message.requestId && decisions.length > 0
					? { requestId: message.requestId, decisions }
					: undefined,
		});

		try {
			let firstId: string | undefined;
			for (const content of cardContents) {
				const r = await this.client.im.message.create({
					...base,
					data: { ...base.data, msg_type: "interactive", content },
				});
				const id = extractMessageId(r);
				if (!id) throw new Error("响应缺少 message_id");
				firstId ??= id;
			}
			return { messageId: firstId! };
		} catch (cardError) {
			const cardReason = errorMessage(cardError, this.credentials.appSecret);
			// 分批卡片只有首批失败时才可安全降级，避免部分卡片后重复发送完整正文。
			if (cardContents.length > 1) {
				throw new Error(`原生飞书卡片分批发送失败：${cardReason}`);
			}
			console.log(`[feishu-native] 卡片发送失败，降级纯文本：${cardReason}`);

			try {
				const textContents = buildPlainTextContents(message.title, message.body);
				let firstId: string | undefined;
				for (const content of textContents) {
					const r = await this.client.im.message.create({
						...base,
						data: { ...base.data, msg_type: "text", content },
					});
					const id = extractMessageId(r);
					if (!id) throw new Error("响应缺少 message_id");
					firstId ??= id;
				}
				return { messageId: firstId! };
			} catch (textError) {
				const textReason = errorMessage(textError, this.credentials.appSecret);
				throw new Error(
					`原生飞书发送失败：卡片与纯文本均失败。卡片：${cardReason}；纯文本：${textReason}`,
				);
			}
		}
	}

	async probeBotOpenId(): Promise<string | undefined> {
		const r = await this.client.request?.({ method: "GET", url: "/open-apis/bot/v3/info" });
		return r?.bot?.open_id ?? r?.data?.bot?.open_id;
	}

	/** 审批卡片：与 send 同路径（含按钮） */
	async sendApprovalCard(message: FeishuOutboundMessage): Promise<FeishuSendResult> {
		return this.send({
			...message,
			event: message.event ?? "approval",
			actions: message.actions?.length ? message.actions : ["approve", "reject"],
		});
	}
}

export type NativeWsConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "failed";
export type NativeWsLike = {
	start(input: { eventDispatcher: unknown }): Promise<void> | void;
	getConnectionStatus(): { state: NativeWsConnectionState };
	close?(input?: { force?: boolean }): void;
};

export class NativeFeishuWsInbound {
	private ws: NativeWsLike;
	private dispatcher: any;
	private readyTimeoutMs: number;
	private readyPollMs: number;
	private log: (s: string) => void;

	constructor(
		credentials: FeishuCredentials,
		private handlers: InboundControlHandlers,
		options: {
			ws?: NativeWsLike;
			dispatcher?: any;
			log?: (s: string) => void;
			readyTimeoutMs?: number;
			readyPollMs?: number;
		} = {},
	) {
		this.log = options.log ?? console.log;
		this.readyTimeoutMs = options.readyTimeoutMs ?? 15_000;
		this.readyPollMs = options.readyPollMs ?? 25;
		this.dispatcher =
			options.dispatcher ??
			new Lark.EventDispatcher({}).register({
				"im.message.receive_v1": (raw: unknown) => void this.accept(raw),
				"card.action.trigger": (raw: unknown) => this.acceptCardAction(raw),
			});
		this.ws =
			options.ws ??
			(new Lark.WSClient({
				appId: credentials.appId,
				appSecret: credentials.appSecret,
				domain: credentials.brand === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu,
				handshakeTimeoutMs: this.readyTimeoutMs,
			}) as unknown as NativeWsLike);
	}

	async start() {
		const deadline = Date.now() + this.readyTimeoutMs;
		let startTimer: NodeJS.Timeout | undefined;
		try {
			await Promise.race([
				Promise.resolve(this.ws.start({ eventDispatcher: this.dispatcher })),
				new Promise<never>((_, reject) => {
					startTimer = setTimeout(
						() => reject(new Error(`WebSocket SDK start 超时（${this.readyTimeoutMs}ms）`)),
						this.readyTimeoutMs,
					);
				}),
			]);
		} finally {
			if (startTimer) clearTimeout(startTimer);
		}
		this.log("[feishu-native] WebSocket 已发起连接，等待握手完成");
		while (Date.now() < deadline) {
			const state = this.ws.getConnectionStatus().state;
			if (state === "connected") {
				this.log("[feishu-native] WebSocket 已连接");
				return;
			}
			if (state === "failed") throw new Error("WebSocket 连接失败");
			await new Promise((resolve) => setTimeout(resolve, this.readyPollMs));
		}
		throw new Error(`WebSocket 连接就绪超时（${this.readyTimeoutMs}ms）`);
	}

	stop() {
		this.ws.close?.({ force: true });
	}

	async accept(raw: unknown) {
		const p = parseInboundEvent(raw);
		if (!p?.text) return;
		try {
			const r = await this.handlers.onMessage({
				text: p.text,
				openId: p.openId,
				replyToMessageId: p.replyToMessageId,
			});
			if (r.reply && this.handlers.replyToUser) await this.handlers.replyToUser(r.reply);
		} catch (e) {
			this.log(`[feishu-native] 入站处理失败：${e instanceof Error ? e.message : String(e)}`);
		}
	}

	async acceptCardAction(raw: unknown): Promise<Record<string, unknown>> {
		const action = parseCardActionTrigger(raw);
		if (!action) {
			return cardActionToast("warning", "无法识别的卡片操作");
		}
		if (!this.handlers.onApprovalAction) {
			return cardActionToast("warning", "Hub 未启用审批回调");
		}
		try {
			const r = await this.handlers.onApprovalAction({
				requestId: action.requestId,
				decision: action.decision,
				openId: action.openId,
			});
			const ok = r.ok;
			return cardActionToast(ok ? "success" : "error", r.reply || (ok ? "已处理" : "处理失败"));
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			this.log(`[feishu-native] 卡片审批回调失败：${message}`);
			return cardActionToast("error", "审批处理异常");
		}
	}
}

function cardActionToast(type: "info" | "success" | "error" | "warning", content: string) {
	return {
		toast: {
			type,
			content: content.slice(0, 200),
		},
	};
}
