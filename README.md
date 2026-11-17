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

Version 0.1.0. All four planned steps are done: unit splitting, pairing with hidden
alignment storage, the Live Preview highlight, and edge-case testing. There is no
dictionary, termbase or translation memory, by design.

## The highlight

In Live Preview or source mode, when the cursor sits on a linked line, that line gets a
soft tint and its partner in the other pane gets a slightly stronger one. The partner is
scrolled into the middle of its pane only when it is off screen. It works in both
directions: click into the other pane and the roles swap. While a Chinese (or any IME)
candidate is being composed the highlight waits for the commit, so it does not flicker.
Reading view is never touched. Tables and callouts that Live Preview draws as rendered
blocks are highlighted as a block (or, for tables, the matching row).

Colours are set in the plugin settings. The current line and its partner follow the
theme accent until you pick a colour; each colour has its own opacity slider and a reset
button.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Highlight corresponding blocks | On | Master switch for the highlight. |
| Highlight the current line | On | Also tint the line under the cursor, not just its partner. |
| Scroll to the corresponding block | On | Centre the partner in its pane when it is off screen. |
| Highlight unpaired lines | Off | Tint lines that have no partner yet. |
| Current line colour | Theme accent, 10% | Tint of the line under the cursor. |
| Corresponding block colour | Theme accent, 18% | Tint of its partner in the other note. |
| Unpaired lines colour | Amber, 12% | Tint of lines without a partner. |

## Where the data lives

Each pair is a small JSON file in `.obsidian\plugins\cat-highlight\pairs\`. Nothing is
written into your notes, and nothing appears in the file tree, search or graph. Removing
the plugin removes the pairings, but never touches the notes. With Obsidian Sync, the
pairings only travel between devices when "Installed community plugins" is synced.

## Known limits

Matching is one-to-one: a line has at most one partner. If you split one source line into
two, the link stays on the half that is most similar to the old text, and the other half
is left unpaired until you write its translation or link it by hand. Very large rewrites
done outside Obsidian (for example replacing most of a note at once) can leave many lines
unpaired; use "Link the current line with the cursor line in the paired note" to fix
individual pairs, or unpair and pair again to start over in order.

## Using it

Open the two notes side by side, focus one of them, and run these from the command
palette (Ctrl+P). Each can also be given a hotkey.

| Command | What it does |
| --- | --- |
| Pair this note with the note in the other pane | Links the two notes and pairs their units in order as a starting point. |
| Unpair this note | Removes the pairing and its stored alignment. |
| Link the current line with the cursor line in the paired note | Fixes a single correspondence by hand. |
| Jump to the corresponding line in the paired note | Moves the cursor to the partner line, opening the partner in a split if needed. |
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
