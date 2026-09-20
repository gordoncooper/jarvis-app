import {
  Children,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
} from "react";

export type Slide = 0 | 1 | 2 | 3;

type Props = {
  index: Slide;
  onIndex: (i: Slide) => void;
  children: ReactNode;
};

export function Shell({ index, onIndex, children }: Props) {
  const startX = useRef<number | null>(null);
  const slides = Children.toArray(children);

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
    if (t.closest("input,button,textarea,a,label,.ck-cmdbar,.ck-login-card")) {
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
    <div className="ck-shell" onPointerDown={down} onPointerUp={up}>
      <div className="ck-track" style={{ transform: `translateX(-${index * 25}%)` }}>
        {slides.map((child, i) => (
          <div key={i} className="ck-slide">
            {child}
          </div>
        ))}
      </div>
      <div className="ck-dots" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <button
            key={i}
            type="button"
            className={i === index ? "is-on" : ""}
            onClick={() => onIndex(i as Slide)}
          />
        ))}
      </div>
    </div>
  );
}
