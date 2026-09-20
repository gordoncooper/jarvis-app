import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const theme = process.env.JARVIS_THEME || "godseye";
const outdir = join(root, "dist");
const packDir = join(root, "themes", theme);
const css = join(packDir, "theme.css");

const entries = {
  godseye: join(root, "src", "hud", "main.tsx"),
};

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

const fontsOut = join(outdir, "fonts");
mkdirSync(fontsOut, { recursive: true });
const fontPairs = [
  ["ibm-plex-sans", "ibm-plex-sans-latin-400-normal.woff2", "plex-sans-400.woff2"],
  ["ibm-plex-sans", "ibm-plex-sans-latin-500-normal.woff2", "plex-sans-500.woff2"],
  ["ibm-plex-sans", "ibm-plex-sans-latin-600-normal.woff2", "plex-sans-600.woff2"],
  ["ibm-plex-mono", "ibm-plex-mono-latin-400-normal.woff2", "plex-mono-400.woff2"],
  ["ibm-plex-mono", "ibm-plex-mono-latin-500-normal.woff2", "plex-mono-500.woff2"],
  ["ibm-plex-mono", "ibm-plex-mono-latin-600-normal.woff2", "plex-mono-600.woff2"],
];
for (const [pkg, file, dest] of fontPairs) {
  const from = join(root, "node_modules", "@fontsource", pkg, "files", file);
  if (existsSync(from)) cpSync(from, join(fontsOut, dest));
}

await esbuild.build({
  entryPoints: [entries[theme] ?? join(root, "src", "main.ts")],
  bundle: true,
  outfile: join(outdir, "app.js"),
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  sourcemap: true,
});

console.log(`built theme=${theme} -> ${outdir}`);
