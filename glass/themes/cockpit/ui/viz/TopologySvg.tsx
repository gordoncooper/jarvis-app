import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { LiveDot } from "../chrome/Marks.js";
import { formatRate, steelNum, type PulseNode } from "@core";
import { RACK_IDS, rackFilter, rackRoleLabel, type RackFilter } from "../rack.js";

type Props = {
  nodes: PulseNode[];
  filters: Record<RackFilter, boolean>;
  selected: string | null;
  onSelect: (id: string) => void;
};

type Box = { x: number; y: number; w: number; h: number };
type Trace = { d: string; id: string };

function findNode(nodes: PulseNode[], id: string): PulseNode | undefined {
  const key = id.toLowerCase();
  return nodes.find((n) => n.id.trim().toLowerCase() === key);
}

/** Ortho bus: every tile drops a stub onto one spine running between the rows. */
function buildTraces(boxes: Array<Box | null>, frame: Box): { traces: Trace[]; joints: Array<[number, number]> } {
  const live = boxes.filter((b): b is Box => b != null);
  if (live.length < 2) return { traces: [], joints: [] };

  const top = boxes.slice(0, 3);
  const bottom = boxes.slice(3, 6);
  const spineY = Math.round(frame.h / 2);
  const traces: Trace[] = [];
  const joints: Array<[number, number]> = [];

  const xs: number[] = [];
  top.forEach((b, i) => {
    if (!b) return;
    const cx = Math.round(b.x + b.w / 2);
    xs.push(cx);
    traces.push({ id: `t${i}`, d: `M${cx} ${Math.round(b.y + b.h)} V${spineY}` });
    joints.push([cx, spineY]);
  });
  bottom.forEach((b, i) => {
    if (!b) return;
    const cx = Math.round(b.x + b.w / 2);
    xs.push(cx);
    traces.push({ id: `b${i}`, d: `M${cx} ${spineY} V${Math.round(b.y)}` });
    joints.push([cx, spineY]);
  });

  if (xs.length) {
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    if (x1 > x0) traces.push({ id: "spine", d: `M${x0} ${spineY} H${x1}` });
  }

  // Perimeter rail: the ortho frame the reference draws around the whole rack.
  const inset = 6;
  traces.push({
    id: "rail",
    d: `M${inset} ${inset} H${Math.round(frame.w - inset)} V${Math.round(frame.h - inset)} H${inset} Z`,
  });

  // Side taps from the outer tiles out to the rail, so the frame reads as a bus.
  // Only the true edge columns tap out; a filtered-away neighbour must not leave
  // a trace running across the empty half of the field.
  for (const row of [top, bottom]) {
    const first = row[0];
    const last = row[2];
    if (first) {
      const cy = Math.round(first.y + first.h / 2);
      traces.push({ id: `l${cy}`, d: `M${inset} ${cy} H${Math.round(first.x)}` });
    }
    if (last) {
      const cy = Math.round(last.y + last.h / 2);
      traces.push({ id: `r${cy}`, d: `M${Math.round(last.x + last.w)} ${cy} H${Math.round(frame.w - inset)}` });
    }
  }

  return { traces, joints };
}

function Meter({ label, value, suffix = "%" }: { label: string; value: number | null | undefined; suffix?: string }) {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
  return (
    <label className="ck-node-meter">
      <span className="ck-node-meter-k">{label}</span>
      <span className="ck-bar">
        <span style={{ width: `${n ?? 0}%` }} />
      </span>
      <span className="ck-node-meter-v">{n == null ? "—" : `${steelNum(n)}${suffix}`}</span>
    </label>
  );
}

export function TopologySvg({ nodes, filters, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [geometry, setGeometry] = useState<{ traces: Trace[]; joints: Array<[number, number]>; frame: Box } | null>(
    null,
  );

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const base = wrap.getBoundingClientRect();
    if (base.width < 2 || base.height < 2) return;
    const boxes = RACK_IDS.map((id, i) => {
      if (!filters[rackFilter(id)]) return null;
      const el = tileRefs.current[i];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x - base.x, y: r.y - base.y, w: r.width, h: r.height };
    });
    const frame = { x: 0, y: 0, w: base.width, h: base.height };
    const { traces, joints } = buildTraces(boxes, frame);
    setGeometry({ traces, joints, frame });
  }, [filters]);

  useLayoutEffect(() => {
    measure();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [measure]);

  const frame = geometry?.frame;

  return (
    <div className="ck-topo-svg-wrap" ref={wrapRef}>
      <svg
        className="ck-topo-traces"
        viewBox={frame ? `0 0 ${frame.w} ${frame.h}` : "0 0 100 100"}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {geometry?.traces.map((t) => (
          <path key={t.id} d={t.d} className={t.id === "rail" ? "ck-trace-rail" : "ck-trace"} />
        ))}
        {geometry?.joints.map(([x, y], i) => (
          <circle key={`j${i}`} cx={x} cy={y} r={2.4} className="ck-trace-joint" />
        ))}
      </svg>
      <div className="ck-topo-grid">
        {RACK_IDS.map((id, i) => {
          const n = findNode(nodes, id);
          if (!filters[rackFilter(id)]) {
            return <div key={id} className="ck-node is-off" ref={() => (tileRefs.current[i] = null)} />;
          }
          const live = n?.ready !== false && !!n;
          const temp = typeof n?.temp_c === "number" ? n.temp_c : null;
          return (
            <button
              key={id}
              type="button"
              ref={(el) => {
                tileRefs.current[i] = el;
              }}
              className={`ck-node ${selected === id ? "is-selected" : ""} ${n ? "" : "is-empty"}`}
              onClick={() => onSelect(id)}
            >
              <LiveDot on={live} />
              <header>
                <strong>{id}</strong>
                <span>{rackRoleLabel(n?.role, id)}</span>
              </header>
              <p className="ck-node-ip">{n?.ip?.trim() || "—"}</p>
              <div className="ck-node-meters">
                <Meter label="CPU" value={n?.cpu} />
                <Meter label="RAM" value={n?.ram} />
                <Meter label="DSK" value={n?.disk} />
              </div>
              <div className="ck-node-extra">
                <span>NET {formatRate(n?.net_bps)}</span>
                <span>{n?.uptime?.trim() || "—"}</span>
              </div>
              <footer className="ck-node-foot">
                <span>LOAD {steelNum(n?.load, 2)}</span>
                <span>{temp == null ? `CPU ${steelNum(n?.cpu_c)}°C` : `GPU ${steelNum(temp)}°C`}</span>
              </footer>
            </button>
          );
        })}
      </div>
    </div>
  );
}
