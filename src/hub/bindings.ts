/**
 * 出站通知绑定：messageId → piId（及可选 requestId / event）。
 * 用于飞书「回复某条消息」精确路由，禁止串线。
 */

import type { NotifyEvent } from "../protocol.js";

export type MessageBinding = {
	messageId: string;
	piId: string;
	requestId?: string;
	event?: NotifyEvent | string;
	createdAt: number;
};

export type MessageBindingStoreOptions = {
	/** 绑定存活时间；0 或未设表示 MVP 内存无界（仅受 purge 调用影响） */
	ttlMs?: number;
};

export class MessageBindingStore {
	private readonly bindings = new Map<string, MessageBinding>();
	private readonly ttlMs: number;

	constructor(options?: MessageBindingStoreOptions) {
		// 默认 24h；0 表示不自动按 TTL 过期（仍可手动 delete / clear）
		this.ttlMs = options?.ttlMs ?? 24 * 60 * 60 * 1000;
	}

	bind(input: {
		messageId: string;
		piId: string;
		requestId?: string;
		event?: NotifyEvent | string;
		createdAt?: number;
	}): MessageBinding {
		const messageId = input.messageId.trim();
		if (!messageId) {
			throw new Error("messageId 不能为空");
		}
		const binding: MessageBinding = {
			messageId,
			piId: input.piId,
			requestId: input.requestId,
			event: input.event,
			createdAt: input.createdAt ?? Date.now(),
		};
		this.bindings.set(messageId, binding);
		return binding;
	}

	get(messageId: string, now = Date.now()): MessageBinding | undefined {
		const id = messageId.trim();
		if (!id) return undefined;
		const binding = this.bindings.get(id);
		if (!binding) return undefined;
		if (this.isExpired(binding, now)) {
			this.bindings.delete(id);
			return undefined;
		}
		return binding;
	}

	delete(messageId: string): boolean {
		return this.bindings.delete(messageId.trim());
	}

	/** 清理过期绑定；ttlMs===0 时不做 TTL 清理 */
	purgeExpired(now = Date.now()): number {
		if (this.ttlMs <= 0) return 0;
		let removed = 0;
		for (const [id, binding] of [...this.bindings.entries()]) {
			if (this.isExpired(binding, now)) {
				this.bindings.delete(id);
				removed++;
			}
		}
		return removed;
	}

	list(now = Date.now()): MessageBinding[] {
		this.purgeExpired(now);
		return [...this.bindings.values()].sort((a, b) => a.createdAt - b.createdAt);
	}

	size(now = Date.now()): number {
		this.purgeExpired(now);
		return this.bindings.size;
	}

	clear(): void {
		this.bindings.clear();
	}

	/** 批量恢复（跳过过期） */
	restoreFromPersisted(items: MessageBinding[], now = Date.now()): number {
		let n = 0;
		for (const item of items) {
			const messageId = item.messageId?.trim();
			if (!messageId || !item.piId?.trim()) continue;
			const binding: MessageBinding = {
				messageId,
				piId: item.piId.trim(),
				requestId: item.requestId,
				event: item.event,
				createdAt: item.createdAt,
			};
			if (this.isExpired(binding, now)) continue;
			this.bindings.set(messageId, binding);
			n++;
		}
		return n;
	}

	private isExpired(binding: MessageBinding, now: number): boolean {
		if (this.ttlMs <= 0) return false;
		return now - binding.createdAt > this.ttlMs;
	}
}
