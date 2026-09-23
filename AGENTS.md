# jarvis-app — how to work in this repo

Orchestrator and glass. Not metal, not Flux YAML.

How it is built: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
How a change ships: [`docs/WORKFLOW.md`](docs/WORKFLOW.md). Read that before the first change.
Theme contract: [`docs/THEMES.md`](docs/THEMES.md).
Product calls: jarvis-infra [`docs/DECISIONS.md`](https://github.com/gordoncooper/jarvis-infra/blob/main/docs/DECISIONS.md). This file does not restate them.

## What outranks what

1. The live cluster.
2. jarvis-infra `docs/DECISIONS.md`.
3. Gitea `~/cluster` — what Flux reconciles.
4. This repo's `VERSION` for image tags and `JARVIS_THEME`. Infra `VERSION` is the metal pins.
5. jarvis-infra `docs/LESSONS.md`.
6. Prose in any docs tree, until the cluster agrees.

## Ship from here

- Edit on the bastion as `agent`. Push to GitHub `jarvis-app`.
- Flux does not watch this repo. A running change is an image pin in `~/cluster`, pushed to Gitea.
- Source `VERSION`. Bump the image tag you actually built. Never retag. `imagePullPolicy: Never` means a reused tag keeps the old layers.
- `scripts/install-images.sh` runs the orchestrator tests, then builds. `SKIP_ORCH=1` or `SKIP_GLASS=1` when the slice touches one image. Do not pass a tag in the environment. The script reads `VERSION` after that, and the override is discarded.
- One coherent change per commit.

## While you edit

- Glass talks only to the orchestrator. No product fetch to LiteLLM, Open WebUI, or OpenClaw.
- Engine is `glass/src/core/**`. UI is `glass/themes/<name>/**`. A theme reaches the orchestrator through `useJarvis()`. The build checks both before it compiles.
- One theme per image, the name in `JARVIS_THEME`. Do not add another without a decision.
- Production packer is esbuild. Vite is a bastion dev server only. Do not bind a workshop to port 8080 on a node.
- React, motion, SVG, and canvas or uPlot sparklines are fine. three.js is for the globe in the cockpit theme.
- Never render a number the cluster did not report. No stub, no filler. An empty state says it is empty. Do not label a one-shot fetch as live.
- Do not put Flux manifests in this repo.
- A later app JARVIS builds gets its own repo.
- Do not commit `learned.md`. Never dump Secret data, SOPS ciphertext, or keys.
- `.claude/settings.json` is the deny-rule set, not a second contract. Keep it committed.
- If an operator instruction contradicts a spec, change the work and the spec in the same commit, with the date and the reason.

## Surfaces

| Host | What an agent does |
| --- | --- |
| `jarvis.lan` | The product. Build this. |
| `home.lan` | Older board. Leave it alone. |
| `chat.lan` | Break-glass Open WebUI. Do not theme it. |
| `noc.lan` | Telemetry. Glass does not scrape it. Pulse comes from the orchestrator. |

Bastion as user `agent` only. No kubectl from a laptop.
