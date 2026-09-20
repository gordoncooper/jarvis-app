# jarvis-app

Product surface for JARVIS: **orchestrator** (brain) + **glass** (UI) + **themes**.

| Layer | Repo |
| --- | --- |
| Metal, law, docs | [`jarvis-infra`](https://github.com/gordoncooper/jarvis-infra) |
| Flux YAML | `cluster` on Gitea (`git.lan`) |
| **This product** | `jarvis-app` |
| Prior art (frozen) | [`jarvis-core`](https://github.com/gordoncooper/jarvis-core) |

Decisions: [`DECISIONS.md`](https://github.com/gordoncooper/jarvis-infra/blob/main/docs/DECISIONS.md)
(especially D-0012, D-0017, D-0020, D-0021). Agents: [`AGENTS.md`](./AGENTS.md).

## Layout

```
orchestrator/   Python FastAPI — /health, /v1/session, /v1/turns (SSE)
glass/          TypeScript → static theme; nginx proxies /v1 to orchestrator
themes live under glass/themes/<name>/
```

## Local orchestrator (bastion)

```bash
cd ~/jarvis-app/orchestrator
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export MOCK_LLM=1
export PERSONA_PATH=~/jarvis-infra/docs/persona.txt
export BRIEFING_PATH=~/jarvis-infra/docs/briefing.md
uvicorn app.main:app --host 127.0.0.1 --port 8080
```

Smoke:

```bash
curl -s localhost:8080/health
curl -s localhost:8080/v1/session | head
curl -sN -H 'Accept: text/event-stream' -H 'Content-Type: application/json' \
  -d '{"text":"Who am I?"}' 'localhost:8080/v1/turns?stream=1'
```

Against live LiteLLM (from a pod or with a key in the env — never commit it):

```bash
export MOCK_LLM=0
export LITELLM_BASE=http://litellm.inference.svc.cluster.local:4000
export LITELLM_API_KEY=…   # from cluster secret, not git
export TALKER_MODEL=jarvis-local
```

## Glass image

```bash
cd ~/jarvis-app/glass
docker build -t jarvis-glass:dev .
# optional: --build-arg JARVIS_THEME=default
```

Nginx in the image proxies `/health` and `/v1/` to
`jarvis-orchestrator.apps.svc.cluster.local:8080`.

## Tags

Source [`VERSION`](./VERSION). Planning freeze was `v0.5.2`. First product cut is
**`v0.6.0`** when slice 1 is ready to ship (D-0021).
