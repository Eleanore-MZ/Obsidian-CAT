import { App, PluginSettingTab, Setting } from "obsidian";
import type CatPlugin from "./main";

export interface CatSettings {
	/** Turn the corresponding-block highlight on or off. */
	highlightEnabled: boolean;
	/** Tint the line under the cursor as well as its partner. */
	highlightSelf: boolean;
	/** Tint lines that have no partner yet. */
	showUnpairedMarkers: boolean;
	/** Scroll the partner into view when it is off screen. */
	scrollPartner: boolean;
	/** Colour of the line under the cursor ("" = theme accent). */
	selfColor: string;
	/** Colour of its partner in the other note ("" = theme accent). */
	partnerColor: string;
	/** Colour of unpaired lines. */
	unpairedColor: string;
	/** Opacity of the cursor-line tint, 0 to 1. */
	selfOpacity: number;
	/** Opacity of the partner tint, 0 to 1. */
	partnerOpacity: number;
	/** Opacity of the unpaired tint, 0 to 1. */
	unpairedOpacity: number;
	/** Tint lines marked as drafts. */
	showDrafts: boolean;
	/** Colour of draft lines. */
	draftColor: string;
	/** Opacity of the draft tint, 0 to 1. */
	draftOpacity: number;
	/** Show the translation-mode button in note headers. */
	showTranslationButton: boolean;
	/** Where new translation notes are created. */
	newFileLocation: "folder" | "same" | "root";
	/** Folder used when newFileLocation is "folder". */
	newFileFolder: string;
	/** File name for new translation notes; {{name}} is the source note's name. */
	newFileName: string;
}

export const DEFAULT_SETTINGS: CatSettings = {
	highlightEnabled: true,
	highlightSelf: true,
	showUnpairedMarkers: false,
	scrollPartner: true,
	selfColor: "",
	partnerColor: "",
	unpairedColor: "#e5a50a",
	selfOpacity: 0.1,
	partnerOpacity: 0.18,
	unpairedOpacity: 0.12,
	showDrafts: true,
	draftColor: "#e5534b",
	draftOpacity: 0.16,
	showTranslationButton: true,
	newFileLocation: "same",
	newFileFolder: "Translations",
	newFileName: "{{name}} (translation)",
};

function hexToRgb(hex: string): string | null {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	const n = parseInt(m[1], 16);
	return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** CSS variable values for the current settings. */
export function colorVariables(s: CatSettings): Record<string, string> {
	const accent = "var(--color-accent-rgb, 124, 77, 255)";
	const rgba = (hex: string, alpha: number, fallback: string) => `rgba(${hexToRgb(hex) ?? fallback}, ${alpha})`;
	return {
		"--cat-hl-self": rgba(s.selfColor, s.selfOpacity, accent),
		"--cat-hl-partner": rgba(s.partnerColor, s.partnerOpacity, accent),
		"--cat-unpaired": rgba(s.unpairedColor, s.unpairedOpacity, "229, 165, 10"),
		"--cat-draft": rgba(s.draftColor, s.draftOpacity, "229, 83, 75"),
	};
}

export class CatSettingTab extends PluginSettingTab {
	plugin: CatPlugin;

	constructor(app: App, plugin: CatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private async setValues(patch: Partial<CatSettings>, redraw = false) {
		Object.assign(this.plugin.settings, patch);
		await this.plugin.saveSettings();
		if (redraw) this.display();
	}

	/** A colour picker, an opacity slider and a reset button on one row. */
	private colorRow(
		name: string,
		desc: string,
		colorKey: "selfColor" | "partnerColor" | "unpairedColor" | "draftColor",
		opacityKey: "selfOpacity" | "partnerOpacity" | "unpairedOpacity" | "draftOpacity",
	) {
		const s = this.plugin.settings;
		const themeDefault = DEFAULT_SETTINGS[colorKey] === "";
		const shown = s[colorKey] || (themeDefault ? this.accentHex() : DEFAULT_SETTINGS[colorKey]);
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc + (themeDefault && !s[colorKey] ? " Currently following the theme accent." : ""))
			.addColorPicker((c) => c.setValue(shown).onChange((v) => this.setValues({ [colorKey]: v })))
			.addSlider((sl) =>
				sl
					.setLimits(0.04, 0.6, 0.02)
					.setValue(s[opacityKey])
					.setDynamicTooltip()
					.onChange((v) => this.setValues({ [opacityKey]: v })),
			)
			.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Reset to default")
					.onClick(() =>
						this.setValues({ [colorKey]: DEFAULT_SETTINGS[colorKey], [opacityKey]: DEFAULT_SETTINGS[opacityKey] }, true),
					),
			);
	}

	private accentHex(): string {
		const rgb = getComputedStyle(document.body).getPropertyValue("--color-accent-rgb").split(",").map((x) => parseInt(x));
		if (rgb.length !== 3 || rgb.some((x) => isNaN(x))) return "#7c4dff";
		return "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("p", {
			text: 'Pair two notes with the command "Pair this note with the note in the other pane".',
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Highlight corresponding blocks")
			.setDesc("Highlight the matching line or block in the paired note while editing.")
			.addToggle((t) => t.setValue(this.plugin.settings.highlightEnabled).onChange((v) => this.setValues({ highlightEnabled: v })));

		new Setting(containerEl)
			.setName("Highlight the current line")
			.setDesc("Also tint the line your cursor is on. When off, only its partner in the other note is highlighted.")
			.addToggle((t) => t.setValue(this.plugin.settings.highlightSelf).onChange((v) => this.setValues({ highlightSelf: v })));

		new Setting(containerEl)
			.setName("Scroll to the corresponding block")
			.setDesc("When the matching block is off screen, scroll the other pane so it sits in the middle.")
			.addToggle((t) => t.setValue(this.plugin.settings.scrollPartner).onChange((v) => this.setValues({ scrollPartner: v })));

		new Setting(containerEl)
			.setName("Highlight unpaired lines")
			.setDesc("Tint lines that have no partner in the paired note yet.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showUnpairedMarkers).onChange((v) => this.setValues({ showUnpairedMarkers: v })),
			);

		new Setting(containerEl)
			.setName("Highlight draft lines")
			.setDesc('Tint lines marked with "Toggle draft on the current line". Give that command a hotkey under Settings, Hotkeys.')
			.addToggle((t) => t.setValue(this.plugin.settings.showDrafts).onChange((v) => this.setValues({ showDrafts: v })));

		new Setting(containerEl).setName("Translation mode").setHeading();

		new Setting(containerEl)
			.setName("Show the translation button")
			.setDesc("Adds a button to the top right of each note that opens its paired note in a split, creating one if needed.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showTranslationButton).onChange(async (v) => {
					await this.setValues({ showTranslationButton: v });
					this.plugin.translation.syncButtons();
				}),
			);

		new Setting(containerEl)
			.setName("Where new translation notes go")
			.setDesc("Used when a note has no paired note yet.")
			.addDropdown((d) =>
				d
					.addOption("same", "Same folder as the source note")
					.addOption("folder", "A dedicated folder")
					.addOption("root", "Vault root folder")
					.setValue(this.plugin.settings.newFileLocation)
					.onChange((v) => this.setValues({ newFileLocation: v as CatSettings["newFileLocation"] }, true)),
			);

		if (this.plugin.settings.newFileLocation === "folder") {
			new Setting(containerEl)
				.setName("Dedicated folder")
				.setDesc("Created if it does not exist.")
				.addText((t) =>
					t
						.setPlaceholder("Translations")
						.setValue(this.plugin.settings.newFileFolder)
						.onChange((v) => this.setValues({ newFileFolder: v })),
				);
		}

		new Setting(containerEl)
			.setName("New note name")
			.setDesc("{{name}} is replaced with the source note's name.")
			.addText((t) =>
				t
					.setPlaceholder("{{name}} (translation)")
					.setValue(this.plugin.settings.newFileName)
					.onChange((v) => this.setValues({ newFileName: v })),
			);

		new Setting(containerEl).setName("Colours").setHeading();
		this.colorRow("Current line", "The line or block your cursor is on.", "selfColor", "selfOpacity");
		this.colorRow("Corresponding block", "Its partner in the other note.", "partnerColor", "partnerOpacity");
		this.colorRow("Unpaired lines", "Lines without a partner, when that option is on.", "unpairedColor", "unpairedOpacity");
		this.colorRow("Draft lines", "Lines marked as drafts, on both notes.", "draftColor", "draftOpacity");
	}
}
