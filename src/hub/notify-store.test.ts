import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	NotifyPartialSendError,
	NotifyStore,
	hashNotifyPayload,
	notifyKey,
} from "./notify-store.js";

const base = {
	piId: "pi-a",
	requestId: "req-1",
	event: "task_end",
	title: "t",
	body: "b",
};

describe("NotifyStore", () => {
	it("相同 payload 第二次不重复调用 transport", async () => {
		const store = new NotifyStore();
		let n = 0;
		const send = async () => {
			n++;
			return "om_1";
		};
		const a = await store.sendIdempotent(base, send);
		const b = await store.sendIdempotent(base, send);
		assert.equal(a.messageId, "om_1");
		assert.equal(b.reused, true);
		assert.equal(n, 1);
		assert.equal(store.list()[0]?.status, "sent");
	});

	it("并发相同 key 只调用一次", async () => {
		const store = new NotifyStore();
		let n = 0;
		const send = async () => {
			n++;
			await new Promise((r) => setTimeout(r, 20));
			return "om_c";
		};
		const p1 = store.sendIdempotent(base, send);
		const p2 = store.sendIdempotent(base, send);
		const [a, b] = await Promise.all([p1, p2]);
		assert.equal(a.messageId, b.messageId);
		assert.equal(n, 1);
	});

	it("同 requestId 不同 body 冲突", async () => {
		const store = new NotifyStore();
		await store.sendIdempotent(base, async () => "om_x");
		await assert.rejects(
			() => store.sendIdempotent({ ...base, body: "other" }, async () => "om_y"),
			/冲突/,
		);
	});

	it("failed 可重试；list 无 body", async () => {
		const store = new NotifyStore();
		let n = 0;
		await assert.rejects(
			() =>
				store.sendIdempotent(base, async () => {
					n++;
					throw new Error("boom secret=abc");
				}),
			/boom/,
		);
		const listed = store.list();
		assert.equal(listed[0]?.status, "failed");
		assert.equal(listed[0]?.retryable, true);
		assert.ok(!JSON.stringify(listed).includes('"body"'));
		assert.match(listed[0]?.error ?? "", /密钥|boom/);

		const r = await store.sendIdempotent(base, async () => {
			n++;
			return { messageId: "om_ok", messageIds: ["om_ok"] };
		});
		assert.equal(r.messageId, "om_ok");
		assert.equal(n, 2);
		assert.equal(store.get(notifyKey(base))?.status, "sent");
	});

	it("partial 失败记录 messageIds", async () => {
		const store = new NotifyStore();
		await assert.rejects(
			() =>
				store.sendIdempotent(base, async () => {
					throw new NotifyPartialSendError("mid fail", ["om_a", "om_b"]);
				}),
			/mid fail/,
		);
		const rec = store.findByRequestId("req-1");
		assert.deepEqual(rec?.messageIds, ["om_a", "om_b"]);
		assert.equal(rec?.status, "failed");
	});

	it("notifyKey / hash 稳定", () => {
		assert.equal(notifyKey(base), "pi-a|req-1|task_end");
		assert.equal(hashNotifyPayload(base), hashNotifyPayload({ ...base }));
	});
});
