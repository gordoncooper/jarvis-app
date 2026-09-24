import { useEffect, useState } from "react";
import type { PulsePayload } from "@core";
import { statusFacts } from "./statusFacts.js";

/** The six header facts, same order and same readings on every room. */
export function StatusStrip({ pulse }: { pulse: PulsePayload | null }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const facts = statusFacts(pulse, now);
  return (
    <div className="ck-status" role="status">
      {facts.map((f, i) => (
        <div className="ck-status-slot" key={f.id}>
          {i > 0 ? <span className="ck-pipe" aria-hidden="true" /> : null}
          <div className="ck-status-tile">
            <span className="ck-status-k">{f.label}</span>
            <span className={`ck-status-v${f.value === "—" ? " is-empty" : ""}`} title={f.value === "—" ? undefined : f.value}>
              {f.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
