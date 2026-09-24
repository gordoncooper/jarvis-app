import { useEffect, useState } from "react";
import type { PulsePayload } from "@core";
import { useHereWeather } from "./hereWeather.js";
import { statusFacts } from "./statusFacts.js";

/** The six header facts, same order and same readings on every room. */
export function StatusStrip({ pulse }: { pulse: PulsePayload | null }) {
  const [now, setNow] = useState(() => new Date());
  const here = useHereWeather();
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const shown = here ? { ...pulse, weather: here } : pulse;
  const facts = statusFacts(shown, now);
  return (
    <div className="ck-status" role="status">
      {facts.map((f, i) => {
        const empty = f.value === "—";
        const title = empty ? undefined : f.href ? `${f.value} — open the forecast` : f.value;
        return (
          <div className="ck-status-slot" key={f.id}>
            {i > 0 ? <span className="ck-pipe" aria-hidden="true" /> : null}
            <div className="ck-status-tile">
              <span className="ck-status-k">{f.label}</span>
              {f.href && !empty ? (
                <a
                  className="ck-status-v"
                  href={f.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={title}
                >
                  {f.value}
                </a>
              ) : (
                <span className={`ck-status-v${empty ? " is-empty" : ""}`} title={title}>
                  {f.value}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
