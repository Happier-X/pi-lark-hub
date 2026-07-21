import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CARD_MARKDOWN_MAX,
	TEXT_FALLBACK_MAX,
	TRUNCATE_SUFFIX,
	buildInteractiveCardContent,
	buildPlainTextContent,
	templateForEvent,
	truncateForFeishu,
} from "./feishu-outbound-format.js";

describe("truncateForFeishu", () => {
	it("短文本原样返回", () => {
		assert.equal(truncateForFeishu("hello", 100), "hello");
	});

	it("超长截断并追加固定后缀", () => {
		const long = "a".repeat(100);
		const out = truncateForFeishu(long, 50);
		assert.ok(out.endsWith(TRUNCATE_SUFFIX));
		assert.ok(out.length <= 50);
		assert.equal(out, "a".repeat(50 - TRUNCATE_SUFFIX.length) + TRUNCATE_SUFFIX);
	});

	it("max 过小时仍不抛错", () => {
		assert.equal(truncateForFeishu("abcdef", 0), "");
		assert.equal(truncateForFeishu("abcdef", 3).length, 3);
	});
});

describe("templateForEvent", () => {
	it("映射 task_end / approval / 默认", () => {
		assert.equal(templateForEvent("task_end"), "green");
		assert.equal(templateForEvent("approval"), "orange");
		assert.equal(templateForEvent(undefined), "blue");
		assert.equal(templateForEvent("other"), "blue");
	});
});

describe("buildInteractiveCardContent", () => {
	it("普通正文：header + markdown 结构", () => {
		const raw = buildInteractiveCardContent("标题", "正文");
		const card = JSON.parse(raw) as {
			config: { wide_screen_mode: boolean };
			header: { title: { tag: string; content: string }; template: string };
			elements: Array<{ tag: string; content: string }>;
		};
		assert.equal(card.config.wide_screen_mode, true);
		assert.equal(card.header.title.tag, "plain_text");
		assert.equal(card.header.title.content, "标题");
		assert.equal(card.header.template, "blue");
		assert.equal(card.elements.length, 1);
		assert.equal(card.elements[0]!.tag, "markdown");
		assert.equal(card.elements[0]!.content, "正文");
	});

	it("title 空用「通知」；body 空用「（无正文）」", () => {
		const card = JSON.parse(buildInteractiveCardContent(undefined, "   ")) as {
			header: { title: { content: string } };
			elements: Array<{ content: string }>;
		};
		assert.equal(card.header.title.content, "通知");
		assert.equal(card.elements[0]!.content, "（无正文）");
	});

	it("表格与代码块原样进入 markdown，不做二次改写", () => {
		const body = [
			"| a | b |",
			"|---|---|",
			"| 1 | 2 |",
			"",
			"```ts",
			"const x = 1;",
			"```",
		].join("\n");
		const card = JSON.parse(buildInteractiveCardContent("任务结束", body, { template: "green" })) as {
			header: { template: string };
			elements: Array<{ content: string }>;
		};
		assert.equal(card.header.template, "green");
		assert.equal(card.elements[0]!.content, body);
	});

	it("超长 body 截断且不超过上限", () => {
		const body = "字".repeat(CARD_MARKDOWN_MAX + 200);
		const card = JSON.parse(buildInteractiveCardContent("t", body)) as {
			elements: Array<{ content: string }>;
		};
		const content = card.elements[0]!.content;
		assert.ok(content.length <= CARD_MARKDOWN_MAX);
		assert.ok(content.endsWith(TRUNCATE_SUFFIX));
	});
});

describe("buildPlainTextContent", () => {
	it("拼接 title 与 body", () => {
		const parsed = JSON.parse(buildPlainTextContent("标题", "正文")) as { text: string };
		assert.equal(parsed.text, "标题\n正文");
	});

	it("无 title 时仅 body", () => {
		const parsed = JSON.parse(buildPlainTextContent(undefined, "only")) as { text: string };
		assert.equal(parsed.text, "only");
	});

	it("超长截断", () => {
		const body = "b".repeat(TEXT_FALLBACK_MAX + 50);
		const parsed = JSON.parse(buildPlainTextContent("t", body)) as { text: string };
		assert.ok(parsed.text.length <= TEXT_FALLBACK_MAX);
		assert.ok(parsed.text.endsWith(TRUNCATE_SUFFIX));
	});
});
