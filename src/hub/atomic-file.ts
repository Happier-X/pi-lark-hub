import { existsSync, renameSync, unlinkSync } from "node:fs";

export type AtomicReplaceFs = {
	existsSync(path: string): boolean;
	renameSync(from: string, to: string): void;
	unlinkSync(path: string): void;
};

const defaultFs: AtomicReplaceFs = { existsSync, renameSync, unlinkSync };

/**
 * 将已写好的临时文件替换为目标文件。
 *
 * Windows 不能直接 rename 覆盖已有文件，因此先把旧目标移动到备份；若新文件
 * 提交失败，立即把备份恢复到原路径，避免“先删旧文件”造成配置或凭证丢失。
 */
export function replaceFileAtomic(
	tmpPath: string,
	targetPath: string,
	options: { fs?: AtomicReplaceFs; backupPath?: string } = {},
): void {
	const fs = options.fs ?? defaultFs;
	try {
		fs.renameSync(tmpPath, targetPath);
		return;
	} catch (firstError) {
		if (!fs.existsSync(targetPath)) {
			try { fs.unlinkSync(tmpPath); } catch { /* 尽力清理 */ }
			throw firstError;
		}
	}

	const backupPath = options.backupPath ?? `${targetPath}.${process.pid}.${Date.now()}.bak`;
	try {
		fs.renameSync(targetPath, backupPath);
	} catch (backupError) {
		try { fs.unlinkSync(tmpPath); } catch { /* 尽力清理 */ }
		throw backupError;
	}

	try {
		fs.renameSync(tmpPath, targetPath);
	} catch (replaceError) {
		try {
			fs.renameSync(backupPath, targetPath);
		} catch (restoreError) {
			throw new AggregateError(
				[replaceError, restoreError],
				`替换 ${targetPath} 失败，且旧文件恢复失败；旧文件仍保留在 ${backupPath}`,
			);
		}
		try { fs.unlinkSync(tmpPath); } catch { /* 尽力清理 */ }
		throw replaceError;
	}

	try { fs.unlinkSync(backupPath); } catch { /* 新目标已提交，备份清理由后续覆盖处理 */ }
}
