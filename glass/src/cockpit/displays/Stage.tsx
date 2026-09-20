import { useEffect, useState } from "react";
import type { ConfirmPayload, HealthPayload } from "../../api.js";
import { CmdBar } from "../chrome/CmdBar.js";
import { ConcRing, HexMark, LiveDot } from "../chrome/Marks.js";
import { type ChatMsg, MOCK, formatUptime } from "../mock.js";

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

  return (
    <div className="ck-stage">
      <div className="ck-stage-earth" />
      <header className="ck-stage-top">
        <div className="ck-stage-brand">
          <HexMark />
          <span className="ck-brand">JARVIS</span>
          <span className="ck-live-pill">
            <LiveDot on={live} /> LIVE
          </span>
        </div>
        <div className="ck-stage-meta">
          <span>
            LAN <em>{MOCK.lan}</em>
          </span>
          <span className="ck-pipe" />
          <span>
            k3s <em>{MOCK.k3s}</em>
          </span>
          <span className="ck-pipe" />
          <span>
            UTC <em>{utc}</em>
          </span>
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
              <div>
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
            <dd>GLOBAL</dd>
          </div>
          <div>
            <dt>MODE</dt>
            <dd>OBSERVE</dd>
          </div>
          <div>
            <dt>HOS</dt>
            <dd>{unreachable ? "DEGRADED" : "NOMINAL"}</dd>
          </div>
          <div>
            <dt>LOCK</dt>
            <dd className={confirm ? "is-accent" : ""}>{confirm ? "TRUE" : "FALSE"}</dd>
          </div>
        </dl>
      </aside>

      <div className="ck-stage-bottom">
        <div className="ck-chip">
          CLUSTER <LiveDot on={!unreachable} /> <em>LIVE</em>
        </div>
        <div className="ck-chip">
          UPTIME <em>{uptime}</em>
        </div>
        <div className="ck-chip-row">
          {MOCK.gpu.map((g) => (
            <div key={g.id} className="ck-chip">
              {g.id} <em>{g.temp}°C</em>
            </div>
          ))}
        </div>
      </div>

      {(lastUser || lastAsst || confirm) && (
        <div className="ck-stage-reply">
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
        </div>
      )}

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
