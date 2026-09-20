import type { PulseNode } from "../../api.js";
import { LiveDot } from "../chrome/Marks.js";
import { RACK_IDS, rackFilter, rackRoleLabel, steelNum, type RackFilter } from "../state/pulse.js";

type Props = {
  nodes: PulseNode[];
  filters: Record<RackFilter, boolean>;
  selected: string | null;
  onSelect: (id: string) => void;
};

function findNode(nodes: PulseNode[], id: string): PulseNode | undefined {
  const key = id.toLowerCase();
  return nodes.find((n) => n.id.trim().toLowerCase() === key);
}

export function TopologySvg({ nodes, filters, selected, onSelect }: Props) {
  return (
    <div className="ck-topo-svg-wrap">
      <svg className="ck-topo-traces" viewBox="0 0 90 60" preserveAspectRatio="none" aria-hidden="true">
        <path
          d="M0.4 0.4 H89.6 V59.6 H0.4 Z"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="0.35"
          opacity="0.4"
        />
      </svg>
      <div className="ck-topo-grid">
        {RACK_IDS.map((id) => {
          const n = findNode(nodes, id);
          const group = rackFilter(id);
          if (!filters[group]) return <div key={id} className="ck-node is-off" />;
          const cpu = n?.cpu;
          const ram = n?.ram;
          const live = n?.ready !== false && !!n;
          return (
            <button
              key={id}
              type="button"
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
                <label>
                  CPU {steelNum(cpu)}%
                  <span className="ck-bar">
                    <span style={{ width: typeof cpu === "number" ? `${Math.min(100, cpu)}%` : "0%" }} />
                  </span>
                </label>
                <label>
                  RAM {steelNum(ram)}%
                  <span className="ck-bar">
                    <span style={{ width: typeof ram === "number" ? `${Math.min(100, ram)}%` : "0%" }} />
                  </span>
                </label>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
