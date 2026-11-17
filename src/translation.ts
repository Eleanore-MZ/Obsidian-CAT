import { MarkdownView, normalizePath, Notice, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { otherSide } from "./align";
import type CatPlugin from "./main";

/**
 * "Translation mode": open the paired note next to the current one, creating
 * and pairing a new note first when there is none.
 */
export class TranslationMode {
	private buttons = new Map<MarkdownView, HTMLElement>();

	constructor(private plugin: CatPlugin) {}

	/** Adds the header button to every open note view that lacks it. */
	syncButtons(): void {
		const show = this.plugin.settings.showTranslationButton;
		const seen = new Set<MarkdownView>();
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) return;
			const view = leaf.view;
			seen.add(view);
			const existing = this.buttons.get(view);
			if (show && !existing) {
				const el = view.addAction("languages", "Translation mode: open the paired note side by side", () => {
					void this.open(view);
				});
				el.addClass("cat-translation-button");
				this.buttons.set(view, el);
			} else if (!show && existing) {
				existing.remove();
				this.buttons.delete(view);
			}
		});
		for (const [view, el] of this.buttons) {
			if (!seen.has(view)) {
				el.remove();
				this.buttons.delete(view);
			}
		}
	}

	removeButtons(): void {
		for (const el of this.buttons.values()) el.remove();
		this.buttons.clear();
	}

	async open(view: MarkdownView): Promise<void> {
		const file = view.file;
		if (!file) return;
		const { app } = this.plugin;
		let partner: TFile | null = null;

		const hit = this.plugin.store.lookup(file.path);
		if (hit) {
			const f = app.vault.getAbstractFileByPath(hit.pair[otherSide(hit.side)].path);
			if (f instanceof TFile) partner = f;
		}
		if (!partner) {
			partner = await this.createPartner(file);
			if (!partner) return;
			this.plugin.store.create(file.path, view.editor.getValue(), partner.path, await app.vault.read(partner));
			new Notice(`CAT: created and paired "${partner.basename}".`);
		}

		// Reuse a pane that already shows the partner; otherwise split to the right.
		let target: WorkspaceLeaf | null = null;
		app.workspace.iterateAllLeaves((leaf) => {
			if (!target && leaf.view instanceof MarkdownView && leaf.view.file?.path === partner!.path) target = leaf;
		});
		if (!target) {
			target = app.workspace.createLeafBySplit(view.leaf, "vertical");
			await target.openFile(partner, { state: { mode: "source" } });
		}
		await app.workspace.revealLeaf(target);
		this.plugin.refreshActive();
	}

	/** Creates the translation note according to the location settings. */
	private async createPartner(source: TFile): Promise<TFile | null> {
		const { app } = this.plugin;
		const s = this.plugin.settings;
		let folder = "";
		if (s.newFileLocation === "same") folder = source.parent?.path ?? "";
		else if (s.newFileLocation === "folder") folder = normalizePath(s.newFileFolder.trim() || "Translations");
		if (folder === "/") folder = "";

		if (folder && !(app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
			try {
				await app.vault.createFolder(folder);
			} catch (err) {
				new Notice(`CAT: could not create folder "${folder}".`);
				return null;
			}
		}

		const base = (s.newFileName.trim() || "{{name}} (translation)").split("{{name}}").join(source.basename).replace(/[\\/:*?"<>|]/g, "-");
		let path = normalizePath(folder ? `${folder}/${base}.md` : `${base}.md`);
		const existing = app.vault.getAbstractFileByPath(path);
		// An existing, unpaired note with exactly that name is used as the partner.
		if (existing instanceof TFile && !this.plugin.store.lookup(existing.path)) return existing;
		for (let n = 2; app.vault.getAbstractFileByPath(path); n++) {
			path = normalizePath(folder ? `${folder}/${base} ${n}.md` : `${base} ${n}.md`);
		}
		return app.vault.create(path, "");
	}
}
