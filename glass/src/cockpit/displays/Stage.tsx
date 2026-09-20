import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { ConfirmPayload, HealthPayload } from "../../api.js";
import { CmdBar } from "../chrome/CmdBar.js";
import { ConcRing, HexMark, LiveDot } from "../chrome/Marks.js";
import { type ChatMsg, MOCK, formatUptime } from "../mock.js";
import { StageEarth, stageWebglOk } from "../StageEarth.js";

type Props = {
  health: HealthPayload | null;
  unreachable: boolean;
  messages: ChatMsg[];
  confirm: ConfirmPayload | null;
  busy: boolean;
  recording: boolean;
  sttOk: boolean;
  talkerOk: boolean;
  handsOk: boolean;
  ttsOk: boolean;
  onSubmit: (text: string) => void;
  onPttStart: () => void;
  onPttStop: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export function Stage({
  health,
  unreachable,
  messages,
  confirm,
  busy,
  recording,
  sttOk,
  talkerOk,
  handsOk,
  ttsOk,
  onSubmit,
  onPttStart,
  onPttStop,
  onConfirm,
  onCancel,
}: Props) {
  const [utc, setUtc] = useState("");
  const [uptime, setUptime] = useState(() => formatUptime(0));
  const [globeOk] = useState(() => stageWebglOk());
  const boot = useState(() => Date.now())[0];
  const live = talkerOk && !unreachable;

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setUtc(
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`,
      );
      setUptime(formatUptime((Date.now() - boot) / 1000));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [boot]);

  const lastAsst = [...messages].reverse().find((m) => m.role === "assistant" && m.content);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const showChat = !!(lastUser || lastAsst || confirm);

  return (
    <div className="ck-stage">
      {globeOk ? <StageEarth /> : <div className="ck-stage-earth-fallback" />}
      <div className="ck-stage-vignette" aria-hidden="true" />
      <div className="ck-stage-heartbeat" aria-hidden="true" />

      <header className="ck-stage-top">
        <div className="ck-stage-brand">
          <HexMark size={24} variant="dot" />
          <span className="ck-brand">JARVIS</span>
          <span className="ck-live-pill ck-pulse">
            <LiveDot on={live} /> LIVE
          </span>
        </div>
        <div className="ck-stage-meta">
          <div className="ck-meta-cell">
            <span className="ck-meta-k">LAN</span>
            <span className="ck-meta-v">{MOCK.lan}</span>
          </div>
          <span className="ck-pipe" />
          <div className="ck-meta-cell">
            <span className="ck-meta-k">k3s</span>
            <span className="ck-meta-v">{MOCK.k3s}</span>
          </div>
          <span className="ck-pipe" />
          <div className="ck-meta-cell">
            <span className="ck-meta-k">UTC</span>
            <span className="ck-meta-v">{utc}</span>
          </div>
        </div>
        <div className="ck-stage-systems">
          {(
            [
              ["TALKER", talkerOk],
              ["HANDS", handsOk],
              ["STT", sttOk],
              ["TTS", ttsOk],
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

      <motion.aside
        className="ck-stage-dossier ck-pulse-border"
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="ck-panel-title">
          DOSSIER <LiveDot on={live} />
        </div>
        <dl>
          <div>
            <dt>TRACK</dt>
            <dd>:</dd>
            <dd className="is-accent">GLOBAL</dd>
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
            <dd className={confirm ? "is-accent" : ""}>{confirm ? "TRUE" : "FALSE"}</dd>
          </div>
        </dl>
      </motion.aside>

      <div className="ck-stage-bottom">
        <div className="ck-chip ck-chip-cluster ck-pulse-border">
          CLUSTER <LiveDot on={!unreachable} /> <em>LIVE</em>
        </div>
        <div className="ck-chip ck-chip-stack">
          <span className="ck-chip-k">UPTIME</span>
          <em>{uptime}</em>
        </div>
        <div className="ck-chip-row">
          {MOCK.gpu.map((g) => (
            <div key={g.id} className="ck-chip ck-chip-stack">
              <span className="ck-chip-k">{g.id}</span>
              <em>{g.temp}°C</em>
            </div>
          ))}
        </div>
      </div>

      {showChat ? (
        <motion.div
          className="ck-stage-reply"
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          {lastUser ? <p className="ck-msg-user">{lastUser.content}</p> : null}
          {lastAsst ? <p className="ck-msg-asst">{lastAsst.content}</p> : null}
          {confirm ? (
            <div className="ck-confirm">
              <span>{confirm.summary || confirm.fact || "Confirm?"}</span>
              <button type="button" onClick={onConfirm}>
                Confirm
              </button>
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
            </div>
          ) : null}
        </motion.div>
      ) : null}

      <CmdBar
        variant="stage"
        busy={busy}
        recording={recording}
        sttOk={sttOk}
        onSubmit={onSubmit}
        onPttStart={onPttStart}
        onPttStop={onPttStop}
      />
      {health?.degraded ? (
        <p className="ck-degraded">{health.reason || "Degraded"}</p>
      ) : null}
    </div>
  );
}
