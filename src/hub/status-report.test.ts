import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatHubStatusReport,
	isStatusCommand,
	type HubStatusSnapshot,
} from "./status-report.js";

const base: HubStatusSnapshot = {
	packageVersion: "0.1.0",
	host: "127.0.0.1",
	port: 8765,
	pid: 123,
	feishuMode: "native",
	ownerBound: true,
	needsPairing: false,
	credentialsPresent: true,
	credentialsUpdatedAt: Date.parse("2026-07-22T00:00:00.000Z"),
	defaultPiId: "pi-a",
	online: [
		{
			piId: "pi-a",
			displayName: "demo",
			cwd: "/tmp/demo",
			pid: 1,
			status: "idle",
			capabilities: ["approval"],
			lastHeartbeatAt: 1,
			connectedAt: 1,
		},
	],
	pendingApprovals: 0,
	bindingCount: 2,
	nativeWsAttached: true,
};

describe("isStatusCommand", () => {
	it("识别中英文", () => {
		assert.equal(isStatusCommand("状态"), true);
		assert.equal(isStatusCommand("status"), true);
		assert.equal(isStatusCommand("诊断"), true);
		assert.equal(isStatusCommand("列表"), false);
	});
});

describe("formatHubStatusReport", () => {
	it("含版本与脱敏建议，不含 secret 形态字段", () => {
		const text = formatHubStatusReport(base);
		assert.match(text, /版本=0\.1\.0/);
		assert.match(text, /主人绑定=是/);
		assert.match(text, /凭证=已落盘/);
		assert.match(text, /运行正常/);
		assert.doesNotMatch(text, /appSecret|client_secret/i);
	});

	it("未开局给出扫码建议", () => {
		const text = formatHubStatusReport({
			...base,
			ownerBound: false,
			needsPairing: true,
			credentialsPresent: false,
			credentialsUpdatedAt: 0,
			online: [],
			defaultPiId: null,
			nativeWsAttached: false,
		});
		assert.match(text, /扫码开局/);
		assert.match(text, /无在线 Pi/);
	});
});
