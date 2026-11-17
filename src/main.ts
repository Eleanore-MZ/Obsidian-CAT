import { EditorView } from "@codemirror/view";
import { Editor, editorInfoField, MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { draftUnits, linkUnits, otherSide, PairRecord, partnerAt, Side, SnapshotUnit, toggleDraft, unitAtLine, unlinkedCount } from "./align";
import {
	clearRenderedMarks,
	HighlightSpec,
	highlightExtension,
	LineSpan,
	markRenderedBlock,
	revealIfHidden,
	setHighlight,
} from "./highlight";
import { CatSettings, CatSettingTab, colorVariables, DEFAULT_SETTINGS } from "./settings";
import { PairStore } from "./store";
import { TranslationMode } from "./translation";

export default class CatPlugin extends Plugin {
	settings: CatSettings = DEFAULT_SETTINGS;
	store!: PairStore;
	translation!: TranslationMode;
	private syncTimers = new Map<string, number>();
	/** Editors that currently show highlight decorations. */
	private decorated = new Set<EditorView>();

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CatSettingTab(this.app, this));

		this.store = new PairStore(this);
		await this.store.load();

		this.translation = new TranslationMode(this);
		this.registerCommands();
		this.registerSyncEvents();
		this.app.workspace.onLayoutReady(() => this.translation.syncButtons());
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.translation.syncButtons();
				this.paintAllMarkers();
			}),
		);
		this.app.workspace.onLayoutReady(() => this.paintAllMarkers());
		this.registerEditorExtension(highlightExtension((view, path, changed, line) => this.onCursor(view, path, changed, line)));

		// Catch up on edits made while Obsidian was closed or the plugin was off.
		this.app.workspace.onLayoutReady(() => void this.syncAllFromDisk());
	}

	async onunload() {
		this.translation?.removeButtons();
		this.clearAll();
		this.removeColors();
		for (const t of this.syncTimers.values()) window.clearTimeout(t);
		await this.store.flush();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.applyColors();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.applyColors();
		this.refreshActive();
	}

	/** Publishes the colour settings as CSS variables used by styles.css. */
	private applyColors() {
		for (const [name, value] of Object.entries(colorVariables(this.settings))) {
			document.body.style.setProperty(name, value);
		}
	}

	private removeColors() {
		for (const name of Object.keys(colorVariables(this.settings))) document.body.style.removeProperty(name);
	}

	// ----- keeping alignment in step with edits -----

	private registerSyncEvents() {
		// Typing in Obsidian is followed by the editor extension (see onCursor).
		// Changes from anywhere else (sync, other apps, other plugins).
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && this.store.lookup(file.path)) {
					this.scheduleSync(file.path, () => this.app.vault.cachedRead(file), 500);
				}
			}),
		);
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.store.rename(oldPath, file.path)));
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (this.store.remove(file.path)) new Notice(`CAT: "${file.name}" was deleted, so its pairing was removed.`);
			}),
		);
	}

	private scheduleSync(path: string, read: () => string | Promise<string>, delay: number) {
		const existing = this.syncTimers.get(path);
		if (existing !== undefined) window.clearTimeout(existing);
		const timer = window.setTimeout(async () => {
			this.syncTimers.delete(path);
			this.store.sync(path, await read());
		}, delay);
		this.syncTimers.set(path, timer);
	}

	/** Syncs a note right now, preferring an open editor's text over the file on disk. */
	async syncNow(path: string): Promise<void> {
		const pending = this.syncTimers.get(path);
		if (pending !== undefined) {
			window.clearTimeout(pending);
			this.syncTimers.delete(path);
		}
		const text = await this.currentText(path);
		if (text !== null) this.store.sync(path, text);
	}

	private async currentText(path: string): Promise<string | null> {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view as MarkdownView;
			if (view.file?.path === path) return view.editor.getValue();
		}
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? this.app.vault.cachedRead(file) : null;
	}

	private async syncAllFromDisk() {
		for (const pair of this.store.all()) {
			for (const side of ["a", "b"] as const) {
				const path = pair[side].path;
				if (!this.app.vault.getAbstractFileByPath(path)) continue;
				await this.syncNow(path);
			}
		}
	}

	// ----- highlighting -----

	/** Called by the editor extension whenever the cursor moves or text changes. */
	private onCursor(view: EditorView, path: string, docChanged: boolean, lineOverride?: number) {
		const hit = this.store.lookup(path);
		if (hit && docChanged) {
			const pending = this.syncTimers.get(path);
			if (pending !== undefined) {
				window.clearTimeout(pending);
				this.syncTimers.delete(path);
			}
			this.store.sync(path, view.state.doc.toString());
			// A change in an editor you are not typing in (another plugin, a
			// table-cell edit landing in the note) should not move the highlight.
			if (!view.hasFocus && lineOverride === undefined) {
				this.paintMarkers(view, path);
				return;
			}
		}
		if (!hit || !this.settings.highlightEnabled) {
			this.resetAll();
			if (hit) this.paintMarkers(view, path);
			return;
		}
		const { pair, side } = hit;
		const line = lineOverride ?? view.state.doc.lineAt(view.state.selection.main.head).number - 1;
		const match = partnerAt(pair, side, line);
		const partnerSide = otherSide(side);
		const partnerViews = this.editorViewsFor(pair[partnerSide].path);

		const span = (u: SnapshotUnit): LineSpan => ({ start: u.start, end: u.end });
		const touched = new Set<EditorView>();
		clearRenderedMarks(view.contentDOM);
		this.apply(view, {
			self: match && this.settings.highlightSelf ? span(match.unit) : null,
			partner: null,
			...this.markers(pair, side),
		});
		touched.add(view);
		for (const pv of partnerViews) {
			clearRenderedMarks(pv.contentDOM);
			this.apply(pv, { self: null, partner: match ? span(match.partner) : null, ...this.markers(pair, partnerSide) });
			touched.add(pv);
			if (match) {
				const partner = match.partner;
				if (this.settings.scrollPartner) revealIfHidden(pv, span(partner));
				const row = partner.kind === "table" ? this.tableRowIndex(pair, partnerSide, partner) : null;
				// Tables and callouts may be drawn as widgets; mark them once drawn.
				window.requestAnimationFrame(() => markRenderedBlock(pv, partner.start, row));
			}
		}
		for (const other of [...this.decorated]) if (!touched.has(other)) this.paintMarkers(other);
	}

	/** The always-on markers (drafts, unpaired lines) for one side of a pair. */
	private markers(pair: PairRecord, side: Side): { unpaired: LineSpan[]; drafts: LineSpan[] } {
		const drafts = this.settings.showDrafts
			? draftUnits(pair, side).map((u) => ({ start: u.start, end: u.end }))
			: [];
		return { unpaired: this.unpairedSpans(pair, side), drafts };
	}

	/** Shows only the always-on markers in an editor, without the cursor highlight. */
	private paintMarkers(view: EditorView, path?: string) {
		clearRenderedMarks(view.contentDOM);
		const p = path ?? view.state.field(editorInfoField, false)?.file?.path;
		const hit = p ? this.store.lookup(p) : null;
		this.apply(view, { self: null, partner: null, ...(hit ? this.markers(hit.pair, hit.side) : { unpaired: [], drafts: [] }) });
	}

	/** Paints markers in every open paired note (e.g. after opening a note or a settings change). */
	paintAllMarkers() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView) || !leaf.view.file || leaf.view.getMode() !== "source") return;
			const cm = this.cmOf(leaf.view);
			if (cm && (this.decorated.has(cm) || this.store.lookup(leaf.view.file.path))) this.paintMarkers(cm, leaf.view.file.path);
		});
	}

	private unpairedSpans(pair: PairRecord, side: Side): LineSpan[] {
		if (!this.settings.showUnpairedMarkers) return [];
		const linked = new Set(pair.links.map((l) => (side === "a" ? l[0] : l[1])));
		return pair[side].units.filter((u) => !linked.has(u.id)).map((u) => ({ start: u.start, end: u.end }));
	}

	/** Position of a table row within its table (0 = header row), for rendered tables. */
	private tableRowIndex(pair: PairRecord, side: Side, unit: SnapshotUnit): number {
		const units = pair[side].units;
		let idx = units.findIndex((u) => u.id === unit.id);
		let row = 0;
		while (idx > 0 && units[idx - 1].kind === "table" && units[idx].start - units[idx - 1].end <= 2) {
			row++;
			idx--;
		}
		return row;
	}

	private apply(view: EditorView, spec: HighlightSpec) {
		const empty = !spec.self && !spec.partner && spec.unpaired.length === 0 && spec.drafts.length === 0;
		if (empty && !this.decorated.has(view)) return;
		view.dispatch({ effects: setHighlight.of(spec) });
		if (empty) this.decorated.delete(view);
		else this.decorated.add(view);
	}

	private clearView(view: EditorView) {
		clearRenderedMarks(view.contentDOM);
		this.apply(view, { self: null, partner: null, unpaired: [], drafts: [] });
		this.decorated.delete(view);
	}

	/** Removes every decoration (used on unload). */
	private clearAll() {
		for (const v of [...this.decorated]) this.clearView(v);
	}

	/** Drops the cursor highlight everywhere but keeps drafts and unpaired markers. */
	private resetAll() {
		for (const v of [...this.decorated]) this.paintMarkers(v);
	}

	/** Re-renders highlights for the focused editor, e.g. after a settings change. */
	refreshActive() {
		this.resetAll();
		this.paintAllMarkers();
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cm = view ? this.cmOf(view) : null;
		if (view?.file && cm) this.onCursor(cm, view.file.path, false);
	}

	private cmOf(view: MarkdownView): EditorView | null {
		const cm = (view.editor as unknown as { cm?: EditorView }).cm;
		return cm instanceof EditorView ? cm : null;
	}

	private editorViewsFor(path: string): EditorView[] {
		const out: EditorView[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path && leaf.view.getMode() === "source") {
				const cm = this.cmOf(leaf.view);
				if (cm) out.push(cm);
			}
		});
		return out;
	}

	// ----- finding the other pane -----

	/** The most recently used markdown pane showing a different note than `view`. */
	private otherMarkdownView(view: MarkdownView, preferPath?: string): MarkdownView | null {
		let best: { view: MarkdownView; time: number } | null = null;
		this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			if (!(leaf.view instanceof MarkdownView) || leaf.view === view || !leaf.view.file) return;
			if (leaf.view.file.path === view.file?.path) return;
			if (preferPath && leaf.view.file.path !== preferPath) return;
			const time = (leaf as unknown as { activeTime?: number }).activeTime ?? 0;
			if (!best || time > best.time) best = { view: leaf.view, time };
		});
		return best ? (best as { view: MarkdownView }).view : null;
	}

	// ----- commands (the plugin's only UI besides settings and highlights) -----

	private registerCommands() {
		this.addCommand({
			id: "pair-open-notes",
			name: "Pair this note with the note in the other pane",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				const other = view ? this.otherMarkdownView(view) : null;
				if (!view?.file || !other?.file) return false;
				if (!checking) {
					const existing = this.store.lookup(view.file.path);
					if (existing && existing.pair[otherSide(existing.side)].path === other.file.path) {
						new Notice(`CAT: already paired with "${other.file.basename}".`);
						return true;
					}
					this.store.create(view.file.path, view.editor.getValue(), other.file.path, other.editor.getValue());
					new Notice(`CAT: paired "${view.file.basename}" with "${other.file.basename}".`);
					this.refreshActive();
				}
				return true;
			},
		});

		this.addCommand({
			id: "translation-mode",
			name: "Open translation mode (paired note side by side, creating one if needed)",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) return false;
				if (!checking) void this.translation.open(view);
				return true;
			},
		});

		this.addCommand({
			id: "unpair-note",
			name: "Unpair this note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.store.lookup(file.path)) return false;
				if (!checking) {
					this.store.remove(file.path);
					this.clearAll();
					new Notice(`CAT: "${file.basename}" is no longer paired.`);
				}
				return true;
			},
		});

		this.addCommand({
			id: "link-current-line",
			name: "Link the current line with the cursor line in the paired note",
			editorCheckCallback: (checking, editor: Editor, ctx) => {
				const file = ctx.file;
				const hit = file ? this.store.lookup(file.path) : null;
				if (!file || !hit || !(ctx instanceof MarkdownView)) return false;
				const partnerPath = hit.pair[otherSide(hit.side)].path;
				const other = this.otherMarkdownView(ctx, partnerPath);
				if (!other) return false;
				if (!checking) void this.linkCursorLines(file.path, editor, partnerPath, other.editor);
				return true;
			},
		});

		this.addCommand({
			id: "jump-to-partner",
			name: "Jump to the corresponding line in the paired note",
			editorCheckCallback: (checking, editor: Editor, ctx) => {
				const file = ctx.file;
				const hit = file ? this.store.lookup(file.path) : null;
				if (!file || !hit) return false;
				if (!checking) void this.jumpToPartner(file.path, editor);
				return true;
			},
		});

		this.addCommand({
			id: "toggle-draft",
			name: "Toggle draft on the current line (and its partner)",
			editorCheckCallback: (checking, editor: Editor, ctx) => {
				const file = ctx.file;
				if (!file || !this.store.lookup(file.path)) return false;
				if (!checking) void this.toggleDraftAt(file.path, editor.getCursor().line);
				return true;
			},
		});

		this.addCommand({
			id: "next-draft",
			name: "Go to the next draft line",
			editorCheckCallback: (checking, editor: Editor, ctx) => {
				const file = ctx.file;
				const hit = file ? this.store.lookup(file.path) : null;
				if (!file || !hit) return false;
				if (!checking) {
					const drafts = draftUnits(hit.pair, hit.side);
					if (drafts.length === 0) {
						new Notice("CAT: no draft lines in this note.");
						return true;
					}
					const cur = editor.getCursor().line;
					const next = drafts.find((u) => u.start > cur) ?? drafts[0];
					editor.setCursor({ line: next.start, ch: 0 });
					editor.scrollIntoView({ from: { line: next.start, ch: 0 }, to: { line: next.end, ch: 0 } }, true);
				}
				return true;
			},
		});

		this.addCommand({
			id: "show-status",
			name: "Show pairing status",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const hit = file ? this.store.lookup(file.path) : null;
				if (!file || !hit) return false;
				if (!checking) {
					const { pair, side } = hit;
					const partner = pair[otherSide(side)].path.split("/").pop()?.replace(/\.md$/, "");
					new Notice(
						`CAT: paired with "${partner}". ${pair.links.length} linked; ` +
							`${unlinkedCount(pair, side)} unlinked here, ${unlinkedCount(pair, otherSide(side))} in the partner.`,
						8000,
					);
				}
				return true;
			},
		});
	}

	private async linkCursorLines(path: string, editor: Editor, partnerPath: string, partnerEditor: Editor) {
		await this.syncNow(path);
		await this.syncNow(partnerPath);
		const hit = this.store.lookup(path);
		if (!hit) return;
		const { pair, side } = hit;
		const mine = unitAtLine(pair[side].units, editor.getCursor().line);
		const theirs = unitAtLine(pair[otherSide(side)].units, partnerEditor.getCursor().line);
		if (mine < 0 || theirs < 0) {
			new Notice("CAT: put the cursor on a line with text in both notes first.");
			return;
		}
		const myId = pair[side].units[mine].id;
		const theirId = pair[otherSide(side)].units[theirs].id;
		if (side === "a") linkUnits(pair, myId, theirId);
		else linkUnits(pair, theirId, myId);
		this.store.markChanged(pair);
		this.refreshActive();
		new Notice("CAT: lines linked.");
	}

	private async jumpToPartner(path: string, editor: Editor) {
		await this.syncNow(path);
		const hit = this.store.lookup(path);
		if (!hit) return;
		const match = partnerAt(hit.pair, hit.side, editor.getCursor().line);
		if (!match) {
			new Notice("CAT: this line has no corresponding line yet.");
			return;
		}
		const partnerPath = hit.pair[otherSide(hit.side)].path;
		let target: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!target && leaf.view instanceof MarkdownView && leaf.view.file?.path === partnerPath) target = leaf;
		});
		const leaf: WorkspaceLeaf = target ?? this.app.workspace.getLeaf("split", "vertical");
		if (!target) {
			const file = this.app.vault.getAbstractFileByPath(partnerPath);
			if (!(file instanceof TFile)) return;
			await leaf.openFile(file);
		}
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		const view = leaf.view;
		if (view instanceof MarkdownView) {
			const pos = { line: match.partner.start, ch: 0 };
			view.editor.setCursor(pos);
			view.editor.scrollIntoView({ from: pos, to: pos }, true);
		}
	}

	private async toggleDraftAt(path: string, line: number) {
		await this.syncNow(path);
		const hit = this.store.lookup(path);
		if (!hit) return;
		const state = toggleDraft(hit.pair, hit.side, line);
		if (state === null) {
			new Notice("CAT: put the cursor on a line with text first.");
			return;
		}
		this.store.markChanged(hit.pair);
		if (!this.settings.showDrafts) new Notice(state ? "CAT: marked as draft." : "CAT: draft cleared.");
		this.refreshActive();
	}
}
