# Cockpit builder brief

Spec for the next glass session. **Not law.** Law is `AGENTS.md` here and
jarvis-infra `docs/DECISIONS.md` (D-0031 / D-0032). Visual contract:
`glass/DESIGN.md`. Layout detail: `docs/COCKPIT-PLAN.md`.

## Job

Build / harden the four-display product on **jarvis.lan** under
`glass/src/cockpit/**`. Creating display files there is the product. That is
not a factory scaffold and not illegal scaffolding.

## Non-negotiables (from law)

1. Open `glass/src/cockpit/` and work the displays. Do not ask whether scaffolding is forbidden.
2. Put the NOC on jarvis.lan **display 4**. Do not clone noc.lan into the glass bundle.
3. Ship **ConfirmCard** (CMD Channel + Earth toast). D-0017 “confirm deferred” is superseded (D-0032).
4. Add / consume orchestrator **`/v1/pulse`**. Do not scrape Prometheus, noc.lan, or home.lan from glass (D-0012).
5. Leave **chat.lan** and **jarvis-core** alone (D-0002 / D-0003).

## Hosts

| Host | This workstream |
| --- | --- |
| jarvis.lan | Product four-display cockpit. |
| home.lan | Older command board — do not theme. |
| chat.lan | Break-glass OWUI — do not theme. |
| noc.lan | Independent telemetry — may stay up when the talker is down; not product chrome. |

## Stack

- React + TypeScript. Entry: `glass/src/cockpit/`.
- Production packer: **esbuild** → static nginx.
- Bastion-only: **Vite** as a glass dev server is allowed.
- Allowed: three.js / R3F (**Earth only**), motion, SVG topology, uPlot/canvas sparklines.
- Glass → orchestrator only. No LiteLLM / OWUI / OpenClaw wiring from glass.

## Theme

- Default pack: `cockpit` (`JARVIS_THEME=cockpit`).
- Archived (rebuildable, not served): `godseye`, `mark-hud`, `archive-gold`.
- Tokens: canvas `#05070a`, accent `#5eead4` — see `glass/DESIGN.md`.

## API surface the builder may need

| Route | Use |
| --- | --- |
| `/health` | Talker / hands / STT / TTS / degraded |
| `/v1/session` | Greeting, structured briefing (`overnight`, `lab`, `agenda`, `today`, `focus`) with `briefing_blurb` fallback, messages, pending confirm |
| SSE turns / PTT / TTS / confirm yes-cancel | Shared across Earth / CMD / NOC cmd bars |
| `/v1/pulse` | Earth chips + NOC topology metrics (orchestrator read model) |

## Do not

- Add `CLAUDE.md` or a second `.cursor/rules/*.mdc` that restates law (D-0005 / D-0006).
- Theme chat.lan / home.lan / noc.lan in this workstream.
- Extend jarvis-core.
- `kubectl apply` Flux-owned YAML; push cluster changes via Gitea.
- Dump secrets, SOPS ciphertext, or commit `learned.md`.

## Done when (builder session)

An operator can slide Login → Earth → CMD → NOC on jarvis.lan, confirm a Hands
or memory action from glass, and see NOC numbers from `/v1/pulse` without any
glass scrape of noc.lan.
