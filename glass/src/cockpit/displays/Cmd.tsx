import { useEffect, useRef, useState } from "react";
import type { ConfirmPayload } from "../../api.js";
import { CmdBar } from "../chrome/CmdBar.js";
import {
  HexMark,
  IconBox,
  IconCal,
  IconChip,
  IconClock,
  IconCloud,
  IconDoc,
  IconGear,
  IconInbox,
  IconMic,
  IconPulse,
  LiveDot,
} from "../chrome/Marks.js";
import { type ChatMsg, MOCK, dayOfYear } from "../mock.js";

type Props = {
  greeting: string;
  blurb: string;
  messages: ChatMsg[];
  confirm: ConfirmPayload | null;
  busy: boolean;
  recording: boolean;
  sttOk: boolean;
  live: boolean;
  memoryFacts: number;
  onNav: (target: "stage" | "cmd" | "noc") => void;
  onSubmit: (text: string) => void;
  onPttStart: () => void;
  onPttStop: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

const TL_ICON: Record<string, typeof IconInbox> = {
  inbox: IconInbox,
  clock: IconClock,
  gear: IconGear,
  chip: IconChip,
};

export function Cmd({
  greeting,
  blurb,
  messages,
  confirm,
  busy,
  recording,
  sttOk,
  live,
  memoryFacts,
  onNav,
  onSubmit,
  onPttStart,
  onPttStop,
  onConfirm,
  onCancel,
}: Props) {
  const [now, setNow] = useState(() => new Date());
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const local = now.toLocaleTimeString("en-GB", { hour12: false });
  const dateStr = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const weekday = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="ck-cmd">
      <header className="ck-cmd-top">
        <div className="ck-stage-brand">
          <HexMark size={22} variant="j" />
          <span className="ck-brand">JARVIS</span>
          <span className="ck-live-pill">
            <LiveDot on={live} /> LIVE
          </span>
        </div>
        <div className="ck-cmd-widgets">
          <div className="ck-widget">
            <span className="ck-ico">
              <IconClock size={18} />
            </span>
            <div>
              <strong>{local} LOCAL</strong>
              <span>{dateStr}</span>
            </div>
          </div>
          <span className="ck-vdiv" />
          <div className="ck-widget">
            <span className="ck-ico">
              <IconCloud size={18} />
            </span>
            <div>
              <strong>{MOCK.weather}</strong>
              <span>{MOCK.wind}</span>
            </div>
          </div>
          <span className="ck-vdiv" />
          <div className="ck-widget">
            <span className="ck-ico">
              <IconCal size={18} />
            </span>
            <div>
              <strong>{weekday}</strong>
              <span>Day {dayOfYear(now)} of 365</span>
            </div>
          </div>
        </div>
        <nav className="ck-cmd-nav">
          <button type="button" className="is-active" onClick={() => onNav("cmd")}>
            BRIEF
          </button>
          <span>|</span>
          <button type="button" onClick={() => onNav("stage")}>
            ASK
          </button>
          <span>|</span>
          <button type="button" onClick={() => onNav("noc")}>
            APPLY
          </button>
        </nav>
      </header>

      <div className="ck-cmd-body">
        <section className="ck-panel ck-dossier">
          <h2>DOSSIER</h2>
          <div className="ck-lab">
            <div className="ck-lab-title">
              LAB: {MOCK.lab} <LiveDot on />
            </div>
            <p>Operator Workspace · Personal Command Context</p>
          </div>
          <h3>
            <IconCal size={12} /> TODAY
          </h3>
          <ul className="ck-timeline">
            {MOCK.timeline.map((row) => {
              const Ico = TL_ICON[row.icon] ?? IconDoc;
              return (
                <li key={row.t}>
                  <span className="ck-tl-time">{row.t}</span>
                  <span className="ck-tl-ico">
                    <Ico />
                  </span>
                  <div>
                    <strong>{row.title}</strong>
                    <p>
                      {row.title === "MEMORY / CONTEXT"
                        ? `${memoryFacts} active facts · context retained`
                        : row.body}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="ck-panel ck-brief">
          <header>
            <h2>
              <IconDoc size={16} /> AM BRIEFING
            </h2>
            <span>
              Updated {local.slice(0, 5)} · Auto-refresh ON <LiveDot on />
            </span>
          </header>
          <p className="ck-greeting">{greeting}</p>
          {blurb ? <p className="ck-blurb">{blurb}</p> : null}
          <h3 className="ck-sec-teal">OVERNIGHT · 00:00 – 07:00</h3>
          <p>
            Quiet window. 2 jobs completed, 1 failure on node v1-7. Spectrograph
            calibration drift +0.7 nm overnight.
          </p>
          <p className="ck-delta">Δ +2 new preprints in arXiv cs.LG · vectorlight-adjacent</p>
          <h3>LAB · SYSTEMS & SIGNALS</h3>
          <ul className="ck-brief-list">
            <li>GPU cluster load: 78% · 4 jobs queued · 2 pending.</li>
            <li>Storage pool at 62% · +1.3 TB since yesterday.</li>
            <li className="ck-delta">Δ Network ingress +18% over 7-day baseline</li>
            <li>All instruments online. No active alerts.</li>
          </ul>
          <footer className="ck-focus">
            <strong>
              <IconPulse size={14} /> BRIEFING FOCUS
            </strong>
            <p>Advance vectorlight calibration stability and clear training queue.</p>
          </footer>
        </section>

        <section className="ck-panel ck-channel">
          <header>
            <h2>
              CHANNEL · OPERATOR CONVO <LiveDot on={live} />
            </h2>
            <button type="button" className="ck-collapse" aria-label="Collapse">
              ≪
            </button>
          </header>
          <div className="ck-thread" ref={thread}>
            {messages.length === 0 ? (
              <p className="ck-thread-empty">Awaiting operator input…</p>
            ) : null}
            {messages.map((m) => (
              <div key={m.id} className={`ck-bubble ${m.role}`}>
                <span className="ck-bubble-meta">
                  {m.role === "user" ? "OPERATOR" : "JARVIS"}
                </span>
                <div className="ck-bubble-body">
                  <p>{m.content || "…"}</p>
                </div>
              </div>
            ))}
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
          <CmdBar
            variant="cmd"
            prompt=">_ cmd ·"
            placeholder="type command or message"
            busy={busy}
            recording={recording}
            sttOk={sttOk}
            onSubmit={onSubmit}
            onPttStart={onPttStart}
            onPttStop={onPttStop}
          />
          <p className="ck-hint"># Enter to send · ↑ history</p>
        </section>
      </div>

      <footer className="ck-cmd-foot">
        <div className="ck-pill">
          <div className="ck-pill-head">
            <IconInbox size={15} />
            <strong>INBOX</strong>
            <LiveDot on />
          </div>
          <span>{MOCK.inboxUnread} unread</span>
        </div>
        <div className="ck-pill">
          <div className="ck-pill-head">
            <IconCal size={15} />
            <strong>CALENDAR</strong>
          </div>
          <span>Next: {MOCK.calendarNext}</span>
        </div>
        <div className="ck-pill">
          <div className="ck-pill-head">
            <IconMic size={15} />
            <strong>VOICE</strong>
          </div>
          <span className="ck-pill-voice">
            {recording ? "listening" : "idle"}
            <span className={`ck-wave ${recording ? "is-on" : ""}`} />
          </span>
        </div>
        <div className="ck-pill">
          <div className="ck-pill-head">
            <IconBox size={15} />
            <strong>APPLY QUEUE</strong>
            <LiveDot on={MOCK.applyPending === 0} />
          </div>
          <span>{MOCK.applyPending} pending</span>
        </div>
      </footer>
    </div>
  );
}
