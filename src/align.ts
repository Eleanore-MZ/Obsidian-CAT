/**
 * Alignment model and re-matching logic. No Obsidian dependency, so it can be
 * unit-tested in Node.
 *
 * Every unit in each note carries a stable id. A pair record keeps, for each
 * note, an ordered snapshot of its units (id + text + line span) and a list of
 * links between ids on the two sides. When a note changes, its new units are
 * compared with the old snapshot and each id is carried over to wherever its
 * unit ended up, the same way a diff tool tracks lines through an edit.
 */

import { parseUnits, Unit, UnitKind } from "./units";

export interface SnapshotUnit {
	id: string;
	kind: UnitKind;
	text: string;
	start: number;
	end: number;
}

export interface SideState {
	path: string;
	units: SnapshotUnit[];
}

export interface PairRecord {
	version: 1;
	id: string;
	a: SideState;
	b: SideState;
	/** Links as [id on side a, id on side b]. One-to-one. */
	links: [string, string][];
	nextId: number;
	/** Ids of units (on either side) marked as drafts. */
	drafts?: string[];
}

export type Side = "a" | "b";

export const otherSide = (s: Side): Side => (s === "a" ? "b" : "a");

function normalise(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Character-bigram Dice similarity, which works for both CJK and Latin text. */
export function similarity(x: string, y: string): number {
	const a = normalise(x).toLowerCase();
	const b = normalise(y).toLowerCase();
	if (a === b) return 1;
	if (a.length === 0 || b.length === 0) return 0;
	if (a.includes(b) || b.includes(a)) {
		return 0.5 + 0.5 * (Math.min(a.length, b.length) / Math.max(a.length, b.length));
	}
	if (a.length < 2 || b.length < 2) return 0;
	const grams = new Map<string, number>();
	for (let i = 0; i < a.length - 1; i++) {
		const g = a.slice(i, i + 2);
		grams.set(g, (grams.get(g) ?? 0) + 1);
	}
	let overlap = 0;
	for (let i = 0; i < b.length - 1; i++) {
		const g = b.slice(i, i + 2);
		const n = grams.get(g) ?? 0;
		if (n > 0) {
			overlap++;
			grams.set(g, n - 1);
		}
	}
	return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

const SIMILAR_ENOUGH = 0.35;

/**
 * Score used when re-matching edited lines. A line that is a piece of the old
 * line (or contains it) scores as a full match, so when a line is split every
 * piece ties and the tie goes to the first piece. That keeps splits on both
 * sides consistent: first halves stay linked, and the new second halves are
 * left to link to each other.
 */
function gapScore(oldText: string, newText: string): number {
	const a = normalise(oldText).toLowerCase();
	const b = normalise(newText).toLowerCase();
	if (a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a))) return 1;
	return similarity(oldText, newText);
}
const MAX_DP_CELLS = 4_000_000;

/**
 * Longest common subsequence of exactly equal strings. Returns matched index
 * pairs in increasing order. Falls back to a greedy in-order match on very
 * large inputs to stay fast.
 */
function lcsPairs(oldAll: string[], newAll: string[]): [number, number][] {
	// Trim the common prefix and suffix first: a typical edit touches one
	// spot, so this keeps the expensive part tiny while typing.
	let pre = 0;
	while (pre < oldAll.length && pre < newAll.length && oldAll[pre] === newAll[pre]) pre++;
	let suf = 0;
	while (
		suf < oldAll.length - pre &&
		suf < newAll.length - pre &&
		oldAll[oldAll.length - 1 - suf] === newAll[newAll.length - 1 - suf]
	) suf++;
	const head: [number, number][] = [];
	for (let k = 0; k < pre; k++) head.push([k, k]);
	const tail: [number, number][] = [];
	for (let k = suf; k > 0; k--) tail.push([oldAll.length - k, newAll.length - k]);
	const middle = lcsCore(oldAll.slice(pre, oldAll.length - suf), newAll.slice(pre, newAll.length - suf));
	return [...head, ...middle.map(([i, j]) => [i + pre, j + pre] as [number, number]), ...tail];
}

function lcsCore(oldT: string[], newT: string[]): [number, number][] {
	const n = oldT.length;
	const m = newT.length;
	if (n === 0 || m === 0) return [];
	if (n * m > MAX_DP_CELLS) {
		const out: [number, number][] = [];
		const positions = new Map<string, number[]>();
		newT.forEach((t, j) => {
			const list = positions.get(t);
			if (list) list.push(j);
			else positions.set(t, [j]);
		});
		let last = -1;
		for (let i = 0; i < n; i++) {
			const list = positions.get(oldT[i]);
			if (!list) continue;
			const j = list.find((p) => p > last);
			if (j !== undefined) {
				out.push([i, j]);
				last = j;
			}
		}
		return out;
	}
	const w = m + 1;
	const dp = new Uint32Array((n + 1) * w);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i * w + j] =
				oldT[i] === newT[j]
					? dp[(i + 1) * w + j + 1] + 1
					: Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
		}
	}
	const out: [number, number][] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (oldT[i] === newT[j]) {
			out.push([i, j]);
			i++;
			j++;
		} else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
		else j++;
	}
	return out;
}

/**
 * Inside a gap between two exact matches, pair up edited units. Equal-sized
 * gaps are treated as in-place edits and paired in order. Otherwise an
 * order-preserving alignment maximising total similarity is used, and only
 * reasonably similar units are paired.
 */
function matchGap(oldT: string[], newT: string[]): [number, number][] {
	const n = oldT.length;
	const m = newT.length;
	if (n === 0 || m === 0) return [];
	if (n === m) return oldT.map((_, k) => [k, k]);
	if (n * m > 40_000) return [];
	const w = m + 1;
	const dp = new Float64Array((n + 1) * w);
	const sim = (i: number, j: number) => {
		const s = gapScore(oldT[i], newT[j]);
		return s >= SIMILAR_ENOUGH ? s : -1;
	};
	const simCache = new Float64Array(n * m);
	for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) simCache[i * m + j] = sim(i, j);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			const s = simCache[i * m + j];
			const take = s > 0 ? dp[(i + 1) * w + j + 1] + s : -Infinity;
			dp[i * w + j] = Math.max(take, dp[(i + 1) * w + j], dp[i * w + j + 1]);
		}
	}
	const out: [number, number][] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		const s = simCache[i * m + j];
		if (s > 0 && dp[i * w + j] === dp[(i + 1) * w + j + 1] + s) {
			out.push([i, j]);
			i++;
			j++;
		} else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
		else j++;
	}
	return out;
}

/**
 * Carries ids from an old snapshot over to a freshly parsed list of units.
 * Units that cannot be traced back get new ids from `freshId`.
 */
export function remapIds(old: SnapshotUnit[], fresh: Unit[], freshId: () => string): SnapshotUnit[] {
	const oldT = old.map((u) => normalise(u.text));
	const newT = fresh.map((u) => normalise(u.text));
	const assigned: (string | null)[] = new Array(fresh.length).fill(null);

	const exact = lcsPairs(oldT, newT);
	const anchors: [number, number][] = [[-1, -1], ...exact, [old.length, fresh.length]];
	for (let k = 0; k < anchors.length - 1; k++) {
		const [oi, ni] = anchors[k];
		if (k > 0) assigned[ni] = old[oi].id;
		const [oj, nj] = anchors[k + 1];
		const gapOld = oldT.slice(oi + 1, oj);
		const gapNew = newT.slice(ni + 1, nj);
		for (const [gi, gj] of matchGap(gapOld, gapNew)) {
			assigned[ni + 1 + gj] = old[oi + 1 + gi].id;
		}
	}

	// Moved units: an unmatched new unit whose text exactly equals an
	// unmatched old unit (anywhere in the note) keeps that unit's id.
	const used = new Set(assigned.filter((id): id is string => id !== null));
	const leftovers = new Map<string, string[]>();
	old.forEach((u, i) => {
		if (used.has(u.id) || oldT[i] === "") return;
		const list = leftovers.get(oldT[i]);
		if (list) list.push(u.id);
		else leftovers.set(oldT[i], [u.id]);
	});
	newT.forEach((t, i) => {
		if (assigned[i] !== null) return;
		const id = leftovers.get(t)?.shift();
		if (id) assigned[i] = id;
	});

	return fresh.map((u, idx) => ({
		id: assigned[idx] ?? freshId(),
		kind: u.kind,
		text: u.text,
		start: u.startLine,
		end: u.endLine,
	}));
}

function makeIdGen(pair: PairRecord): () => string {
	return () => `u${(pair.nextId++).toString(36)}`;
}

export function snapshotFromText(text: string, freshId: () => string): SnapshotUnit[] {
	return parseUnits(text).map((u) => ({
		id: freshId(),
		kind: u.kind,
		text: u.text,
		start: u.startLine,
		end: u.endLine,
	}));
}

/** Creates a new pair, linking the two notes' units in order as a starting point. */
export function createPair(id: string, pathA: string, textA: string, pathB: string, textB: string): PairRecord {
	const pair: PairRecord = {
		version: 1,
		id,
		a: { path: pathA, units: [] },
		b: { path: pathB, units: [] },
		links: [],
		nextId: 1,
	};
	const gen = makeIdGen(pair);
	pair.a.units = snapshotFromText(textA, gen);
	pair.b.units = snapshotFromText(textB, gen);
	const n = Math.min(pair.a.units.length, pair.b.units.length);
	for (let i = 0; i < n; i++) pair.links.push([pair.a.units[i].id, pair.b.units[i].id]);
	return pair;
}

/**
 * Brings one side of a pair up to date with that note's current text.
 * Returns true if anything stored changed.
 */
export function syncSide(pair: PairRecord, side: Side, text: string): boolean {
	const state = pair[side];
	const oldUnits = state.units;
	const oldLinks = pair.links.length;
	const draftsBefore = pair.drafts?.length ?? 0;
	state.units = remapIds(oldUnits, parseUnits(text), makeIdGen(pair));
	cleanLinks(pair);
	autoLink(pair);
	return pair.links.length !== oldLinks || !sameUnits(oldUnits, state.units) || (pair.drafts?.length ?? 0) !== draftsBefore;
}

function sameUnits(x: SnapshotUnit[], y: SnapshotUnit[]): boolean {
	if (x.length !== y.length) return false;
	for (let i = 0; i < x.length; i++) {
		const a = x[i];
		const b = y[i];
		if (a.id !== b.id || a.start !== b.start || a.end !== b.end || a.text !== b.text) return false;
	}
	return true;
}

/** Drops links whose unit no longer exists on either side. */
export function cleanLinks(pair: PairRecord): void {
	const aIds = new Set(pair.a.units.map((u) => u.id));
	const bIds = new Set(pair.b.units.map((u) => u.id));
	pair.links = pair.links.filter(([a, b]) => aIds.has(a) && bIds.has(b));
	if (pair.drafts?.length) pair.drafts = pair.drafts.filter((id) => aIds.has(id) || bIds.has(id));
}

/**
 * Toggles the draft mark on the unit at `line` and on its partner, if any.
 * Returns the new state, or null when the line is not part of any unit.
 */
export function toggleDraft(pair: PairRecord, side: Side, line: number): boolean | null {
	const idx = unitAtLine(pair[side].units, line);
	if (idx < 0) return null;
	const id = pair[side].units[idx].id;
	const link = pair.links.find((l) => (side === "a" ? l[0] : l[1]) === id);
	const ids = link ? [link[0], link[1]] : [id];
	const drafts = new Set(pair.drafts ?? []);
	const makeDraft = !drafts.has(id);
	for (const x of ids) {
		if (makeDraft) drafts.add(x);
		else drafts.delete(x);
	}
	pair.drafts = [...drafts];
	return makeDraft;
}

/** Line spans of draft units on one side. */
export function draftUnits(pair: PairRecord, side: Side): SnapshotUnit[] {
	if (!pair.drafts?.length) return [];
	const drafts = new Set(pair.drafts);
	return pair[side].units.filter((u) => drafts.has(u.id));
}

/**
 * Links unpaired units automatically: between two consecutive linked units,
 * the unpaired units of both notes are linked in order, as far as both sides
 * have them. Writing several new source lines and then translating them one
 * by one links each translation to the next untranslated source line.
 */
export function autoLink(pair: PairRecord): void {
	const posA = new Map(pair.a.units.map((u, i) => [u.id, i]));
	const posB = new Map(pair.b.units.map((u, i) => [u.id, i]));
	const linkedA = new Set(pair.links.map((l) => l[0]));
	const linkedB = new Set(pair.links.map((l) => l[1]));

	// Anchors: links that are in the same order on both sides.
	const sorted = pair.links
		.map(([a, b]) => [posA.get(a)!, posB.get(b)!] as [number, number])
		.sort((x, y) => x[0] - y[0]);
	const anchors = longestIncreasing(sorted);
	const bounds: [number, number][] = [[-1, -1], ...anchors, [pair.a.units.length, pair.b.units.length]];

	for (let k = 0; k < bounds.length - 1; k++) {
		const [a0, b0] = bounds[k];
		const [a1, b1] = bounds[k + 1];
		const freeA = pair.a.units.slice(a0 + 1, a1).filter((u) => !linkedA.has(u.id));
		const freeB = pair.b.units.slice(b0 + 1, b1).filter((u) => !linkedB.has(u.id));
		const n = Math.min(freeA.length, freeB.length);
		for (let i = 0; i < n; i++) pair.links.push([freeA[i].id, freeB[i].id]);
	}
}

/** Longest subsequence increasing in the second coordinate (input sorted by first). */
function longestIncreasing(items: [number, number][]): [number, number][] {
	const tails: number[] = [];
	const prev: number[] = new Array(items.length).fill(-1);
	for (let i = 0; i < items.length; i++) {
		let lo = 0;
		let hi = tails.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (items[tails[mid]][1] < items[i][1]) lo = mid + 1;
			else hi = mid;
		}
		if (lo > 0) prev[i] = tails[lo - 1];
		tails[lo] = i;
	}
	const out: [number, number][] = [];
	let k = tails.length ? tails[tails.length - 1] : -1;
	while (k >= 0) {
		out.push(items[k]);
		k = prev[k];
	}
	return out.reverse();
}

/** Index of the unit that covers a 0-based line, or -1. */
export function unitAtLine(units: SnapshotUnit[], line: number): number {
	let lo = 0;
	let hi = units.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const u = units[mid];
		if (line < u.start) hi = mid - 1;
		else if (line > u.end) lo = mid + 1;
		else return mid;
	}
	return -1;
}

/** The partner of the unit at `line` on `side`, if it is linked. */
export function partnerAt(pair: PairRecord, side: Side, line: number): { unit: SnapshotUnit; partner: SnapshotUnit } | null {
	const idx = unitAtLine(pair[side].units, line);
	if (idx < 0) return null;
	const unit = pair[side].units[idx];
	const link = pair.links.find((l) => (side === "a" ? l[0] : l[1]) === unit.id);
	if (!link) return null;
	const partnerId = side === "a" ? link[1] : link[0];
	const partner = pair[otherSide(side)].units.find((u) => u.id === partnerId);
	return partner ? { unit, partner } : null;
}

/** Links two specific units by hand, replacing any links either had. */
export function linkUnits(pair: PairRecord, aId: string, bId: string): void {
	pair.links = pair.links.filter(([a, b]) => a !== aId && b !== bId);
	pair.links.push([aId, bId]);
}

export function unlinkedCount(pair: PairRecord, side: Side): number {
	const linked = new Set(pair.links.map((l) => (side === "a" ? l[0] : l[1])));
	return pair[side].units.filter((u) => !linked.has(u.id)).length;
}
