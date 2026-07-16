/**
 * 多 Pi 在线注册表：注册、心跳、超时离线、默认实例。
 */

import type { Capability, InstanceSnapshot, PiStatus } from "../protocol.js";

export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000;

export type RegisteredInstance = {
	piId: string;
	displayName: string;
	cwd: string;
	pid: number;
	status: PiStatus;
	capabilities: Capability[];
	lastHeartbeatAt: number;
	connectedAt: number;
	/** 与 WebSocket 等连接绑定的 opaque 句柄 */
	connectionId: string;
};

export type RegistryEvents = {
	offline: (instance: RegisteredInstance, reason: "timeout" | "unregister" | "disconnect") => void;
	online: (instance: RegisteredInstance) => void;
	defaultChanged: (piId: string | null) => void;
};

export class InstanceRegistry {
	private readonly instances = new Map<string, RegisteredInstance>();
	private defaultPiId: string | null = null;
	private readonly heartbeatTimeoutMs: number;
	private sweeper: ReturnType<typeof setInterval> | null = null;
	private readonly listeners: Partial<RegistryEvents> = {};

	constructor(options?: { heartbeatTimeoutMs?: number }) {
		this.heartbeatTimeoutMs = options?.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
	}

	on<K extends keyof RegistryEvents>(event: K, handler: RegistryEvents[K]): void {
		this.listeners[event] = handler;
	}

	startSweeper(intervalMs = 5_000): void {
		if (this.sweeper) return;
		this.sweeper = setInterval(() => this.sweepExpired(), intervalMs);
		// 不阻止进程退出
		if (typeof this.sweeper === "object" && "unref" in this.sweeper) {
			this.sweeper.unref();
		}
	}

	stopSweeper(): void {
		if (this.sweeper) {
			clearInterval(this.sweeper);
			this.sweeper = null;
		}
	}

	getDefaultPiId(): string | null {
		return this.defaultPiId;
	}

	setDefault(piId: string | null): boolean {
		if (piId === null) {
			if (this.defaultPiId !== null) {
				this.defaultPiId = null;
				this.listeners.defaultChanged?.(null);
			}
			return true;
		}
		if (!this.instances.has(piId)) return false;
		if (this.defaultPiId !== piId) {
			this.defaultPiId = piId;
			this.listeners.defaultChanged?.(piId);
		}
		return true;
	}

	/** 仅 1 个在线时自动设为默认 */
	ensureSingleOnlineDefault(): void {
		const online = this.listOnline();
		if (online.length === 1) {
			this.setDefault(online[0]!.piId);
		} else if (online.length === 0) {
			this.setDefault(null);
		} else if (this.defaultPiId && !this.instances.has(this.defaultPiId)) {
			this.setDefault(null);
		}
	}

	register(input: {
		piId: string;
		displayName: string;
		cwd: string;
		pid: number;
		capabilities?: Capability[];
		connectionId: string;
	}): RegisteredInstance {
		const now = Date.now();
		const existing = this.instances.get(input.piId);
		const instance: RegisteredInstance = {
			piId: input.piId,
			displayName: input.displayName,
			cwd: input.cwd,
			pid: input.pid,
			status: "idle",
			capabilities: input.capabilities ?? [],
			lastHeartbeatAt: now,
			connectedAt: existing?.connectedAt ?? now,
			connectionId: input.connectionId,
		};
		this.instances.set(input.piId, instance);
		this.listeners.online?.(instance);
		this.ensureSingleOnlineDefault();
		return instance;
	}

	heartbeat(piId: string, status: PiStatus, _ts?: number): boolean {
		const instance = this.instances.get(piId);
		if (!instance) return false;
		instance.status = status;
		// 必须以服务端时间为准：客户端 ts 可被拨慢/拨快，导致误踢或永不超时
		instance.lastHeartbeatAt = Date.now();
		return true;
	}

	unregister(piId: string, reason: "timeout" | "unregister" | "disconnect" = "unregister"): boolean {
		const instance = this.instances.get(piId);
		if (!instance) return false;
		this.instances.delete(piId);
		if (this.defaultPiId === piId) {
			this.setDefault(null);
		}
		this.listeners.offline?.(instance, reason);
		this.ensureSingleOnlineDefault();
		return true;
	}

	/** 按连接断开：移除绑定该 connectionId 的实例 */
	disconnectByConnection(connectionId: string): RegisteredInstance[] {
		const removed: RegisteredInstance[] = [];
		for (const [piId, instance] of [...this.instances.entries()]) {
			if (instance.connectionId === connectionId) {
				this.unregister(piId, "disconnect");
				removed.push(instance);
			}
		}
		return removed;
	}

	get(piId: string): RegisteredInstance | undefined {
		return this.instances.get(piId);
	}

	listOnline(): RegisteredInstance[] {
		return [...this.instances.values()].sort((a, b) => a.connectedAt - b.connectedAt);
	}

	listSnapshots(): InstanceSnapshot[] {
		return this.listOnline().map((i) => ({
			piId: i.piId,
			displayName: i.displayName,
			cwd: i.cwd,
			pid: i.pid,
			status: i.status,
			capabilities: [...i.capabilities],
			lastHeartbeatAt: i.lastHeartbeatAt,
			connectedAt: i.connectedAt,
		}));
	}

	/**
	 * 按 piId 或 displayName / cwd 末段模糊解析。
	 * 精确 piId 优先；否则 displayName 或 path basename 大小写不敏感包含匹配。
	 */
	resolve(query: string): RegisteredInstance[] {
		const q = query.trim();
		if (!q) return [];
		const exact = this.instances.get(q);
		if (exact) return [exact];

		const lower = q.toLowerCase();
		const matches: RegisteredInstance[] = [];
		for (const instance of this.instances.values()) {
			const name = instance.displayName.toLowerCase();
			const base = basename(instance.cwd).toLowerCase();
			if (name === lower || base === lower || name.includes(lower) || base.includes(lower)) {
				matches.push(instance);
			}
		}
		return matches;
	}

	sweepExpired(now = Date.now()): string[] {
		const expired: string[] = [];
		for (const [piId, instance] of [...this.instances.entries()]) {
			if (now - instance.lastHeartbeatAt > this.heartbeatTimeoutMs) {
				this.unregister(piId, "timeout");
				expired.push(piId);
			}
		}
		return expired;
	}

	clear(): void {
		this.instances.clear();
		this.defaultPiId = null;
	}
}

function basename(p: string): string {
	const normalized = p.replace(/\\/g, "/");
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? p;
}
