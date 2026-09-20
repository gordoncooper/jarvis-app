import { AnimatePresence, motion } from "motion/react";

type Props = { text: string | null };

export function Ticker({ text }: Props) {
  return (
    <div className="hud-ticker" aria-live="polite">
      <AnimatePresence mode="wait">
        {text ? (
          <motion.p
            key={text}
            className="hud-ticker-line"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {text}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
