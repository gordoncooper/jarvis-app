import { gpuChips, type PulsePayload } from "@core";

/** Cockpit's rack model. These are this lab's machines and this theme's
 *  filter groups, so they live with the UI that draws them, not in core. */
export const RACK_IDS = ["ctrl-01", "gpu-01", "gpu-02", "data-01", "data-02", "apps-01"] as const;

export type RackFilter = "CTRL" | "GPU" | "DATA" | "APPS";

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

/** Breath shows two GPU chips in fixed slots; pad so the HUD never reflows. */
export function pulseGpuChips(pulse: PulsePayload | null): Array<{ id: string; tempC: number | null }> {
  const live = gpuChips(pulse);
  return ["GPU-01", "GPU-02"].map((id) => live.find((g) => g.id === id) ?? { id, tempC: null });
}
