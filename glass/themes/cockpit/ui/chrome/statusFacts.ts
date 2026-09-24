export type StatusFact = {
  id: "weather" | "date" | "local" | "utc" | "lan" | "k3s";
  label: string;
  value: string;
};

/** The pulse fields this strip reads. A full pulse object is fine. */
export type StatusPulse = {
  lan?: string | null;
  k3s?: string | null;
  weather?: { temp_c?: number | null; text?: string | null } | null;
} | null;

const EMPTY = "—";

function shown(value: string | null | undefined): string {
  const t = value?.trim();
  return t ? t : EMPTY;
}

/** The header facts, in the order every room shows them. Local and UTC come
 *  from the browser clock. Weather, LAN, and k3s come from the pulse, and
 *  stay empty when the pulse has no reading. */
export function statusFacts(pulse: StatusPulse, now: Date): StatusFact[] {
  return [
    { id: "weather", label: "WEATHER", value: weatherLine(pulse) },
    { id: "date", label: "DATE", value: dateLine(now) },
    { id: "local", label: "LOCAL", value: clock(now, false) },
    { id: "utc", label: "UTC", value: clock(now, true) },
    { id: "lan", label: "LAN", value: shown(pulse?.lan) },
    { id: "k3s", label: "K3S", value: shown(pulse?.k3s) },
  ];
}

function clock(now: Date, utc: boolean): string {
  return now.toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: utc ? "UTC" : undefined,
  });
}

function dateLine(now: Date): string {
  return now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function weatherLine(pulse: StatusPulse): string {
  const w = pulse?.weather;
  if (!w || typeof w.temp_c !== "number" || !Number.isFinite(w.temp_c)) return EMPTY;
  const text = w.text?.trim();
  return text ? `${Math.round(w.temp_c)}°C, ${text}` : `${Math.round(w.temp_c)}°C`;
}
