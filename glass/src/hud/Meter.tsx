type ArcProps = {
  label: string;
  ok: boolean;
  live: boolean;
};

export function ArcMeter({ label, ok, live }: ArcProps) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = ok ? 0.78 : 0.16;
  const dash = `${c * frac} ${c}`;
  return (
    <div className={`hud-arc ${ok && live ? "is-live" : ""} ${ok ? "" : "is-down"}`}>
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle className="hud-arc-track" cx="36" cy="36" r={r} />
        <circle
          className="hud-arc-fill"
          cx="36"
          cy="36"
          r={r}
          strokeDasharray={dash}
          transform="rotate(-90 36 36)"
        />
      </svg>
      <span className="hud-arc-label">{label}</span>
      <span className="hud-arc-value">{ok ? "LIVE" : "WAIT"}</span>
    </div>
  );
}

type MemProps = { count: number };

export function MemoryRing({ count }: MemProps) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, count / 40) * 0.78 + 0.08;
  const dash = `${c * frac} ${c}`;
  return (
    <div className={`hud-arc hud-arc-mem ${count > 0 ? "is-live" : ""}`}>
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle className="hud-arc-track" cx="36" cy="36" r={r} />
        <circle
          className="hud-arc-fill"
          cx="36"
          cy="36"
          r={r}
          strokeDasharray={dash}
          transform="rotate(-90 36 36)"
        />
      </svg>
      <span className="hud-arc-label">MEM</span>
      <span className="hud-arc-value">{count}</span>
    </div>
  );
}
