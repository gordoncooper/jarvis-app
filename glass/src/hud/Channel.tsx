import { AnimatePresence, motion } from "motion/react";
import type { ConfirmPayload } from "../api.js";

export type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Props = {
  messages: ChatMsg[];
  confirm: ConfirmPayload | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function Channel({ messages, confirm, onConfirm, onCancel }: Props) {
  if (messages.length === 0) return null;
  return (
    <motion.section
      className="hud-channel"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <div className="hud-panel-label">CHANNEL</div>
      <div className="hud-thread">
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              className={`msg ${m.role}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
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
