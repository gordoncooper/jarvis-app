# Cockpit plan — four-display jarvis.lan

Product layout and wiring plan for pack `cockpit` (D-0031 / D-0032). Spec, not
law. Tokens and host rules: `glass/DESIGN.md`. Builder contract: `docs/COCKPIT.md`.

## Displays

| Index | Room | Role |
| --- | --- | --- |
| 0 | Login | Full-bleed splash still + stub Enter → advances to Earth. No auth. |
| 1 | Earth | WebGL / R3F night-Earth stage + HUD chrome + cmd/PTT + confirm toast. |
| 2 | CMD | AM Briefing / Dossier / Channel. Structured briefing. ConfirmCard. |
| 3 | NOC | SVG rack topology + rings / sparklines / ticker. Pulse-fed. |

Slide left→right. Keyboard ←/→ and horizontal drag. CMD header nav
(BRIEF / ASK / APPLY) may jump to CMD / Earth / NOC.

```
glass/src/cockpit/
  main.tsx
  App.tsx              # session / health / pulse / turn state + slide index
  Shell.tsx            # 4-panel track
  displays/
    Login.tsx
    Stage.tsx          # Earth
    Cmd.tsx
    Noc.tsx            # SVG topology
  chrome/              # shared marks, LiveDot, CmdBar, ConfirmCard, clocks
themes/cockpit/
  theme.css
  static/              # login still + any pack assets
```

## Tokens

- Canvas `#05070a`
- Accent `#5eead4`
- Steel `#8b9aaa`
- Ink `#e7eef4`
- Hair `#1c252e`
- Panels `#0c1014` / `#10151b`
- IBM Plex Sans + Mono; radius 2–4px; motion ~160ms ease-out

## Per-room notes

### Login
Still image only. Stub username/password + Enter. No secrets stored. Cyan/teal
accents matching the splash.

### Earth
WebGL globe (R3F). Thin HUD: LIVE, LAN, k3s summary, service dots from
`/health`, dossier chip, bottom chips from `/v1/pulse`, full-width cmd + PTT.
Reply as a thin floating line. Confirm as toast when pending.

### CMD
Three columns: Dossier · AM Briefing (structured fields; blurb fallback) ·
Channel (real turns + ConfirmCard + cmd/PTT). Top nav BRIEF|ASK|APPLY.
Bottom action pills may stay structural until feeds exist.

### NOC
SVG (not a Cesium/WebGL globe port). Topology cards, filters (local UI state),
rings, sparklines (uPlot or canvas), event ticker, metrics table — numbers from
`/v1/pulse`. Shared footer cmd with Earth/CMD.

## Real vs orchestrated

| Source | Used on |
| --- | --- |
| `/health` | Earth status, CMD VOICE, NOC when relevant |
| `/v1/session` | Greeting, briefing, messages, confirm |
| Turns / PTT / TTS / confirm | Shared message list across Earth / CMD / NOC |
| `/v1/pulse` | Earth chips + NOC topology / temps / uptime |

No noc.lan / home.lan / Prometheus scrape from glass (D-0012).

## Build / pack

- Production: esbuild → static nginx. Pack entry `cockpit → src/cockpit/main.tsx`.
- Bastion: Vite glass dev server allowed (D-0032).
- Pin `JARVIS_THEME=cockpit`. Archived packs stay rebuildable.
- Deploy: jarvis-app images; Flux YAML under `cluster/clusters/jarvis/apps/`
  (D-0021). Do not extend jarvis-core.

## Out of product chrome

Real auth project, theming chat.lan, merging noc.lan into the glass bundle,
reopening `godseye` / `mark-hud` as default, App Builder factory scaffolds,
second-bible rule files.
