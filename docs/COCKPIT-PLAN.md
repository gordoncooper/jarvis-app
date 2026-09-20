# JARVIS cockpit — product plan

Date: 2026-09-20
Repos: jarvis-app (product), jarvis-infra (law), jarvis-cluster (Flux YAML, Gitea origin)
Surface: jarvis.lan — four slideable displays
Authority this plan fulfills: D-0020, D-0012, D-0030, D-0031, D-0032

Spec, not law. Builder “what to type”: `docs/COCKPIT.md`. Visual contract:
`glass/DESIGN.md`.

This is the locked visual + architecture plan for the four frames:

- `jarvis-login.jpg` — Fort Knox gate
- `jarvis.jpg` — Earth stage after login
- `jarvis-cmd.jpg` — AM briefing + channel
- `jarvis-noc.jpg` — cluster topology NOC

---

## Thesis

One TypeScript React app. Four stages. One token file. One chrome language. The orchestrator is the only brain.

```
glass  ──nginx /v1──►  orchestrator
                         /health
                         /v1/session     greeting, briefing, messages, confirm
                         /v1/turns SSE   talk + verbs + memory confirm
                         /v1/stt /v1/tts
                         (add) /v1/pulse  rack snapshot for NOC + Earth chips
```

Glass never talks to LiteLLM, OpenClaw, Prometheus, or Piper. If NOC needs numbers, orchestrator grows `/v1/pulse`. That keeps D-0012 and still matches `jarvis-noc.jpg`.

---

## Stack

| Layer | Choice | Why this picture |
|---|---|---|
| App | React 18 + TypeScript | Four stages, one session store, confirm modal |
| Bundle | esbuild already in `glass/` (Vite only if you explicitly want bastion HMR) | Fast LAN static image behind nginx |
| Motion | `motion` | Login wordmark, stage HUD fade, deck slide |
| Earth | three + R3F + drei + postprocessing | Photoreal night Earth, not a CSS sphere |
| Topology | SVG | `jarvis-noc.jpg` is an ortho schematic |
| Sparklines | uPlot or a small canvas | NOC GPU traces |
| Fonts | IBM Plex Sans + Mono, self-hosted | Earth / CMD / NOC |
| Login plate | Rack-room still as full-bleed `<img>` + HTML/SVG wordmark | The plate *is* the look |

Use Three on Earth. Use SVG on NOC. Use a photograph on Login. Mixing those is how four different rooms still feel like one house.

---

## Design tokens (locked to the uploaded frames)

```css
--bg:        #05070a;
--panel:     #0b1014;
--panel-2:   #10151b;
--line:      #1c252e;
--steel:     #8b9aaa;
--ink:       #e7eef4;
--accent:    #5eead4;
--warn:      #e8b86d;
--bad:       #e06c75;
--radius:    10px;
--radius-lg: 18px;
--type-ui:   "IBM Plex Sans";
--type-data: "IBM Plex Mono";
```

Unify:

- Same hex mark, same LIVE pip, same IBM Plex, same accent, same 1px `#1c252e` hairline on Earth / CMD / NOC.
- Login is cinematic (no pip, no tables). The other three share chrome.
- Teal on ≤15% of pixels. Body copy is steel. Numbers are mono.
- Cmd strip is the same component on Earth and NOC. CMD display uses the Channel input with the same glyphs (`>_` + paper plane).

---

## The four rooms

### 1. Login — Fort Knox

Stage, not a form.

- Full-viewport plate: the rack-room still.
- Center: extruded “JARVIS” as SVG/HTML with a teal inner glow (keep letters out of the JPG for 4K sharpness).
- Subline: `HOME-LAB AI CLUSTER COMMAND CENTER`
- Inverted triangle = Enter. Click / Enter / say “open” → `GET`/`POST` session and slide to Earth.
- No username field. Presence gate. Real auth later: LAN allowlist + optional PIN to orchestrator.

Motion: 800ms ease, wordmark fades up, triangle pulses once, deck translates.

### 2. Earth — first breath

Talk happens here. Chat does **not** cover the planet.

```
[ JARVIS • LIVE ]     LAN   k3s   UTC          TALKER  HANDS  STT  TTS
[ DOSSIER          ]
[ TRACK/MODE/HOS   ]
[ LOCK             ]

                    << night Earth, drag, city lights >>

[ CLUSTER LIVE ] [ UPTIME ]              [ GPU-01 ] [ GPU-02 ]
[ cmd  Speak freely…                              Hold to talk | Send ]
```

- Globe: R3F Sphere + night-lights + atmosphere limb shader.
- HUD is DOM, pointer-events none except dossier / cmd / pips.
- Dossier from `/v1/session` + `/v1/pulse`.
- Pips map `/health`: llm→TALKER, hands→HANDS, stt→STT, tts→TTS.
- Cmd: text → `streamTurn`. PTT → `streamAudioTurn`. Reply is TTS + a 2-line toast at the cmd bar, not a modal on the globe.
- Long thread lives on the CMD display.

### 3. CMD — daily ops

Three columns + a pill dock. Channel is allowed to be a column here.

| Left ~280 | Center flex | Right ~360 |
|---|---|---|
| Dossier + Today list (icon rows) | AM Briefing (Overnight / Lab / Agenda) | Channel · operator convo |

Bottom pills: Inbox · Calendar · Voice · Apply queue.

| UI | Orchestrator |
|---|---|
| Channel thread | `session.messages` + SSE tokens |
| Confirm card in Channel | `session.confirm` / SSE `done.confirm` |
| AM Briefing body | structured briefing on session (not one blob) |
| Today rows | same briefing object |
| BRIEF / ASK / APPLY | ASK = focus Channel. BRIEF = refresh session. APPLY = verb through `/v1/turns` |
| Voice pill | PTT, waveform from analyser |
| Apply queue | pending confirm count |

Cap briefing at ~8 lines. Orchestrator owns the text.

### 4. NOC — rack truth

- Left filter rail (CTRL / GPU / DATA / APPS)
- Center: 2×3 ortho tiles `ctrl-01 gpu-01 gpu-02 / data-01 data-02 apps-01` + teal traces
- Right: four ring meters, voice waveform, GPU sparklines, env bars
- Event ticker (one row)
- Node metrics table
- `> cmd` at the bottom — same CmdBar as Earth

`GET /v1/pulse` shape:

```json
{
  "lan": "192.168.8.0/24",
  "k3s": "7/7",
  "utc": "...",
  "nodes": [
    {"id":"gpu-01","role":"gpu-node","ip":"10.8.0.11","cpu":67,"ram":71,"disk":64,"load":4.8,"temp_c":61}
  ],
  "rings": {"cpu":42,"mem":56,"net":18,"io":27},
  "env": {"air_c":22.1,"hum":41,"pwr":98},
  "events": [{"ts":"...","src":"ctrl-01","msg":"NodeReady"}],
  "talker": true, "hands": true, "stt": true, "tts": true
}
```

Orchestrator fills this from Hands / Prometheus internally. Glass polls ~2s.

Break-glass header verbs APPLY / PULSE / STATUS send turns, they are not decoration. Recycle stays confirm-gated (D-0023).

Topology = SVG. Tiles select a node and filter the ticker. No 3D rack.

---

## App shape

```
glass/src/cockpit/
  App.tsx
  Shell.tsx
  deck/Deck.tsx              horizontal snap, ← →, swipe, BRIEF|ASK|APPLY
  chrome/
    Brand.tsx
    CmdBar.tsx
    LivePip.tsx
    ConfirmCard.tsx
  displays/
    Login.tsx
    Earth.tsx
    Cmd.tsx
    Noc.tsx
  state/
    session.ts
    health.ts
    pulse.ts
    deck.ts
  viz/
    EarthGlobe.tsx
    TopologySvg.tsx
    Spark.tsx
    Waveform.tsx
    Rings.tsx
```

Deck is the router. Hash optional (`#earth`).

---

## Interaction map

| Input | Where | Effect |
|---|---|---|
| Enter / triangle | Login | session + deck→Earth |
| Type + Send / PTT | Earth, CMD, NOC | `/v1/turns` SSE |
| Hold to talk | Earth cmd | `streamAudioTurn` |
| Arrow keys / drag | any | adjacent display |
| BRIEF | header | deck→CMD, refetch session |
| ASK | header | deck→CMD, focus Channel |
| APPLY | header | pending confirm or prompt verb |
| Node tile | NOC | select + filter ticker |
| yes / cancel | ConfirmCard | next turn |

---

## Orchestrator work

1. `GET /v1/pulse` — node table, rings, env, events, k3s fraction, GPU temps.
2. Structured briefing on `/v1/session`:
   `{ overnight, lab, agenda[], today[], focus }`
3. Optional SSE `event: pulse` later. Poll is enough for v0.6.

---

## Build sequence

1. Tokens + Brand + Deck chrome (empty stages, correct type).
2. Login plate + Enter.
3. Earth globe + HUD chrome + CmdBar wired to turns / PTT / TTS.
4. CMD layout with real Channel + structured briefing.
5. NOC SVG + table + ticker against `/v1/pulse`.
6. ConfirmCard + APPLY path.
7. Pixel pass against the four JPGs at 1920×1080.

---

## Done when

- Login: same room, same wordmark weight, same subline, triangle is the only control.
- Earth: globe is the hero; instruments on the rim; cmd is a hairline; no center chat.
- CMD: three columns + four pills; Channel is a dock; briefing is the stage.
- NOC: 2×3 ortho rack, rings, ticker, table, cmd.
- Same hex, same teal, same plex, same pip. Four rooms, one house, one `/v1`.
