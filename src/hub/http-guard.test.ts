import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import type http from "node:http";
import {
	BodyTooLargeError,
	FixedWindowRateLimiter,
	authorizeControlHttp,
	extractControlToken,
	readBodyLimited,
	redactDiagnosticValue,
} from "./http-guard.js";

function fakeReq(headers: Record<string, string | string[] | undefined> = {}): http.IncomingMessage {
	return { headers } as http.IncomingMessage;
}

describe("authorizeControlHttp", () => {
	it("/health 始终放行", () => {
		assert.equal(
			authorizeControlHttp({ pathname: "/health", expectedToken: "sec", providedToken: undefined }).ok,
			true,
		);
	});

	it("未配置 token 时放行", () => {
		assert.equal(
			authorizeControlHttp({ pathname: "/control/message", expectedToken: "", providedToken: undefined }).ok,
			true,
		);
	});

	it("错误 token 拒绝", () => {
		const r = authorizeControlHttp({
			pathname: "/instances",
			expectedToken: "sec",
			providedToken: "nope",
		});
		assert.equal(r.ok, false);
		if (!r.ok) assert.equal(r.status, 401);
	});
});

describe("extractControlToken", () => {
	it("Bearer 与自定义头", () => {
		assert.equal(extractControlToken(fakeReq({ authorization: "Bearer abc" })), "abc");
		assert.equal(extractControlToken(fakeReq({ "x-lark-hub-token": "xyz" })), "xyz");
	});
});

describe("FixedWindowRateLimiter", () => {
	it("超限后拒绝", () => {
		let now = 1000;
		const lim = new FixedWindowRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
		assert.equal(lim.tryConsume().ok, true);
		assert.equal(lim.tryConsume().ok, true);
		assert.equal(lim.tryConsume().ok, false);
		now = 2500;
		assert.equal(lim.tryConsume().ok, true);
	});
});

describe("readBodyLimited", () => {
	it("超限抛 BodyTooLargeError", async () => {
		const req = new EventEmitter() as EventEmitter & http.IncomingMessage;
		(req as { destroy: () => void }).destroy = () => {
			req.emit("close");
		};
		const p = readBodyLimited(req, 4);
		req.emit("data", Buffer.from("12345"));
		await assert.rejects(p, (e: unknown) => e instanceof BodyTooLargeError);
	});

	it("正常读取", async () => {
		const req = new EventEmitter() as EventEmitter & http.IncomingMessage;
		(req as { destroy: () => void }).destroy = () => undefined;
		const p = readBodyLimited(req, 100);
		req.emit("data", Buffer.from("hi"));
		req.emit("end");
		assert.equal(await p, "hi");
	});
});

describe("redactDiagnosticValue", () => {
	it("截断 body 与脱敏 secret 字段", () => {
		const out = redactDiagnosticValue({
			body: "x".repeat(300),
			appSecret: "s3cr3t",
			title: "ok",
		}) as Record<string, string>;
		assert.equal(out.appSecret, "[已脱敏]");
		assert.match(out.body, /已截断/);
		assert.equal(out.title, "ok");
	});
});
