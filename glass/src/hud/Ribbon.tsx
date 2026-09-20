import { useEffect, useRef } from "react";
import { Pip } from "./Pip.js";

type Tick = { id: string; label: string; live: boolean };

type Props = {
  greeting: string;
  live: boolean;
  alert: boolean;
  ticks: Tick[];
};

function Clock() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tick = () => {
      if (ref.current) ref.current.textContent = `${new Date().toISOString().slice(11, 19)}Z`;
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="hud-clock" ref={ref} />;
}

export function Ribbon({ greeting, live, alert, ticks }: Props) {
  return (
    <header className="hud-ribbon">
      <h1 className="brand">JARVIS</h1>
      <Pip live={live} alert={alert} />
      <p className="greeting">{greeting}</p>
      <Clock />
      <div className="hud-ticks">
        {ticks.map((t) => (
          <span key={t.id} className={`hud-tick ${t.live ? "is-live" : ""}`}>
            {t.label}
          </span>
        ))}
      </div>
    </header>
  );
}
