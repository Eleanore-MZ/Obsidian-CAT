import { normalizePath, Plugin } from "obsidian";
import { createPair, PairRecord, Side, syncSide } from "./align";

/**
 * Keeps pair records as small JSON files inside the plugin's own folder
 * (.obsidian/plugins/cat-highlight/pairs/). Obsidian never shows anything
 * under .obsidian in the file tree, search, graph or link suggestions, and the
 * files are accessed through the adapter rather than as vault notes, so other
 * plugins do not see them either.
 */
export class PairStore {
	private pairs = new Map<string, PairRecord>();
	private byPath = new Map<string, string>();
	private saveTimers = new Map<string, number>();

	constructor(private plugin: Plugin) {}

	private get dir(): string {
		return normalizePath(`${this.plugin.manifest.dir}/pairs`);
	}

	private fileFor(id: string): string {
		return normalizePath(`${this.dir}/${id}.json`);
	}

	async load(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		if (!(await adapter.exists(this.dir))) return;
		const listing = await adapter.list(this.dir);
		for (const file of listing.files) {
			if (!file.endsWith(".json")) continue;
			try {
				const record = JSON.parse(await adapter.read(file)) as PairRecord;
				if (record.version === 1 && record.id) this.index(record);
			} catch (err) {
				console.warn(`[cat] could not read pair file ${file}`, err);
			}
		}
	}

	private index(pair: PairRecord): void {
		this.pairs.set(pair.id, pair);
		this.byPath.set(pair.a.path, pair.id);
		this.byPath.set(pair.b.path, pair.id);
	}

	all(): PairRecord[] {
		return [...this.pairs.values()];
	}

	/** The pair a note belongs to, and which side it is. */
	lookup(path: string): { pair: PairRecord; side: Side } | null {
		const id = this.byPath.get(path);
		const pair = id ? this.pairs.get(id) : undefined;
		if (!pair) return null;
		return { pair, side: pair.a.path === path ? "a" : "b" };
	}

	create(pathA: string, textA: string, pathB: string, textB: string): PairRecord {
		this.remove(pathA);
		this.remove(pathB);
		const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
		const pair = createPair(id, pathA, textA, pathB, textB);
		this.index(pair);
		this.scheduleSave(pair, 0);
		return pair;
	}

	/** Updates a note's side of its pair from its current text. */
	sync(path: string, text: string): PairRecord | null {
		const hit = this.lookup(path);
		if (!hit) return null;
		if (syncSide(hit.pair, hit.side, text)) this.scheduleSave(hit.pair);
		return hit.pair;
	}

	rename(oldPath: string, newPath: string): void {
		const hit = this.lookup(oldPath);
		if (!hit) return;
		hit.pair[hit.side].path = newPath;
		this.byPath.delete(oldPath);
		this.byPath.set(newPath, hit.pair.id);
		this.scheduleSave(hit.pair, 0);
	}

	/** Unpairs the note (and its partner) and deletes the stored record. */
	remove(path: string): PairRecord | null {
		const hit = this.lookup(path);
		if (!hit) return null;
		const pair = hit.pair;
		this.pairs.delete(pair.id);
		this.byPath.delete(pair.a.path);
		this.byPath.delete(pair.b.path);
		const timer = this.saveTimers.get(pair.id);
		if (timer !== undefined) window.clearTimeout(timer);
		this.saveTimers.delete(pair.id);
		const file = this.fileFor(pair.id);
		const adapter = this.plugin.app.vault.adapter;
		void adapter.exists(file).then((exists) => (exists ? adapter.remove(file) : undefined));
		return pair;
	}

	markChanged(pair: PairRecord): void {
		this.scheduleSave(pair);
	}

	private scheduleSave(pair: PairRecord, delay = 1000): void {
		const existing = this.saveTimers.get(pair.id);
		if (existing !== undefined) window.clearTimeout(existing);
		const timer = window.setTimeout(() => {
			this.saveTimers.delete(pair.id);
			void this.write(pair);
		}, delay);
		this.saveTimers.set(pair.id, timer);
	}

	private async write(pair: PairRecord): Promise<void> {
		if (!this.pairs.has(pair.id)) return;
		const adapter = this.plugin.app.vault.adapter;
		if (!(await adapter.exists(this.dir))) await adapter.mkdir(this.dir);
		await adapter.write(this.fileFor(pair.id), JSON.stringify(pair));
	}

	/** Writes any pending changes immediately (used on unload). */
	async flush(): Promise<void> {
		const pending = [...this.saveTimers.keys()];
		for (const id of pending) {
			window.clearTimeout(this.saveTimers.get(id));
			this.saveTimers.delete(id);
			const pair = this.pairs.get(id);
			if (pair) await this.write(pair);
		}
	}
}
