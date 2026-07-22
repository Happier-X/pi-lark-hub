/**
 * 审批状态机：pending → approve|reject|timeout → terminal。
 * 重复决策幂等；超时向在线 Pi 下发 reject；离线不改投其他实例。
 */

import type { ApprovalDecision } from "../protocol.js";

export type ApprovalStatus =
	| "pending"
	| "approved"
	| "rejected"
	| "timeout"
	| "failed_delivery";

export type ApprovalRecord = {
	requestId: string;
	piId: string;
	status: ApprovalStatus;
	decision?: ApprovalDecision;
	createdAt: number;
	timeoutMs: number;
	messageId?: string;
	title?: string;
	body?: string;
	actorOpenId?: string;
	/** 是否已向 Pi 投递过 approval_result（幂等保护） */
	deliveredToPi: boolean;
};

export type CreateApprovalInput = {
	requestId: string;
	piId: string;
	timeoutMs?: number;
	messageId?: string;
	title?: string;
	body?: string;
	createdAt?: number;
};

export type DecideApprovalResult =
	| {
			kind: "decided";
			record: ApprovalRecord;
			/** 是否应向 Pi 发送 approval_result */
			shouldDeliver: boolean;
			offline: boolean;
	  }
	| { kind: "already_handled"; record: ApprovalRecord }
	| { kind: "not_found" };

export type TimeoutResult =
	| {
			kind: "timed_out";
			record: ApprovalRecord;
			shouldDeliver: boolean;
			offline: boolean;
	  }
	| { kind: "already_handled"; record: ApprovalRecord }
	| { kind: "not_found" };

export const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export type ApprovalStoreOptions = {
	defaultTimeoutMs?: number;
	/**
	 * 定时器触发时回调 requestId；调用方应 `applyTimeout(requestId, isPiOnline)`
	 * 并在 shouldDeliver 时向 Pi 下发 approval_result(reject)。
	 */
	onTimeoutFire?: (requestId: string) => void;
	now?: () => number;
	setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
	clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
};

export class ApprovalStore {
	private readonly records = new Map<string, ApprovalRecord>();
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly defaultTimeoutMs: number;
	private readonly onTimeoutFire?: (requestId: string) => void;
	private readonly now: () => number;
	private readonly setTimer: (
		fn: () => void,
		ms: number,
	) => ReturnType<typeof setTimeout>;
	private readonly clearTimer: (id: ReturnType<typeof setTimeout>) => void;

	constructor(options?: ApprovalStoreOptions) {
		this.defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
		this.onTimeoutFire = options?.onTimeoutFire;
		this.now = options?.now ?? (() => Date.now());
		this.setTimer =
			options?.setTimer ??
			((fn, ms) => {
				const id = setTimeout(fn, ms);
				if (typeof id === "object" && id && "unref" in id) {
					(id as NodeJS.Timeout).unref();
				}
				return id;
			});
		this.clearTimer = options?.clearTimer ?? ((id) => clearTimeout(id));
	}

	create(input: CreateApprovalInput): ApprovalRecord {
		const requestId = input.requestId.trim();
		if (!requestId) throw new Error("requestId 不能为空");
		if (!input.piId.trim()) throw new Error("piId 不能为空");

		const existing = this.records.get(requestId);
		if (existing) {
			// 已 terminal：不覆盖（幂等）
			if (existing.status !== "pending") {
				return cloneRecord(existing);
			}
			// pending 同 piId：不重置超时、不覆盖正文
			if (existing.piId === input.piId) {
				return cloneRecord(existing);
			}
			// pending 不同 piId：冲突，禁止改投
			throw new Error(
				`审批 requestId 冲突：${requestId} 已归属 ${existing.piId}，拒绝改写为 ${input.piId}`,
			);
		}

		const timeoutMs =
			typeof input.timeoutMs === "number" && input.timeoutMs > 0
				? input.timeoutMs
				: this.defaultTimeoutMs;

		const record: ApprovalRecord = {
			requestId,
			piId: input.piId,
			status: "pending",
			createdAt: input.createdAt ?? this.now(),
			timeoutMs,
			messageId: input.messageId,
			title: input.title,
			body: input.body,
			deliveredToPi: false,
		};
		this.records.set(requestId, record);
		this.armTimeout(requestId, timeoutMs);
		return cloneRecord(record);
	}

	setMessageId(requestId: string, messageId: string): ApprovalRecord | undefined {
		const record = this.records.get(requestId.trim());
		if (!record) return undefined;
		record.messageId = messageId;
		return cloneRecord(record);
	}

	get(requestId: string): ApprovalRecord | undefined {
		const record = this.records.get(requestId.trim());
		return record ? cloneRecord(record) : undefined;
	}

	/**
	 * 按 requestId 前缀解析；仅当唯一匹配时返回，否则 null。
	 */
	resolveByPrefix(prefix: string): ApprovalRecord | null {
		const p = prefix.trim().toLowerCase();
		if (!p) return null;
		const matches: ApprovalRecord[] = [];
		for (const record of this.records.values()) {
			if (record.requestId.toLowerCase().startsWith(p)) {
				matches.push(record);
			}
		}
		return matches.length === 1 ? cloneRecord(matches[0]!) : null;
	}

	list(): ApprovalRecord[] {
		return [...this.records.values()]
			.map(cloneRecord)
			.sort((a, b) => a.createdAt - b.createdAt);
	}

	listPending(): ApprovalRecord[] {
		return this.list().filter((r) => r.status === "pending");
	}

	/**
	 * 用户决策（approve / reject）。
	 * - pending + 在线 → terminal + shouldDeliver
	 * - pending + 离线 → failed_delivery + 不投递（不改投其他 Pi）
	 * - 已成功投递 Pi → already_handled（幂等，不二次执行）
	 * - terminal/failed 但未投递 → 允许重试投递（保留首次决策，不改投其他 Pi）
	 */
	decide(input: {
		requestId: string;
		decision: ApprovalDecision;
		actorOpenId?: string;
		isPiOnline: (piId: string) => boolean;
	}): DecideApprovalResult {
		const requestId = input.requestId.trim();
		const record = this.records.get(requestId);
		if (!record) return { kind: "not_found" };

		// 仅在已向 Pi 成功投递后视为真正幂等终态
		if (record.deliveredToPi) {
			return { kind: "already_handled", record: cloneRecord(record) };
		}

		this.clearTimeoutTimer(requestId);

		// 未投递的 terminal / failed_delivery：保留首次决策，允许重试投递
		if (record.status !== "pending") {
			const decision = record.decision ?? input.decision;
			if (!decision) {
				return { kind: "already_handled", record: cloneRecord(record) };
			}
			record.decision = decision;
			record.actorOpenId = input.actorOpenId ?? record.actorOpenId;
			const online = input.isPiOnline(record.piId);
			if (!online) {
				record.status = "failed_delivery";
				return {
					kind: "decided",
					record: cloneRecord(record),
					shouldDeliver: false,
					offline: true,
				};
			}
			record.status = decision === "approve" ? "approved" : "rejected";
			return {
				kind: "decided",
				record: cloneRecord(record),
				shouldDeliver: true,
				offline: false,
			};
		}

		const online = input.isPiOnline(record.piId);
		record.decision = input.decision;
		record.actorOpenId = input.actorOpenId;

		if (!online) {
			record.status = "failed_delivery";
			return {
				kind: "decided",
				record: cloneRecord(record),
				shouldDeliver: false,
				offline: true,
			};
		}

		record.status = input.decision === "approve" ? "approved" : "rejected";
		return {
			kind: "decided",
			record: cloneRecord(record),
			shouldDeliver: true,
			offline: false,
		};
	}

	/** 成功向 Pi 投递后标记，防止重复执行 */
	markDelivered(requestId: string): void {
		const record = this.records.get(requestId.trim());
		if (record) record.deliveredToPi = true;
	}

	/** 投递失败：标 failed_delivery，保留 decision，允许后续重试 */
	markFailedDelivery(requestId: string): void {
		const record = this.records.get(requestId.trim());
		if (!record || record.deliveredToPi) return;
		record.status = "failed_delivery";
	}

	/**
	 * 应用超时：pending → timeout（decision=reject）。
	 * 离线 → failed_delivery，shouldDeliver=false。
	 */
	applyTimeout(
		requestId: string,
		isPiOnline: (piId: string) => boolean,
	): TimeoutResult {
		const id = requestId.trim();
		const record = this.records.get(id);
		if (!record) return { kind: "not_found" };

		if (record.status !== "pending" || record.deliveredToPi) {
			return { kind: "already_handled", record: cloneRecord(record) };
		}

		this.clearTimeoutTimer(id);
		record.decision = "reject";

		const online = isPiOnline(record.piId);
		if (!online) {
			record.status = "failed_delivery";
			return {
				kind: "timed_out",
				record: cloneRecord(record),
				shouldDeliver: false,
				offline: true,
			};
		}

		record.status = "timeout";
		return {
			kind: "timed_out",
			record: cloneRecord(record),
			shouldDeliver: true,
			offline: false,
		};
	}

	/** 测试/关闭：清理全部定时器与记录 */
	clear(): void {
		for (const id of [...this.timers.keys()]) {
			this.clearTimeoutTimer(id);
		}
		this.records.clear();
	}

	private armTimeout(requestId: string, timeoutMs: number): void {
		const timer = this.setTimer(() => {
			this.timers.delete(requestId);
			// 仅通知外部；状态转换由 applyTimeout 负责（需真实 isPiOnline）
			if (this.onTimeoutFire) {
				this.onTimeoutFire(requestId);
			} else {
				// 无回调时仍标记 timeout，避免永久 pending
				this.applyTimeout(requestId, () => true);
			}
		}, timeoutMs);
		this.timers.set(requestId, timer);
	}

	private clearTimeoutTimer(requestId: string): void {
		const timer = this.timers.get(requestId);
		if (timer !== undefined) {
			this.clearTimer(timer);
			this.timers.delete(requestId);
		}
	}
}

function cloneRecord(record: ApprovalRecord): ApprovalRecord {
	return { ...record };
}

/**
 * 解析「批准 <requestId前缀>」/「拒绝 <…>」。
 * 返回 null 表示非审批文本命令。
 */
export function parseApprovalTextCommand(
	text: string,
): { decision: ApprovalDecision; requestIdPrefix: string } | null {
	const normalized = text.trim();
	const approve = normalized.match(
		/^(批准|同意|允许|approve|yes)\s+(\S+)$/i,
	);
	if (approve) {
		return { decision: "approve", requestIdPrefix: approve[2]! };
	}
	const reject = normalized.match(
		/^(拒绝|不同意|禁止|reject|no)\s+(\S+)$/i,
	);
	if (reject) {
		return { decision: "reject", requestIdPrefix: reject[2]! };
	}
	return null;
}
