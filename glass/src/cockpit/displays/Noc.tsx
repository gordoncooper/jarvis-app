import { useEffect, useMemo, useRef, useState } from "react";
import type { ConfirmPayload, PulsePayload } from "../../api.js";
import { Brand } from "../chrome/Brand.js";
import { CmdBar } from "../chrome/CmdBar.js";
import { LiveDot } from "../chrome/Marks.js";
import { RACK_IDS, pulseText, rackFilter, rackRoleLabel, steelNum, type RackFilter } from "../state/pulse.js";
import { Ring } from "../viz/Rings.js";
import { Spark } from "../viz/Spark.js";
import { TopologySvg } from "../viz/TopologySvg.js";
import { Waveform } from "../viz/Waveform.js";

type Props = {
  pulse: PulsePayload | null;
  confirm: ConfirmPayload | null;
  busy: boolean;
  recording: boolean;
  sttOk: boolean;
  live: boolean;
  onSubmit: (text: string) => void;
  onPttStart: () => void;
  onPttStop: () => void;
};

function Bar({ value }: { value: number | null | undefined }) {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <span className="ck-bar">
      <span style={{ width: `${n}%` }} />
    </span>
  );
}

function envBar(value: number | null | undefined, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export function Noc({
  pulse,
  confirm,
  busy,
  recording,
  sttOk,
  live,
  onSubmit,
  onPttStart,
  onPttStop,
}: Props) {
  const [filters, setFilters] = useState<Record<RackFilter, boolean>>({
    CTRL: true,
    GPU: true,
    DATA: true,
    APPS: true,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [gpuHist, setGpuHist] = useState<Array<{ a: number | null; b: number | null }>>([]);
  const cmdInput = useRef<HTMLInputElement>(null);

  const nodes = pulse?.nodes ?? [];
  const gpu01 = nodes.find((n) => n.id.trim().toLowerCase() === "gpu-01");
  const gpu02 = nodes.find((n) => n.id.trim().toLowerCase() === "gpu-02");
  const t1 = typeof gpu01?.temp_c === "number" && Number.isFinite(gpu01.temp_c) ? gpu01.temp_c : null;
  const t2 = typeof gpu02?.temp_c === "number" && Number.isFinite(gpu02.temp_c) ? gpu02.temp_c : null;

  useEffect(() => {
    if (!pulse) return;
    setSyncedAt(Date.now());
    if (t1 == null && t2 == null) return;
    setGpuHist((prev) => [...prev, { a: t1, b: t2 }].slice(-24));
  }, [pulse, t1, t2]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const events = useMemo(() => {
    const rows = pulse?.events ?? [];
    if (!selected) return rows;
    return rows.filter((e) => (e.src || "").toLowerCase() === selected.toLowerCase());
  }, [pulse, selected]);

  const tableIds = RACK_IDS.filter((id) => filters[rackFilter(id)]);
  const lan = pulseText(pulse?.lan);
  const k3s = pulseText(pulse?.k3s);
  const utc = pulseText(pulse?.utc);
  const syncAge = syncedAt == null ? "—" : Math.max(0, (now - syncedAt) / 1000).toFixed(3);
  const air = pulse?.env?.air_c;
  const hum = pulse?.env?.hum;
  const pwr = pulse?.env?.pwr;

  function onApply() {
    if (confirm) {
      onSubmit("yes");
      return;
    }
    cmdInput.current?.focus();
  }

  return (
    <div className="ck-noc">
      <header className="ck-noc-top">
        <div className="ck-stage-brand">
          <Brand live={live} size={18} />
          <span className="ck-noc-meta">
            LAN {lan ?? "—"}
            <span className="ck-pipe" />
            k3s {k3s ?? "—"}
          </span>
        </div>
        <span className="ck-noc-utc">UTC {utc ?? "—"}</span>
        <div className="ck-noc-actions">
          <button type="button" onClick={onApply}>
            APPLY
          </button>
          <button type="button" onClick={() => onSubmit("pulse")}>
            PULSE
          </button>
          <button type="button" onClick={() => onSubmit("status cluster")}>
            STATUS
          </button>
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
            {(Object.keys(filters) as RackFilter[]).map((k) => (
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
            LAST SYNC {syncAge}s <LiveDot on={pulse != null} />
          </p>
        </aside>

        <section className="ck-panel ck-topo">
          <header>
            <h2>CLUSTER TOPOLOGY // ORTHO RACK VIEW</h2>
            <span>{nodes.length ? `${nodes.length} NODES` : "6 NODES"} · 3U LOGICAL</span>
          </header>
          <div className="ck-topo-wrap">
            <TopologySvg nodes={nodes} filters={filters} selected={selected} onSelect={setSelected} />
          </div>
        </section>

        <aside className="ck-panel ck-noc-right">
          <h2>SYSTEM RINGS // LIVE</h2>
          <div className="ck-rings">
            <Ring label="CPU" value={pulse?.rings?.cpu} />
            <Ring label="MEM" value={pulse?.rings?.mem} />
            <Ring label="NET" value={pulse?.rings?.net} />
            <Ring label="IO" value={pulse?.rings?.io} />
          </div>
          <h2>VOICE CHANNEL // LIVE</h2>
          <Waveform active={recording} />
          <h2>GPU TEMP // LIVE</h2>
          <Spark
            history={gpuHist}
            labelA={`GPU-01 ${t1 == null ? "—" : `${steelNum(t1)}°C`}`}
            labelB={`GPU-02 ${t2 == null ? "—" : `${steelNum(t2)}°C`}`}
          />
          <h2>ENVIRONMENT</h2>
          <div className="ck-env">
            <label>
              <span>AIR {air == null ? "—" : `${steelNum(air, 1)}°C`}</span>
              <Bar value={envBar(air, 40)} />
            </label>
            <label>
              <span>HUM {hum == null ? "—" : `${steelNum(hum)}%`}</span>
              <Bar value={hum} />
            </label>
            <label>
              <span>PWR {pwr == null ? "—" : `${steelNum(pwr)}%`}</span>
              <Bar value={pwr} />
            </label>
          </div>
        </aside>
      </div>

      <div className="ck-ticker">
        <strong>EVENT TICKER // TAIL -20</strong>
        <div className="ck-ticker-line">
          {events.length === 0 ? <span>no events</span> : null}
          {events.map((e, i) => (
            <span key={`${e.ts}-${e.src}-${e.msg}-${i}`}>
              {(e.ts || "—").replace("T", " ").replace("Z", "")} · {e.src || "—"} · {e.msg || "—"}
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
            {tableIds.map((id) => {
              const n = nodes.find((row) => row.id.trim().toLowerCase() === id);
              return (
                <tr key={id}>
                  <td className="is-accent">{id}</td>
                  <td>{rackRoleLabel(n?.role, id)}</td>
                  <td>{n?.ip?.trim() || "—"}</td>
                  <td>
                    <Bar value={n?.cpu} /> {steelNum(n?.cpu)}%
                  </td>
                  <td>
                    <Bar value={n?.ram} /> {steelNum(n?.ram)}%
                  </td>
                  <td>
                    <Bar value={n?.disk} /> {steelNum(n?.disk)}%
                  </td>
                  <td>{steelNum(n?.load, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <CmdBar
        variant="stage"
        prompt="> cmd"
        placeholder="Speak freely."
        busy={busy}
        recording={recording}
        sttOk={sttOk}
        inputRef={cmdInput}
        onSubmit={onSubmit}
        onPttStart={onPttStart}
        onPttStop={onPttStop}
      />
    </div>
  );
}
