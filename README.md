# CAT Highlight

A lightweight, computer-assisted-translation style plugin for Obsidian, built for
bilingual writing (mainly Chinese and English). When you edit a pair of notes side by
side, the line or block under your cursor is highlighted together with its counterpart
in the other note. Both notes may keep changing; the pairing follows the text.

The plugin aims to be invisible: no ribbon icon, sidebar, or dashboard. It works through
a few command palette entries, a settings tab, and the highlight itself. Alignment data
is kept inside the plugin's own folder under `.obsidian`, so your Markdown stays clean
and nothing appears in the file tree.

## Status

Step 1 of 4: project skeleton. The plugin loads and has a settings tab, but pairing and
highlighting are not implemented yet.

## Development (Windows)

The repository is expected to sit next to the test vault:

```
E:\Projects\obsidian-cat      <- this repository
E:\Projects\test-vault        <- Obsidian test vault
```

Requires Node.js 18 or newer. In PowerShell:

```powershell
cd E:\Projects\obsidian-cat
npm install
npm run dev      # watch mode, rebuilds on every save
npm run build    # type-check and production build
```

Each build copies `main.js`, `manifest.json` and `styles.css` into
`..\test-vault\.obsidian\plugins\cat-highlight\`. To target a different vault, set the
`CAT_PLUGIN_DIR` environment variable first, for example
`$env:CAT_PLUGIN_DIR = "D:\Notes\.obsidian\plugins\cat-highlight"`.

Enable **CAT Highlight** under Settings, Community plugins in the test vault. If the
community "Hot Reload" plugin is installed in the vault, it reloads the plugin
automatically after each rebuild (a `.hotreload` marker is created for it).

## Design notes

Units of correspondence, given strict line breaks: each non-empty line, each heading,
each list item (nested ones included), each table row (the `|---|` divider skipped), and
each whole quote block or callout. Frontmatter and code blocks are ignored. Highlighting
is limited to Live Preview and source editing mode.
