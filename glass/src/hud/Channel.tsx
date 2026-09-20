import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ConfirmPayload } from "../api.js";

export type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: number;
};

const FADE_START_MS = 16_000;
const FADE_END_MS = 48_000;

type Props = {
  messages: ChatMsg[];
  confirm: ConfirmPayload | null;
  pinLast: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function opacityFor(age: number, pinned: boolean): number {
  if (pinned) return 1;
  if (age <= FADE_START_MS) return 1;
  if (age >= FADE_END_MS) return 0;
  return 1 - (age - FADE_START_MS) / (FADE_END_MS - FADE_START_MS);
}

export function Channel({ messages, confirm, pinLast, onConfirm, onCancel }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(id);
  }, []);

  const lastId = messages[messages.length - 1]?.id;
  const rows = messages
    .map((m) => {
      const pinned = pinLast && m.id === lastId;
      const opacity = opacityFor(now - m.at, pinned);
      return { m, opacity };
    })
    .filter((row) => row.opacity > 0.03 || (confirm && row.m.id === lastId));

  useEffect(() => {
    const el = thread.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, rows.length]);

  if (rows.length === 0 && !confirm) return null;

  return (
    <motion.section
      className="hud-channel"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <div className="hud-panel-label">CHANNEL</div>
      <div className="hud-thread" ref={thread}>
        <AnimatePresence initial={false}>
          {rows.map(({ m, opacity }) => (
            <motion.div
              key={m.id}
              className={`msg ${m.role}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
            >
              {m.content}
            </motion.div>
          ))}
        </AnimatePresence>
        {confirm ? (
          <div className="confirm-row">
            <button type="button" className="confirm-yes" onClick={onConfirm}>
              Confirm
            </button>
            <button type="button" className="confirm-no" onClick={onCancel}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </motion.section>
  );
}
