import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Brand } from "../chrome/Brand.js";
import { CmdBar } from "../chrome/CmdBar.js";
import { StatusStrip } from "../chrome/StatusStrip.js";
import { ConcRing, IconBox, IconChip, IconGear, IconPulse, LiveDot } from "../chrome/Marks.js";
import { pulseText, type ChatMsg, type ConfirmPayload, type HealthPayload, type PulsePayload } from "@core";
import { pulseGpuChips } from "../rack.js";
import { EarthGlobe, earthWebglOk } from "../EarthGlobe.js";
import { BreathLine } from "./breathReply.js";

/** Messages kept over the globe. The top of the strip is the top of this
 * tail; anything older stays on the CMD display. */
const TAIL = 6;

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

  // Six messages, not the session. The strip's top is the top of this tail,
  // and the CSS cap stops that top short of the header. No scroll handling:
  // the strip is bottom-aligned and clips, so the newest line is the last
  // one and older lines run out under the top fade. (Overflow past a flex
  // start edge is not reachable by scrollTop anyway.)
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
            <StatusStrip pulse={pulse} />
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
          <p className="ck-breath-dossier-sub">Global track · observe</p>
          <ul className="ck-breath-rows">
            {(
              [
                ["TRACK", "GLOBAL", IconPulse, ""],
                ["MODE", "OBSERVE", IconGear, ""],
                ["HOS", unreachable ? "DEGRADED" : "NOMINAL", IconChip, unreachable ? "is-bad" : ""],
                ["LOCK", confirm ? "HELD" : "OPEN", IconBox, confirm ? "is-accent" : "is-quiet"],
              ] as const
            ).map(([k, v, Ico, tone]) => (
              <li key={k}>
                <span className="ck-breath-ico" aria-hidden="true">
                  <Ico size={12} />
                </span>
                <span className="ck-breath-k">{k}</span>
                <span className={`ck-breath-v ${tone}`}>{v}</span>
              </li>
            ))}
          </ul>
        </aside>

        <div className="ck-breath-bottom">
          <div className="ck-breath-corner">
            <div>
              <span className="ck-chip-k">
                CLUSTER <LiveDot on={live} />
              </span>
              <strong className={live ? "is-live" : "is-empty"}>{live ? "LIVE" : "WAIT"}</strong>
            </div>
            <div>
              <span className="ck-chip-k">UPTIME</span>
              <strong className={uptime ? "" : "is-empty"}>{uptime ?? "—"}</strong>
            </div>
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
            placeholder="Speak freely."
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
