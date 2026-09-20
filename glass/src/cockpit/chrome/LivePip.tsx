export function LivePip({ on = true }: { on?: boolean }) {
  return <span className={`ck-live-pip ${on ? "is-on" : ""}`} aria-hidden="true" />;
}
