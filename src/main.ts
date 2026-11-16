import { Plugin } from "obsidian";
import { CatSettings, CatSettingTab, DEFAULT_SETTINGS } from "./settings";

export default class CatPlugin extends Plugin {
	settings: CatSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CatSettingTab(this.app, this));
		// Step 1 skeleton: no UI beyond the settings tab. Pairing, alignment
		// tracking and highlighting arrive in steps 2 and 3.
		console.log("[cat] CAT Highlight loaded");
	}

	onunload() {
		console.log("[cat] CAT Highlight unloaded");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
