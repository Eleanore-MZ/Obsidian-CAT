import { Editor, MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { linkUnits, otherSide, unitAtLine, unlinkedCount } from "./align";
import { CatSettings, CatSettingTab, DEFAULT_SETTINGS } from "./settings";
import { PairStore } from "./store";

export default class CatPlugin extends Plugin {
	settings: CatSettings = DEFAULT_SETTINGS;
	store!: PairStore;
	private syncTimers = new Map<string, number>();

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CatSettingTab(this.app, this));

		this.store = new PairStore(this);
		await this.store.load();

		this.registerCommands();
		this.registerSyncEvents();

		// Catch up on edits made while Obsidian was closed or the plugin was off.
		this.app.workspace.onLayoutReady(() => void this.syncAllFromDisk());
	}

	async onunload() {
		for (const t of this.syncTimers.values()) window.clearTimeout(t);
		await this.store.flush();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ----- keeping alignment in step with edits -----

	private registerSyncEvents() {
		// Typing in Obsidian: follow the live editor text.
		this.registerEvent(
			this.app.workspace.on("editor-change", (editor, info) => {
				const file = info.file;
				if (file && this.store.lookup(file.path)) this.scheduleSync(file.path, () => editor.getValue(), 300);
			}),
		);
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
				}
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
		new Notice("CAT: lines linked.");
	}
}
