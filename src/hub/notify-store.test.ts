import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotifyStore, hashNotifyPayload, notifyKey } from "./notify-store.js";

const base = {
	piId: "p1",
	requestId: "r1",
	event: "task_end",
	title: "t",
	body: "b",
};

describe("NotifyStore", () => {
	it("相同 payload 第二次不重复调用 transport", async () => {
		const store = new NotifyStore();
		let calls = 0;
		const send = async () => {
			calls += 1;
			return "om_1";
		};
		const a = await store.sendIdempotent(base, send);
		const b = await store.sendIdempotent(base, send);
		assert.equal(a.messageId, "om_1");
		assert.equal(b.messageId, "om_1");
		assert.equal(a.reused, false);
		assert.equal(b.reused, true);
		assert.equal(calls, 1);
	});

	it("并发相同 key 只调用一次", async () => {
		const store = new NotifyStore();
		let calls = 0;
		let resolveSend!: (id: string) => void;
		const gate = new Promise<string>((r) => {
			resolveSend = r;
		});
		const send = async () => {
			calls += 1;
			return gate;
		};
		const p1 = store.sendIdempotent(base, send);
		const p2 = store.sendIdempotent(base, send);
		resolveSend("om_c");
		const [a, b] = await Promise.all([p1, p2]);
		assert.equal(a.messageId, "om_c");
		assert.equal(b.messageId, "om_c");
		assert.equal(calls, 1);
	});

	it("同 requestId 不同 body 冲突", async () => {
		const store = new NotifyStore();
		await store.sendIdempotent(base, async () => "om_x");
		await assert.rejects(
			() => store.sendIdempotent({ ...base, body: "other" }, async () => "om_y"),
			/冲突/,
		);
	});

	it("notifyKey / hash 稳定", () => {
		assert.equal(notifyKey(base), "p1|r1|task_end");
		assert.equal(hashNotifyPayload(base), hashNotifyPayload({ ...base }));
	});
});
