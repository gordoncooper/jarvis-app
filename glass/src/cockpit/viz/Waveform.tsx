export function Waveform({ active }: { active: boolean }) {
  const bars = Array.from({ length: 48 }, (_, i) => {
    const mid = Math.abs(i - 24) / 24;
    const h = active ? 18 + Math.sin(i * 0.55) * 14 * (1 - mid * 0.4) : 4 + Math.sin(i * 0.4) * 2;
    return h;
  });
  return (
    <div className={`ck-wave-panel ${active ? "is-on" : ""}`}>
      <svg viewBox="0 0 200 40" preserveAspectRatio="none">
        {bars.map((h, i) => {
          const x = i * (200 / bars.length);
          const y = 20 - h / 2;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width="2.2"
              height={h}
              rx="1"
              fill="currentColor"
              opacity={0.35 + (h / 40) * 0.65}
            />
          );
        })}
      </svg>
    </div>
  );
}
