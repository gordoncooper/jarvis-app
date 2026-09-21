# glass

One engine, one theme, chosen at build time. The engine (`src/core/`) is the
same for every theme; the theme owns the entire UI/UX.

Contract and how to add a theme: [`docs/THEMES.md`](../docs/THEMES.md).

```
src/core/        the engine — api, useJarvis(), parsers, formatters
assets/globe/    shared asset library, served at /globe/*
themes/<name>/   theme.json + main.tsx + css + ui/
tools/           bastion-only screenshot and CDP driver
devserve.mjs     bastion-only static server with /v1 proxy
```

## Themes

| Theme | Status |
| --- | --- |
| `cockpit` | Product pack (D-0031 / D-0032). Four displays: login, earth, cmd, noc. |

## Build

`VERSION` in the repo root is the source of truth for both the theme and the
image tag; `scripts/install-images.sh` sources it.

```bash
cd ~/jarvis-app/glass
export PATH="$HOME/.local/node-v22.14.0-linux-x64/bin:$PATH"
JARVIS_THEME=cockpit npm run build     # -> dist/
npm run typecheck                      # covers src/ and themes/
```

The build refuses an unknown theme rather than falling back, and asserts the
two boundary rules from `docs/THEMES.md` before compiling: core may not import
a theme, and a theme may not touch the transport.

`dist/build.json` records the theme, tag and build time, so a running image can
say what it is:

```bash
curl -sk https://jarvis.lan/build.json
```

## Image

```bash
docker build -t jarvis-glass:dev .          # expects dist/ to exist
```

Nginx in the image proxies `/health` and `/v1/` to
`jarvis-orchestrator.apps.svc.cluster.local:8080`.
