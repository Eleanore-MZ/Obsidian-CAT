import { App, PluginSettingTab, Setting } from "obsidian";
import type CatPlugin from "./main";

export interface CatSettings {
	/** Turn the corresponding-block highlight on or off. */
	highlightEnabled: boolean;
	/** Show a faint marker on lines that have lost their partner. */
	showUnpairedMarkers: boolean;
}

export const DEFAULT_SETTINGS: CatSettings = {
	highlightEnabled: true,
	showUnpairedMarkers: false,
};

export class CatSettingTab extends PluginSettingTab {
	plugin: CatPlugin;

	constructor(app: App, plugin: CatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Highlight corresponding blocks")
			.setDesc("Highlight the matching line or block in the paired note while editing.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.highlightEnabled).onChange(async (v) => {
					this.plugin.settings.highlightEnabled = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Mark unpaired lines")
			.setDesc("Show a faint marker on lines that have no partner in the paired note.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showUnpairedMarkers).onChange(async (v) => {
					this.plugin.settings.showUnpairedMarkers = v;
					await this.plugin.saveSettings();
				}),
			);
	}
}
