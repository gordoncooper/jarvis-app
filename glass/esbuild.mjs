import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const theme = process.env.JARVIS_THEME || "default";
const outdir = join(root, "dist");

mkdirSync(outdir, { recursive: true });
cpSync(join(root, "public", "index.html"), join(outdir, "index.html"));
cpSync(join(root, "themes", theme, "theme.css"), join(outdir, "theme.css"));

await esbuild.build({
  entryPoints: [join(root, "src", "main.ts")],
  bundle: true,
  outfile: join(outdir, "app.js"),
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: true,
});

console.log(`built theme=${theme} -> ${outdir}`);
