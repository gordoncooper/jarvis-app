export type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export const MOCK = {
  lan: "192.168.8.0/24",
  k3s: "7/7",
  uptimeBaseSec: 15 * 86400 + 6 * 3600 + 42 * 60 + 18,
  weather: "16°C, overcast",
  wind: "NW wind 8 km/h",
  lab: "VECTORLIGHT RESEARCH",
  inboxUnread: 3,
  calendarNext: "Lab sync at 09:00 · 1h 18m",
  applyPending: 0,
  gpu: [
    { id: "GPU-01", temp: 68 },
    { id: "GPU-02", temp: 60 },
  ],
  nodes: [
    { name: "ctrl-01", role: "CONTROL PLANE", ip: "10.8.0.10", cpu: 22, ram: 41, disk: 38, load: 1.2 },
    { name: "gpu-01", role: "GPU NODE", ip: "10.8.0.21", cpu: 64, ram: 71, disk: 55, load: 4.8 },
    { name: "gpu-02", role: "GPU NODE", ip: "10.8.0.22", cpu: 58, ram: 66, disk: 52, load: 3.9 },
    { name: "data-01", role: "STORAGE", ip: "10.8.0.31", cpu: 18, ram: 54, disk: 72, load: 0.9 },
    { name: "data-02", role: "STORAGE", ip: "10.8.0.32", cpu: 14, ram: 49, disk: 68, load: 0.7 },
    { name: "apps-01", role: "WORKLOAD", ip: "10.8.0.41", cpu: 36, ram: 58, disk: 44, load: 2.1 },
  ],
  rings: { cpu: 42, mem: 56, net: 18, io: 27 },
  env: { air: 22.1, hum: 41, pwr: 98 },
  events: [
    { t: "14:36:01", node: "ctrl-01", msg: "NodeReady" },
    { t: "14:35:44", node: "apps-01", msg: "Deployment jarvis-glass rolled" },
    { t: "14:34:12", node: "gpu-01", msg: "GPU temp within band" },
    { t: "14:32:58", node: "data-01", msg: "PVC resize complete" },
    { t: "14:31:03", node: "ctrl-01", msg: "cert-manager updated" },
  ],
  timeline: [
    { t: "06:58", title: "Inbound", body: "3 unread messages, 1 flagged", icon: "inbox" },
    { t: "07:10", title: "Schedule", body: "Lab sync at 09:00 · 3 agenda items", icon: "clock" },
    { t: "07:22", title: "Cluster Pulse", body: "GPU utilization 78% · queue depth 4", icon: "gear" },
    { t: "07:30", title: "Reminder", body: "Calibrate spectrograph stage 2", icon: "clock" },
    { t: "07:38", title: "MEMORY / CONTEXT", body: "4 active chips · 18.7k tokens", icon: "chip" },
  ],
};

export function formatUptime(elapsedSec: number): string {
  const total = MOCK.uptimeBaseSec + Math.floor(elapsedSec);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d}d ${p(h)}h ${p(m)}m ${p(s)}s`;
}

export function dayOfYear(d = new Date()): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}
