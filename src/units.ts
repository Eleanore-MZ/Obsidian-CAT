/**
 * Splits a Markdown note into "units": the smallest pieces that can
 * correspond to a piece of the paired note.
 *
 * Rules (the vault uses strict line breaks):
 *  - each non-empty ordinary line is a unit
 *  - each heading is a unit
 *  - each list item is a unit (nested items too); indented continuation
 *    lines without a marker belong to the item above them
 *  - each table row is a unit; the |---| divider row is skipped
 *  - a whole quote block or callout (consecutive ">" lines) is one unit
 *  - frontmatter, fenced code blocks, $$ math blocks and %% comment blocks
 *    are skipped entirely
 *
 * This module has no Obsidian dependency so it can be unit-tested in Node.
 */

export type UnitKind = "line" | "heading" | "list" | "table" | "quote";

export interface Unit {
	kind: UnitKind;
	/** 0-based first line of the unit. */
	startLine: number;
	/** 0-based last line of the unit (inclusive). */
	endLine: number;
	/** Raw text of the unit (lines joined with "\n"), used for matching. */
	text: string;
}

const HEADING = /^#{1,6}(\s|$)/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])(\s|$)/;
const TASK_OR_LIST_CONT = /^(\s{2,}|\t)\S/;
const QUOTE = /^\s{0,3}>/;
const TABLE_ROW = /^\s*\|/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

export function splitLines(text: string): string[] {
	return text.split(/\r?\n/);
}

export function parseUnits(text: string): Unit[] {
	const lines = splitLines(text);
	const units: Unit[] = [];
	let i = 0;

	// Frontmatter: only when the very first line is ---.
	if (lines.length > 0 && lines[0].trim() === "---") {
		let j = 1;
		while (j < lines.length && lines[j].trim() !== "---" && lines[j].trim() !== "...") j++;
		if (j < lines.length) i = j + 1;
	}

	const push = (kind: UnitKind, start: number, end: number) => {
		units.push({ kind, startLine: start, endLine: end, text: lines.slice(start, end + 1).join("\n") });
	};

	while (i < lines.length) {
		const line = lines[i];
		const trimmed = line.trim();

		if (trimmed === "") {
			i++;
			continue;
		}

		// Fenced code block: skip to the matching closing fence.
		const fence = FENCE.exec(line);
		if (fence) {
			const marker = fence[1];
			let j = i + 1;
			while (j < lines.length) {
				const close = FENCE.exec(lines[j]);
				if (close && close[1][0] === marker[0] && close[1].length >= marker.length && lines[j].trim() === close[1]) break;
				j++;
			}
			i = j + 1;
			continue;
		}

		// $$ math blocks and %% comment blocks are skipped, whether they sit
		// on one line or span several.
		const delim = trimmed.startsWith("$$") ? "$$" : trimmed.startsWith("%%") ? "%%" : null;
		if (delim) {
			const closesOnSameLine = trimmed.length >= delim.length * 2 && trimmed.endsWith(delim);
			if (closesOnSameLine) {
				i++;
				continue;
			}
			let j = i + 1;
			while (j < lines.length && !lines[j].trim().endsWith(delim)) j++;
			i = j + 1;
			continue;
		}

		if (HEADING.test(line)) {
			push("heading", i, i);
			i++;
			continue;
		}

		if (QUOTE.test(line)) {
			let j = i;
			while (j + 1 < lines.length && QUOTE.test(lines[j + 1])) j++;
			push("quote", i, j);
			i = j + 1;
			continue;
		}

		if (TABLE_ROW.test(line)) {
			if (!TABLE_DIVIDER.test(line)) push("table", i, i);
			i++;
			continue;
		}

		if (LIST_ITEM.test(line)) {
			let j = i;
			while (
				j + 1 < lines.length &&
				lines[j + 1].trim() !== "" &&
				!LIST_ITEM.test(lines[j + 1]) &&
				TASK_OR_LIST_CONT.test(lines[j + 1]) &&
				!FENCE.test(lines[j + 1])
			) j++;
			push("list", i, j);
			i = j + 1;
			continue;
		}

		push("line", i, i);
		i++;
	}

	return units;
}
