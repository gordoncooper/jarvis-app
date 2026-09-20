import { motion } from "motion/react";

type Props = {
  live: boolean;
  alert: boolean;
};

export function Pip({ live, alert }: Props) {
  const label = live ? "LIVE" : "HOLD";
  return (
    <motion.span
      className={`pip ${live ? "is-live" : "is-down"} ${alert ? "is-alert" : ""}`}
      aria-live="polite"
      animate={
        live
          ? { opacity: [1, alert ? 0.25 : 0.42, 1], scale: [1, alert ? 1.08 : 1.03, 1] }
          : { opacity: 1, scale: 1 }
      }
      transition={
        live
          ? { duration: alert ? 0.7 : 1.85, repeat: Infinity, ease: "easeInOut" }
          : { duration: 0.16 }
      }
    >
      {label}
    </motion.span>
  );
}
