import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const themesDir = join(root, "themes");
const coreDir = join(root, "src", "core");
const outdir = join(root, "dist");

const known = () =>
  readdirSync(themesDir).filter((d) => existsSync(join(themesDir, d, "theme.json")));

const theme = process.env.JARVIS_THEME || "cockpit";
const packDir = join(themesDir, theme);
const manifestPath = join(packDir, "theme.json");

if (!existsSync(manifestPath)) {
  // No silent fallback: a build that cannot find the theme must fail loudly
  // rather than quietly shipping a different UI than the one that was asked for.
  throw new Error(
    `unknown theme "${theme}" — no themes/${theme}/theme.json. Known themes: ${known().join(", ") || "none"}`,
  );
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const field of ["name", "entry", "css"]) {
  if (!manifest[field]) throw new Error(`themes/${theme}/theme.json is missing "${field}"`);
}
if (manifest.name !== theme) {
  throw new Error(`themes/${theme}/theme.json declares name "${manifest.name}"`);
}

const entry = join(packDir, manifest.entry);
if (!existsSync(entry)) throw new Error(`theme entry missing: ${relative(root, entry)}`);
const cssFiles = manifest.css.map((f) => join(packDir, f));
for (const f of cssFiles) if (!existsSync(f)) throw new Error(`theme css missing: ${relative(root, f)}`);

// ---------------------------------------------------------------------------
// Boundary assertions. The whole point of the core/theme split is that a second
// theme can be written without touching core and without reimplementing the
// data layer. These two checks are what keep that true; they run before every
// build so they cannot be skipped by the deploy script.
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const coreViolations = [];
// Matches `from "x"`, bare `import "x"` and dynamic `import("x")` — a
// side-effect import has no `from` and would otherwise slip past.
const SPECIFIER = /(?:from|import)\s*\(?\s*"([^"]+)"/g;
for (const file of walk(coreDir)) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(SPECIFIER)) {
    if (m[1].includes("themes/")) coreViolations.push(`${relative(root, file)} -> ${m[1]}`);
  }
}
if (coreViolations.length) {
  throw new Error(`core must not depend on a theme:\n  ${coreViolations.join("\n  ")}`);
}

// Themes render; they do not talk to the orchestrator. If a theme reaches for
// one of these directly, the useJarvis surface is incomplete and the next theme
// will have to copy the plumbing again.
const RUNTIME_CALLS =
  /\b(fetchHealth|fetchSession|fetchPulse|streamTurn|streamAudioTurn|fetchTtsObjectUrl|MediaRecorder|EventSource)\b/;
const themeViolations = [];
for (const dir of known()) {
  for (const file of walk(join(themesDir, dir))) {
    const src = readFileSync(file, "utf8");
    for (const [i, line] of src.split("\n").entries()) {
      const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      if (/^\s*\*/.test(line)) continue; // block-comment body
      if (RUNTIME_CALLS.test(code)) themeViolations.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
    }
    if (/from\s+"\.\.\/\.\.\/src\//.test(src)) {
      themeViolations.push(`${relative(root, file)}: reaches into src/ — import from "@core"`);
    }
  }
}
if (themeViolations.length) {
  throw new Error(
    `themes must go through useJarvis(), not the transport:\n  ${themeViolations.join("\n  ")}`,
  );
}

// ---------------------------------------------------------------------------
// Wipe first. cpSync only adds, so dist accumulated files that had been
// deleted from the theme — themes/cockpit/static/login.jpg was removed from
// the repo and still shipped in the image. Worse, building theme B over a
// theme A dist would have produced an image containing both.
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
cpSync(join(root, "public", "index.html"), join(outdir, "index.html"));

// Concatenated in manifest order: tokens first, then the pack, or the cascade
// breaks in ways that look like random visual damage.
writeFileSync(outdir + "/theme.css", cssFiles.map((f) => readFileSync(f, "utf8")).join("\n"));

if (manifest.static) {
  const extra = join(packDir, manifest.static);
  if (existsSync(extra)) cpSync(extra, join(outdir, "theme-static"), { recursive: true });
}

// Assets the theme declares. `from` is resolved theme-relative first, then
// glass-relative, so two themes can share one copy of something big without
// either of them owning it. Nothing is copied that a theme did not ask for.
for (const asset of manifest.assets ?? []) {
  if (!asset.from || !asset.to) throw new Error(`themes/${theme}/theme.json: asset needs "from" and "to"`);
  const themeLocal = join(packDir, asset.from);
  const glassLocal = join(root, asset.from);
  const src = existsSync(themeLocal) ? themeLocal : glassLocal;
  if (!existsSync(src)) throw new Error(`theme asset missing: ${asset.from} (looked in ${relative(root, themeLocal)} and ${asset.from})`);
  cpSync(src, join(outdir, asset.to), { recursive: true });
}

// Fonts the theme declares, pulled from @fontsource. The latin subset and the
// output filename used to be hardcoded here while theme.css referenced the
// output names — the manifest now carries the name so the coupling is visible.
const FONT_SUBSET = "latin";
if (manifest.fonts?.length) mkdirSync(join(outdir, "fonts"), { recursive: true });
for (const font of manifest.fonts ?? []) {
  if (!font.pkg || !font.weight || !font.as) {
    throw new Error(`themes/${theme}/theme.json: font needs "pkg", "weight" and "as"`);
  }
  const file = `${font.pkg}-${FONT_SUBSET}-${font.weight}-normal.woff2`;
  const from = join(root, "node_modules", "@fontsource", font.pkg, "files", file);
  // A declared font that is not installed used to be skipped silently and you
  // got unstyled text. Same class of failure as a missing stylesheet.
  if (!existsSync(from)) {
    throw new Error(`font not installed: @fontsource/${font.pkg} ${font.weight} (add it to package.json)`);
  }
  cpSync(from, join(outdir, "fonts", font.as));
}

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  outfile: join(outdir, "app.js"),
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  // 4.4MB of sourcemap has no business in the runtime image; install-images.sh
  // sets this to 0. Local builds keep maps for debugging.
  sourcemap: process.env.JARVIS_SOURCEMAP !== "0",
  alias: { "@core": join(coreDir, "index.ts") },
});

// A built image should be able to say which theme it contains. Two images that
// differ only by theme were previously indistinguishable artifacts.
writeFileSync(
  join(outdir, "build.json"),
  JSON.stringify(
    {
      theme: manifest.name,
      title: manifest.title ?? manifest.name,
      displays: manifest.displays ?? [],
      tag: process.env.JARVIS_APP_TAG || process.env.IMAGE_GLASS_TAG || "dev",
      built_at: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);

console.log(`built theme=${manifest.name} -> ${relative(root, outdir)}`);
