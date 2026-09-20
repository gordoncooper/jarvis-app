import { Pip } from "./Pip.js";

type Tick = { id: string; label: string; live: boolean };

type Props = {
  greeting: string;
  live: boolean;
  alert: boolean;
  ticks: Tick[];
};

export function Ribbon({ greeting, live, alert, ticks }: Props) {
  return (
    <header className="hud-ribbon">
      <h1 className="brand">JARVIS</h1>
      <Pip live={live} alert={alert} />
      <p className="greeting">{greeting}</p>
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
