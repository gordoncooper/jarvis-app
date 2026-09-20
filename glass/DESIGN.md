# God’s Eye — visual contract (D-0030)

jarvis.lan is a **stage**. The globe is the room. Chrome docks on the glass.
Empty channel reveals Earth.

- Canvas `#07090b`. Hair `#1c252e`. Steel `#8b9aaa`. Ink `#e7eef4`.
  Accent `#5eead4` only on LIVE / selected / scan. `--accent-dim` is an OKLCH mix.
- IBM Plex Sans + Mono, weights 400/500/600, bundled (no Google Fonts).
- Radius 2–4px. Motion 160–280ms ease-out.
- Widgets mean something: `/health` (llm, hands, stt, tts, memory_facts,
  degraded) plus turn / confirm / PTT. No fake telemetry. No noc.lan scrape.
- Globe: NASA-mapped Earth (day / night lights / specular / clouds / normals),
  fresnel atmosphere, graticule, system orbits, data arcs, scan, lock reticle.
  Frozen limb when HOLD. Confirm = LOCK. Streaming = SCAN. Track tape shows
  real LOOK/HDG from the camera. No CDN at runtime.
- Overlay: ribbon, dossier chip, floating channel slab, arc meters, ticker, CMD.
- Out: Vite, Tailwind, Recharts, Inter, indigo, glassmorphism, helmet visor,
  scanlines-over-everything, Sparkles.

Swap look: `glass/themes/<name>/` + `JARVIS_THEME`. `godseye` is product.
`mark-hud` is the archived 3-column. `archive-gold` stays rebuildable.
