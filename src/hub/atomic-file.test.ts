import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replaceFileAtomic, type AtomicReplaceFs } from "./atomic-file.js";

describe("replaceFileAtomic", () => {
	it("Windows 式覆盖失败时恢复旧文件", () => {
		const files = new Set(["target", "tmp"]);
		const fs: AtomicReplaceFs = {
			existsSync: (p) => files.has(p),
			renameSync: (from, to) => {
				if (from === "tmp" && to === "target") throw new Error("目标被占用");
				if (!files.delete(from)) throw new Error("源不存在");
				files.add(to);
			},
			unlinkSync: (p) => { files.delete(p); },
		};
		assert.throws(() => replaceFileAtomic("tmp", "target", { fs, backupPath: "backup" }), /目标被占用/);
		assert.equal(files.has("target"), true);
		assert.equal(files.has("backup"), false);
	});
});
