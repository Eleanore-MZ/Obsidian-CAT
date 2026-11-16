import { test } from "node:test";
import assert from "node:assert/strict";
import { createPair, partnerAt, PairRecord, similarity, syncSide } from "../src/align";

const zh = ["# 第一章", "今天天气很好。", "我们去公园散步。", "- 苹果", "- 香蕉"].join("\n");
const en = ["# Chapter one", "The weather is nice today.", "We went for a walk in the park.", "- Apples", "- Bananas"].join("\n");

function partnerText(pair: PairRecord, side: "a" | "b", line: number): string | null {
	return partnerAt(pair, side, line)?.partner.text ?? null;
}

function fresh() {
	return createPair("p", "zh.md", zh, "en.md", en);
}

test("a new pair is linked in order", () => {
	const pair = fresh();
	assert.equal(pair.links.length, 5);
	assert.equal(partnerText(pair, "a", 2), "We went for a walk in the park.");
	assert.equal(partnerText(pair, "b", 0), "# 第一章");
});

test("inserting a line in the source does not shift later pairs", () => {
	const pair = fresh();
	const edited = ["# 第一章", "今天天气很好。", "阳光明媚。", "我们去公园散步。", "- 苹果", "- 香蕉"].join("\n");
	syncSide(pair, "a", edited);
	assert.equal(partnerText(pair, "a", 2), null, "the new line has no partner yet");
	assert.equal(partnerText(pair, "a", 3), "We went for a walk in the park.");
	assert.equal(partnerText(pair, "a", 5), "- Bananas");
});

test("writing the translation of a new line links it automatically", () => {
	const pair = fresh();
	syncSide(pair, "a", ["# 第一章", "今天天气很好。", "阳光明媚。", "我们去公园散步。", "- 苹果", "- 香蕉"].join("\n"));
	syncSide(
		pair,
		"b",
		["# Chapter one", "The weather is nice today.", "The sun is shining.", "We went for a walk in the park.", "- Apples", "- Bananas"].join("\n"),
	);
	assert.equal(partnerText(pair, "a", 2), "The sun is shining.");
	assert.equal(partnerText(pair, "b", 3), "我们去公园散步。");
});

test("rewriting a line keeps its link", () => {
	const pair = fresh();
	syncSide(pair, "a", ["# 第一章", "今天的天气非常好！", "我们去公园散步。", "- 苹果", "- 香蕉"].join("\n"));
	assert.equal(partnerText(pair, "a", 1), "The weather is nice today.");
});

test("deleting a line drops only its own link", () => {
	const pair = fresh();
	syncSide(pair, "a", ["# 第一章", "我们去公园散步。", "- 苹果", "- 香蕉"].join("\n"));
	assert.equal(partnerText(pair, "a", 1), "We went for a walk in the park.");
	assert.equal(partnerText(pair, "b", 1), null);
});

test("moving a line carries its link along", () => {
	const pair = fresh();
	syncSide(pair, "a", ["# 第一章", "我们去公园散步。", "- 苹果", "- 香蕉", "今天天气很好。"].join("\n"));
	assert.equal(partnerText(pair, "a", 4), "The weather is nice today.");
	assert.equal(partnerText(pair, "a", 1), "We went for a walk in the park.");
});

test("typing a new line character by character keeps one id", () => {
	const pair = fresh();
	const base = ["# 第一章", "今天天气很好。", "我们去公园散步。", "- 苹果", "- 香蕉"];
	let firstId: string | null = null;
	for (const partial of ["我", "我们", "我们回", "我们回家了。"]) {
		syncSide(pair, "a", [...base, partial].join("\n"));
		const id = pair.a.units[5].id;
		firstId ??= id;
		assert.equal(id, firstId);
	}
});

test("splitting a line keeps the link on the more similar half", () => {
	const pair = fresh();
	syncSide(pair, "a", ["# 第一章", "今天天气很好，", "非常适合出门。", "我们去公园散步。", "- 苹果", "- 香蕉"].join("\n"));
	assert.equal(partnerText(pair, "a", 1), "The weather is nice today.");
	assert.equal(partnerText(pair, "a", 3), "We went for a walk in the park.");
});

test("similarity handles CJK and Latin text", () => {
	assert.ok(similarity("今天天气很好。", "今天天气非常好。") > 0.5);
	assert.ok(similarity("The weather is nice", "the weather is very nice") > 0.7);
	assert.ok(similarity("今天天气很好。", "我们去公园散步。") < 0.2);
});
