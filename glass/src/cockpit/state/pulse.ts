import type { PulsePayload } from "../../api.js";

export type { PulsePayload };

export type EarthToast = {
  user: string;
  asst: string;
};

const GPU_IDS = ["gpu-01", "gpu-02"] as const;

export const RACK_IDS = ["ctrl-01", "gpu-01", "gpu-02", "data-01", "data-02", "apps-01"] as const;

export type RackFilter = "CTRL" | "GPU" | "DATA" | "APPS";

export function pulseText(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

export function pulseGpuChips(pulse: PulsePayload | null): Array<{ id: string; tempC: number | null }> {
  const nodes = pulse?.nodes ?? [];
  return GPU_IDS.map((id) => {
    const node = nodes.find((n) => n.id.trim().toLowerCase() === id);
    const temp = node?.temp_c;
    return {
      id: id.toUpperCase(),
      tempC: typeof temp === "number" && Number.isFinite(temp) ? temp : null,
    };
  });
}

export function rackFilter(id: string): RackFilter {
  const p = id.trim().toLowerCase().split("-")[0] ?? "";
  if (p === "ctrl") return "CTRL";
  if (p === "gpu") return "GPU";
  if (p === "data") return "DATA";
  return "APPS";
}

export function rackRoleLabel(role: string | null | undefined, id: string): string {
  if (role && role.trim()) return role.trim().replace(/-/g, " ").toUpperCase();
  const f = rackFilter(id);
  if (f === "CTRL") return "CONTROL PLANE";
  if (f === "GPU") return "GPU NODE";
  if (f === "DATA") return "STORAGE";
  return "WORKLOAD";
}

export function steelNum(value: number | null | undefined, digits = 0): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return digits > 0 ? value.toFixed(digits) : String(Math.round(value));
}
