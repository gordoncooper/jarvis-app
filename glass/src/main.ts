import { fetchHealth, fetchSession, streamTurn } from "./api.js";

const SESSION_KEY = "jarvis.session_id";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;

  const brand = el("h1", "brand", "JARVIS");
  const greeting = el("p", "greeting", "…");
  const blurb = el("p", "blurb", "");
  const banner = el("div", "banner");
  const thread = el("div", "thread");
  const form = el("form", "composer");
  const input = el("input") as HTMLInputElement;
  input.type = "text";
  input.placeholder = "Speak freely…";
  input.autocomplete = "off";
  const send = el("button", undefined, "Send") as HTMLButtonElement;
  send.type = "submit";
  form.append(input, send);
  root.append(brand, greeting, blurb, banner, thread, form);

  let sessionId = localStorage.getItem(SESSION_KEY);

  try {
    const health = await fetchHealth();
    if (health.degraded) {
      banner.textContent = health.reason
        ? `Degraded: ${health.reason}`
        : "Degraded: the talker is unavailable.";
      banner.classList.add("show");
    }
  } catch {
    banner.textContent = "Cannot reach the orchestrator.";
    banner.classList.add("show");
  }

  try {
    const session = await fetchSession(sessionId);
    sessionId = session.session_id;
    localStorage.setItem(SESSION_KEY, sessionId);
    greeting.textContent = session.greeting;
    blurb.textContent = session.briefing_blurb;
    for (const m of session.messages) {
      if (m.role === "user" || m.role === "assistant") {
        thread.append(el("div", `msg ${m.role}`, m.content));
      }
    }
  } catch {
    greeting.textContent = "Good evening.";
    blurb.textContent = "Session unavailable.";
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text || !sessionId) return;
    input.value = "";
    send.disabled = true;
    thread.append(el("div", "msg user", text));
    const assistant = el("div", "msg assistant", "");
    thread.append(assistant);
    assistant.scrollIntoView({ block: "end" });

    await streamTurn(sessionId, text, {
      onMeta: (id) => {
        sessionId = id;
        localStorage.setItem(SESSION_KEY, id);
      },
      onToken: (t) => {
        assistant.textContent = (assistant.textContent ?? "") + t;
      },
      onDone: (reply) => {
        if (reply && !assistant.textContent) assistant.textContent = reply;
        send.disabled = false;
        input.focus();
      },
      onError: (message) => {
        assistant.textContent = `Error: ${message}`;
        banner.textContent = message;
        banner.classList.add("show");
        send.disabled = false;
      },
    });
  });

  input.focus();
}

void main();
