# BUILD BRIEF — JARVIS four-display cockpit

Spec for the builder session. **Not law.** Law is `AGENTS.md` here and
jarvis-infra `docs/DECISIONS.md` (D-0031 / D-0032). Visual contract:
`glass/DESIGN.md`. Architecture detail: `docs/COCKPIT-PLAN.md`.

Drop this entire file into Cursor, Claude Code, Grok Build, or any coding agent.
Build exactly this. Do not invent a fifth product. Do not theme chat.lan.

You are implementing the product surface at **jarvis.lan** in repo **gordoncooper/jarvis-app**.
Law lives in **gordoncooper/jarvis-infra** `docs/DECISIONS.md` and `AGENTS.md`.
Flux YAML lives in **gordoncooper/jarvis-cluster** (Gitea is origin; GitHub is a mirror).

Reference frames (match these, do not “improve” them into SaaS):

- Login: Fort Knox rack room plate + JARVIS badge as a lift-open lid
- Earth: night globe, HUD on the rim, cmd bar, no chat modal on the planet
- CMD: dossier | AM briefing | channel drawer + four bottom pills
- NOC: 2×3 ortho rack, rings, ticker, node table, cmd

Read `docs/COCKPIT-PLAN.md` if present. If both exist, the plan wins on architecture; this brief wins on “what to type.”

---

## 0. Identity

- Product repo: `~/jarvis-app` → GitHub `gordoncooper/jarvis-app`
- Code: `glass/` (UI) + `orchestrator/` (FastAPI)
- Theme pack name: `cockpit` (D-0031 / D-0032)
- Operator user on bastion: `agent` (never `bastion`)
- Glass talks **only** to orchestrator: `/health`, `/v1/session`, `/v1/turns`, `/v1/stt`, `/v1/tts`, and new `/v1/pulse`
- Do not call LiteLLM, Open WebUI, OpenClaw, Prometheus, Piper, or Grafana from the browser

---

## 1. Stack you will use

- React 18 + TypeScript
- Bundler: existing `glass/esbuild.mjs` unless the operator explicitly says Vite
- `motion` for deck + login
- `three` + `@react-three/fiber` + `@react-three/drei` + `@react-three/postprocessing` for Earth only
- SVG for NOC topology
- uPlot or a tiny canvas for NOC sparklines
- IBM Plex Sans + IBM Plex Mono from `@fontsource/*` (already in package.json)
- Existing client: `glass/src/api.ts` (`fetchHealth`, `fetchSession`, `streamTurn`, `streamAudioTurn`, `fetchTtsObjectUrl`)

Do not add shadcn, Tailwind-as-theme, Next.js, React Flow, Recharts, Stream Chat, or a second bible (`CLAUDE.md`, extra `.cursor/rules` that restates AGENTS.md).

---

## 2. Tokens (exact)

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

Type: IBM Plex Sans for chrome, IBM Plex Mono for numbers and cmd. Accent on ≤15% of pixels.

---

## 3. File map to create / replace

Implement under `glass/themes/cockpit/` (the tree moved in v0.6.44; data and
behaviour now come from `glass/src/core/` via `useJarvis()` — see docs/THEMES.md):

```
glass/themes/cockpit/
  main.tsx
  App.tsx                 deck index 0=login 1=earth 2=cmd 3=noc
  Shell.tsx
  deck/Deck.tsx           snap translateX, arrow keys, swipe
  chrome/Brand.tsx
  chrome/CmdBar.tsx
  chrome/LivePip.tsx
  chrome/ConfirmCard.tsx
  displays/Login.tsx
  displays/Earth.tsx
  displays/Cmd.tsx
  displays/Noc.tsx
  state/session.ts
  state/health.ts
  state/pulse.ts
  state/deck.ts
  viz/EarthGlobe.tsx
  viz/TopologySvg.tsx
  viz/Spark.tsx
  viz/Waveform.tsx
  viz/Rings.tsx
  tokens.css
```

Wire `esbuild.mjs` / theme `cockpit` so this pack is what nginx serves.

---

## 4. Display contracts

### Login (index 0)

- Full-bleed still of the empty server-room wall,
  `themes/cockpit/static/login-plate.jpg`. The wall carries no lettering.
- The JARVIS badge is a separate transparent PNG,
  `themes/cockpit/static/login-badge.png` (wordmark + subline + triangle),
  composited centre-wall so it stays sharp at 4K. It replaced a plate with the
  wordmark baked in, which was soft at scale.
- **Revised 2026-09-20 (operator request), superseding "no form fields":** the
  badge is a lid. Click it, or press Enter, and it lifts and shrinks to reveal
  a login prompt underneath; Authorise (or Enter in the field) sets `deck = 1`.
- The prompt is a presence gate, not authentication. The operator name is fixed
  and the passphrase field is labelled `NOT YET ENFORCED` with the note "no
  credential is checked", because the orchestrator has no auth and the UI must
  not imply otherwise. Real auth later: LAN allowlist + PIN.
- Still no model picker.
- Focus lands in the field only after the lift finishes. Focusing immediately
  let the same Enter that opened the lid produce a keypress on the new input,
  implicitly submitting the form and skipping the prompt.

### Earth (index 1)

- Full-viewport R3F night Earth. Drag to spin. Atmosphere limb. City lights.
- DOM HUD pinned to edges:
  - Top-left: hex + JARVIS + LIVE
  - Top-center: LAN, k3s, UTC from `/v1/pulse`
  - Top-right: four ring pips TALKER HANDS STT TTS from `/health`
  - Left: dossier TRACK / MODE / HOS / LOCK
  - Bottom chips: CLUSTER LIVE, UPTIME, GPU-01 °C, GPU-02 °C
  - Bottom: CmdBar `cmd  Speak freely…` + Send + Hold to talk
- **Forbidden:** centered chat modal, greeting card over the globe, purple, glassmorphism.

Turns: `streamTurn` / `streamAudioTurn`. Streamed reply → TTS via `fetchTtsObjectUrl` + a two-line toast above CmdBar. Persist messages in session state for the CMD display.

### CMD (index 2)

Layout:

- Header: Brand + local clock + weather stub + date + `BRIEF | ASK | APPLY`
- Left ~280px: Dossier + Today icon rows
- Center: AM BRIEFING sections Overnight / Lab / Agenda from structured session briefing
- Right ~360px: Channel thread (session.messages + live tokens) + cmd input
- Bottom pills: Inbox, Calendar, Voice, Apply queue

BRIEF focuses this display and refetches session.
ASK focuses the Channel input.
APPLY: if `confirm` pending, scroll it into view; else send a turn that is a Hands verb (operator types it).

ConfirmCard renders inside Channel when `session.confirm` is set. Yes/cancel are themselves turns (`"yes"` / `"cancel"`).

### NOC (index 3)

- Left rail: filters CTRL GPU DATA APPS + dossier track/mode
- Center: SVG 2×3 tiles labeled ctrl-01, gpu-01, gpu-02, data-01, data-02, apps-01 with teal traces
- Right: four ring meters (cpu/mem/net/io), voice waveform, GPU temp sparks, env bars
- Full-width event ticker
- Node metrics table: NODE ROLE IP CPU RAM DISK LOAD
- Bottom CmdBar (same component as Earth)

All numbers from `/v1/pulse` polled every 2s. If pulse is missing, show steel placeholders — do **not** invent cluster numbers in the client.

Header APPLY / PULSE / STATUS send turns (`"status cluster"`, `"pulse"`, or the pending apply). They are not empty dropdowns.

---

## 5. Orchestrator changes (same repo, `orchestrator/app`)

Add `GET /v1/pulse` returning JSON:

```json
{
  "lan": "192.168.8.0/24",
  "k3s": "7/7",
  "utc": "ISO-8601",
  "uptime": "15d 06h 42m 18s",
  "nodes": [
    {
      "id": "gpu-01",
      "role": "gpu-node",
      "ip": "10.8.0.11",
      "cpu": 67,
      "ram": 71,
      "disk": 64,
      "load": 4.8,
      "temp_c": 61
    }
  ],
  "rings": { "cpu": 42, "mem": 56, "net": 18, "io": 27 },
  "env": { "air_c": 22.1, "hum": 41, "pwr": 98 },
  "events": [{ "ts": "ISO", "src": "ctrl-01", "msg": "NodeReady" }],
  "talker": true,
  "hands": true,
  "stt": true,
  "tts": true
}
```

Fill pulse from Hands / existing health helpers. If a field is unknown, omit it or null — never fabricate.

Extend `/v1/session` briefing to structured fields when you can do it without breaking old glass:

```json
"briefing": {
  "overnight": "…",
  "lab": "…",
  "agenda": [{ "t": "09:00", "label": "Lab sync" }],
  "today": [{ "t": "06:58", "kind": "inbound", "label": "3 unread" }],
  "focus": "…"
}
```

Keep `briefing_blurb` as a fallback string for one release.

Do not teach glass to scrape noc.lan or home.lan.

---

## 6. Motion and input

- Deck: `translateX(-index * 100%)`, 280–400ms ease. ArrowLeft / ArrowRight. Optional hash `#login|#earth|#cmd|#noc`.
- Login badge: slow glow while sealed; spring lift + scale on open, with the
  prompt revealed by a clip-path wipe. Both respect `prefers-reduced-motion`.
- Earth HUD: fade in 200ms after globe first frame.
- PTT: pointer-down start MediaRecorder, pointer-up `streamAudioTurn`.
- No page reloads.

---

## 7. What you will not do

- Do not put a chat transcript on the globe.
- Do not use noc.lan or home.lan as the product UI.
- Do not theme chat.lan / grafana.lan / agent.lan.
- Do not `kubectl apply` product YAML; Flux owns cluster (edit `~/cluster` on the bastion, push Gitea).
- Do not dump secrets, SOPS, or `learned.md`.
- Do not extend `jarvis-core` (D-0003).
- Do not invent GPU numbers in React.
- Do not add a model picker.

---

## 8. Build order (one PR-sized slice per step)

1. tokens.css + Brand + Deck with four empty stages at the right type
2. Login plate + Enter → Earth
3. Earth globe + HUD + CmdBar wired to existing `api.ts`
4. CMD columns + Channel using session.messages + SSE
5. ConfirmCard
6. Orchestrator `/v1/pulse` + structured briefing
7. NOC SVG + table + ticker + rings bound to pulse
8. Pixel pass vs the four JPGs at 1920×1080

Stop after each slice and show the operator. Do not binge all eight in one unattended loop unless asked.

---

## 9. Acceptance

At 1920×1080, a screenshot of each stage is recognizably the matching reference JPG: same hierarchy, same teal, same plex, same density. Earth has no center modal. Login opens from the badge into the mocked presence gate (revised 2026-09-20). NOC is a schematic, not a globe. CMD is a briefing desk, not a rack.
