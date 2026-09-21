# jarvis-app

Product surface for JARVIS: an **orchestrator** (the brain) and **glass** (the
UI), where glass is an engine plus one swappable **theme**.

It runs on **jarvis.lan**. The selected theme and the image tags live in
[`VERSION`](./VERSION) — this README does not repeat them, so it cannot go stale.

## Start here

| If you want to… | Read |
| --- | --- |
| Understand how the pieces fit | [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| Build, validate and ship a change | [docs/WORKFLOW.md](./docs/WORKFLOW.md) |
| Write or modify a theme | [docs/THEMES.md](./docs/THEMES.md) |
| Know the rules and what outranks what | [AGENTS.md](./AGENTS.md) |
| Work on the cockpit theme specifically | [glass/themes/cockpit/docs/](./glass/themes/cockpit/docs/) |

## Layout

```
orchestrator/            Python FastAPI — /health, /v1/{session,turns,pulse,stt,tts}
glass/
  src/core/              the engine: transport + useJarvis() + parsers
  themes/<name>/         a theme: manifest, UI, its own assets and docs
  esbuild.mjs public/    the packer
  devserve.mjs tools/    bastion-only dev server and headless UI driver
scripts/install-images.sh  build images on apps-01 and import into k3s
docs/                    architecture, workflow, theme contract
VERSION                  image tags and the selected theme — source of truth
```

Related repos: metal and law in
[`jarvis-infra`](https://github.com/gordoncooper/jarvis-infra); Flux YAML in
`cluster` on Gitea (`git.lan`); frozen prior art in
[`jarvis-core`](https://github.com/gordoncooper/jarvis-core).

## Quickstart (bastion, as `agent`)

```bash
export PATH="$HOME/.local/node-v22.14.0-linux-x64/bin:$PATH"

# UI against the live orchestrator, no rebuild cycle
kubectl -n apps port-forward svc/jarvis-orchestrator 18080:8080 &
cd ~/jarvis-app/glass && npm run build && node devserve.mjs
# http://127.0.0.1:5173/#login | #earth | #cmd | #noc
```

Orchestrator on its own, with mocked talker:

```bash
cd ~/jarvis-app/orchestrator
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
MOCK_LLM=1 PROMETHEUS_BASE=http://127.0.0.1:19090 \
  python -m uvicorn app.main:app --host 127.0.0.1 --port 8080
curl -s localhost:8080/health
```

```bash
python -m pytest        # orchestrator tests
npm run build           # glass: typecheck (src/ + themes/), guards, bundle
```

Full loop, validation checklist and the ship pipeline:
[docs/WORKFLOW.md](./docs/WORKFLOW.md).

## What is deployed

Both artifacts describe themselves, so you never have to guess:

```bash
curl -sk https://jarvis.lan/build.json   # theme, tag, build time
curl -sk https://jarvis.lan/health       # orchestrator version
```
