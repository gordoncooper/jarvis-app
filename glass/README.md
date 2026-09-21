# glass

One engine plus one theme, selected at build time. `glass/` is **not** a theme:

- **engine** — `src/core/`. Transport, `useJarvis()`, parsers, formatters.
- **packer** — `esbuild.mjs`, `public/`, `nginx.conf`, `Dockerfile`, plus
  `devserve.mjs` and `tools/` for the bastion loop.
- **themes** — `themes/<name>/`, each self-contained.

How it fits together: [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).
Writing a theme: [../docs/THEMES.md](../docs/THEMES.md).
Build/validate/ship loop: [../docs/WORKFLOW.md](../docs/WORKFLOW.md).

## Themes

| Theme | Status |
| --- | --- |
| `cockpit` | Product pack (D-0031 / D-0032). Four displays: login, earth, cmd, noc. Docs in [`themes/cockpit/docs/`](./themes/cockpit/docs/). |

## Build

`VERSION` in the repo root selects the theme and the tag;
`scripts/install-images.sh` sources it.

```bash
export PATH="$HOME/.local/node-v22.14.0-linux-x64/bin:$PATH"
JARVIS_THEME=cockpit npm run build   # typecheck (src/ + themes/) then bundle
npm run bundle                       # skip the typecheck while iterating
```

The build fails — it does not warn — on any of:

| Check | Why |
| --- | --- |
| unknown theme | no silent fallback; a build must ship the theme that was asked for |
| core imports a theme | deleting a theme would break the engine |
| a theme touches the transport | `fetch*`, `streamTurn`, `MediaRecorder`, `EventSource`, or a relative import into `src/` |
| declared asset missing | `theme.json` is the complete list of inputs |
| declared font not installed | used to skip silently and give you unstyled text |
| type error anywhere | including inside `themes/` |

`dist/` is wiped first, so a file deleted from a theme stops shipping and
building theme B over a theme A `dist` cannot produce an image containing both.

Environment knobs:

| Var | Effect |
| --- | --- |
| `JARVIS_THEME` | which theme to build (default `cockpit`) |
| `JARVIS_APP_TAG` | stamped into `dist/build.json` |
| `JARVIS_SOURCEMAP=0` | omit the 4.4MB sourcemap; set by `install-images.sh` |

## Image

`dist/` is built on the bastion first, then the image just serves it:

```bash
JARVIS_THEME=cockpit npm run build
docker build -t jarvis-glass:dev .
```

Nginx proxies `/health`, `/readyz` and `/v1/` to
`jarvis-orchestrator.apps.svc.cluster.local:8080`.

`Dockerfile.multistage` builds from source instead — for CI or a machine with
Docker and network. `install-images.sh` uses the bastion path.

## What shipped

```bash
curl -sk https://jarvis.lan/build.json    # theme, tag, build time
```
