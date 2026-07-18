import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os"; import path from "node:path"; import { describe, it } from "node:test";
import { credentialsPath, loadCredentials, saveCredentials } from "./credentials.js";
describe("credentials", () => { it("独立原子落盘并可读", () => { const dir = mkdtempSync(path.join(os.tmpdir(), "lark-cred-")); try { const file = path.join(dir, "credentials.json"); saveCredentials({ appId: "cli_x", appSecret: "s", brand: "feishu" }, file); assert.equal(loadCredentials(file)?.appSecret, "s"); assert.equal(credentialsPath({ PI_LARK_HUB_CREDENTIALS: file }), file); } finally { rmSync(dir, { recursive: true, force: true }); } }); });
