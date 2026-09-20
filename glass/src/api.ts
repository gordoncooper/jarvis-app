export type SessionPayload = {
  session_id: string;
  messages: Array<{ role: string; content: string }>;
  greeting: string;
  briefing_blurb: string;
};

export type HealthPayload = {
  ok: boolean;
  degraded?: boolean;
  reason?: string | null;
};

const jsonHeaders = { Accept: "application/json" };

export async function fetchHealth(): Promise<HealthPayload> {
  const r = await fetch("/health", { headers: jsonHeaders });
  if (!r.ok) throw new Error(`health ${r.status}`);
  return r.json() as Promise<HealthPayload>;
}

export async function fetchSession(sessionId: string | null): Promise<SessionPayload> {
  const headers: Record<string, string> = { ...jsonHeaders };
  if (sessionId) headers["X-Session-Id"] = sessionId;
  const r = await fetch("/v1/session", { headers });
  if (!r.ok) throw new Error(`session ${r.status}`);
  return r.json() as Promise<SessionPayload>;
}

export type TurnHandlers = {
  onMeta?: (sessionId: string) => void;
  onToken?: (text: string) => void;
  onDone?: (reply: string) => void;
  onError?: (message: string) => void;
};

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
        handlers.onMeta?.(obj.session_id);
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
        handlers.onDone?.(full);
      }
    }
  }
}
