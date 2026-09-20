# jarvis-glass — themed static HUD (D-0020 / D-0029)

TypeScript compiles to static assets. **No Vite.** Look-and-feel is a pack under
`themes/<name>/`. The shell in `src/main.ts` is theme-agnostic.

## Packs

| Pack | Notes |
| --- | --- |
| `mark-hud` | Product cockpit (ships). Tokens in D-0029. |
| `archive-gold` | Previous sterile/gold column. Rebuildable, not default. |

Each pack: required `theme.css`. Optional `static/` is copied to `dist/theme-static/`.

## Rebuild / swap

```bash
# local dist only
cd ~/jarvis-app/glass
JARVIS_THEME=mark-hud npm run build

# ship: pin pack + image tag, then import
# VERSION: JARVIS_THEME=mark-hud   IMAGE_GLASS_TAG=v0.6.xx
./scripts/install-images.sh
```

Add a look: new directory `themes/<name>/theme.css` that styles the cockpit
classes (`.hud-canvas`, `.hud-rail`, `.hud-stage`, `.hud-thread`, `.msg`,
`.hud-console`, `.hud-meter`, `.pip-live`, `.confirm-row`). Pin `JARVIS_THEME`,
bump the glass image tag, install, Flux recreate glass.

Override without editing VERSION: `JARVIS_THEME=archive-gold npm run build`.
LAN still follows VERSION when `install-images.sh` runs.
