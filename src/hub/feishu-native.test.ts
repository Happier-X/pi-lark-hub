import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NativeFeishuTransport, NativeFeishuWsInbound } from "./feishu-native.js";

const credentials = { appId: "cli_x", appSecret: "secret", brand: "feishu" as const, updatedAt: 1 };

describe("NativeFeishuTransport", () => {
	it("优先发送 interactive 卡片并返回真实 message_id", async () => {
		let input: any;
		const t = new NativeFeishuTransport(credentials, {
			userId: "ou_owner",
			client: {
				im: {
					message: {
						create: async (v: unknown) => {
							input = v;
							return { data: { message_id: "om_1" } };
						},
					},
				},
			},
		});
		assert.deepEqual(await t.send({ title: "标题", body: "正文", event: "task_end" }), {
			messageId: "om_1",
		});
		assert.equal(input.params.receive_id_type, "open_id");
		assert.equal(input.data.receive_id, "ou_owner");
		assert.equal(input.data.msg_type, "interactive");
		const card = JSON.parse(input.data.content) as {
			header: { title: { content: string }; template: string };
			elements: Array<{ tag: string; content: string }>;
		};
		assert.equal(card.header.title.content, "标题");
		assert.equal(card.header.template, "green");
		assert.equal(card.elements[0]!.tag, "markdown");
		assert.equal(card.elements[0]!.content, "正文");
	});

	it("表格/代码块原样进入 markdown content", async () => {
		let input: any;
		const body = "| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\n1\n```";
		const t = new NativeFeishuTransport(credentials, {
			userId: "ou_owner",
			client: {
				im: {
					message: {
						create: async (v: unknown) => {
							input = v;
							return { data: { message_id: "om_md" } };
						},
					},
				},
			},
		});
		await t.send({ title: "摘要", body });
		const card = JSON.parse(input.data.content) as { elements: Array<{ content: string }> };
		assert.equal(card.elements[0]!.content, body);
	});

	it("超长 body 分成多个卡片且完整发送", async () => {
		const inputs: any[] = [];
		const t = new NativeFeishuTransport(credentials, {
			userId: "ou_owner",
			client: {
				im: {
					message: {
						create: async (v: unknown) => {
							inputs.push(v);
							return { data: { message_id: `om_long_${inputs.length}` } };
						},
					},
				},
			},
		});
		const body = "x".repeat(5000);
		await t.send({ title: "长", body });
		const cards = inputs.map((input) => JSON.parse(input.data.content) as { elements: Array<{ content: string }> });
		assert.ok(cards.some((card) => card.elements.length > 1));

		inputs.length = 0;
		const manyBody = "x".repeat(3000 * 11);
		await t.send({ title: "长", body: manyBody });
		assert.ok(inputs.length > 1);
		const manyCards = inputs.map((input) => JSON.parse(input.data.content) as { elements: Array<{ content: string }> });
		assert.equal(manyCards.flatMap((card) => card.elements.map((element) => element.content)).join(""), manyBody);
		assert.equal(cards.flatMap((card) => card.elements.map((element) => element.content)).join(""), body);
	});

	it("多卡片中途失败时不重复降级", async () => {
		let calls = 0;
		const t = new NativeFeishuTransport(credentials, {
			userId: "ou_owner",
			client: {
				im: { message: { create: async () => {
					calls += 1;
					if (calls === 2) throw new Error("second card boom");
					return { data: { message_id: `om_${calls}` } };
				} } },
			},
		});
		await assert.rejects(() => t.send({ title: "长", body: "x".repeat(3000 * 11) }), /分批发送失败/);
		assert.equal(calls, 2);
	});

	it("卡片失败时降级 text 并返回 text 的 message_id", async () => {
		const calls: any[] = [];
		const t = new NativeFeishuTransport(credentials, {
			userId: "ou_owner",
			client: {
				im: {
					message: {
						create: async (v: unknown) => {
							calls.push(v);
							if (calls.length === 1) throw new Error("card boom");
							return { data: { message_id: "om_text" } };
						},
					},
				},
			},
		});
		assert.deepEqual(await t.send({ title: "标题", body: "正文" }), { messageId: "om_text" });
		assert.equal(calls.length, 2);
		assert.equal(calls[0].data.msg_type, "interactive");
		assert.equal(calls[1].data.msg_type, "text");
		const text = JSON.parse(calls[1].data.content) as { text: string };
		assert.equal(text.text, "标题\n正文");
	});

	it("卡片与 text 均失败时抛出中文汇总错误且不回显 secret", async () => {
		const secret = credentials.appSecret;
		const t = new NativeFeishuTransport(credentials, {
			userId: "ou_owner",
			client: {
				im: {
					message: {
						create: async () => {
							throw new Error(`fail with ${secret}`);
						},
					},
				},
			},
		});
		await assert.rejects(
			() => t.send({ title: "t", body: "b" }),
			(err: unknown) => {
				assert.ok(err instanceof Error);
				assert.match(err.message, /卡片与纯文本均失败/);
				assert.match(err.message, /已脱敏/);
				// 必须不回显真实 appSecret 原文（不仅是字段名）
				assert.equal(err.message.includes(secret), false);
				assert.doesNotMatch(err.message, /appSecret|app_secret\s*=/i);
				return true;
			},
		);
	});

	it("未绑定主人时关闭发送，setRecipient 后立即可发", async () => {
		const t = new NativeFeishuTransport(credentials, {
			client: {
				im: {
					message: {
						create: async () => ({ data: { message_id: "om_pair" } }),
					},
				},
			},
		});
		await assert.rejects(() => t.send({ body: "x" }), /lark/);
		t.setRecipient({ userId: "ou_new" });
		assert.equal((await t.send({ body: "x" })).messageId, "om_pair");
	});

	it("WS fixture 解析并在 stop 时关闭 SDK", async () => {
		let closed = false;
		let received = "";
		const ws = {
			start: async () => {},
			getConnectionStatus: () => ({ state: "connected" as const }),
			close: () => {
				closed = true;
			},
		};
		const inbound = new NativeFeishuWsInbound(
			credentials,
			{
				onMessage: async (input) => {
					received = `${input.openId}:${input.text}`;
					return { ok: true, reply: "" };
				},
			},
			{ ws, dispatcher: {} },
		);
		await inbound.start();
		await inbound.accept({
			event: {
				sender: { sender_id: { open_id: "ou_x" } },
				message: { content: JSON.stringify({ text: "你好" }) },
			},
		});
		assert.equal(received, "ou_x:你好");
		inbound.stop();
		assert.equal(closed, true);
	});

	it("SDK start 返回但未连接时，等待真实连接并超时", async () => {
		const ws = {
			start: async () => {},
			getConnectionStatus: () => ({ state: "connecting" as const }),
			close: () => {},
		};
		const inbound = new NativeFeishuWsInbound(
			credentials,
			{ onMessage: async () => ({ ok: true, reply: "" }) },
			{ ws, dispatcher: {}, readyTimeoutMs: 10, readyPollMs: 1 },
		);
		await assert.rejects(() => inbound.start(), /就绪超时/);
	});

	it("连接状态变为 connected 后才报告就绪", async () => {
		let calls = 0;
		const ws = {
			start: async () => {},
			getConnectionStatus: () => ({
				state: (calls++ > 1 ? "connected" : "connecting") as "connected" | "connecting",
			}),
			close: () => {},
		};
		const inbound = new NativeFeishuWsInbound(
			credentials,
			{ onMessage: async () => ({ ok: true, reply: "" }) },
			{ ws, dispatcher: {}, readyTimeoutMs: 100, readyPollMs: 1 },
		);
		await inbound.start();
	});
});
