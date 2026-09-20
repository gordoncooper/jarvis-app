import { useEffect, useMemo, useRef, useState } from "react";
import type { ConfirmPayload } from "../../api.js";
import { CmdBar } from "../chrome/CmdBar.js";
import { ConfirmCard } from "../chrome/ConfirmCard.js";
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
import { type ChatMsg, dayOfYear } from "../mock.js";
import { capCopy, parseBriefing, type SessionBriefing } from "../state/session.js";

type Props = {
  greeting: string;
  blurb: string;
  briefing?: SessionBriefing | Record<string, unknown> | null;
  messages: ChatMsg[];
  confirm: ConfirmPayload | null;
  busy: boolean;
  recording: boolean;
  sttOk: boolean;
  live: boolean;
  memoryFacts: number;
  onRefetchSession: () => void | Promise<void>;
  onSubmit: (text: string) => void;
  onPttStart: () => void;
  onPttStop: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

const WEATHER_STUB = { now: "16°C, overcast", wind: "NW wind 8 km/h" };

const KIND_ICON: Record<string, typeof IconInbox> = {
  inbound: IconInbox,
  inbox: IconInbox,
  mail: IconInbox,
  schedule: IconClock,
  calendar: IconClock,
  agenda: IconClock,
  clock: IconClock,
  pulse: IconGear,
  cluster: IconGear,
  system: IconGear,
  gear: IconGear,
  memory: IconChip,
  mem: IconChip,
  chip: IconChip,
};

export function Cmd({
  greeting,
  blurb,
  briefing,
  messages,
  confirm,
  busy,
  recording,
  sttOk,
  live,
  memoryFacts,
  onRefetchSession,
  onSubmit,
  onPttStart,
  onPttStop,
  onConfirm,
  onCancel,
}: Props) {
  const [now, setNow] = useState(() => new Date());
  const [mode, setMode] = useState<"brief" | "ask" | "apply">("brief");
  const [collapsed, setCollapsed] = useState(false);
  const [wantFocus, setWantFocus] = useState<"ask" | "apply" | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const channelInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, confirm, busy]);

  useEffect(() => {
    if (!wantFocus) return;
    if (wantFocus === "apply" && confirm) {
      confirmRef.current?.scrollIntoView({ block: "nearest" });
    } else {
      channelInput.current?.focus();
    }
    setWantFocus(null);
  }, [wantFocus, confirm, collapsed]);

  const structured = useMemo(() => parseBriefing(briefing), [briefing]);
  const overnight = structured?.overnight ? capCopy(structured.overnight, 280) : null;
  const lab = structured?.lab ? capCopy(structured.lab, 280) : null;
  const focus = structured?.focus ? capCopy(structured.focus, 220) : null;
  const labName = structured?.lab_name ? capCopy(structured.lab_name, 48) : "OPERATOR WORKSPACE";
  const agenda = structured?.agenda ?? [];
  const today = structured?.today ?? [];
  const greetingCopy = capCopy(greeting, 160);
  const blurbCopy = capCopy(blurb, 420);

  const inboxCount = today.filter((row) => /in|mail|msg/i.test(row.kind)).length;
  const calendarLabel =
    agenda[0]?.label ?? today.find((row) => /cal|meet|agenda|schedule/i.test(row.kind))?.label ?? null;
  const applyCount = confirm ? 1 : 0;

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

  function onBrief() {
    setMode("brief");
    void onRefetchSession();
  }

  function onAsk() {
    setMode("ask");
    setCollapsed(false);
    setWantFocus("ask");
  }

  function onApply() {
    setMode("apply");
    setCollapsed(false);
    setWantFocus("apply");
  }

  return (
    <div className="ck-cmd">
      <header className="ck-cmd-top">
        <div className="ck-stage-brand">
          <HexMark size={22} />
          <span className="ck-brand">JARVIS</span>
          <span className="ck-live-pill ck-pulse">
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
              <strong>{WEATHER_STUB.now}</strong>
              <span>{WEATHER_STUB.wind}</span>
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
          <button type="button" className={mode === "brief" ? "is-active" : ""} onClick={onBrief}>
            BRIEF
          </button>
          <span>|</span>
          <button type="button" className={mode === "ask" ? "is-active" : ""} onClick={onAsk}>
            ASK
          </button>
          <span>|</span>
          <button type="button" className={mode === "apply" ? "is-active" : ""} onClick={onApply}>
            APPLY
          </button>
        </nav>
      </header>

      <div className="ck-cmd-body">
        <section className="ck-panel ck-dossier">
          <h2>DOSSIER</h2>
          <div className="ck-lab">
            <div className="ck-lab-title">
              LAB: {labName} <LiveDot on={live} />
            </div>
            <p>Operator Workspace · Personal Command Context</p>
          </div>
          <h3>
            <IconCal size={12} /> TODAY
          </h3>
          <ul className="ck-timeline">
            {today.map((row, i) => {
              const Ico = KIND_ICON[row.kind.toLowerCase()] ?? IconDoc;
              return (
                <li key={`${row.t}-${i}`}>
                  <span className="ck-tl-time">{row.t || "—"}</span>
                  <span className="ck-tl-ico">
                    <Ico />
                  </span>
                  <div>
                    <strong>{row.label}</strong>
                    <p>{row.kind}</p>
                  </div>
                </li>
              );
            })}
            {memoryFacts > 0 ? (
              <li>
                <span className="ck-tl-time">MEM</span>
                <span className="ck-tl-ico">
                  <IconChip />
                </span>
                <div>
                  <strong>MEMORY / CONTEXT</strong>
                  <p>
                    {memoryFacts} remembered {memoryFacts === 1 ? "fact" : "facts"}
                  </p>
                </div>
              </li>
            ) : null}
            {today.length === 0 && memoryFacts === 0 ? (
              <li>
                <span className="ck-tl-time">—</span>
                <span className="ck-tl-ico">
                  <IconDoc />
                </span>
                <div>
                  <strong>Today</strong>
                  <p>No structured today rows</p>
                </div>
              </li>
            ) : null}
          </ul>
        </section>

        <section className="ck-panel ck-brief">
          <header>
            <h2>
              <IconDoc size={16} /> AM BRIEFING
            </h2>
            <span>
              Updated {local.slice(0, 5)} · Auto-refresh ON <LiveDot on={live} />
            </span>
          </header>
          <p className="ck-greeting">{greetingCopy}</p>
          {!overnight && !lab && !agenda.length && blurbCopy ? <p className="ck-blurb">{blurbCopy}</p> : null}
          {overnight ? (
            <>
              <h3 className="ck-sec-teal">OVERNIGHT</h3>
              <p>{overnight}</p>
            </>
          ) : null}
          {lab ? (
            <>
              <h3>LAB</h3>
              <p>{lab}</p>
            </>
          ) : null}
          {agenda.length ? (
            <>
              <h3>AGENDA</h3>
              <ul className="ck-brief-list">
                {agenda.map((row, i) => (
                  <li key={`${row.t}-${i}`}>
                    {row.t ? `${row.t} · ` : ""}
                    {row.label}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {focus ? (
            <footer className="ck-focus">
              <strong>
                <IconPulse size={14} /> BRIEFING FOCUS
              </strong>
              <p>{focus}</p>
            </footer>
          ) : null}
        </section>

        <section className="ck-panel ck-channel">
          <header>
            <h2>
              CHANNEL · OPERATOR CONVO <LiveDot on={live} />
            </h2>
            <button
              type="button"
              className="ck-collapse"
              aria-label={collapsed ? "Expand channel" : "Collapse channel"}
              onClick={() => setCollapsed((v) => !v)}
            >
              {collapsed ? "≫" : "≪"}
            </button>
          </header>
          {collapsed ? null : (
            <>
              <div className="ck-thread" ref={thread}>
                {messages.length === 0 ? (
                  <p className="ck-thread-empty">Awaiting operator input…</p>
                ) : null}
                {messages.map((m) => (
                  <div key={m.id} className={`ck-bubble ${m.role}`}>
                    <span className="ck-bubble-meta">{m.role === "user" ? "OPERATOR" : "JARVIS"}</span>
                    <div className="ck-bubble-body">
                      <p>{m.content || "…"}</p>
                    </div>
                  </div>
                ))}
                {confirm ? (
                  <div ref={confirmRef}>
                    <ConfirmCard confirm={confirm} busy={busy} onYes={onConfirm} onCancel={onCancel} />
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
                inputRef={channelInput}
                onSubmit={onSubmit}
                onPttStart={onPttStart}
                onPttStop={onPttStop}
              />
            </>
          )}
        </section>
      </div>

      <footer className="ck-cmd-foot">
        <div className="ck-pill">
          <div className="ck-pill-head">
            <IconInbox size={15} />
            <strong>INBOX</strong>
            <LiveDot on={inboxCount > 0} />
          </div>
          <span>{inboxCount ? `${inboxCount} inbound` : "—"}</span>
        </div>
        <div className="ck-pill">
          <div className="ck-pill-head">
            <IconCal size={15} />
            <strong>CALENDAR</strong>
          </div>
          <span>{calendarLabel ? capCopy(calendarLabel, 28) : "—"}</span>
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
            <LiveDot on={applyCount === 0} />
          </div>
          <span>{applyCount} pending</span>
        </div>
      </footer>
    </div>
  );
}
