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
      <span className="ck-live-pill">
        <LivePip on={live} />
        LIVE
      </span>
    </div>
  );
}
