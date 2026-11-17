import { App, PluginSettingTab, Setting } from "obsidian";
import type CatPlugin from "./main";

export interface CatSettings {
	/** Turn the corresponding-block highlight on or off. */
	highlightEnabled: boolean;
	/** Show a faint marker on lines that have lost their partner. */
	showUnpairedMarkers: boolean;
	/** Scroll the partner into view when it is off screen. */
	scrollPartner: boolean;
}

export const DEFAULT_SETTINGS: CatSettings = {
	highlightEnabled: true,
	showUnpairedMarkers: false,
	scrollPartner: true,
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
		containerEl.createEl("p", {
			text: "Pair two notes with the command \"Pair this note with the note in the other pane\". Highlight colours follow your theme accent and can be changed with a CSS snippet (see the README).",
			cls: "setting-item-description",
		});

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
			.setName("Scroll to the corresponding block")
			.setDesc("When the matching block is off screen, scroll the other pane so it sits in the middle.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.scrollPartner).onChange(async (v) => {
					this.plugin.settings.scrollPartner = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Mark unpaired lines")
			.setDesc("Show a faint bar at the left of lines that have no partner in the paired note yet.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showUnpairedMarkers).onChange(async (v) => {
					this.plugin.settings.showUnpairedMarkers = v;
					await this.plugin.saveSettings();
				}),
			);
	}
}
