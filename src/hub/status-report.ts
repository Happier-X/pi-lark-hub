/**
 * Hub 诊断状态：纯函数格式化 + 命令识别。
 * 禁止输出 secret / 完整 openId / 完整隐私正文。
 */

import type { InstanceSnapshot } from "../protocol.js";
import { formatOnlineList } from "./router.js";

export type HubStatusSnapshot = {
	packageVersion: string;
	host: string;
	port: number;
	pid?: number;
	feishuMode: string;
	ownerBound: boolean;
	needsPairing: boolean;
	/** 凭证文件是否存在 */
	credentialsPresent: boolean;
	/** 凭证更新时间戳 ms；未知则 0 */
	credentialsUpdatedAt: number;
	defaultPiId: string | null;
	online: InstanceSnapshot[];
	pendingApprovals: number;
	bindingCount: number;
	/** 可选：原生 WS 是否已挂载（未知则 undefined） */
	nativeWsAttached?: boolean;
};

export function isStatusCommand(text: string): boolean {
	const t = text.trim();
	return /^(状态|status|诊断|diag)$/i.test(t);
}

function formatTime(ts: number): string {
	if (!ts || ts <= 0) return "未知";
	try {
		return new Date(ts).toISOString();
	} catch {
		return "未知";
	}
}

/** 生成面向用户的脱敏诊断文本 */
export function formatHubStatusReport(s: HubStatusSnapshot): string {
	const lines: string[] = [
		"【pi-lark-hub 状态】",
		`版本=${s.packageVersion}  pid=${s.pid ?? "-"}`,
		`Hub=${s.host}:${s.port}  模式=${s.feishuMode}`,
		`主人绑定=${s.ownerBound ? "是" : "否"}  需扫码=${s.needsPairing ? "是" : "否"}`,
		`凭证=${s.credentialsPresent ? "已落盘" : "无"}  更新=${formatTime(s.credentialsUpdatedAt)}`,
	];
	if (s.nativeWsAttached !== undefined) {
		lines.push(`原生WS入站=${s.nativeWsAttached ? "已挂载" : "未挂载"}`);
	}
	lines.push(
		`默认Pi=${s.defaultPiId ?? "（无）"}`,
		`待审批=${s.pendingApprovals}  消息绑定=${s.bindingCount}`,
		"",
		formatOnlineList(s.online, s.defaultPiId),
		"",
		"【建议】",
		...buildHints(s),
	);
	return lines.join("\n");
}

function buildHints(s: HubStatusSnapshot): string[] {
	const hints: string[] = [];
	if (s.needsPairing || !s.ownerBound) {
		hints.push("- 尚未绑定可信主人：在 Pi 执行 /lark 扫码开局");
	}
	if (!s.credentialsPresent) {
		hints.push("- 本机无凭证文件：执行 /lark 完成官方注册");
	}
	if (s.online.length === 0) {
		hints.push("- 无在线 Pi：确认 Bridge 已加载且能连上本机 Hub");
	}
	if (s.nativeWsAttached === false && s.credentialsPresent) {
		hints.push("- 凭证已在但 WS 未挂载：重启 Hub 或重新 /lark");
	}
	if (s.pendingApprovals > 0) {
		hints.push(`- 有 ${s.pendingApprovals} 条待审批：可在卡片点按钮或发送「批准/拒绝 <前缀>」`);
	}
	if (hints.length === 0) {
		hints.push("- 运行正常。列表/使用 可切换默认 Pi；/lark reset 可清理后重开局");
	}
	return hints;
}
