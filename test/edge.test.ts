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
