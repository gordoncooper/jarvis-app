import { motion } from "motion/react";
import type { ReactNode } from "react";

type Props = {
  className?: string;
  label?: string;
  children: ReactNode;
};

export function Panel({ className, label, children }: Props) {
  return (
    <motion.aside
      className={`hud-panel ${className ?? ""}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      {label ? <div className="hud-panel-label">{label}</div> : null}
      {children}
    </motion.aside>
  );
}
