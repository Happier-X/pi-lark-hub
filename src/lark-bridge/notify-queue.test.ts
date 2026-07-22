import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotifyAckQueue } from "./notify-queue.js";

const payload = {
	type: "notify" as const,
	piId: "p1",
	event: "task_end" as const,
	requestId: "r1",
	title: "t",
	body: "b",
};

describe("NotifyAckQueue", () => {
	it("ack 清除待确认项", () => {
		const sent: string[] = [];
		const q = new NotifyAckQueue({
			ackTimeoutMs: 60_000,
			send: (p) => {
				sent.push(p.requestId);
				return true;
			},
		});
		assert.equal(q.enqueue(payload).ok, true);
		assert.equal(q.size(), 1);
		assert.equal(q.ack("r1"), true);
		assert.equal(q.size(), 0);
		assert.equal(sent.length, 1);
	});

	it("超时重试直至上限后放弃", async () => {
		const timers: Array<() => void> = [];
		const sent: number[] = [];
		const given: string[] = [];
		const q = new NotifyAckQueue({
			maxAttempts: 2,
			ackTimeoutMs: 10,
			setTimer: (fn) => {
				timers.push(fn);
				return timers.length as unknown as ReturnType<typeof setTimeout>;
			},
			clearTimer: () => {},
			send: () => {
				sent.push(1);
				return true;
			},
			onGiveUp: (_item, reason) => given.push(reason),
		});
		q.enqueue(payload);
		assert.equal(sent.length, 1);
		// 第一次超时 → 第二次发送
		timers[0]!();
		assert.equal(sent.length, 2);
		// 第二次超时 → 放弃
		const last = timers[timers.length - 1]!;
		last();
		assert.equal(q.size(), 0);
		assert.ok(given.length >= 1);
	});

	it("队列满拒绝", () => {
		const q = new NotifyAckQueue({
			maxItems: 1,
			ackTimeoutMs: 60_000,
			send: () => true,
		});
		assert.equal(q.enqueue(payload).ok, true);
		assert.equal(
			q.enqueue({ ...payload, requestId: "r2" }).ok,
			false,
		);
	});
});
