type Sample = { a: number | null; b: number | null };

const W = 240;
const H = 42;
const PAD = 4;

/** Temps live in a narrow band; scaling 0-100 flattens them into a dead line. */
function scale(v: number, lo: number, hi: number): number {
  const t = (v - lo) / Math.max(1, hi - lo);
  return H - PAD - Math.min(1, Math.max(0, t)) * (H - PAD * 2);
}

/** Gaps in the Prometheus window must break the line, not interpolate across. */
function segments(values: Array<number | null>, lo: number, hi: number): string[] {
  const n = Math.max(values.length, 2);
  const out: string[] = [];
  let run: string[] = [];
  values.forEach((v, i) => {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      if (run.length >= 2) out.push(run.join(" "));
      run = [];
      return;
    }
    run.push(`${((i / (n - 1)) * W).toFixed(1)},${scale(v, lo, hi).toFixed(1)}`);
  });
  if (run.length >= 2) out.push(run.join(" "));
  return out;
}

function range(values: Array<number | null>): { min: number; max: number } | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

function Trace({
  values,
  lo,
  hi,
  gid,
}: {
  values: Array<number | null>;
  lo: number;
  hi: number;
  gid: string;
}) {
  const segs = segments(values, lo, hi);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="ck-spark-svg">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ck-accent)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--ck-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" y1={H * f} x2={W} y2={H * f} className="ck-spark-grid" />
      ))}
      {segs.map((pts, i) => (
        <polygon key={`f${i}`} className="ck-spark-fill" fill={`url(#${gid})`} points={`${pts.split(" ")[0].split(",")[0]},${H} ${pts} ${pts.split(" ").slice(-1)[0].split(",")[0]},${H}`} />
      ))}
      {segs.map((pts, i) => (
        <polyline key={`l${i}`} className="ck-spark-line" points={pts} />
      ))}
      {!segs.length ? (
        <text x={W / 2} y={H / 2 + 3} className="ck-spark-empty">
          no samples in window
        </text>
      ) : null}
    </svg>
  );
}

function Row({
  label,
  values,
  lo,
  hi,
  gid,
}: {
  label: string;
  values: Array<number | null>;
  lo: number;
  hi: number;
  gid: string;
}) {
  const r = range(values);
  return (
    <div className="ck-spark-row">
      <span className="ck-spark-k">
        {label}
        <em>{r ? `${Math.round(r.min)}–${Math.round(r.max)}°C` : "—"}</em>
      </span>
      <Trace values={values} lo={lo} hi={hi} gid={gid} />
    </div>
  );
}

/** Two stacked traces, each labelled, matching the NOC reference frame. */
export function Spark({
  history,
  labelA,
  labelB,
  lo = 30,
  hi = 95,
}: {
  history: Sample[];
  labelA: string;
  labelB: string;
  lo?: number;
  hi?: number;
}) {
  return (
    <div className="ck-spark">
      <Row label={labelA} values={history.map((s) => s.a)} lo={lo} hi={hi} gid="ck-spark-a" />
      <Row label={labelB} values={history.map((s) => s.b)} lo={lo} hi={hi} gid="ck-spark-b" />
      <p className="ck-spark-scale">scale {lo}–{hi}°C</p>
    </div>
  );
}
