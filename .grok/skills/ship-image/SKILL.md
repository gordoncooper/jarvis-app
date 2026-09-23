---
name: ship-image
description: Build and pin JARVIS product images. Use when shipping glass or orchestrator, install-images.sh, VERSION image tag, SKIP_ORCH, SKIP_GLASS, or a running change that is not Flux YAML.
---

# ship-image

- Work in ~/jarvis-app as agent. Push GitHub jarvis-app.
- Flux does not watch this repo. A running change also needs a flux-pin in ~/cluster after the image exists.
- Source VERSION. Bump only the tag you built. Never retag. Never pass the tag in the environment to install-images.sh.
- Read docs/WORKFLOW.md before a cut. The tag sequences and the index.html `?v=` query are there. Do not paste WORKFLOW into the reply.
- scripts/install-images.sh runs orchestrator tests then builds. SKIP_ORCH=1 or SKIP_GLASS=1 when only one image changed.
- imagePullPolicy Never means a reused tag keeps old layers.
- Glass talks only to the orchestrator. Do not add product fetch to LiteLLM, OWUI, or OpenClaw.
- After build, state the new VERSION values and stop. Do not kubectl apply.
