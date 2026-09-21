import { LivePip } from "./LivePip.js";
import { HexMark } from "./Marks.js";

type Props = {
  live?: boolean;
  size?: number;
};

export function Brand({ live = true, size = 20 }: Props) {
  return (
    <div className="ck-brand-lockup">
      <HexMark size={size} />
      <span className="ck-brand">JARVIS</span>
      {/* A grey pip beside the word LIVE reads as live. Say what is true. */}
      <span className={`ck-live-pill ${live ? "" : "is-down"}`}>
        <LivePip on={live} />
        {live ? "LIVE" : "OFFLINE"}
      </span>
    </div>
  );
}
