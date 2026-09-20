import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const theme = process.env.JARVIS_THEME || "mark-hud";
const outdir = join(root, "dist");
const packDir = join(root, "themes", theme);
const css = join(packDir, "theme.css");

if (!existsSync(css)) {
  throw new Error(`theme pack missing: ${css} (JARVIS_THEME=${theme})`);
}

mkdirSync(outdir, { recursive: true });
cpSync(join(root, "public", "index.html"), join(outdir, "index.html"));
cpSync(css, join(outdir, "theme.css"));

const extraStatic = join(packDir, "static");
if (existsSync(extraStatic)) {
  cpSync(extraStatic, join(outdir, "theme-static"), { recursive: true });
}

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
