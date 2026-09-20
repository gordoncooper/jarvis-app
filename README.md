# jarvis-app

Product surface for JARVIS: **orchestrator** (brain) + **glass** (UI) + **themes**.

| Layer | Repo |
| --- | --- |
| Metal, law, docs | [`jarvis-infra`](https://github.com/gordoncooper/jarvis-infra) |
| Flux YAML | `cluster` on Gitea (`git.lan`) |
| **This product** | `jarvis-app` |
| Prior art (frozen) | [`jarvis-core`](https://github.com/gordoncooper/jarvis-core) |

Decisions that govern this repo live in
[`jarvis-infra/docs/DECISIONS.md`](https://github.com/gordoncooper/jarvis-infra/blob/main/docs/DECISIONS.md)
(especially D-0012, D-0017, D-0020). Agents read [`AGENTS.md`](./AGENTS.md).

Bootstrap only for now — implementation follows the planning decisions.
