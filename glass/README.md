# jarvis-glass — themed static HUD (D-0020 / D-0030)

TypeScript compiles to static assets. **No Vite.** Look-and-feel is a pack under
`themes/<name>/`. Product shell is React + R3F (`src/hud/`) for `godseye`.
`mark-hud` / `archive-gold` keep the frozen DOM shell in `src/main.ts`.

## Packs

| Pack | Notes |
| --- | --- |
| `godseye` | Product. Globe-as-stage (D-0030). |
| `mark-hud` | Archived 3-column cockpit. Rebuildable. |
| `archive-gold` | Previous sterile/gold column. Rebuildable. |

Each pack: required `theme.css`. Optional `static/` is copied to `dist/theme-static/`.
Visual contract: [`DESIGN.md`](DESIGN.md).

## Rebuild / swap

```bash
# local dist only
cd ~/jarvis-app/glass
JARVIS_THEME=godseye npm run build

# ship: pin pack + image tag, then import
# VERSION: JARVIS_THEME=godseye   IMAGE_GLASS_TAG=v0.6.xx
./scripts/install-images.sh
```

`godseye` styles overlay classes (`.hud-overlay`, `.hud-ribbon`, `.hud-channel`,
`.hud-console`, `.hud-arc`, `.pip`, `.confirm-row`). Legacy packs still target
the 3-column classes in `src/main.ts`. Pin `JARVIS_THEME`, bump the glass image
tag, install, Flux recreate glass.

Override without editing VERSION: `JARVIS_THEME=mark-hud npm run build`.
LAN still follows VERSION when `install-images.sh` runs.
