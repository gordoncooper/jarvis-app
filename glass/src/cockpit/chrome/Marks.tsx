export function HexMark({ size = 18 }: { size?: number }) {
  return (
    <svg className="ck-hex" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <polygon
        points="16,2 28,9 28,23 16,30 4,23 4,9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M11 10h6c2.2 0 4 1.6 4 3.6S19.2 17 17 17h-3v5h-3V10zm3 4.5h2.6c.8 0 1.4-.5 1.4-1.2s-.6-1.2-1.4-1.2H14v2.4z"
        fill="currentColor"
      />
    </svg>
  );
}

export function LiveDot({ on = true }: { on?: boolean }) {
  return <span className={`ck-live-dot ${on ? "is-on" : ""}`} aria-hidden="true" />;
}

export function ConcRing({ on = true }: { on?: boolean }) {
  return (
    <span className={`ck-conc ${on ? "is-on" : ""}`} aria-hidden="true">
      <span />
    </span>
  );
}
