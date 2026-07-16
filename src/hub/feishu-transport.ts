/**
 * 飞书出站传输抽象。阶段 2 起 send 返回 messageId 供绑定；
 * Console 实现打印并生成 console-<uuid>。
 */

import { randomUUID } from "node:crypto";

export type FeishuOutboundMessage = {
	title?: string;
	body: string;
	piId?: string;
	event?: string;
	requestId?: string;
	actions?: string[];
};

export type FeishuSendResult = {
	messageId: string;
};

export interface FeishuTransport {
	/**
	 * 向授权用户发送文本/摘要/卡片。
	 * 必须返回可绑定的 messageId（真实 IM 的 message_id 或 console 合成 id）。
	 */
	send(message: FeishuOutboundMessage): Promise<FeishuSendResult>;

	/**
	 * @deprecated 请用 send；保留兼容旧调用方，默认委托 send。
	 */
	sendText?(message: FeishuOutboundMessage): Promise<void>;

	/** 发送审批卡片（阶段 3）；可与 send 合并 */
	sendApprovalCard?(message: FeishuOutboundMessage): Promise<FeishuSendResult>;
}

/** 开发期：打印到 stdout，返回 console-<uuid> */
export class ConsoleFeishuTransport implements FeishuTransport {
	/** 最近出站记录，便于 GET /notifications 调试 */
	readonly history: Array<FeishuOutboundMessage & { messageId: string; sentAt: number }> = [];
	private readonly maxHistory: number;

	constructor(options?: { maxHistory?: number }) {
		this.maxHistory = options?.maxHistory ?? 100;
	}

	async send(message: FeishuOutboundMessage): Promise<FeishuSendResult> {
		const messageId = `console-${randomUUID()}`;
		const prefix = message.piId ? `[feishu→user][${message.piId}]` : "[feishu→user]";
		const title = message.title ? `${message.title}\n` : "";
		const event = message.event ? ` event=${message.event}` : "";
		const req = message.requestId ? ` requestId=${message.requestId}` : "";
		console.log(`${prefix}${event}${req} messageId=${messageId}\n${title}${message.body}`);
		this.pushHistory({ ...message, messageId, sentAt: Date.now() });
		return { messageId };
	}

	async sendText(message: FeishuOutboundMessage): Promise<void> {
		await this.send(message);
	}

	async sendApprovalCard(message: FeishuOutboundMessage): Promise<FeishuSendResult> {
		const actions = (message.actions ?? ["approve", "reject"]).join("|");
		const withTitle = {
			...message,
			title: message.title ?? "approval",
			body: `[card actions=${actions}]\n${message.body}`,
		};
		const result = await this.send(withTitle);
		// 阶段 3 模拟卡片回调路径提示
		if (message.requestId) {
			console.log(
				`[feishu-sim] approve: POST /control/approval {"requestId":"${message.requestId}","decision":"approve"}`,
			);
			console.log(
				`[feishu-sim] reject:  POST /control/approval {"requestId":"${message.requestId}","decision":"reject"}`,
			);
		}
		return result;
	}

	private pushHistory(
		entry: FeishuOutboundMessage & { messageId: string; sentAt: number },
	): void {
		this.history.push(entry);
		while (this.history.length > this.maxHistory) {
			this.history.shift();
		}
	}
}

/** 测试用：可预测 messageId 或自定义生成 */
export class NoopFeishuTransport implements FeishuTransport {
	readonly sent: Array<FeishuOutboundMessage & { messageId: string }> = [];
	private seq = 0;
	private readonly idFactory?: () => string;

	constructor(options?: { idFactory?: () => string }) {
		this.idFactory = options?.idFactory;
	}

	async send(message: FeishuOutboundMessage): Promise<FeishuSendResult> {
		const messageId = this.idFactory?.() ?? `noop-${++this.seq}`;
		this.sent.push({ ...message, messageId });
		return { messageId };
	}
}
