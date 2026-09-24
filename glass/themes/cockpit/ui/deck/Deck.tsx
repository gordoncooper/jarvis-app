import { motion, useReducedMotion } from "motion/react";
import {
  Children,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
} from "react";
import { hashFor, parseHash, SLIDES, type Slide } from "./routes.js";

export type { Slide };

type Props = {
  index: Slide;
  onIndex: (i: Slide) => void;
  children: ReactNode;
};

export function Deck({ index, onIndex, children }: Props) {
  const startX = useRef<number | null>(null);
  const slides = Children.toArray(children);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const fromHash = parseHash();
    if (fromHash !== 0) onIndex(fromHash);
  }, [onIndex]);

  useEffect(() => {
    const next = hashFor(index);
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [index]);

  useEffect(() => {
    const onHash = () => onIndex(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [onIndex]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (ev.key === "ArrowRight" && index < 3) onIndex((index + 1) as Slide);
      if (ev.key === "ArrowLeft" && index > 0) onIndex((index - 1) as Slide);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onIndex]);

  const down = (ev: ReactPointerEvent) => {
    const t = ev.target as HTMLElement;
    if (t.closest("input,button,textarea,a,label,.ck-cmdbar,.ck-login-card,.ck-login-badge,.ck-brand-lockup,.ck-breath-canvas,.ck-breath-toast")) {
      startX.current = null;
      return;
    }
    startX.current = ev.clientX;
  };
  const up = (ev: ReactPointerEvent) => {
    if (startX.current == null) return;
    const dx = ev.clientX - startX.current;
    startX.current = null;
    if (Math.abs(dx) < 90) return;
    if (dx < 0 && index < 3) onIndex((index + 1) as Slide);
    if (dx > 0 && index > 0) onIndex((index - 1) as Slide);
  };

  return (
    <div className="ck-shell" data-slide={SLIDES[index]} onPointerDown={down} onPointerUp={up}>
      <motion.div
        className="ck-track"
        animate={{ x: `${-index * 100}vw` }}
        transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
      >
        {slides.map((child, i) => (
          <div key={SLIDES[i] ?? i} className="ck-slide" data-slide={SLIDES[i]}>
            {child}
          </div>
        ))}
      </motion.div>
      <nav className="ck-dots" aria-label="Displays">
        {SLIDES.map((name, i) => (
          <button
            key={name}
            type="button"
            className={i === index ? "is-on" : ""}
            aria-label={name}
            aria-current={i === index ? "true" : undefined}
            onClick={() => onIndex(i as Slide)}
          />
        ))}
      </nav>
    </div>
  );
}
