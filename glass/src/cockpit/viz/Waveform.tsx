import { useEffect, useRef, useState } from "react";

const BARS = 56;

/** Mirrored bar field. Idle is a low live-looking floor, not a row of dashes;
 *  recording opens the envelope. No audio analyser is wired yet, so this shows
 *  channel state rather than claiming to plot the operator's voice. */
export function Waveform({ active }: { active: boolean }) {
  const [phase, setPhase] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    const step = () => {
      if (!alive) return;
      setPhase((p) => p + (active ? 0.16 : 0.03));
      raf.current = window.requestAnimationFrame(step);
    };
    raf.current = window.requestAnimationFrame(step);
    return () => {
      alive = false;
      if (raf.current != null) window.cancelAnimationFrame(raf.current);
    };
  }, [active]);

  const bars = Array.from({ length: BARS }, (_, i) => {
    const taper = 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
    const swell = Math.sin(i * 0.42 + phase) * Math.sin(i * 0.13 - phase * 0.7);
    const amp = active ? 7 + Math.abs(swell) * 26 * (0.45 + taper * 0.55) : 4 + Math.abs(swell) * 7.5;
    return Math.max(1.5, amp);
  });

  return (
    <div className={`ck-wave-panel ${active ? "is-on" : ""}`}>
      <svg viewBox="0 0 240 40" preserveAspectRatio="none">
        {bars.map((h, i) => {
          const x = i * (240 / BARS) + 1;
          return (
            <rect
              key={i}
              x={x}
              y={20 - h / 2}
              width={240 / BARS - 2}
              height={h}
              rx="0.8"
              fill="currentColor"
              opacity={0.3 + (h / 34) * 0.7}
            />
          );
        })}
      </svg>
      <span className="ck-wave-state">{active ? "CAPTURING" : "IDLE"}</span>
    </div>
  );
}
