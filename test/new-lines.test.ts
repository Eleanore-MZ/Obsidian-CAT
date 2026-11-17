import { test } from "node:test";
import assert from "node:assert/strict";
import { createPair, PairRecord, partnerAt, syncSide } from "../src/align";
const P = (pair: PairRecord, s: "a"|"b", l: number) => partnerAt(pair, s, l)?.partner.text ?? null;
test("several source lines, translated one at a time", () => {
	const pair = createPair("p", "zh.md", "一。\n二。", "en.md", "One.\nTwo.");
	syncSide(pair, "a", "一。\n二。\n三。\n四。\n五。");
	syncSide(pair, "b", "One.\nTwo.\nThree.");
	assert.equal(P(pair, "b", 2), "三。");
});
test("typing new target line char by char", () => {
	const pair = createPair("p", "zh.md", "一。\n二。", "en.md", "One.\nTwo.");
	syncSide(pair, "a", "一。\n二。\n三。");
	for (const t of ["T", "Th", "Three."]) syncSide(pair, "b", "One.\nTwo.\n" + t);
	assert.equal(P(pair, "b", 2), "三。");
});
test("new line in the middle", () => {
	const pair = createPair("p", "zh.md", "一。\n二。\n三。", "en.md", "One.\nTwo.\nThree.");
	syncSide(pair, "a", "一。\n新。\n二。\n三。");
	syncSide(pair, "b", "One.\nNew.\nTwo.\nThree.");
	assert.equal(P(pair, "b", 1), "新。");
});
