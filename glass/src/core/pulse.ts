import type { PulsePayload } from "./api.js";

/** Generic pulse formatting. Anything that names *this* rack's nodes belongs to
 *  a theme, not here — core must not decide that a cluster has six machines. */

export function pulseText(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

/** "—" for anything that is not a finite reading, so a theme cannot print 0
 *  where the orchestrator reported nothing. */
export function steelNum(value: number | null | undefined, digits = 0): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return digits > 0 ? value.toFixed(digits) : String(Math.round(value));
}

export function findNode(pulse: PulsePayload | null, id: string) {
  const key = id.trim().toLowerCase();
  return (pulse?.nodes ?? []).find((n) => n.id.trim().toLowerCase() === key);
}

/** GPU nodes as the pulse actually reports them — derived, not a fixed list. */
export function gpuChips(pulse: PulsePayload | null): Array<{ id: string; tempC: number | null }> {
  return (pulse?.nodes ?? [])
    .filter((n) => typeof n.temp_c === "number" && Number.isFinite(n.temp_c))
    .map((n) => ({ id: n.id.toUpperCase(), tempC: n.temp_c as number }));
}

export function formatRate(bps: number | null | undefined): string {
  if (typeof bps !== "number" || !Number.isFinite(bps)) return "—";
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)} GB/s`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} kB/s`;
  return `${Math.round(bps)} B/s`;
}

export function formatBytes(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  for (const [unit, scale] of [["TB", 1e12], ["GB", 1e9], ["MB", 1e6], ["kB", 1e3]] as const) {
    if (n >= scale) return `${(n / scale).toFixed(1)} ${unit}`;
  }
  return `${Math.round(n)} B`;
}
