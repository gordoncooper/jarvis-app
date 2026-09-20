# Cockpit — visual contract (D-0031 / D-0032)

jarvis.lan is the product four-display deck. Not a centered chat column.
Not noc.lan. Not home.lan. Not chat.lan.

## Tokens (locked)

| Token | Value |
| --- | --- |
| Canvas | `#05070a` |
| Accent | `#5eead4` |
| Steel | `#8b9aaa` |
| Ink | `#e7eef4` |
| Hair | `#1c252e` |
| Panels | `#0c1014` / `#10151b` |

IBM Plex Sans + Mono (fontsource / LAN fonts). Radius 2–4px. Motion 160ms
ease-out. Accent only on LIVE / selected / meters / primary actions.

## Four displays

Slide order left→right. Arrow keys / drag. No center-chat layout.

| # | Room | Rendering |
| --- | --- | --- |
| 0 | Login | Full-bleed still (splash JPG) + stub Enter. No auth yet. |
| 1 | Earth | WebGL / R3F globe + thin HUD chrome + cmd/PTT + confirm toast. |
| 2 | CMD | Dossier / structured briefing / Channel. ConfirmCard lives here. |
| 3 | NOC | SVG topology + rings / sparklines (uPlot or canvas). Operator NOC *display* on jarvis.lan. |

## Wiring (D-0012 / D-0032)

- Glass talks **only** to the orchestrator.
- Real: `/health`, `/v1/session` (structured briefing preferred;
  `briefing_blurb` fallback), SSE turns, PTT, TTS, confirm, **`/v1/pulse`**
  for Earth chips + NOC.
- Do **not** scrape noc.lan, home.lan, Prometheus, or Grafana from glass.
- Confirm UI ships: ConfirmCard on CMD Channel; toast on Earth. Hands/memory
  confirms stay orchestrator-owned.

## Pack / build

- Product pack: `cockpit` (`JARVIS_THEME=cockpit`).
- Archived (rebuildable, not served): `godseye`, `mark-hud`, `archive-gold`.
- Production: esbuild → static nginx.
- Bastion-only: Vite as glass dev server is allowed.
- Allowed libs: React, three.js / R3F (Earth only), motion, SVG, uPlot/canvas.
- Out: Tailwind marketing layouts, Recharts-as-product, theming chat.lan,
  App Builder factory scaffolds, a second bible (`CLAUDE.md` / extra cursor rules).

## Hosts

| Host | Role this workstream |
| --- | --- |
| **jarvis.lan** | Build the four-display product here. |
| home.lan | Older command board — leave alone until retired. |
| chat.lan | Break-glass OWUI — do not theme. |
| noc.lan | Independent break-glass telemetry — do not merge into the glass bundle. |

Builder brief: [`docs/COCKPIT.md`](../docs/COCKPIT.md). Plan:
[`docs/COCKPIT-PLAN.md`](../docs/COCKPIT-PLAN.md). Law: jarvis-infra
`AGENTS.md` + `docs/DECISIONS.md` (D-0032).
