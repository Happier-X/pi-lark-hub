import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FeishuRegistrationClient } from "./feishu-registration.js";

function response(value: unknown, ok = true): Response {
	return { ok, status: ok ? 200 : 500, json: async () => value } as Response;
}

describe("FeishuRegistrationClient", () => {
	it("严格解析 init/begin/poll 并返回凭证", async () => {
		const replies = [
			{ supported_auth_methods: ["client_secret"] },
			{ data: { device_code: "dc", verification_uri_complete: "https://accounts.feishu.cn/verify", interval: 0.001, expire_in: 60 } },
			{ data: { client_id: "cli_x", client_secret: "s", user_info: { open_id: "ou_owner" } } },
		];
		const client = new FeishuRegistrationClient((async () => response(replies.shift())) as typeof fetch);
		const challenge = await client.begin(Date.now());
		challenge.intervalMs = 1;
		const result = await client.poll(challenge);
		assert.equal(result.credentials.appId, "cli_x");
		assert.equal(result.ownerOpenId, "ou_owner");
	});

	it("拒绝非 HTTPS 二维码和缺失有效期", async () => {
		const replies = [{ supported_auth_methods: ["client_secret"] }, { data: { device_code: "dc", verification_uri_complete: "javascript:x", expire_in: 60 } }];
		const client = new FeishuRegistrationClient((async () => response(replies.shift())) as typeof fetch);
		await assert.rejects(() => client.begin(), /URL 无效/);
	});

	it("注册错误不回显 secret", async () => {
		const replies = [{ supported_auth_methods: ["client_secret"] }, { error: "client_secret=very-sensitive" }];
		const client = new FeishuRegistrationClient((async () => response(replies.shift())) as typeof fetch);
		await assert.rejects(() => client.begin(), (error: unknown) => error instanceof Error && !error.message.includes("very-sensitive"));
	});

	it("兼容 code/msg 及嵌套错误响应", async () => {
		const replies = [
			{ supported_auth_methods: ["client_secret"] },
			{ data: { error: { code: "registration_denied", msg: "拒绝" } } },
		];
		const client = new FeishuRegistrationClient((async () => response(replies.shift())) as typeof fetch);
		await assert.rejects(() => client.begin(), /registration_denied/);
	});
});
