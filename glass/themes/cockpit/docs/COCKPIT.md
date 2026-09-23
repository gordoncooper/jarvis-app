# BUILD BRIEF — JARVIS four-display cockpit

Spec for the builder session. **Not law.** Law is `AGENTS.md` here and
jarvis-infra `docs/DECISIONS.md` (D-0031 / D-0032). Visual contract:
`DESIGN.md`. Architecture detail: `COCKPIT-PLAN.md`.

Drop this entire file into Cursor, Claude Code, Grok Build, or any coding agent.
Build exactly this. Do not invent a fifth product. Do not theme chat.lan.

You are implementing the product surface at **jarvis.lan** in repo **gordoncooper/jarvis-app**.
Law lives in **gordoncooper/jarvis-infra** `docs/DECISIONS.md` and `AGENTS.md`.
Flux YAML lives in **gordoncooper/jarvis-cluster** (Gitea is origin; GitHub is a mirror).

The four rooms, and what each is for, are described in
[README.md](./README.md). Reference frames (match these, do not “improve”
them into SaaS):

- Login: Fort Knox rack room plate + JARVIS badge as a lift-open lid
- Breath: night Earth as backdrop, HUD on the rim, cmd bar, dialogue strip
- CMD: dossier | AM briefing | channel drawer + four bottom pills
- NOC: 2×3 ortho rack, rings, ticker, node table, cmd

Read `COCKPIT-PLAN.md` if present. If both exist, the plan wins on architecture; this brief wins on “what to type.”

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
- `three` + `@react-three/fiber` + `@react-three/drei` + `@react-three/postprocessing` for the Earth globe only
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
  App.tsx                 deck index 0=login 1=breath 2=cmd 3=noc
  Shell.tsx
  deck/Deck.tsx           snap translateX, arrow keys, swipe
  chrome/Brand.tsx
  chrome/CmdBar.tsx
  chrome/LivePip.tsx
  chrome/ConfirmCard.tsx
  displays/Login.tsx
  displays/Breath.tsx
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
  a login prompt underneath.
- The badge **toggles** — clicking it again lowers the lid and hides the
  prompt. Escape closes it too.
- **Only Authorise advances to Breath** (Enter inside the field is the same
  thing, being a form submit). The badge never navigates, and neither does a
  stray Enter with nothing focused. The badge's box is ~858x288 with large
  transparent gaps between the letterforms, so "clicking beside the mark" is
  usually still a badge click — when that used to advance the deck it read as
  "clicking anywhere takes me to Breath".
- The prompt is a presence gate, not authentication. The operator name is fixed
  and the passphrase field is labelled `NOT YET ENFORCED` with the note "no
  credential is checked", because the orchestrator has no auth and the UI must
  not imply otherwise. Real auth later: LAN allowlist + PIN.
- Still no model picker.
- Focus lands in the field only after the lift finishes. Focusing immediately
  let the same Enter that opened the lid produce a keypress on the new input,
  implicitly submitting the form and skipping the prompt.

### Breath (index 1)

The first portal you speak to: one operator, one JARVIS, a 1:1 living
exchange. The night Earth is the backdrop, not the subject — which is why the
instruments sit on the rim and the dialogue rises out of the command line.
Renamed from `earth` on 2026-09-21; `#earth` still resolves here.

- Full-viewport R3F night Earth (`ui/EarthGlobe.tsx`). Drag to spin.
  Atmosphere limb. City lights.
- **Revised 2026-09-23 (operator request), superseding the full-disk marble:**
  the Earth matches `docs/reference/breath.jpg`. The disk is large and low:
  the lit limb clears the header and the south runs off the bottom. The facing
  side opens on the US east coast. Day and city lights share a wide twilight.
  The sun is up and to the rear right, with a faint second glow on the rear left.
  The blue air is a thin limb, brighter at the top. The globe turns slowly.
  Drag still spins it.
- DOM HUD pinned to edges:
  - Top-left: hex + JARVIS + LIVE
  - Top-center: LAN, k3s, UTC from `/v1/pulse`
  - Top-right: four ring pips TALKER HANDS STT TTS from `/health`
  - Left: dossier TRACK / MODE / HOS / LOCK
  - Bottom chips: CLUSTER LIVE, UPTIME, GPU-01 °C, GPU-02 °C
  - Bottom: CmdBar `cmd  Speak freely…` + Send + Hold to talk
- **Forbidden:** centered chat modal, greeting card over the globe, purple, glassmorphism.
  The dialogue strip below is not a modal: it is bottom-aligned on the cmd bar,
  non-interactive, and dissolves into the globe at its top edge.

Turns: `streamTurn` / `streamAudioTurn`. Streamed reply → TTS via
`fetchTtsObjectUrl` + the dialogue strip above CmdBar. Persist messages in
session state for the CMD display.

**Revised 2026-09-20 (operator request), superseding "two-line toast":** the
strip was clamped to one line per speaker (`-webkit-line-clamp: 1`) and never
grew. It now grows upward from the cmd bar as the exchange continues, capped at
`min(52cqh, 46rem)` and the last 12 messages; older lines run out under a
`mask-image` fade at the top. It is bottom-aligned by `justify-content:
flex-end` and clips — overflow past a flex start edge is not reachable by
`scrollTop`, so there is no scroll handling and none is needed. The stack must
be `flex: 0 0 auto` or it compresses to fit instead of overflowing, and nothing
ever fades.

The strip and the CmdBar are one bottom-anchored flex column
(`.ck-stage-comms`), not two things positioned against the same edge with
hand-tuned offsets — at a short window the old offsets put the strip's bottom
*under* the cmd bar and clipped the newest line.

It scales with the stage rather than sitting at fixed rem: type is
`clamp(0.95rem, 0.59rem + 0.5cqi, 1.85rem)` (~14px at a 1272px stage, ~17px at
1920, ~23px at 3070) and the measure is `min(96ch, max(28ch, 100% - 560px))`.
The 560px reserves the CLUSTER/UPTIME and GPU chip clusters, which stay pinned
to the stage corners at a fixed ~285px / ~145px however wide the window is.

The full transcript still lives on the CMD display; the globe keeps only the
tail so returning to the stage does not bury the planet.

**Revised 2026-09-23 (operator request), superseding the 12-message cap and
the previous type size:** the strip keeps the last 6 messages, and its top is
the top of that tail, so a short exchange stays a short column. It stops
`12rem` short of filling the stage (`max-height: calc(100cqh - 12rem)`), which
keeps it under the header. Reply colour is ink mixed toward steel, and the
type is `clamp(0.9rem, 0.55rem + 0.38cqi, 1.42rem)` — about 12px at a 1272px
stage, 14px at 1920, 18px at 3070. Still bottom-anchored, still faded at the
top when the cap is hit, still not a transcript. The CMD channel is unchanged.

**Revised 2026-09-22 (operator request):** a JARVIS reply on the strip keeps
its line breaks and lays out as projected type over the globe. A bullet is a
row with a diamond, a count is a row with a two-digit index, and emphasis
takes the accent. The operator's line is the warm mark. Markdown sigils are
not shown. The strip stays bottom-anchored, capped, and faded at the top:
still not a scrolling transcript and not a modal. The CMD channel is unchanged.

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
- Bottom CmdBar (same component as Breath)

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

- Deck: `translateX(-index * 100%)`, 280–400ms ease. ArrowLeft / ArrowRight.
  Hash `#login|#breath|#cmd|#noc`; the retired `#earth` resolves to `#breath`
  and rewrites itself.
- Login badge: slow glow while sealed; spring lift + scale on open, with the
  prompt revealed by a clip-path wipe. Both respect `prefers-reduced-motion`.
- Breath HUD: fade in 200ms after globe first frame.
- PTT: pointer-down start MediaRecorder, pointer-up `streamAudioTurn`.
- **Streamed speech**, added 2026-09-21. TTS used to fire once on `done` with
  the whole reply, so the voice started only after the last token — measured
  at 20.8s to the first spoken word on a 1497-character answer (12.0s of text
  plus 8.8s of render). The engine now splits the reply into sentences as it
  streams, renders them a couple ahead, and plays them in order: **2.6s to the
  first word, with no gaps between clips.** Piper renders ~8x faster than real
  time, which is what lets the queue stay ahead of playback.
  Markdown is stripped before synthesis — Piper reads `**Bastion**` as
  "asterisk asterisk Bastion" — and list items get a terminator so they are
  not run together in one breath.
- **Interrupt / barge-in**, added 2026-09-21. JARVIS can be cut off mid-reply
  three ways: **Esc**, the **Stop** control that appears in the cmd bar while
  it is responding, and simply **starting to talk or type over it** — holding
  Space or submitting a turn interrupts first. The cmd input and the mic stay
  enabled while it is responding, which is what makes talking over it work;
  they used to be disabled by `busy`.
  Interrupting stops the TTS audio *and* aborts the SSE stream, and the
  partial reply is kept and marked with `⏹` rather than dropped — the
  orchestrator appends the same marker when the socket drops, so reloading the
  session shows the same truncated text. An interrupt before any token arrived
  removes the empty bubble instead of leaving a lone marker.
  Space is still ignored while focus is in a field, so mid-typing you want Esc
  or the Stop button.
- **Hold Space** is the keyboard twin of the mic button, added 2026-09-21.
  Bound in the theme (`ui/useHoldToTalk.ts`), not the engine — the engine owns
  what push-to-talk *does*, a theme owns what triggers it. Live in breath, cmd
  and noc; the login gate has no cmd bar and keeps its own keys.
  It must ignore Space when focus is in an input, textarea, button or
  contenteditable, swallow autorepeat (keydown fires ~30x/s while held, and
  each one would open another MediaRecorder), `preventDefault` so the page
  does not scroll, and release on window blur or tab hide — a key-up never
  arrives if focus leaves mid-hold, which would otherwise record until the
  operator came back. No latch: press-and-hold only.
- No page reloads.

---

## 7. What you will not do

- Do not put a scrolling chat transcript or a modal on the globe. The bounded,
  fading dialogue strip added 2026-09-20 is the sanctioned form.
- Do not use noc.lan or home.lan as the product UI.
- Do not theme chat.lan / grafana.lan / agent.lan.
- Do not `kubectl apply` product YAML; Flux owns cluster (edit `~/cluster` on the bastion, push Gitea).
- Do not dump secrets, SOPS, or `learned.md`.
- Do not invent GPU numbers in React.
- Do not add a model picker.

---

## 8. Build order (one PR-sized slice per step)

1. tokens.css + Brand + Deck with four empty stages at the right type
2. Login plate + Enter → Breath
3. Breath: Earth globe + HUD + CmdBar wired to existing `api.ts`
4. CMD columns + Channel using session.messages + SSE
5. ConfirmCard
6. Orchestrator `/v1/pulse` + structured briefing
7. NOC SVG + table + ticker + rings bound to pulse
8. Pixel pass vs the four JPGs at 1920×1080

Stop after each slice and show the operator. Do not binge all eight in one unattended loop unless asked.

---

## 9. Acceptance

At 1920×1080, a screenshot of each stage is recognizably the matching reference JPG: same hierarchy, same teal, same plex, same density. Breath has no center modal. Login opens from the badge into the mocked presence gate (revised 2026-09-20). NOC is a schematic, not a globe. CMD is a briefing desk, not a rack.
