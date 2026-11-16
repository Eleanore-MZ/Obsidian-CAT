import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnits } from "../src/units";

const kinds = (text: string) => parseUnits(text).map((u) => [u.kind, u.startLine, u.endLine]);

test("frontmatter, blank lines and code blocks are skipped", () => {
	const text = ["---", "title: x", "---", "", "第一行", "```js", "code", "```", "second line"].join("\n");
	assert.deepEqual(kinds(text), [
		["line", 4, 4],
		["line", 8, 8],
	]);
});

test("headings, list items, nested items and continuation lines", () => {
	const text = ["# 标题", "- item one", "  continued", "  - nested", "1. numbered", "plain"].join("\n");
	assert.deepEqual(kinds(text), [
		["heading", 0, 0],
		["list", 1, 2],
		["list", 3, 3],
		["list", 4, 4],
		["line", 5, 5],
	]);
});

test("table rows are units and the divider is skipped", () => {
	const text = ["| 中文 | English |", "| --- | :---: |", "| 一 | one |"].join("\n");
	assert.deepEqual(kinds(text), [
		["table", 0, 0],
		["table", 2, 2],
	]);
});

test("a quote block or callout is one unit", () => {
	const text = ["> [!note] 提示", "> 第二行", "> third", "after"].join("\n");
	assert.deepEqual(kinds(text), [
		["quote", 0, 2],
		["line", 3, 3],
	]);
});

test("math and comment blocks are skipped", () => {
	const text = ["$$", "x^2", "$$", "%%", "hidden", "%%", "%%inline comment%%", "visible"].join("\n");
	assert.deepEqual(kinds(text), [["line", 7, 7]]);
});

test("Windows line endings", () => {
	assert.deepEqual(kinds("一\r\n\r\n二"), [
		["line", 0, 0],
		["line", 2, 2],
	]);
});
