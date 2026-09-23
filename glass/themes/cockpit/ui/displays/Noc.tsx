import { useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "../chrome/Brand.js";
import { CmdBar } from "../chrome/CmdBar.js";
import { LiveDot } from "../chrome/Marks.js";
import { formatRate, pulseText, steelNum, type ConfirmPayload, type PulsePayload } from "@core";
import { RACK_IDS, rackFilter, rackRoleLabel, type RackFilter } from "../rack.js";
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
  speaking?: boolean;
  live: boolean;
  onSubmit: (text: string) => void;
  onPttStart: () => void;
  onPttStop: () => void;
  onInterrupt?: () => void;
};

function Bar({ value }: { value: number | null | undefined }) {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <span className="ck-bar">
      <span style={{ width: `${n}%` }} />
    </span>
  );
}

/** Bytes/s the nodes actually reported. Null stays null — no zero placeholder. */
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
  speaking,
  live,
  onSubmit,
  onPttStart,
  onPttStop,
  onInterrupt,
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
  const cmdInput = useRef<HTMLTextAreaElement>(null);

  const nodes = pulse?.nodes ?? [];
  const gpu01 = nodes.find((n) => n.id.trim().toLowerCase() === "gpu-01");
  const gpu02 = nodes.find((n) => n.id.trim().toLowerCase() === "gpu-02");
  const t1 = typeof gpu01?.temp_c === "number" && Number.isFinite(gpu01.temp_c) ? gpu01.temp_c : null;
  const t2 = typeof gpu02?.temp_c === "number" && Number.isFinite(gpu02.temp_c) ? gpu02.temp_c : null;

  useEffect(() => {
    if (!pulse) return;
    setSyncedAt(Date.now());
  }, [pulse]);

  // Prometheus already holds the window; the client only appends the newest read.
  const gpuHist = useMemo(() => {
    const series = pulse?.series?.gpu_temp ?? {};
    const a = series["gpu-01"] ?? [];
    const b = series["gpu-02"] ?? [];
    const len = Math.max(a.length, b.length);
    const rows: Array<{ a: number | null; b: number | null }> = [];
    for (let i = 0; i < len; i += 1) {
      rows.push({ a: a[i] ?? null, b: b[i] ?? null });
    }
    if (t1 != null || t2 != null) rows.push({ a: t1, b: t2 });
    return rows;
  }, [pulse, t1, t2]);

  const windowLabel = useMemo(() => {
    const secs = pulse?.series?.window_s;
    if (typeof secs !== "number" || !Number.isFinite(secs) || secs <= 0) return null;
    return secs >= 3600 ? `${Math.round(secs / 3600)}h` : `${Math.round(secs / 60)}m`;
  }, [pulse]);

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
  const cpuC = pulse?.env?.cpu_c;
  const fan = pulse?.env?.fan;
  const vram = pulse?.env?.vram;
  const netBps = nodes.reduce<number | null>((sum, n) => {
    const v = n.net_bps;
    if (typeof v !== "number" || !Number.isFinite(v)) return sum;
    return (sum ?? 0) + v;
  }, null);

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
        <div className="ck-panel-brand">
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
          <h3>CLUSTER</h3>
          <dl className="ck-noc-dl">
            <div>
              <dt>NODES</dt>
              <dd>{k3s ?? "—"}</dd>
            </div>
            <div>
              <dt>UPTIME</dt>
              <dd className="ck-col-tight">{pulse?.uptime?.trim() || "—"}</dd>
            </div>
            <div>
              <dt>EVENTS</dt>
              <dd>{pulse?.events?.length ?? "—"}</dd>
            </div>
            <div>
              <dt>SOURCE</dt>
              <dd>/v1/pulse</dd>
            </div>
          </dl>
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
            <TopologySvg nodes={nodes} filters={filters} selected={selected} onSelect={(id) => setSelected((prev) => (prev === id ? null : id))} />
          </div>
        </section>

        <aside className="ck-panel ck-noc-right">
          <h2>SYSTEM RINGS // LIVE</h2>
          <div className="ck-rings">
            <Ring label="CPU" value={pulse?.rings?.cpu} sub="busy" />
            <Ring label="MEM" value={pulse?.rings?.mem} sub="used" />
            <Ring label="NET" value={pulse?.rings?.net} sub={formatRate(netBps)} />
            <Ring label="IO" value={pulse?.rings?.io} sub="busy" />
          </div>
          <h2>VOICE CHANNEL // LIVE</h2>
          <Waveform active={recording} />
          <h2>GPU TEMP // LAST {windowLabel ?? "—"}</h2>
          <Spark
            history={gpuHist}
            labelA={`GPU-01 ${t1 == null ? "—" : `${steelNum(t1)}°C`}`}
            labelB={`GPU-02 ${t2 == null ? "—" : `${steelNum(t2)}°C`}`}
          />
          <div className="ck-noc-foot">
          <h2>RACK THERMALS // LIVE</h2>
          <div className="ck-env">
            <label>
              <span>CPU PKG</span>
              <Bar value={envBar(cpuC, 90)} />
              <em>{cpuC == null ? "—" : `${steelNum(cpuC, 1)}°C`}</em>
            </label>
            <label>
              <span>GPU FAN</span>
              <Bar value={fan} />
              <em>{fan == null ? "—" : `${steelNum(fan)}%`}</em>
            </label>
            <label>
              <span>VRAM</span>
              <Bar value={vram} />
              <em>{vram == null ? "—" : `${steelNum(vram)}%`}</em>
            </label>
          </div>

          <h2 className="ck-noc-sub">SERVICE PLANE</h2>
          <ul className="ck-svc">
            {(
              [
                ["TALKER", pulse?.talker],
                ["HANDS", pulse?.hands],
                ["STT", pulse?.stt],
                ["TTS", pulse?.tts],
              ] as Array<[string, boolean | null | undefined]>
            ).map(([name, ok]) => (
              <li key={name} className={ok === false ? "is-down" : ok ? "is-up" : ""}>
                <LiveDot on={ok === true} />
                <span>{name}</span>
                <em>{ok == null ? "—" : ok ? "LIVE" : "DOWN"}</em>
              </li>
            ))}
          </ul>
          </div>
        </aside>
      </div>

      <div className="ck-ticker">
        <strong>
          EVENT TICKER // TAIL -{events.length}
          {selected ? <em> · filtered {selected}</em> : null}
        </strong>
        <div className="ck-ticker-view">
          {events.length === 0 ? (
            <span className="ck-ticker-empty">no transitions observed since this orchestrator started</span>
          ) : (
            <div className="ck-ticker-line">
              {[0, 1].map((copy) =>
                events.map((e, i) => (
                  <span key={`${copy}-${e.ts}-${e.src}-${e.msg}-${i}`} className={`is-${e.level || "info"}`}>
                    <i>{(e.ts || "—").replace("T", " ").replace("Z", "")}</i>
                    <b>{e.src || "—"}</b>
                    {e.msg || "—"}
                  </span>
                )),
              )}
            </div>
          )}
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
              <th>TEMP</th>
              <th>UPTIME</th>
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
                  <td>{steelNum(n?.load, 2)}</td>
                  <td>
                    {typeof n?.temp_c === "number"
                      ? `${steelNum(n.temp_c)}°C`
                      : typeof n?.cpu_c === "number"
                        ? `${steelNum(n.cpu_c)}°C`
                        : "—"}
                  </td>
                  <td className="ck-col-dim">{n?.uptime?.trim() || "—"}</td>
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
        speaking={speaking}
        inputRef={cmdInput}
        onSubmit={onSubmit}
        onPttStart={onPttStart}
        onPttStop={onPttStop}
        onInterrupt={onInterrupt}
      />
    </div>
  );
}
