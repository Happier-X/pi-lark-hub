/** 飞书原生 WebSocket 入站的通用消息解析。 */
export type InboundControlHandlers = {
	onMessage: (input: {
		text: string;
		openId?: string;
		replyToMessageId?: string;
	}) => Promise<{ ok: boolean; reply: string }>;
	replyToUser?: (text: string) => Promise<void>;
	/** 卡片审批按钮回调（card.action.trigger） */
	onApprovalAction?: (input: {
		requestId: string;
		decision: "approve" | "reject";
		openId?: string;
	}) => Promise<{ ok: boolean; reply: string }>;
};
export type ParsedInboundMessage = {
	openId?: string;
	text: string;
	messageId?: string;
	replyToMessageId?: string;
	chatId?: string;
	chatType?: string;
	raw: unknown;
};

export type ParsedCardApprovalAction = {
	requestId: string;
	decision: "approve" | "reject";
	openId?: string;
};

/**
 * 解析 card.action.trigger 回调。
 * open_id 只从 operator/sender 取，不信任 value 内身份字段。
 */
export function parseCardActionTrigger(raw: unknown): ParsedCardApprovalAction | null {
	if (!raw || typeof raw !== "object") return null;
	const root = raw as Record<string, unknown>;
	const event =
		root.event && typeof root.event === "object"
			? (root.event as Record<string, unknown>)
			: root;

	const openId =
		pickNestedOperatorOpenId(event) ??
		pickNestedOpenId(event) ??
		pickString(event, ["open_id", "openId"]);

	const action =
		event.action && typeof event.action === "object"
			? (event.action as Record<string, unknown>)
			: event;

	let value: unknown = action.value ?? event.value;
	if (typeof value === "string") {
		const t = value.trim();
		if (t.startsWith("{")) {
			try {
				value = JSON.parse(t);
			} catch {
				return null;
			}
		} else {
			return null;
		}
	}
	if (!value || typeof value !== "object") return null;
	const v = value as Record<string, unknown>;
	if (v.kind !== "approval" && v.kind !== undefined) return null;
	const requestId = typeof v.requestId === "string" ? v.requestId.trim() : "";
	const decision = v.decision;
	if (!requestId) return null;
	if (decision !== "approve" && decision !== "reject") return null;
	return { requestId, decision, openId: openId || undefined };
}

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
	// 飞书事件 content 通常为 JSON 文本
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

function pickNestedOperatorOpenId(obj: Record<string, unknown>): string | undefined {
	const operator = obj.operator;
	if (operator && typeof operator === "object") {
		const o = operator as Record<string, unknown>;
		if (typeof o.open_id === "string" && o.open_id.trim()) return o.open_id.trim();
		const id = o.operator_id ?? o.user_id;
		if (id && typeof id === "object") {
			const ids = id as Record<string, unknown>;
			if (typeof ids.open_id === "string") return ids.open_id;
		}
	}
	return undefined;
}
