import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCardActionTrigger } from "./feishu-native-inbound.js";

describe("parseCardActionTrigger", () => {
	it("解析 operator open_id 与 value", () => {
		const r = parseCardActionTrigger({
			event: {
				operator: { open_id: "ou_owner" },
				action: {
					value: { v: 1, kind: "approval", requestId: "req-x", decision: "approve" },
				},
			},
		});
		assert.deepEqual(r, {
			requestId: "req-x",
			decision: "approve",
			openId: "ou_owner",
		});
	});

	it("value 为 JSON 字符串亦可", () => {
		const r = parseCardActionTrigger({
			operator: { open_id: "ou_2" },
			action: {
				value: JSON.stringify({
					kind: "approval",
					requestId: "r2",
					decision: "reject",
				}),
			},
		});
		assert.equal(r?.decision, "reject");
		assert.equal(r?.openId, "ou_2");
	});

	it("不信任 value 内 open_id 冒充 operator", () => {
		const r = parseCardActionTrigger({
			event: {
				operator: { open_id: "ou_real" },
				action: {
					value: {
						kind: "approval",
						requestId: "r",
						decision: "approve",
						open_id: "ou_fake",
					},
				},
			},
		});
		assert.equal(r?.openId, "ou_real");
	});

	it("非法 decision 返回 null", () => {
		assert.equal(
			parseCardActionTrigger({
				action: { value: { requestId: "r", decision: "maybe" } },
			}),
			null,
		);
	});
});
