import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { ConfirmPayload, HealthPayload, PulsePayload } from "../../api.js";
import { Brand } from "../chrome/Brand.js";
import { CmdBar } from "../chrome/CmdBar.js";
import { ConcRing, LiveDot } from "../chrome/Marks.js";
import { type EarthToast, pulseGpuChips, pulseText } from "../state/pulse.js";
import { StageEarth, stageWebglOk } from "../StageEarth.js";

type Props = {
  health: HealthPayload | null;
  unreachable: boolean;
  pulse: PulsePayload | null;
  toast: EarthToast | null;
  confirm: ConfirmPayload | null;
  busy: boolean;
  recording: boolean;
  sttOk: boolean;
  active?: boolean;
  onSubmit: (text: string) => void;
  onPttStart: () => void;
  onPttStop: () => void;
};

function Steel({ value }: { value: string | null }) {
  return <span className={value ? "ck-meta-v" : "ck-meta-v is-empty"}>{value ?? "—"}</span>;
}

export function Stage({
  health,
  unreachable,
  pulse,
  toast,
  confirm,
  busy,
  recording,
  sttOk,
  active = false,
  onSubmit,
  onPttStart,
  onPttStop,
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
    setGlobeOk(stageWebglOk());
    const id = window.setTimeout(() => setHudOn(true), 200);
    return () => window.clearTimeout(id);
  }, [active]);

  const showToast = toast != null && !!(toast.user || toast.asst);

  return (
    <div className="ck-stage">
      {active && globeOk ? <StageEarth /> : <div className="ck-stage-earth-fallback" />}
      <div className="ck-stage-vignette" aria-hidden="true" />

      <motion.div
        className="ck-stage-hud"
        initial={false}
        animate={{ opacity: hudOn ? 1 : 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <header className="ck-stage-top">
          <Brand live={live} size={22} />
          <div className="ck-stage-meta">
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
          <div className="ck-stage-systems">
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

        <aside className="ck-stage-dossier">
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

        <div className="ck-stage-bottom">
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

        {showToast && toast ? (
          <div className="ck-stage-toast" aria-live="polite">
            {toast.user ? <p className="ck-toast-user">{toast.user}</p> : null}
            {toast.asst ? <p className="ck-toast-asst">{toast.asst}</p> : <p className="ck-toast-asst is-empty">…</p>}
          </div>
        ) : null}

        <CmdBar
          variant="stage"
          busy={busy}
          recording={recording}
          sttOk={sttOk}
          placeholder="Speak freely…"
          onSubmit={onSubmit}
          onPttStart={onPttStart}
          onPttStop={onPttStop}
        />
      </motion.div>
      {health?.degraded ? (
        <p className="ck-degraded">{health.reason || "Degraded"}</p>
      ) : null}
    </div>
  );
}
