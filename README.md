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

Step 2 of 4: pairing and alignment tracking work; the visible highlight arrives in step 3.

## Using it

Open the two notes side by side, focus one of them, and run these from the command
palette (Ctrl+P). Each can also be given a hotkey.

| Command | What it does |
| --- | --- |
| Pair this note with the note in the other pane | Links the two notes and pairs their units in order as a starting point. |
| Unpair this note | Removes the pairing and its stored alignment. |
| Link the current line with the cursor line in the paired note | Fixes a single correspondence by hand. |
| Show pairing status | Shows how many units are linked and how many are not. |

While you write, the plugin compares each note with its last snapshot and carries every
link to wherever its line ended up, so inserting, deleting, rewriting or moving lines does
not scramble the pairs. When both notes gain the same number of new lines between two
already-linked lines (for example a new sentence and then its translation), they are
linked automatically. Renaming or moving a paired note keeps the pairing; deleting one
removes it.

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
npm test         # unit tests for the splitter and re-matching logic
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
