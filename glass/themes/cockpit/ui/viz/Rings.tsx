import { steelNum } from "@core";

/** Donut gauge. A null reading draws the track only — never a zero-looking arc. */
export function Ring({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | null | undefined;
  sub?: string | null;
}) {
  const r = 27;
  const c = 2 * Math.PI * r;
  const n = typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
  // A live-but-idle reading still needs a visible tick, or the ring reads as broken.
  const frac = n == null ? 0 : Math.max(n / 100, 0.012);
  return (
    <div className={`ck-ring ${n == null ? "is-null" : ""}`}>
      <svg viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} className="ck-ring-track" />
        {n != null ? (
          <circle
            cx="36"
            cy="36"
            r={r}
            className="ck-ring-fill"
            strokeDasharray={`${frac * c} ${c}`}
            transform="rotate(-90 36 36)"
          />
        ) : null}
        <text x="36" y="40" className="ck-ring-val">
          {n == null ? "—" : steelNum(n)}
          {n == null ? null : <tspan className="ck-ring-pct">%</tspan>}
        </text>
      </svg>
      <div className="ck-ring-lab">
        <strong>{label}</strong>
        {sub ? <span className="ck-ring-sub">{sub}</span> : null}
      </div>
    </div>
  );
}
