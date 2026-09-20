type Sample = { a: number | null; b: number | null };

function polyline(values: Array<number | null>, w: number, h: number): string | null {
  const pts: string[] = [];
  const n = Math.max(values.length, 2);
  values.forEach((v, i) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    const x = (i / (n - 1)) * w;
    const y = h - ((Math.min(100, Math.max(0, v)) / 100) * (h - 8) + 4);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return pts.length >= 2 ? pts.join(" ") : null;
}

export function Spark({
  history,
  labelA,
  labelB,
}: {
  history: Sample[];
  labelA: string;
  labelB: string;
}) {
  const a = polyline(
    history.map((s) => s.a),
    200,
    48,
  );
  const b = polyline(
    history.map((s) => s.b),
    200,
    48,
  );
  return (
    <div className="ck-spark">
      <svg viewBox="0 0 200 48" preserveAspectRatio="none">
        {a ? (
          <polyline fill="none" stroke="var(--ck-accent)" strokeWidth="1.6" points={a} />
        ) : null}
        {b ? (
          <polyline fill="none" stroke="#5eead4" strokeWidth="1.3" opacity="0.65" points={b} />
        ) : null}
      </svg>
      <div className="ck-spark-labels">
        <span>{labelA}</span>
        <span>{labelB}</span>
      </div>
    </div>
  );
}
