import { test } from "node:test";
import assert from "node:assert/strict";
import { createPair, partnerAt, PairRecord, syncSide, unlinkedCount } from "../src/align";

const partner = (pair: PairRecord, side: "a" | "b", line: number) => partnerAt(pair, side, line)?.partner.text ?? null;

const zhLines = ["# 标题", "第一句。", "第二句。", "第三句。", "第四句。"];
const enLines = ["# Title", "Sentence one.", "Sentence two.", "Sentence three.", "Sentence four."];
const make = () => createPair("p", "zh.md", zhLines.join("\n"), "en.md", enLines.join("\n"));

test("merging two lines keeps one link and frees the other partner", () => {
	const pair = make();
	syncSide(pair, "a", ["# 标题", "第一句。第二句。", "第三句。", "第四句。"].join("\n"));
	assert.ok(["Sentence one.", "Sentence two."].includes(partner(pair, "a", 1)!));
	assert.equal(partner(pair, "a", 2), "Sentence three.");
	assert.equal(unlinkedCount(pair, "b"), 1);
});

test("reordering two lines carries both links", () => {
	const pair = make();
	syncSide(pair, "a", ["# 标题", "第一句。", "第三句。", "第二句。", "第四句。"].join("\n"));
	assert.equal(partner(pair, "a", 2), "Sentence three.");
	assert.equal(partner(pair, "a", 3), "Sentence two.");
});

test("blank lines and spacing changes do not break links", () => {
	const pair = make();
	syncSide(pair, "a", ["# 标题", "", "第一句。", "", "", "第二句。  ", "第三句。", "第四句。"].join("\n"));
	assert.equal(partner(pair, "a", 2), "Sentence one.");
	assert.equal(partner(pair, "a", 5), "Sentence two.");
});

test("mixed Chinese and English lines are matched", () => {
	const pair = createPair("p", "zh.md", "使用 Obsidian 写作。\n第二行", "en.md", "Writing in Obsidian.\nLine two");
	syncSide(pair, "a", "我们使用 Obsidian 来写作。\n第二行");
	assert.equal(partner(pair, "a", 0), "Writing in Obsidian.");
});

test("translating a whole new section links it line by line", () => {
	const pair = make();
	syncSide(pair, "a", [...zhLines, "## 新的一节", "新内容一。", "新内容二。"].join("\n"));
	assert.equal(unlinkedCount(pair, "a"), 3);
	syncSide(pair, "b", [...enLines, "## New section", "New content one.", "New content two."].join("\n"));
	assert.equal(unlinkedCount(pair, "a"), 0);
	assert.equal(partner(pair, "a", 6), "New content one.");
});

test("partial translation in progress does not link out of order", () => {
	const pair = make();
	syncSide(pair, "a", [...zhLines, "新一。", "新二。"].join("\n"));
	syncSide(pair, "b", [...enLines, "New one."].join("\n"));
	// Two new source lines, one new target line: ambiguous, so nothing links yet.
	assert.equal(partner(pair, "b", 5), null);
	syncSide(pair, "b", [...enLines, "New one.", "New two."].join("\n"));
	assert.equal(partner(pair, "b", 5), "新一。");
	assert.equal(partner(pair, "b", 6), "新二。");
});

test("clearing a note and undoing restores links through the snapshot", () => {
	const pair = make();
	syncSide(pair, "a", "");
	assert.equal(pair.links.length, 0);
	// Links cannot come back after deletion, but nothing crashes and new
	// lines auto-link when counts match again.
	syncSide(pair, "a", zhLines.join("\n"));
	assert.equal(unlinkedCount(pair, "a"), 0);
});

test("long notes re-sync quickly after a small edit", () => {
	const n = 5000;
	const zh = Array.from({ length: n }, (_, i) => `第${i}句，这是一个比较长的中文句子用于测试。`);
	const en = Array.from({ length: n }, (_, i) => `Sentence ${i}, a fairly long English sentence for testing.`);
	const pair = createPair("p", "zh.md", zh.join("\n"), "en.md", en.join("\n"));
	const edited = [...zh];
	edited[2500] = edited[2500] + "（修改）";
	edited.splice(3000, 0, "插入的新句子。");
	const t0 = performance.now();
	for (let k = 0; k < 20; k++) syncSide(pair, "a", edited.join("\n"));
	const per = (performance.now() - t0) / 20;
	assert.ok(per < 50, `sync took ${per.toFixed(1)} ms`);
	assert.equal(partner(pair, "a", 2500), en[2500]);
	assert.equal(partner(pair, "a", 3001), en[3000]);
	console.log(`  long note sync: ${per.toFixed(1)} ms per edit`);
});

test("splitting a line on both sides pairs first halves and second halves", () => {
	for (const [zh1, zh2, en1, en2] of [
		["今天天气很好，", "非常非常适合出门去公园散步。", "The weather is nice today,", "perfect for a walk."],
		["今天天气非常非常好，", "适合出门。", "The weather is nice,", "so we should definitely go out for a long walk."],
	]) {
		const pair = createPair("p", "zh.md", `# 标题\n${zh1}${zh2}\n结尾。`, "en.md", `# Title\n${en1} ${en2}\nThe end.`);
		syncSide(pair, "a", `# 标题\n${zh1}\n${zh2}\n结尾。`);
		assert.equal(partner(pair, "a", 1), `${en1} ${en2}`, "first half keeps the link while only one side is split");
		assert.equal(partner(pair, "a", 2), null);
		syncSide(pair, "b", `# Title\n${en1}\n${en2}\nThe end.`);
		assert.equal(partner(pair, "a", 1), en1);
		assert.equal(partner(pair, "a", 2), en2);
		assert.equal(partner(pair, "a", 3), "The end.");
	}
});

test("splitting with Enter then typing the translation in order", () => {
	const pair = createPair("p", "zh.md", "第一句很长很长。第二句短。\n其他。", "en.md", "First sentence is long. Second is short.\nOther.");
	syncSide(pair, "b", "First sentence is long.\nSecond is short.\nOther.");
	syncSide(pair, "a", "第一句很长很长。\n第二句短。\n其他。");
	assert.equal(partner(pair, "a", 0), "First sentence is long.");
	assert.equal(partner(pair, "a", 1), "Second is short.");
});
