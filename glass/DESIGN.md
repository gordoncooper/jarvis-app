# Cockpit — visual contract (D-0031)

jarvis.lan is four **slideable displays**: Login → Earth Stage → AM Briefing
(CMD) → Topology NOC. Arrow keys / drag; Cmd header BRIEF|ASK|APPLY jumps.

- Canvas `#050607`. Accent `#00e5c8`. Steel `#8b9aaa`. Ink `#e8eef4`.
- IBM Plex Sans + Mono (fontsource, LAN).
- Login uses the literal splash JPG + stub Enter (no auth yet).
- Stage: night-Earth backdrop + thin HUD chrome + real cmd/PTT.
- Cmd: dossier / briefing / channel — channel is real turns; timeline prototype.
- Noc: topology / rings / ticker / metrics table — structure exact, metrics
  prototype until a real feed lands. No noc.lan scrape (D-0012).
- Real: `/health`, session, SSE turns, PTT, TTS, confirm.
- Out: Vite, Tailwind, Recharts, godseye WebGL as product default.

Swap look: `glass/themes/<name>/` + `JARVIS_THEME`. Product pack is `cockpit`.
`godseye`, `mark-hud`, `archive-gold` remain rebuildable.
