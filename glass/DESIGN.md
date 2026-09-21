# Cockpit — visual contract (D-0031 / D-0032)

jarvis.lan is the product four-display deck. Not a centered chat column.
Not noc.lan. Not home.lan. Not chat.lan.

Locked tokens and rooms come from `docs/COCKPIT-PLAN.md`. Builder steps:
`docs/COCKPIT.md`.

## Tokens (locked)

```css
:root {
  --bg: #05070a;
  --panel: #0b1014;
  --panel-2: #10151b;
  --line: #1c252e;
  --steel: #8b9aaa;
  --ink: #e7eef4;
  --accent: #5eead4;
  --warn: #e8b86d;
  --bad: #e06c75;
  --radius: 10px;
  --radius-lg: 18px;
}
```

IBM Plex Sans for chrome, IBM Plex Mono for numbers and cmd. Accent on ≤15%
of pixels. Same hex, LIVE pip, and 1px `#1c252e` hairline on Earth / CMD / NOC.

## Four displays

Slide order left→right. Arrow keys / drag. No center-chat on Earth.

| # | Room | Rendering |
| --- | --- | --- |
| 0 | Login | Full-bleed rack-room still + HTML/SVG wordmark + inverted triangle Enter. **No** username/password. |
| 1 | Earth | R3F night globe (+ drei / postprocessing) + rim HUD + CmdBar + 2-line reply toast. |
| 2 | CMD | Dossier / structured briefing / Channel. ConfirmCard in Channel. Four bottom pills. |
| 3 | NOC | SVG 2×3 ortho rack + rings / sparklines / ticker / table. Pulse-fed. |

## Wiring (D-0012 / D-0032)

- Glass talks **only** to the orchestrator.
- Real: `/health`, `/v1/session` (structured briefing preferred;
  `briefing_blurb` fallback), `/v1/turns` SSE, STT/TTS, confirm, **`/v1/pulse`**
  (poll ~2s) for Earth chips + NOC.
- Do **not** scrape noc.lan, home.lan, Prometheus, or Grafana from glass.
- Confirm UI: ConfirmCard on CMD Channel; Earth uses toast for replies (confirm
  lives in Channel / APPLY). Hands/memory confirms stay orchestrator-owned.

## Pack / build

- Product pack: `cockpit` (`JARVIS_THEME=cockpit`).
- `cockpit` is the only theme. `godseye` / `mark-hud` / `archive-gold` were
  deleted in v0.6.44 (CSS packs with no entry point). See docs/THEMES.md.
- Production: esbuild → static nginx. Vite only if the operator asks for bastion HMR.
- Allowed: React, three / R3F / drei / postprocessing (Earth only), motion, SVG,
  uPlot or canvas. Out: shadcn, Tailwind-as-theme, Recharts, React Flow, chat.lan
  theming, App Builder scaffolds, second bible files.

## Hosts

| Host | Role this workstream |
| --- | --- |
| **jarvis.lan** | Build the four-display product here. |
| home.lan | Older command board — leave alone until retired. |
| chat.lan | Break-glass OWUI — do not theme. |
| noc.lan | Independent break-glass telemetry — do not merge into the glass bundle. |
