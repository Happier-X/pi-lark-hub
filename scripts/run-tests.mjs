#!/usr/bin/env node
/**
 * 递归收集 src 下 *.test.ts 并用 tsx --test 运行（跨平台，避免 shell glob）。
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(root, "src");

function collectTests(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const full = path.join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) collectTests(full, out);
		else if (name.endsWith(".test.ts")) out.push(full);
	}
	return out;
}

const files = collectTests(srcRoot).sort();
if (files.length === 0) {
	console.error("[run-tests] 未找到任何测试文件");
	process.exit(1);
}

const require = createRequire(import.meta.url);
let tsxCli;
try {
	tsxCli = require.resolve("tsx/cli");
} catch {
	console.error("[run-tests] 未找到 tsx，请先 npm install");
	process.exit(1);
}

const rel = files.map((f) => path.relative(root, f));
console.log(`[run-tests] ${rel.length} 个测试文件`);

const result = spawnSync(process.execPath, [tsxCli, "--test", ...rel], {
	cwd: root,
	stdio: "inherit",
	env: process.env,
});

if (result.error) {
	console.error(result.error);
	process.exit(1);
}
process.exit(result.status ?? 1);
