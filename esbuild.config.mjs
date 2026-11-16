import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import fs from "fs";
import path from "path";

// Where the built plugin is copied so Obsidian can load it.
// Defaults to the sibling test vault (E:\Projects\test-vault when this repo
// lives at E:\Projects\obsidian-cat). Override with the CAT_PLUGIN_DIR
// environment variable to point at another vault's plugin folder.
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const pluginDir =
	process.env.CAT_PLUGIN_DIR ||
	path.resolve("..", "test-vault", ".obsidian", "plugins", manifest.id);

const prod = process.argv[2] === "production";

function copyToVault() {
	try {
		fs.mkdirSync(pluginDir, { recursive: true });
		for (const file of ["main.js", "manifest.json", "styles.css"]) {
			if (fs.existsSync(file)) fs.copyFileSync(file, path.join(pluginDir, file));
		}
		// Lets the community "Hot Reload" plugin pick up rebuilds automatically.
		const marker = path.join(pluginDir, ".hotreload");
		if (!fs.existsSync(marker)) fs.writeFileSync(marker, "");
		console.log(`[cat] copied build to ${pluginDir}`);
	} catch (err) {
		console.warn(`[cat] could not copy build to ${pluginDir}: ${err.message}`);
	}
}

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: prod,
	plugins: [
		{
			name: "copy-to-vault",
			setup(build) {
				build.onEnd((result) => {
					if (result.errors.length === 0) copyToVault();
				});
			},
		},
	],
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
