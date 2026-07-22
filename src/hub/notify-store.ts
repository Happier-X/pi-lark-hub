/**
 * Hub 出站 notify 幂等状态机：同 piId+requestId+event 单飞、重放返回原 messageId。
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

export type NotifyRecord = {
	key: string;
	piId: string;
	requestId: string;
	event: string;
	payloadHash: string;
	status: NotifyRecordStatus;
	messageId?: string;
	error?: string;
	createdAt: number;
	updatedAt: number;
};

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

export type NotifyStoreOptions = {
	maxRecords?: number;
	now?: () => number;
};

export class NotifyStore {
	private readonly records = new Map<string, NotifyRecord>();
	private readonly inflight = new Map<string, Promise<string>>();
	private readonly maxRecords: number;
	private readonly now: () => number;

	constructor(options?: NotifyStoreOptions) {
		this.maxRecords = options?.maxRecords ?? 500;
		this.now = options?.now ?? (() => Date.now());
	}

	get(key: string): NotifyRecord | undefined {
		const r = this.records.get(key);
		return r ? { ...r } : undefined;
	}

	/**
	 * 若已 sent 且 hash 匹配 → 返回 messageId；
	 * hash 冲突 → throw；
	 * 否则执行 sendOnce 单飞。
	 */
	async sendIdempotent(
		payload: NotifyPayload,
		sendOnce: () => Promise<string>,
	): Promise<{ messageId: string; reused: boolean }> {
		const key = notifyKey(payload);
		const hash = hashNotifyPayload(payload);
		const existing = this.records.get(key);

		if (existing) {
			if (existing.payloadHash !== hash) {
				throw new Error("notify 冲突：相同 requestId 但内容或归属不一致");
			}
			if (existing.status === "sent" && existing.messageId) {
				return { messageId: existing.messageId, reused: true };
			}
			const pending = this.inflight.get(key);
			if (pending) {
				const messageId = await pending;
				return { messageId, reused: true };
			}
		}

		const t = this.now();
		this.records.set(key, {
			key,
			piId: payload.piId,
			requestId: payload.requestId,
			event: payload.event,
			payloadHash: hash,
			status: "sending",
			createdAt: existing?.createdAt ?? t,
			updatedAt: t,
		});
		this.evictIfNeeded();

		const promise = (async () => {
			try {
				const messageId = await sendOnce();
				const rec = this.records.get(key);
				if (rec) {
					rec.status = "sent";
					rec.messageId = messageId;
					rec.updatedAt = this.now();
					rec.error = undefined;
				}
				return messageId;
			} catch (error) {
				const rec = this.records.get(key);
				if (rec) {
					rec.status = "failed";
					rec.error = error instanceof Error ? error.message : String(error);
					rec.updatedAt = this.now();
				}
				throw error;
			} finally {
				this.inflight.delete(key);
			}
		})();

		this.inflight.set(key, promise);
		const messageId = await promise;
		return { messageId, reused: false };
	}

	clear(): void {
		this.records.clear();
		this.inflight.clear();
	}

	private evictIfNeeded(): void {
		if (this.records.size <= this.maxRecords) return;
		for (const [key, rec] of this.records) {
			if (rec.status !== "sending") {
				this.records.delete(key);
				if (this.records.size <= this.maxRecords) return;
			}
		}
	}
}
