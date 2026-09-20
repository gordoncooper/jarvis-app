import type { SessionBriefing } from "./cockpit/state/session.js";

export type SessionPayload = {
  session_id: string;
  messages: Array<{ role: string; content: string }>;
  greeting: string;
  briefing_blurb: string;
  briefing?: SessionBriefing | Record<string, unknown>;
  confirm?: ConfirmPayload;
};

export type HealthPayload = {
  ok: boolean;
  degraded?: boolean;
  reason?: string | null;
  llm?: boolean;
  stt?: boolean;
  tts?: boolean;
  hands?: boolean;
  memory_facts?: number;
};

const jsonHeaders = { Accept: "application/json" };

export async function fetchHealth(): Promise<HealthPayload> {
  const r = await fetch("/health", { headers: jsonHeaders });
  if (!r.ok) throw new Error(`health ${r.status}`);
  return r.json() as Promise<HealthPayload>;
}

export type PulseNode = {
  id: string;
  role?: string | null;
  ip?: string | null;
  cpu?: number | null;
  ram?: number | null;
  disk?: number | null;
  load?: number | null;
  temp_c?: number | null;
  ready?: boolean | null;
};

export type PulseRings = {
  cpu?: number | null;
  mem?: number | null;
  net?: number | null;
  io?: number | null;
};

export type PulseEnv = {
  air_c?: number | null;
  hum?: number | null;
  pwr?: number | null;
};

export type PulseEvent = {
  ts?: string | null;
  src?: string | null;
  msg?: string | null;
};

export type PulsePayload = {
  lan?: string | null;
  k3s?: string | null;
  utc?: string | null;
  uptime?: string | null;
  nodes?: PulseNode[] | null;
  rings?: PulseRings | null;
  env?: PulseEnv | null;
  events?: PulseEvent[] | null;
  talker?: boolean | null;
  hands?: boolean | null;
  stt?: boolean | null;
  tts?: boolean | null;
};

/** Missing route or transport → null. Never synthesize cluster numbers. */
export async function fetchPulse(): Promise<PulsePayload | null> {
  try {
    const r = await fetch("/v1/pulse", { headers: jsonHeaders });
    if (!r.ok) return null;
    return (await r.json()) as PulsePayload;
  } catch {
    return null;
  }
}

export async function fetchSession(sessionId: string | null): Promise<SessionPayload> {
  const headers: Record<string, string> = { ...jsonHeaders };
  if (sessionId) headers["X-Session-Id"] = sessionId;
  const r = await fetch("/v1/session", { headers });
  if (!r.ok) throw new Error(`session ${r.status}`);
  return r.json() as Promise<SessionPayload>;
}

export type ConfirmPayload = {
  id: string;
  kind?: "hands" | "memory";
  verb?: string;
  args?: Record<string, string>;
  summary?: string;
  fact?: string;
};

export type TurnHandlers = {
  onMeta?: (sessionId: string, transcript?: string) => void;
  onToken?: (text: string) => void;
  onDone?: (
    reply: string,
    transcript?: string,
    confirm?: ConfirmPayload | null,
  ) => void;
  onError?: (message: string) => void;
};

async function consumeSse(r: Response, handlers: TurnHandlers): Promise<void> {
  if (!r.ok || !r.body) {
    handlers.onError?.(`turn ${r.status}`);
    return;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let reply = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const block of parts) {
      const lines = block.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event === "meta" && typeof obj.session_id === "string") {
        handlers.onMeta?.(
          obj.session_id,
          typeof obj.transcript === "string" ? obj.transcript : undefined,
        );
      } else if (event === "token" && typeof obj.text === "string") {
        reply += obj.text;
        handlers.onToken?.(obj.text);
      } else if (event === "error" && typeof obj.message === "string") {
        handlers.onError?.(obj.message);
      } else if (event === "done") {
        const full =
          typeof obj.reply_text === "string" && obj.reply_text.length > 0
            ? obj.reply_text
            : reply;
        let confirm: ConfirmPayload | null = null;
        const raw = obj.confirm;
        if (raw && typeof raw === "object") {
          const c = raw as Record<string, unknown>;
          if (typeof c.id === "string") {
            confirm = {
              id: c.id,
              kind:
                c.kind === "memory" || c.kind === "hands"
                  ? c.kind
                  : typeof c.verb === "string" && c.verb.startsWith("memory.")
                    ? "memory"
                    : "hands",
              verb: typeof c.verb === "string" ? c.verb : undefined,
              args:
                c.args && typeof c.args === "object"
                  ? (c.args as Record<string, string>)
                  : undefined,
              summary: typeof c.summary === "string" ? c.summary : undefined,
              fact: typeof c.fact === "string" ? c.fact : undefined,
            };
          }
        }
        handlers.onDone?.(
          full,
          typeof obj.transcript === "string" ? obj.transcript : undefined,
          confirm,
        );
      }
    }
  }
}

export async function streamTurn(
  sessionId: string,
  text: string,
  handlers: TurnHandlers,
): Promise<void> {
  const r = await fetch("/v1/turns?stream=1", {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "X-Session-Id": sessionId,
    },
    body: JSON.stringify({ text, session_id: sessionId }),
  });
  await consumeSse(r, handlers);
}

export async function streamAudioTurn(
  sessionId: string,
  blob: Blob,
  handlers: TurnHandlers,
): Promise<void> {
  const form = new FormData();
  form.append("session_id", sessionId);
  form.append("audio", blob, "speech.webm");
  const r = await fetch("/v1/turns?stream=1", {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "X-Session-Id": sessionId,
    },
    body: form,
  });
  await consumeSse(r, handlers);
}

/** Fetch Piper WAV via orchestrator (D-0014). Returns object URL or null. */
export async function fetchTtsObjectUrl(text: string): Promise<string | null> {
  const clean = text.trim();
  if (!clean) return null;
  const r = await fetch("/v1/tts", {
    method: "POST",
    headers: { Accept: "audio/wav, application/octet-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ text: clean.slice(0, 4000) }),
  });
  if (!r.ok) return null;
  const blob = await r.blob();
  if (blob.size < 64) return null;
  return URL.createObjectURL(blob);
}
