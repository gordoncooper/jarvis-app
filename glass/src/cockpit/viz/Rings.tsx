import { steelNum } from "../state/pulse.js";

export function Ring({ label, value }: { label: string; value: number | null | undefined }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const n = typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
  const dash = n == null ? `0 ${c}` : `${(n / 100) * c * 0.85} ${c}`;
  return (
    <div className="ck-ring">
      <svg viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} className="ck-ring-track" />
        <circle
          cx="36"
          cy="36"
          r={r}
          className="ck-ring-fill"
          strokeDasharray={dash}
          transform="rotate(-90 36 36)"
        />
      </svg>
      <div className="ck-ring-lab">
        <strong>{label}</strong>
        <span>{n == null ? "—" : `${steelNum(n)}%`}</span>
      </div>
    </div>
  );
}
