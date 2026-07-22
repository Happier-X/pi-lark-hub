/**
 * Hub 运行时状态轻量持久化：未决审批 + 消息绑定。
 * 不写入 secret / control token。
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	chmodSync,
	rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { replaceFileAtomic } from "./atomic-file.js";
import type { ApprovalRecord, ApprovalStatus } from "./approvals.js";
import type { MessageBinding } from "./bindings.js";

export const HUB_STATE_SCHEMA_VERSION = 1;

export type HubPersistedState = {
	schemaVersion: number;
	savedAt: number;
	approvals: ApprovalRecord[];
	bindings: MessageBinding[];
};

export function defaultStatePath(
	env: NodeJS.ProcessEnv = process.env,
	home = os.homedir(),
): string {
	return (
		env.PI_LARK_HUB_STATE?.trim() ||
		path.join(home, ".pi", "lark-hub", "state.json")
	);
}

const PERSISTABLE_STATUS = new Set<ApprovalStatus>(["pending", "failed_delivery"]);

export function filterPersistableApprovals(records: ApprovalRecord[]): ApprovalRecord[] {
	return records
		.filter((r) => PERSISTABLE_STATUS.has(r.status) && !r.deliveredToPi)
		.map((r) => ({ ...r }));
}

/** 加载；文件不存在返回空；损坏/版本不符返回 null（调用方记日志后空启动） */
export function loadHubState(filePath: string): HubPersistedState | null {
	if (!existsSync(filePath)) {
		return emptyState();
	}
	try {
		const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		if (!raw || typeof raw !== "object") return null;
		const obj = raw as Record<string, unknown>;
		const version = Number(obj.schemaVersion);
		if (version !== HUB_STATE_SCHEMA_VERSION) return null;
		const approvals = Array.isArray(obj.approvals)
			? obj.approvals.map(parseApproval).filter(Boolean) as ApprovalRecord[]
			: [];
		const bindings = Array.isArray(obj.bindings)
			? obj.bindings.map(parseBinding).filter(Boolean) as MessageBinding[]
			: [];
		return {
			schemaVersion: HUB_STATE_SCHEMA_VERSION,
			savedAt: typeof obj.savedAt === "number" ? obj.savedAt : 0,
			approvals: filterPersistableApprovals(approvals),
			bindings,
		};
	} catch {
		return null;
	}
}

export function saveHubState(
	filePath: string,
	input: {
		approvals: ApprovalRecord[];
		bindings: MessageBinding[];
		now?: number;
	},
): void {
	const state: HubPersistedState = {
		schemaVersion: HUB_STATE_SCHEMA_VERSION,
		savedAt: input.now ?? Date.now(),
		approvals: filterPersistableApprovals(input.approvals),
		bindings: input.bindings.map((b) => ({ ...b })),
	};
	mkdirSync(path.dirname(filePath), { recursive: true });
	const tmp = `${filePath}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	try {
		chmodSync(tmp, 0o600);
	} catch {
		/* Windows */
	}
	replaceFileAtomic(tmp, filePath);
}

export function clearHubStateFile(filePath: string): void {
	rmSync(filePath, { force: true });
}

export function emptyState(): HubPersistedState {
	return {
		schemaVersion: HUB_STATE_SCHEMA_VERSION,
		savedAt: 0,
		approvals: [],
		bindings: [],
	};
}

export type DebouncedPersist = {
	schedule: () => void;
	flush: () => void;
	cancel: () => void;
};

export function createDebouncedPersist(
	write: () => void,
	options?: {
		delayMs?: number;
		setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
		clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
	},
): DebouncedPersist {
	const delayMs = options?.delayMs ?? 300;
	const setTimer =
		options?.setTimer ??
		((fn, ms) => {
			const id = setTimeout(fn, ms);
			if (typeof id === "object" && id && "unref" in id) (id as NodeJS.Timeout).unref();
			return id;
		});
	const clearTimer = options?.clearTimer ?? ((id) => clearTimeout(id));
	let timer: ReturnType<typeof setTimeout> | undefined;

	const flush = () => {
		if (timer !== undefined) {
			clearTimer(timer);
			timer = undefined;
		}
		write();
	};

	return {
		schedule: () => {
			if (timer !== undefined) clearTimer(timer);
			timer = setTimer(() => {
				timer = undefined;
				try {
					write();
				} catch {
					/* 调用方 write 内部应自行 log */
				}
			}, delayMs);
		},
		flush,
		cancel: () => {
			if (timer !== undefined) {
				clearTimer(timer);
				timer = undefined;
			}
		},
	};
}

function parseApproval(raw: unknown): ApprovalRecord | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	if (typeof o.requestId !== "string" || !o.requestId.trim()) return null;
	if (typeof o.piId !== "string" || !o.piId.trim()) return null;
	const status = o.status;
	if (
		status !== "pending" &&
		status !== "approved" &&
		status !== "rejected" &&
		status !== "timeout" &&
		status !== "failed_delivery"
	) {
		return null;
	}
	const createdAt = Number(o.createdAt);
	const timeoutMs = Number(o.timeoutMs);
	if (!Number.isFinite(createdAt) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		return null;
	}
	const rec: ApprovalRecord = {
		requestId: o.requestId.trim(),
		piId: o.piId.trim(),
		status,
		createdAt,
		timeoutMs,
		deliveredToPi: Boolean(o.deliveredToPi),
	};
	if (o.decision === "approve" || o.decision === "reject") rec.decision = o.decision;
	if (typeof o.messageId === "string") rec.messageId = o.messageId;
	if (typeof o.title === "string") rec.title = o.title;
	if (typeof o.body === "string") rec.body = o.body;
	if (typeof o.actorOpenId === "string") rec.actorOpenId = o.actorOpenId;
	return rec;
}

function parseBinding(raw: unknown): MessageBinding | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	if (typeof o.messageId !== "string" || !o.messageId.trim()) return null;
	if (typeof o.piId !== "string" || !o.piId.trim()) return null;
	const createdAt = Number(o.createdAt);
	if (!Number.isFinite(createdAt)) return null;
	const b: MessageBinding = {
		messageId: o.messageId.trim(),
		piId: o.piId.trim(),
		createdAt,
	};
	if (typeof o.requestId === "string") b.requestId = o.requestId;
	if (typeof o.event === "string") b.event = o.event;
	return b;
}
