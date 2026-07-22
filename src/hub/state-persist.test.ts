import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
	createDebouncedPersist,
	filterPersistableApprovals,
	loadHubState,
	saveHubState,
} from "./state-persist.js";

describe("state-persist", () => {
	it("save/load 往返保留 pending", () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "hub-state-"));
		const file = path.join(dir, "state.json");
		try {
			saveHubState(file, {
				approvals: [
					{
						requestId: "r1",
						piId: "pi-a",
						status: "pending",
						createdAt: 1000,
						timeoutMs: 60_000,
						deliveredToPi: false,
						title: "t",
						body: "b",
					},
					{
						requestId: "r2",
						piId: "pi-a",
						status: "approved",
						createdAt: 1,
						timeoutMs: 1,
						deliveredToPi: true,
						decision: "approve",
					},
				],
				bindings: [
					{ messageId: "om1", piId: "pi-a", requestId: "r1", event: "approval", createdAt: 1000 },
				],
				now: 2000,
			});
			const loaded = loadHubState(file);
			assert.ok(loaded);
			assert.equal(loaded!.approvals.length, 1);
			assert.equal(loaded!.approvals[0]!.requestId, "r1");
			assert.equal(loaded!.bindings.length, 1);
			assert.equal(loaded!.savedAt, 2000);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("损坏 JSON 返回 null", () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "hub-state-"));
		const file = path.join(dir, "bad.json");
		try {
			writeFileSync(file, "{not json", "utf8");
			assert.equal(loadHubState(file), null);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("错误 schemaVersion 返回 null", () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "hub-state-"));
		const file = path.join(dir, "v.json");
		try {
			writeFileSync(file, JSON.stringify({ schemaVersion: 99, approvals: [], bindings: [] }), "utf8");
			assert.equal(loadHubState(file), null);
			assert.ok(readFileSync(file, "utf8").includes("99"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("filter 去掉已投递 terminal", () => {
		const out = filterPersistableApprovals([
			{
				requestId: "a",
				piId: "p",
				status: "failed_delivery",
				createdAt: 1,
				timeoutMs: 1,
				deliveredToPi: false,
				decision: "reject",
			},
			{
				requestId: "b",
				piId: "p",
				status: "pending",
				createdAt: 1,
				timeoutMs: 1,
				deliveredToPi: true,
			},
		]);
		assert.equal(out.length, 1);
		assert.equal(out[0]!.requestId, "a");
	});

	it("debounce 合并多次 schedule", async () => {
		let n = 0;
		let now = 0;
		const timers: Array<{ fn: () => void; at: number }> = [];
		const d = createDebouncedPersist(
			() => {
				n++;
			},
			{
				delayMs: 10,
				setTimer: (fn, ms) => {
					const handle = { id: timers.length };
					timers.push({ fn, at: now + ms });
					return handle as unknown as ReturnType<typeof setTimeout>;
				},
				clearTimer: () => {
					timers.length = 0;
				},
			},
		);
		d.schedule();
		d.schedule();
		assert.equal(timers.length, 1);
		timers[0]!.fn();
		assert.equal(n, 1);
		d.flush();
		assert.equal(n, 2);
	});
});
