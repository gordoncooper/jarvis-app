import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Brand } from "../chrome/Brand.js";
import { CmdBar } from "../chrome/CmdBar.js";
import { ConcRing, LiveDot } from "../chrome/Marks.js";
import { pulseText, type ChatMsg, type ConfirmPayload, type HealthPayload, type PulsePayload } from "@core";
import { pulseGpuChips } from "../rack.js";
import { EarthGlobe, earthWebglOk } from "../EarthGlobe.js";
import { BreathLine } from "./breathReply.js";

/** Lines of dialogue kept over the globe. The rest lives on the CMD display. */
const TAIL = 12;

type Props = {
  health: HealthPayload | null;
  unreachable: boolean;
  pulse: PulsePayload | null;
  /** Full transcript; the stage shows the tail of it above the cmd bar. */
  messages: ChatMsg[];
  confirm: ConfirmPayload | null;
  busy: boolean;
  recording: boolean;
  sttOk: boolean;
  speaking?: boolean;
  active?: boolean;
  onSubmit: (text: string) => void;
  onPttStart: () => void;
  onPttStop: () => void;
  onInterrupt?: () => void;
};

function Steel({ value }: { value: string | null }) {
  return <span className={value ? "ck-meta-v" : "ck-meta-v is-empty"}>{value ?? "—"}</span>;
}

export function Breath({
  health,
  unreachable,
  pulse,
  messages,
  confirm,
  busy,
  recording,
  sttOk,
  speaking,
  active = false,
  onSubmit,
  onPttStart,
  onPttStop,
  onInterrupt,
}: Props) {
  const [globeOk, setGlobeOk] = useState(false);
  const [hudOn, setHudOn] = useState(false);
  const live = !unreachable && health?.ok !== false;
  const talker = !unreachable && health?.llm === true;
  const hands = !unreachable && health?.hands === true;
  const stt = !unreachable && health?.stt === true;
  const tts = !unreachable && health?.tts === true;
  const lan = pulseText(pulse?.lan);
  const k3s = pulseText(pulse?.k3s);
  const utc = pulseText(pulse?.utc);
  const uptime = pulseText(pulse?.uptime);
  const gpus = pulseGpuChips(pulse);

  useEffect(() => {
    if (!active) {
      setGlobeOk(false);
      setHudOn(false);
      return;
    }
    setGlobeOk(earthWebglOk());
    const id = window.setTimeout(() => setHudOn(true), 200);
    return () => window.clearTimeout(id);
  }, [active]);

  // The globe keeps its own short tail rather than the whole session, so
  // coming back to the stage does not bury the planet under yesterday.
  // No scroll handling: the strip is bottom-aligned and clips, so the newest
  // line is always the last one and older lines run out under the top fade.
  // (Overflow past a flex start edge is not reachable by scrollTop anyway.)
  const tail = useMemo(() => messages.filter((m) => m.content.trim()).slice(-TAIL), [messages]);

  return (
    <div className="ck-breath">
      {active && globeOk ? <EarthGlobe /> : <div className="ck-breath-earth-fallback" />}
      <div className="ck-breath-vignette" aria-hidden="true" />

      <motion.div
        className="ck-breath-hud"
        initial={false}
        animate={{ opacity: hudOn ? 1 : 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <header className="ck-breath-top">
          <Brand live={live} size={22} />
          <div className="ck-breath-meta">
            <div className="ck-meta-cell">
              <span className="ck-meta-k">LAN</span>
              <Steel value={lan} />
            </div>
            <span className="ck-pipe" />
            <div className="ck-meta-cell">
              <span className="ck-meta-k">k3s</span>
              <Steel value={k3s} />
            </div>
            <span className="ck-pipe" />
            <div className="ck-meta-cell">
              <span className="ck-meta-k">UTC</span>
              <Steel value={utc} />
            </div>
          </div>
          <div className="ck-breath-systems">
            {(
              [
                ["TALKER", talker],
                ["HANDS", hands],
                ["STT", stt],
                ["TTS", tts],
              ] as const
            ).map(([label, ok]) => (
              <div key={label} className={`ck-sys ${ok ? "is-live" : ""}`}>
                <ConcRing on={ok} />
                <div className="ck-sys-txt">
                  <strong>{label}</strong>
                  <span>{ok ? "LIVE" : "WAIT"}</span>
                </div>
              </div>
            ))}
          </div>
        </header>

        <aside className="ck-breath-dossier">
          <div className="ck-panel-title">
            DOSSIER <LiveDot on={live} />
          </div>
          <dl>
            <div>
              <dt>TRACK</dt>
              <dd>:</dd>
              <dd>GLOBAL</dd>
            </div>
            <div>
              <dt>MODE</dt>
              <dd>:</dd>
              <dd>OBSERVE</dd>
            </div>
            <div>
              <dt>HOS</dt>
              <dd>:</dd>
              <dd>{unreachable ? "DEGRADED" : "NOMINAL"}</dd>
            </div>
            <div>
              <dt>LOCK</dt>
              <dd>:</dd>
              <dd>{confirm ? "TRUE" : "FALSE"}</dd>
            </div>
          </dl>
        </aside>

        <div className="ck-breath-bottom">
          <div className="ck-chip">
            CLUSTER <LiveDot on={live} /> <em className={live ? "" : "is-empty"}>{live ? "LIVE" : "WAIT"}</em>
          </div>
          <div className="ck-chip ck-chip-stack">
            <span className="ck-chip-k">UPTIME</span>
            <em className={uptime ? "" : "is-empty"}>{uptime ?? "—"}</em>
          </div>
          <div className="ck-chip-row">
            {gpus.map((g) => (
              <div key={g.id} className="ck-chip ck-chip-stack">
                <span className="ck-chip-k">{g.id}</span>
                <em className={g.tempC == null ? "is-empty" : ""}>
                  {g.tempC == null ? "—" : `${Math.round(g.tempC)}°C`}
                </em>
              </div>
            ))}
          </div>
        </div>

        {/* Comms column: the dialogue strip and the cmd bar are one
            bottom-anchored stack, so the strip can never be positioned under
            the cmd bar the way a magic `bottom` offset allowed. */}
        <div className="ck-breath-comms">
          {tail.length ? (
            <div className="ck-breath-toast" aria-live="polite">
              <div className="ck-toast-stack">
                {tail.map((m) => (
                  <BreathLine key={m.id} role={m.role} content={m.content} />
                ))}
              </div>
            </div>
          ) : null}

          <CmdBar
            variant="stage"
            busy={busy}
            recording={recording}
            sttOk={sttOk}
            speaking={speaking}
            placeholder="Speak freely…"
            onSubmit={onSubmit}
            onPttStart={onPttStart}
            onPttStop={onPttStop}
            onInterrupt={onInterrupt}
          />
        </div>
      </motion.div>
      {health?.degraded ? (
        <p className="ck-degraded">{health.reason || "Degraded"}</p>
      ) : null}
    </div>
  );
}
