# jarvis-app — product (orchestrator, glass, themes)

This repo is the **third-attempt product** (D-0020): Python orchestrator,
TypeScript→static glass, and swappable themes. It is not metal, not Flux YAML,
and not prior art.

The contract is jarvis-infra
[AGENTS.md](https://github.com/gordoncooper/jarvis-infra/blob/main/AGENTS.md),
then [docs/DECISIONS.md](https://github.com/gordoncooper/jarvis-infra/blob/main/docs/DECISIONS.md).
A dated decision outranks any prose here or there.

## Rank of authority (same as law)

1. The live cluster
2. `jarvis-infra` `docs/DECISIONS.md`
3. Gitea `cluster` (what Flux reconciles)
4. `jarvis-infra` `VERSION` for infra pins; product image pins live with this repo
5. `jarvis-infra` `docs/LESSONS.md`
6. Prose in any docs tree — stale until the cluster agrees

## Rules specific to this repo

- Edit and `git push` from bastion `~/jarvis-app` to **GitHub** `jarvis-app`
- Flux never watches this repo. Deploy via YAML in `~/cluster` → Gitea
- Two runtime Deployments: **jarvis-glass** and **jarvis-orchestrator** in
  namespace `apps` (D-0021). Themes are look-and-feel only; the orchestrator
  stays theme-agnostic (D-0020)
- Source `VERSION` in this repo for product image pins; never retag. Next build
  cut is **v0.6.0** (D-0021)
- Glass talks only to the orchestrator — no direct product wiring to LiteLLM,
  Open WebUI, or OpenClaw (D-0012)
- No Vite / App Builder greenfield. TS compiles to static assets (D-0020)
- Do not extend `jarvis-core` (D-0003). Do not put Flux manifests in this repo
- Factory apps JARVIS builds later get their **own** repos; do not dump them here
  unless deliberately promoted to product (D-0020)
- `.claude/settings.json` is deny-rules for Claude Code and Grok CLI (D-0007),
  not a second bible. Keep it committed
- Do not commit `learned.md`. Never dump Secret `.data`, SOPS ciphertext, or keys

## Hands

Bastion as user `agent` only. No kubectl from a laptop. One coherent change per
session.
