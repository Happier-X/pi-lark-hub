/**
 * 飞书出站消息格式：interactive 卡片 Markdown 优先，text 降级。
 * 纯函数，不依赖 SDK / 网络。
 */

/** 单个 markdown 元素的保守正文上限。 */
export const CARD_MARKDOWN_MAX = 3000;
/** 卡片消息体最大 30 KB；预留结构和编码余量。 */
export const CARD_MESSAGE_MAX_BYTES = 30 * 1024 - 1024;
/** 单张卡片最多放置的 markdown 元素数。 */
export const CARD_MAX_MARKDOWN_ELEMENTS = 10;
/** 文本消息官方上限为 150 KB，这里预留 JSON 结构余量。 */
export const TEXT_FALLBACK_MAX = 140 * 1024;

/** 兼容旧调用方；新的分段逻辑不再使用截断后缀。 */
export const TRUNCATE_SUFFIX = "\n…（已截断）";

export type CardTemplate = "blue" | "green" | "orange" | "red" | "purple" | "indigo" | "turquoise" | "wathet" | "yellow" | "grey";

export type BuildInteractiveCardOptions = {
	template?: CardTemplate;
	maxLength?: number;
};

export type CardContentOptions = BuildInteractiveCardOptions & {
	maxBytes?: number;
	maxElements?: number;
	/** 审批按钮：仅挂在第一张卡片末尾 */
	approvalActions?: {
		requestId: string;
		decisions: Array<"approve" | "reject">;
	};
};

/** 按钮 value 约定（卡片回调解析） */
export type ApprovalCardActionValue = {
	v: 1;
	kind: "approval";
	requestId: string;
	decision: "approve" | "reject";
};

export function buildApprovalActionValue(
	requestId: string,
	decision: "approve" | "reject",
): ApprovalCardActionValue {
	return { v: 1, kind: "approval", requestId, decision };
}

export function buildApprovalActionElement(
	requestId: string,
	decisions: Array<"approve" | "reject">,
): { tag: "action"; actions: unknown[] } {
	const buttons = decisions.map((decision) => ({
		tag: "button",
		text: {
			tag: "plain_text",
			content: decision === "approve" ? "批准" : "拒绝",
		},
		type: decision === "approve" ? "primary" : "danger",
		value: buildApprovalActionValue(requestId, decision),
	}));
	return { tag: "action", actions: buttons };
}

export function templateForEvent(event?: string): CardTemplate {
	if (event === "task_end") return "green";
	if (event === "approval") return "orange";
	return "blue";
}

/** 旧接口保留给外部调用方；内部新路径使用分段函数保证完整性。 */
export function truncateForFeishu(text: string, max: number): string {
	if (max <= 0) return "";
	if (text.length <= max) return text;
	if (max <= TRUNCATE_SUFFIX.length) return TRUNCATE_SUFFIX.slice(0, max);
	return text.slice(0, max - TRUNCATE_SUFFIX.length) + TRUNCATE_SUFFIX;
}

function splitText(text: string, maxLength: number): string[] {
	if (maxLength <= 0) throw new Error("正文分段上限必须大于 0");
	const units = Array.from(text);
	if (units.length <= maxLength) return [text];
	const parts: string[] = [];
	let offset = 0;
	while (units.length - offset > maxLength) {
		const window = units.slice(offset, offset + maxLength + 1).join("");
		const newline = window.lastIndexOf("\n");
		const count = Array.from(newline > 0 ? window.slice(0, newline + 1) : window.slice(0, maxLength)).length;
		parts.push(units.slice(offset, offset + count).join(""));
		offset += count;
	}
	if (offset < units.length) parts.push(units.slice(offset).join(""));
	return parts;
}

function splitTextByBytes(text: string, maxBytes: number): string[] {
	if (maxBytes <= 0) throw new Error("正文字节分段上限必须大于 0");
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return [text];
	const parts: string[] = [];
	let remaining = text;
	while (Buffer.byteLength(remaining, "utf8") > maxBytes) {
		const units = Array.from(remaining);
		let low = 1;
		let high = Math.min(units.length, maxBytes);
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if (Buffer.byteLength(units.slice(0, middle).join(""), "utf8") <= maxBytes) low = middle;
			else high = middle - 1;
		}
		const window = units.slice(0, low + 1).join("");
		const newline = window.lastIndexOf("\n");
		const candidate = newline > 0 ? window.slice(0, newline + 1) : units.slice(0, low).join("");
		const cut = Array.from(candidate).length;
		if (cut <= 0) throw new Error("无法按 UTF-8 字节限制切分正文");
		parts.push(units.slice(0, cut).join(""));
		remaining = units.slice(cut).join("");
	}
	if (remaining.length > 0) parts.push(remaining);
	return parts;
}

function headerTitle(title: string | undefined, part: number, total: number): string {
	const base = title?.trim() || "通知";
	return total > 1 ? `${base}（第 ${part}/${total} 部分）` : base;
}

function cardObject(
	title: string,
	parts: string[],
	template: CardTemplate,
	actionElement?: { tag: "action"; actions: unknown[] },
) {
	const elements: unknown[] = parts.map((content) => ({ tag: "markdown", content }));
	if (actionElement) elements.push(actionElement);
	return {
		config: { wide_screen_mode: true },
		header: { title: { tag: "plain_text", content: title }, template },
		elements,
	};
}

/** 将正文按 Markdown 元素和卡片字节上限分组，不丢弃任何字符。 */
export function buildInteractiveCardContents(
	title: string | undefined,
	body: string,
	eventOrOptions: CardTemplate | CardContentOptions = {},
): string[] {
	const options = typeof eventOrOptions === "string" ? { template: eventOrOptions } : eventOrOptions;
	const maxLength = options.maxLength ?? CARD_MARKDOWN_MAX;
	const maxBytes = options.maxBytes ?? CARD_MESSAGE_MAX_BYTES;
	const maxElements = options.maxElements ?? CARD_MAX_MARKDOWN_ELEMENTS;
	const template = options.template ?? "blue";
	const actionEl =
		options.approvalActions &&
		options.approvalActions.requestId.trim() &&
		options.approvalActions.decisions.length > 0
			? buildApprovalActionElement(
					options.approvalActions.requestId.trim(),
					options.approvalActions.decisions,
			  )
			: undefined;
	const rawBody = body?.trim() ? body : "（无正文）";
	const chunks = splitText(rawBody, maxLength);
	const groups: string[][] = [];
	for (const chunk of chunks) {
		const current = groups.at(-1) ?? [];
		const candidate = [...current, chunk];
		const total = Math.ceil(chunks.length / Math.max(1, maxElements));
		const titleText = headerTitle(title, groups.length + 1, total);
		// 估算时对首卡预留 action，避免最后装不下
		const withAction = groups.length === 0 ? actionEl : undefined;
		const candidateCard = JSON.stringify(cardObject(titleText, candidate, template, withAction));
		if (current.length > 0 && (current.length >= maxElements || Buffer.byteLength(candidateCard, "utf8") > maxBytes)) {
			groups.push([chunk]);
		} else if (current.length === 0 && Buffer.byteLength(candidateCard, "utf8") > maxBytes && chunk.length > 1) {
			// 极端长标题/编码开销：降低本片段上限后重试，仍不截断正文。
			return buildInteractiveCardContents(title, body, { ...options, maxLength: Math.max(1, Math.floor(maxLength / 2)) });
		} else if (groups.length === 0 && Buffer.byteLength(candidateCard, "utf8") > maxBytes) {
			throw new Error("飞书卡片标题或结构超过消息体限制");
		} else {
			if (groups.length === 0) groups.push([]);
			groups[groups.length - 1]!.push(chunk);
		}
	}
	const total = groups.length;
	const contents = groups.map((parts, index) =>
		JSON.stringify(
			cardObject(
				headerTitle(title, index + 1, total),
				parts,
				template,
				index === 0 ? actionEl : undefined,
			),
		),
	);
	if (contents.some((content) => Buffer.byteLength(content, "utf8") > maxBytes)) {
		throw new Error("飞书卡片消息体超过限制");
	}
	return contents;
}

export function buildInteractiveCardContent(title: string | undefined, body: string, options: BuildInteractiveCardOptions = {}): string {
	const contents = buildInteractiveCardContents(title, body, options);
	if (contents.length !== 1) throw new Error("正文过长，请使用 buildInteractiveCardContents");
	return contents[0]!;
}

/** 将纯文本按消息体限制分批，保证拼接后正文完整。 */
export function buildPlainTextContents(title: string | undefined, body: string, maxLength = TEXT_FALLBACK_MAX): string[] {
	const text = [title, body].filter((part) => part != null && String(part).length > 0).join("\n") || "（无正文）";
	const chunks = splitTextByBytes(text, Math.max(1, maxLength - 128));
	return chunks.map((chunk, index) => JSON.stringify({ text: chunks.length > 1 ? `（第 ${index + 1}/${chunks.length} 部分）\n${chunk}` : chunk }));
}

export function buildPlainTextContent(title: string | undefined, body: string, maxLength = TEXT_FALLBACK_MAX): string {
	return buildPlainTextContents(title, body, maxLength)[0]!;
}
