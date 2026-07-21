import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Pi 包清单使用包根 index 扩展入口以显示产品名", async () => {
	const packageJson = JSON.parse(
		await readFile(resolve(rootDir, "package.json"), "utf8"),
	) as {
		files?: string[];
		pi?: { extensions?: string[] };
	};

	assert.deepEqual(packageJson.pi?.extensions, ["./index.ts"]);
	assert.ok(packageJson.files?.includes("index.ts"));

	const entry = await readFile(resolve(rootDir, "index.ts"), "utf8");
	assert.match(entry, /export \{ default \} from "\.\/src\/index\.js";/);

	const extension = await import("../index.js");
	assert.equal(typeof extension.default, "function");
});
