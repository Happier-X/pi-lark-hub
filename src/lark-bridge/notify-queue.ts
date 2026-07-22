/**
 * Bridge 侧 notify 待确认队列：等待 notify_ack，超时有限重试。
 */

export type PendingNotifyPayload = {
	type: "notify";
	piId: string;
	event: "approval" | "task_end";
	requestId: string;
	title: string;
	body: string;
	actions?: Array<"approve" | "reject">;
	timeoutMs?: number;
};

export type PendingNotifyItem = {
	payload: PendingNotifyPayload;
	attempts: number;
	firstSentAt: number;
	lastSentAt: number;
	timer?: ReturnType<typeof setTimeout>;
};

export type NotifyQueueOptions = {
	maxItems?: number;
	maxAttempts?: number;
	ackTimeoutMs?: number;
	now?: () => number;
	setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
	clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
	/** 实际发送；返回 false 表示 socket 不可用 */
	send?: (payload: PendingNotifyPayload) => boolean;
	onGiveUp?: (item: PendingNotifyItem, reason: string) => void;
};

export class NotifyAckQueue {
	private readonly items = new Map<string, PendingNotifyItem>();
	private readonly maxItems: number;
	private readonly maxAttempts: number;
	private readonly ackTimeoutMs: number;
	private readonly now: () => number;
	private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
	private readonly clearTimer: (id: ReturnType<typeof setTimeout>) => void;
	private sendFn: (payload: PendingNotifyPayload) => boolean;
	private onGiveUp?: (item: PendingNotifyItem, reason: string) => void;

	constructor(options?: NotifyQueueOptions) {
		this.maxItems = options?.maxItems ?? 50;
		this.maxAttempts = options?.maxAttempts ?? 3;
		this.ackTimeoutMs = options?.ackTimeoutMs ?? 8_000;
		this.now = options?.now ?? (() => Date.now());
		this.setTimer =
			options?.setTimer ??
			((fn, ms) => {
				const id = setTimeout(fn, ms);
				if (typeof id === "object" && id && "unref" in id) (id as NodeJS.Timeout).unref();
				return id;
			});
		this.clearTimer = options?.clearTimer ?? ((id) => clearTimeout(id));
		this.sendFn = options?.send ?? (() => false);
		this.onGiveUp = options?.onGiveUp;
	}

	setSend(send: (payload: PendingNotifyPayload) => boolean): void {
		this.sendFn = send;
	}

	size(): number {
		return this.items.size;
	}

	/** 入队并立即发送（若未满） */
	enqueue(payload: PendingNotifyPayload): { ok: boolean; reason?: string } {
		const id = payload.requestId;
		if (this.items.has(id)) {
			// 已有未确认：重置超时并再发一次（不增加 attempts 超过上限逻辑在 tick）
			this.arm(id);
			this.sendFn(payload);
			return { ok: true };
		}
		if (this.items.size >= this.maxItems) {
			return { ok: false, reason: "notify 待确认队列已满" };
		}
		const t = this.now();
		const item: PendingNotifyItem = {
			payload,
			attempts: 0,
			firstSentAt: t,
			lastSentAt: t,
		};
		this.items.set(id, item);
		this.attemptSend(id);
		return { ok: true };
	}

	ack(requestId: string): boolean {
		const item = this.items.get(requestId);
		if (!item) return false;
		this.clearItemTimer(item);
		this.items.delete(requestId);
		return true;
	}

	/** 重连后重放全部未确认 */
	flush(): void {
		for (const id of [...this.items.keys()]) {
			this.attemptSend(id);
		}
	}

	clear(): void {
		for (const item of this.items.values()) this.clearItemTimer(item);
		this.items.clear();
	}

	private attemptSend(requestId: string): void {
		const item = this.items.get(requestId);
		if (!item) return;
		if (item.attempts >= this.maxAttempts) {
			this.giveUp(requestId, "超过最大重试次数");
			return;
		}
		item.attempts += 1;
		item.lastSentAt = this.now();
		const ok = this.sendFn(item.payload);
		if (!ok && item.attempts >= this.maxAttempts) {
			this.giveUp(requestId, "发送通道不可用");
			return;
		}
		this.arm(requestId);
	}

	private arm(requestId: string): void {
		const item = this.items.get(requestId);
		if (!item) return;
		this.clearItemTimer(item);
		item.timer = this.setTimer(() => {
			const cur = this.items.get(requestId);
			if (!cur) return;
			if (cur.attempts >= this.maxAttempts) {
				this.giveUp(requestId, "等待 notify_ack 超时");
				return;
			}
			this.attemptSend(requestId);
		}, this.ackTimeoutMs);
	}

	private giveUp(requestId: string, reason: string): void {
		const item = this.items.get(requestId);
		if (!item) return;
		this.clearItemTimer(item);
		this.items.delete(requestId);
		this.onGiveUp?.(item, reason);
	}

	private clearItemTimer(item: PendingNotifyItem): void {
		if (item.timer !== undefined) {
			this.clearTimer(item.timer);
			item.timer = undefined;
		}
	}
}
