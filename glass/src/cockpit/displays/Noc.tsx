import { useEffect, useState } from "react";
import { CmdBar } from "../chrome/CmdBar.js";
import { HexMark, LiveDot } from "../chrome/Marks.js";
import { MOCK } from "../mock.js";

type Props = {
  busy: boolean;
  recording: boolean;
  sttOk: boolean;
  live: boolean;
  onSubmit: (text: string) => void;
  onPttStart: () => void;
  onPttStop: () => void;
};

function Bar({ value }: { value: number }) {
  return (
    <span className="ck-bar">
      <span style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  );
}

function Ring({ label, value }: { label: string; value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const dash = `${(value / 100) * c * 0.85} ${c}`;
  return (
    <div className="ck-ring">
      <svg viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} className="ck-ring-track" />
        <circle
          cx="36"
          cy="36"
          r={r}
          className="ck-ring-fill"
          strokeDasharray={dash}
          transform="rotate(-90 36 36)"
        />
      </svg>
      <div className="ck-ring-lab">
        <strong>{label}</strong>
        <span>{value}%</span>
      </div>
    </div>
  );
}

function Waveform({ active }: { active: boolean }) {
  const bars = Array.from({ length: 48 }, (_, i) => {
    const mid = Math.abs(i - 24) / 24;
    const h = active
      ? 18 + Math.sin(i * 0.55) * 14 * (1 - mid * 0.4)
      : 4 + Math.sin(i * 0.4) * 2;
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

export function Noc({ busy, recording, sttOk, live, onSubmit, onPttStart, onPttStop }: Props) {
  const [utc, setUtc] = useState("");
  const [filters, setFilters] = useState({ CTRL: true, GPU: true, DATA: true, APPS: true });
  const [syncMs, setSyncMs] = useState(1.342);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setUtc(
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`,
      );
      setSyncMs(1 + Math.random() * 0.8);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const visible = MOCK.nodes.filter((n) => {
    if (n.role.includes("CONTROL") && !filters.CTRL) return false;
    if (n.role.includes("GPU") && !filters.GPU) return false;
    if (n.role.includes("STORAGE") && !filters.DATA) return false;
    if (n.role.includes("WORKLOAD") && !filters.APPS) return false;
    return true;
  });

  return (
    <div className="ck-noc">
      <header className="ck-noc-top">
        <div className="ck-stage-brand">
          <HexMark size={18} variant="dot" />
          <span className="ck-brand">JARVIS</span>
          <span className="ck-live-pill">
            <LiveDot on={live} /> LIVE
          </span>
          <span className="ck-noc-meta">
            LAN {MOCK.lan}
            <span className="ck-pipe" />
            k3s {MOCK.k3s}
          </span>
        </div>
        <span className="ck-noc-utc">UTC {utc}</span>
        <div className="ck-noc-actions">
          <button type="button">APPLY ▾</button>
          <button type="button">PULSE ▾</button>
          <button type="button">STATUS ▾</button>
        </div>
      </header>

      <div className="ck-noc-grid">
        <aside className="ck-panel ck-noc-left">
          <h2>DOSSIER // TRACK MODE</h2>
          <dl className="ck-noc-dl">
            <div>
              <dt>HOS</dt>
              <dd>STANDBY</dd>
            </div>
            <div>
              <dt>LOCK</dt>
              <dd className="is-accent">ENGAGED</dd>
            </div>
            <div>
              <dt>MODE</dt>
              <dd>TRACK</dd>
            </div>
            <div>
              <dt>SCOPE</dt>
              <dd>CLUSTER</dd>
            </div>
            <div>
              <dt>DEPTH</dt>
              <dd>INFRA</dd>
            </div>
          </dl>
          <h3>FILTERS</h3>
          <div className="ck-filters">
            {(Object.keys(filters) as Array<keyof typeof filters>).map((k) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={filters[k]}
                  onChange={() => setFilters((f) => ({ ...f, [k]: !f[k] }))}
                />
                <span className="ck-check" />
                {k}
              </label>
            ))}
          </div>
          <p className="ck-sync">
            LAST SYNC 00:00:0{syncMs.toFixed(3).slice(0, 5)} <LiveDot on />
          </p>
        </aside>

        <section className="ck-panel ck-topo">
          <header>
            <h2>CLUSTER TOPOLOGY // ORTHO RACK VIEW</h2>
            <span>6 NODES · 3U LOGICAL</span>
          </header>
          <div className="ck-topo-wrap">
            <svg className="ck-topo-links" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d="M18 28 H50 H82" />
              <path d="M18 72 H50 H82" />
              <path d="M18 28 V72" />
              <path d="M50 28 V72" />
              <path d="M82 28 V72" />
              <path d="M18 28 L50 72 L82 28" />
              <circle cx="18" cy="28" r="1.2" />
              <circle cx="50" cy="28" r="1.2" />
              <circle cx="82" cy="28" r="1.2" />
              <circle cx="18" cy="72" r="1.2" />
              <circle cx="50" cy="72" r="1.2" />
              <circle cx="82" cy="72" r="1.2" />
            </svg>
            <div className="ck-topo-grid">
              {visible.map((n) => (
                <article key={n.name} className="ck-node">
                  <LiveDot on />
                  <header>
                    <strong>{n.name}</strong>
                    <span>{n.role}</span>
                  </header>
                  <p className="ck-node-ip">{n.ip}</p>
                  <div className="ck-node-meters">
                    <label>
                      CPU {n.cpu}% <Bar value={n.cpu} />
                    </label>
                    <label>
                      RAM {n.ram}% <Bar value={n.ram} />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <aside className="ck-panel ck-noc-right">
          <h2>SYSTEM RINGS // LIVE</h2>
          <div className="ck-rings">
            <Ring label="CPU" value={MOCK.rings.cpu} />
            <Ring label="MEM" value={MOCK.rings.mem} />
            <Ring label="NET" value={MOCK.rings.net} />
            <Ring label="IO" value={MOCK.rings.io} />
          </div>
          <h2>VOICE CHANNEL // LIVE</h2>
          <Waveform active={recording} />
          <h2>GPU TEMP // LIVE</h2>
          <div className="ck-spark">
            <svg viewBox="0 0 200 48" preserveAspectRatio="none">
              <polyline
                fill="none"
                stroke="var(--ck-accent)"
                strokeWidth="1.6"
                points="0,30 18,26 36,32 54,18 72,24 90,12 108,20 126,14 144,22 162,10 180,16 200,12"
              />
              <polyline
                fill="none"
                stroke="#5eead4"
                strokeWidth="1.3"
                opacity="0.65"
                points="0,34 18,32 36,36 54,28 72,30 90,24 108,28 126,22 144,26 162,20 180,24 200,22"
              />
            </svg>
            <div className="ck-spark-labels">
              <span>GPU-01 61°C</span>
              <span>GPU-02 58°C</span>
            </div>
          </div>
          <h2>ENVIRONMENT</h2>
          <div className="ck-env">
            <label>
              <span>AIR {MOCK.env.air}°C</span> <Bar value={55} />
            </label>
            <label>
              <span>HUM {MOCK.env.hum}%</span> <Bar value={MOCK.env.hum} />
            </label>
            <label>
              <span>PWR {MOCK.env.pwr}%</span> <Bar value={MOCK.env.pwr} />
            </label>
          </div>
        </aside>
      </div>

      <div className="ck-ticker">
        <strong>EVENT TICKER // TAIL -20</strong>
        <div className="ck-ticker-line">
          {MOCK.events.map((e) => (
            <span key={`${e.t}-${e.msg}`}>
              {e.t} · {e.node} · {e.msg}
            </span>
          ))}
        </div>
        <span className="ck-ticker-arrow">▾</span>
      </div>

      <section className="ck-panel ck-metrics">
        <h2>NODE METRICS // LIVE</h2>
        <table>
          <thead>
            <tr>
              <th>NODE</th>
              <th>ROLE</th>
              <th>IP</th>
              <th>CPU</th>
              <th>RAM</th>
              <th>DISK</th>
              <th>LOAD</th>
            </tr>
          </thead>
          <tbody>
            {MOCK.nodes.map((n) => (
              <tr key={n.name}>
                <td className="is-accent">{n.name}</td>
                <td>{n.role}</td>
                <td>{n.ip}</td>
                <td>
                  <Bar value={n.cpu} /> {n.cpu}%
                </td>
                <td>
                  <Bar value={n.ram} /> {n.ram}%
                </td>
                <td>
                  <Bar value={n.disk} /> {n.disk}%
                </td>
                <td>{n.load.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <CmdBar
        variant="noc"
        prompt="> cmd"
        placeholder="Speak freely."
        busy={busy}
        recording={recording}
        sttOk={sttOk}
        onSubmit={onSubmit}
        onPttStart={onPttStart}
        onPttStop={onPttStop}
      />
    </div>
  );
}
