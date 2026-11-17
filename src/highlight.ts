import { Extension, RangeSetBuilder, StateEffect, StateField, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { editorInfoField } from "obsidian";

/**
 * Editor-side pieces of the highlight: a state field holding line
 * decorations for each editor, and a view plugin that reports cursor
 * movement back to the main plugin. Only editing views (Live Preview and
 * source mode) run CodeMirror, so Reading view is never affected.
 */

export interface LineSpan {
	start: number; // 0-based first line
	end: number; // 0-based last line, inclusive
}

export interface HighlightSpec {
	self: LineSpan | null;
	partner: LineSpan | null;
	unpaired: LineSpan[];
	drafts: LineSpan[];
}

export const setHighlight = StateEffect.define<HighlightSpec>();

const decoCache = new Map<string, Decoration>();
function lineDeco(classes: string): Decoration {
	let d = decoCache.get(classes);
	if (!d) {
		d = Decoration.line({ class: classes });
		decoCache.set(classes, d);
	}
	return d;
}

function build(doc: Text, spec: HighlightSpec): DecorationSet {
	// Collect the classes for each line; a line can be both a draft and
	// highlighted, and the CSS layers the two colours.
	const byLine = new Map<number, Set<string>>();
	const add = (span: LineSpan | null, cls: string) => {
		if (!span) return;
		const last = Math.min(span.end, doc.lines - 1);
		for (let l = Math.max(0, span.start); l <= last; l++) {
			let set = byLine.get(l);
			if (!set) byLine.set(l, (set = new Set()));
			set.add(cls);
		}
	};
	for (const span of spec.unpaired) add(span, "cat-unpaired");
	for (const span of spec.drafts) add(span, "cat-draft");
	add(spec.partner, "cat-hl cat-hl-partner");
	add(spec.self, "cat-hl cat-hl-self");
	const builder = new RangeSetBuilder<Decoration>();
	for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
		const set = byLine.get(line)!;
		if (set.has("cat-draft")) set.delete("cat-unpaired");
		const pos = doc.line(line + 1).from;
		builder.add(pos, pos, lineDeco([...set].join(" ")));
	}
	return builder.finish();
}

export const highlightField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(value, tr) {
		for (const e of tr.effects) if (e.is(setHighlight)) return build(tr.state.doc, e.value);
		return tr.docChanged ? value.map(tr.changes) : value;
	},
	provide: (f) => EditorView.decorations.from(f),
});

export interface CursorListener {
	/** `line` overrides the cursor line, e.g. for a cursor inside a table cell. */
	(view: EditorView, path: string, docChanged: boolean, line?: number): void;
}

/**
 * Live Preview edits table cells in small nested editors. Maps such a nested
 * editor to its outer note editor and the 0-based line of its table row.
 */
function resolveNested(inner: EditorView): { outer: EditorView; line: number } | null {
	const outerEl = inner.dom.parentElement?.closest(".cm-editor");
	if (!(outerEl instanceof HTMLElement)) return null;
	const outer = EditorView.findFromDOM(outerEl);
	const tr = inner.dom.closest("tr");
	const table = inner.dom.closest("table");
	const widget = inner.dom.closest(".cm-embed-block, .cm-table-widget");
	if (!outer || !tr || !table || !(widget instanceof HTMLElement)) return null;
	const rowIndex = Array.from(table.querySelectorAll("tr")).indexOf(tr);
	let start: number;
	try {
		start = outer.state.doc.lineAt(outer.posAtDOM(widget)).number - 1;
	} catch {
		return null;
	}
	// Row 0 is the header; the |---| divider line sits between it and row 1.
	return { outer, line: start + (rowIndex <= 0 ? 0 : rowIndex + 1) };
}

export function highlightExtension(onCursor: CursorListener): Extension {
	const reporter = ViewPlugin.fromClass(
		class {
			private pendingDocChange = false;
			update(u: ViewUpdate) {
				if (u.docChanged) this.pendingDocChange = true;
				if (!(u.docChanged || u.selectionSet || u.focusChanged)) return;
				// While a Chinese (or any IME) candidate is being composed the
				// text is provisional; wait for the commit to avoid flicker.
				if (u.view.composing) return;
				if (u.focusChanged && !u.view.hasFocus) return;
				const changed = this.pendingDocChange;
				this.pendingDocChange = false;
				const isNested = !!u.view.dom.parentElement?.closest(".cm-editor");
				// Dispatching from inside an update is not allowed; defer.
				queueMicrotask(() => {
					if (isNested) {
						// A table-cell editor: never sync its text (it is only one
						// cell); the outer editor reports the real document change.
						const hit = resolveNested(u.view);
						const path = hit?.outer.state.field(editorInfoField, false)?.file?.path;
						if (hit && path) onCursor(hit.outer, path, false, hit.line);
						return;
					}
					const path = u.state.field(editorInfoField, false)?.file?.path;
					if (path) onCursor(u.view, path, changed);
				});
			}
		},
	);
	return [highlightField, reporter];
}

/** Scrolls a line span into the middle of the view, only if it is off screen. */
export function revealIfHidden(view: EditorView, span: LineSpan): void {
	const doc = view.state.doc;
	if (span.start >= doc.lines) return;
	const from = doc.line(span.start + 1).from;
	const to = doc.line(Math.min(span.end, doc.lines - 1) + 1).to;
	const rect = view.scrollDOM.getBoundingClientRect();
	const top = view.coordsAtPos(from);
	const bottom = view.coordsAtPos(to);
	const visible = top && bottom && top.top >= rect.top && bottom.bottom <= rect.bottom;
	if (!visible) view.dispatch({ effects: EditorView.scrollIntoView(from, { y: "center" }) });
}

/**
 * Live Preview renders tables and (unfocused) callouts as widgets, which line
 * decorations cannot reach. For those, mark the rendered element directly.
 * `rowIndex` selects a table row (0 = header row) when the unit is a row.
 */
export function markRenderedBlock(view: EditorView, line: number, rowIndex: number | null): HTMLElement | null {
	const doc = view.state.doc;
	if (line >= doc.lines) return null;
	const pos = doc.line(line + 1).from;
	// If the line is shown as ordinary text, the line decoration already works.
	try {
		const { node } = view.domAtPos(pos);
		const el = node instanceof HTMLElement ? node : node.parentElement;
		if (el?.closest(".cm-line")) return null;
	} catch {
		return null;
	}
	// Otherwise it sits inside a rendered widget: take the widget that starts
	// closest before the line.
	let block: HTMLElement | null = null;
	let bestStart = -1;
	const candidates = view.contentDOM.querySelectorAll<HTMLElement>(".cm-callout, .cm-table-widget, .cm-embed-block");
	for (const el of Array.from(candidates)) {
		let at: number;
		try {
			at = view.posAtDOM(el);
		} catch {
			continue;
		}
		if (at <= pos && at > bestStart) {
			bestStart = at;
			block = el;
		}
	}
	if (!block) return null;
	let target: HTMLElement = block;
	if (rowIndex !== null) {
		const rows = block.querySelectorAll<HTMLElement>("tr");
		if (rows[rowIndex]) target = rows[rowIndex];
	}
	target.classList.add("cat-hl-rendered");
	return target;
}

export function clearRenderedMarks(root: HTMLElement): void {
	root.querySelectorAll(".cat-hl-rendered").forEach((el) => el.classList.remove("cat-hl-rendered"));
}
