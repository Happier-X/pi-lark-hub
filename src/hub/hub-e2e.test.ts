/**
 * Hub HTTP/WS 端到端：真实 startHubServer + ws 客户端 + Noop 飞书。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import WebSocket from "ws";
import { serializeMessage } from "../protocol.js";
import { NoopFeishuTransport } from "./feishu-transport.js";
import { startHubServer, type HubServer } from "./server.js";

const OWNER = "ou_e2e_owner";

async function withHub(
	options: {
		controlToken?: string;
		feishu?: NoopFeishuTransport;
	},
	fn: (hub: HubServer, ctx: { httpOrigin: string; feishu: NoopFeishuTransport }) => Promise<void>,
): Promise<void> {
	const feishu = options.feishu ?? new NoopFeishuTransport();
	const hub = await startHubServer({
		host: "127.0.0.1",
		port: 0,
		feishu,
		allowedOpenIds: [OWNER],
		controlToken: options.controlToken,
		disableStatePersist: true,
		log: () => {},
	});
	const httpOrigin = `http://127.0.0.1:${hub.port}`;
	try {
		await fn(hub, { httpOrigin, feishu });
	} finally {
		await hub.close();
	}
}

function connectWs(port: number): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}`);
		const t = setTimeout(() => reject(new Error("ws open timeout")), 5_000);
		ws.once("open", () => {
			clearTimeout(t);
			resolve(ws);
		});
		ws.once("error", (e) => {
			clearTimeout(t);
			reject(e);
		});
	});
}

function onceJson(
	ws: WebSocket,
	predicate: (msg: Record<string, unknown>) => boolean,
	timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			ws.off("message", onMsg);
			reject(new Error("onceJson timeout"));
		}, timeoutMs);
		const onMsg = (data: WebSocket.RawData) => {
			try {
				const msg = JSON.parse(String(data)) as Record<string, unknown>;
				if (predicate(msg)) {
					clearTimeout(timer);
					ws.off("message", onMsg);
					resolve(msg);
				}
			} catch {
				/* ignore non-json */
			}
		};
		ws.on("message", onMsg);
	});
}

async function registerPi(ws: WebSocket, piId = "pi-e2e"): Promise<string> {
	const okP = onceJson(ws, (m) => m.type === "register_ok");
	ws.send(
		serializeMessage({
			type: "register",
			piId,
			displayName: "e2e",
			cwd: "/tmp/e2e",
			pid: process.pid,
			capabilities: ["approval"],
		}),
	);
	const ok = await okP;
	assert.equal(ok.piId, piId);
	return piId;
}

async function httpJson(
	origin: string,
	pathname: string,
	init?: RequestInit & { token?: string },
): Promise<{ status: number; body: any }> {
	const headers: Record<string, string> = {
		...(init?.headers as Record<string, string>),
	};
	if (init?.token) headers.Authorization = `Bearer ${init.token}`;
	if (init?.body && !headers["Content-Type"]) {
		headers["Content-Type"] = "application/json";
	}
	const res = await fetch(`${origin}${pathname}`, { ...init, headers });
	const text = await res.text();
	let body: unknown = text;
	try {
		body = JSON.parse(text);
	} catch {
		/* keep text */
	}
	return { status: res.status, body };
}

describe("Hub e2e", () => {
	it("register 后 /health 可见在线实例", async () => {
		await withHub({}, async (hub, { httpOrigin }) => {
			const ws = await connectWs(hub.port);
			try {
				await registerPi(ws, "pi-online");
				const health = await httpJson(httpOrigin, "/health");
				assert.equal(health.status, 200);
				assert.equal(health.body.ok, true);
				assert.ok(
					Array.isArray(health.body.online) &&
						health.body.online.some((i: { piId: string }) => i.piId === "pi-online"),
				);
			} finally {
				ws.close();
			}
		});
	});

	it("畸形协议帧回 error 且连接仍可用", async () => {
		await withHub({}, async (hub) => {
			const ws = await connectWs(hub.port);
			try {
				const errP = onceJson(ws, (m) => m.type === "error");
				ws.send("{not-json");
				const err = await errP;
				assert.equal(typeof err.message, "string");
				await registerPi(ws, "pi-after-bad");
			} finally {
				ws.close();
			}
		});
	});

	it("notify 幂等：相同 requestId 仅一次出站", async () => {
		const feishu = new NoopFeishuTransport({ idFactory: () => "om-fixed" });
		await withHub({ feishu }, async (hub) => {
			const ws = await connectWs(hub.port);
			try {
				const piId = await registerPi(ws, "pi-n");
				const payload = {
					type: "notify" as const,
					piId,
					event: "task_end" as const,
					requestId: "req-same",
					title: "t",
					body: "hello",
				};
				const ack1 = onceJson(ws, (m) => m.type === "notify_ack" && m.requestId === "req-same");
				ws.send(serializeMessage(payload));
				await ack1;
				const ack2 = onceJson(ws, (m) => m.type === "notify_ack" && m.requestId === "req-same");
				ws.send(serializeMessage(payload));
				await ack2;
				assert.equal(feishu.sent.length, 1);
			} finally {
				ws.close();
			}
		});
	});

	it("POST /control/message 投递 user_message", async () => {
		await withHub({}, async (hub, { httpOrigin }) => {
			const ws = await connectWs(hub.port);
			try {
				await registerPi(ws, "pi-msg");
				const umP = onceJson(ws, (m) => m.type === "user_message");
				const res = await httpJson(httpOrigin, "/control/message", {
					method: "POST",
					body: JSON.stringify({ text: "跑一下测试", openId: OWNER }),
				});
				assert.equal(res.status, 200);
				assert.equal(res.body.ok, true);
				const um = await umP;
				assert.equal(um.text, "跑一下测试");
				assert.equal(um.piId, "pi-msg");
			} finally {
				ws.close();
			}
		});
	});

	it("control token：/health 免鉴权，/instances 需 token", async () => {
		await withHub({ controlToken: "secret-e2e" }, async (hub, { httpOrigin }) => {
			const health = await httpJson(httpOrigin, "/health");
			assert.equal(health.status, 200);
			assert.equal(health.body.controlTokenRequired, true);

			const denied = await httpJson(httpOrigin, "/instances");
			assert.equal(denied.status, 401);

			const ok = await httpJson(httpOrigin, "/instances", { token: "secret-e2e" });
			assert.equal(ok.status, 200);
			assert.ok("instances" in ok.body || "defaultPiId" in ok.body);
		});
	});
});
