/**
 * 飞书出站消息格式：interactive 卡片 Markdown 优先，text 降级。
 * 纯函数，不依赖 SDK / 网络。
 */

/** markdown content 安全上限（留余量给 header） */
export const CARD_MARKDOWN_MAX = 3500;

/** 降级 text 同样截断 */
export const TEXT_FALLBACK_MAX = 3500;

/** 截断后缀（固定，便于断言） */
export const TRUNCATE_SUFFIX = "\n…（已截断）";

export type CardTemplate = "blue" | "green" | "orange" | "red" | "purple" | "indigo" | "turquoise" | "wathet" | "yellow" | "grey";

export type BuildInteractiveCardOptions = {
	/** 飞书 header template；可由 event 映射 */
	template?: CardTemplate;
	/** markdown 正文上限，默认 CARD_MARKDOWN_MAX */
	maxLength?: number;
};

/**
 * 将 event 映射为卡片 header 颜色。
 * task_end → green；approval → orange；其他 → blue。
 */
export function templateForEvent(event?: string): CardTemplate {
	if (event === "task_end") return "green";
	if (event === "approval") return "orange";
	return "blue";
}

/**
 * 按 JS string length 截断，超限时追加固定后缀。
 * 保证结果长度 ≤ max，且后缀完整（max 过小时仍只返回后缀的前 max 字符，避免无限）。
 */
export function truncateForFeishu(text: string, max: number): string {
	if (max <= 0) return "";
	if (text.length <= max) return text;
	const suffix = TRUNCATE_SUFFIX;
	if (max <= suffix.length) return suffix.slice(0, max);
	return text.slice(0, max - suffix.length) + suffix;
}

/**
 * 构建 interactive 卡片 content（JSON 字符串）。
 * - title 空 → header 用「通知」
 * - body 空 → markdown 用「（无正文）」
 * - body 不做二次 Markdown 改写，原样进入 content
 */
export function buildInteractiveCardContent(
	title: string | undefined,
	body: string,
	options: BuildInteractiveCardOptions = {},
): string {
	const maxLength = options.maxLength ?? CARD_MARKDOWN_MAX;
	const template = options.template ?? "blue";
	const headerTitle = title?.trim() ? title.trim() : "通知";
	const rawBody = body?.trim() ? body : "（无正文）";
	const markdown = truncateForFeishu(rawBody, maxLength);

	return JSON.stringify({
		config: { wide_screen_mode: true },
		header: {
			title: { tag: "plain_text", content: headerTitle },
			template,
		},
		elements: [
			{
				tag: "markdown",
				content: markdown,
			},
		],
	});
}

/**
 * 构建 text 消息 content（JSON 字符串）。
 * title + body 用换行拼接；超长截断。
 */
export function buildPlainTextContent(
	title: string | undefined,
	body: string,
	maxLength: number = TEXT_FALLBACK_MAX,
): string {
	const text = [title, body].filter((part) => part != null && String(part).length > 0).join("\n");
	const truncated = truncateForFeishu(text || "（无正文）", maxLength);
	return JSON.stringify({ text: truncated });
}
