// Bundles the Obsidian-free modules' tests with esbuild and runs them with
// Node's built-in test runner. Usage: npm test
import esbuild from "esbuild";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-tests-"));
const entries = fs.readdirSync("test").filter((f) => f.endsWith(".test.ts"));
await esbuild.build({
	entryPoints: entries.map((f) => path.join("test", f)),
	bundle: true,
	platform: "node",
	format: "esm",
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	logLevel: "warning",
});
const files = fs.readdirSync(outDir).map((f) => path.join(outDir, f));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(result.status ?? 1);
