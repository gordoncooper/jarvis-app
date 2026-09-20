import {
  type ConfirmPayload,
  type HealthPayload,
  fetchHealth,
  fetchSession,
  fetchTtsObjectUrl,
  streamAudioTurn,
  streamTurn,
} from "./api.js";

/** Frozen 3-column shell for `mark-hud` / `archive-gold` packs (D-0030). */

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

function meter(
  id: string,
  label: string,
): { root: HTMLElement; fill: HTMLElement; value: HTMLElement } {
  const root = el("div", "hud-meter");
  root.dataset.meter = id;
  const name = el("span", "hud-meter-label", label);
  const track = el("div", "hud-meter-track");
  const fill = el("div", "hud-meter-fill");
  track.append(fill);
  const value = el("span", "hud-meter-value", "—");
  root.append(name, track, value);
  return { root, fill, value };
}

function setMeter(
  m: { fill: HTMLElement; value: HTMLElement; root: HTMLElement },
  ok: boolean,
  live: boolean,
): void {
  m.root.classList.toggle("is-live", live && ok);
  m.root.classList.toggle("is-down", !ok);
  m.fill.style.width = ok ? "100%" : "18%";
  m.value.textContent = ok ? "LIVE" : "WAIT";
}

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;

  root.className = "hud-canvas";

  const grid = el("div", "hud-grid");
  const globe = el("div", "hud-globe");
  document.body.prepend(grid, globe);

  const rail = el("header", "hud-rail");
  const brand = el("h1", "brand", "JARVIS");
  const pip = el("span", "pip-live", "LIVE");
  pip.setAttribute("aria-live", "polite");
  const greeting = el("p", "greeting", "…");
  const crumbs = el("div", "hud-crumbs");
  const crumbHands = el("span", "hud-crumb", "HANDS");
  const crumbStt = el("span", "hud-crumb", "STT");
  const crumbTts = el("span", "hud-crumb", "TTS");
  crumbs.append(crumbHands, crumbStt, crumbTts);
  rail.append(brand, pip, greeting, crumbs);

  const banner = el("div", "banner");

  const stages = el("div", "hud-stages");

  const left = el("aside", "hud-stage hud-stage-left");
  const leftLabel = el("div", "hud-stage-label", "DOSSIER");
  const blurb = el("p", "blurb", "");
  left.append(leftLabel, blurb);

  const center = el("section", "hud-stage hud-stage-center");
  const centerLabel = el("div", "hud-stage-label", "CHANNEL");
  const thread = el("div", "hud-thread thread");
  center.append(centerLabel, thread);

  const right = el("aside", "hud-stage hud-stage-right");
  const rightLabel = el("div", "hud-stage-label", "SYSTEMS");
  const talkerM = meter("talker", "TALKER");
  const handsM = meter("hands", "HANDS");
  const sttM = meter("stt", "STT");
  const ttsM = meter("tts", "TTS");
  right.append(rightLabel, talkerM.root, handsM.root, sttM.root, ttsM.root);

  stages.append(left, center, right);

  const form = el("form", "hud-console composer");
  const consoleLabel = el("span", "hud-console-label", "CMD");
  const input = el("input") as HTMLInputElement;
  input.type = "text";
  input.placeholder = "Speak freely…";
  input.autocomplete = "off";
  input.spellcheck = false;
  const send = el("button", "hud-send", "Send") as HTMLButtonElement;
  send.type = "submit";
  const mic = el("button", "mic", "Hold to talk") as HTMLButtonElement;
  mic.type = "button";
  form.append(consoleLabel, input, send, mic);

  root.append(rail, banner, stages, form);

  let sessionId = localStorage.getItem(SESSION_KEY);
  let busy = false;
  let ttsOk = true;
  let currentAudio: HTMLAudioElement | null = null;
  let activeConfirmRow: HTMLElement | null = null;

  const applyHealth = (health: HealthPayload | null, unreachable = false): void => {
    const talkerOk = !unreachable && health?.degraded !== true;
    const handsOk = !unreachable && health?.hands !== false;
    const sttOk = !unreachable && health?.stt !== false;
    ttsOk = !unreachable && health?.tts !== false;
    const live = talkerOk && !unreachable;

    pip.classList.toggle("is-live", live);
    pip.classList.toggle("is-down", !live);
    pip.textContent = live ? "LIVE" : "HOLD";

    crumbHands.classList.toggle("is-live", handsOk);
    crumbStt.classList.toggle("is-live", sttOk);
    crumbTts.classList.toggle("is-live", ttsOk);

    setMeter(talkerM, talkerOk, live);
    setMeter(handsM, handsOk, live);
    setMeter(sttM, sttOk, live);
    setMeter(ttsM, ttsOk, live);

    banner.classList.remove("show");
    banner.textContent = "";
    if (unreachable) {
      banner.textContent = "Cannot reach the orchestrator.";
      banner.classList.add("show");
      return;
    }
    if (!health) return;
    if (health.degraded) {
      banner.textContent = health.reason
        ? `Degraded: ${health.reason}`
        : "Degraded: the talker is unavailable.";
      banner.classList.add("show");
    } else if (health.hands === false) {
      banner.textContent =
        health.reason || "Hands unavailable — live rack questions will wait.";
      banner.classList.add("show");
    } else if (health.stt === false) {
      banner.textContent = "Voice unavailable (STT). Typing still works.";
      banner.classList.add("show");
      mic.disabled = true;
    } else if (!ttsOk) {
      banner.textContent = "Speaker unavailable (TTS). Replies stay as text.";
      banner.classList.add("show");
    }
  };

  const clearConfirmRow = (): void => {
    if (activeConfirmRow) {
      activeConfirmRow.remove();
      activeConfirmRow = null;
    }
  };

  const speak = async (text: string): Promise<void> => {
    if (!ttsOk || !text.trim()) return;
    try {
      const url = await fetchTtsObjectUrl(text);
      if (!url) return;
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = "";
        currentAudio = null;
      }
      const audio = new Audio(url);
      currentAudio = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
      };
      await audio.play();
    } catch {
      // Autoplay / TTS failure — text already shown (D-0014).
    }
  };

  try {
    applyHealth(await fetchHealth());
  } catch {
    applyHealth(null, true);
  }

  let restoreConfirm: ConfirmPayload | null = null;
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
    if (session.confirm) restoreConfirm = session.confirm;
  } catch {
    greeting.textContent = "Good evening.";
    blurb.textContent = "Session unavailable.";
  }

  const showConfirm = (
    after: HTMLElement,
    confirm: ConfirmPayload,
    run: (text: string) => Promise<void>,
  ): void => {
    clearConfirmRow();
    const row = el("div", "confirm-row");
    const yes = el("button", "confirm-yes", "Confirm") as HTMLButtonElement;
    yes.type = "button";
    const no = el("button", "confirm-no", "Cancel") as HTMLButtonElement;
    no.type = "button";
    yes.addEventListener("click", () => {
      yes.disabled = true;
      no.disabled = true;
      void run("yes");
    });
    no.addEventListener("click", () => {
      yes.disabled = true;
      no.disabled = true;
      void run("cancel");
    });
    row.append(yes, no);
    after.insertAdjacentElement("afterend", row);
    activeConfirmRow = row;
    void confirm;
  };

  async function runText(text: string): Promise<void> {
    if (!text || !sessionId || busy) return;
    busy = true;
    send.disabled = true;
    mic.disabled = true;
    clearConfirmRow();
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
      onDone: (reply, _transcript, confirm) => {
        if (reply) assistant.textContent = reply;
        busy = false;
        send.disabled = false;
        mic.disabled = false;
        input.focus();
        if (confirm) showConfirm(assistant, confirm, runText);
        void speak(reply);
      },
      onError: (message) => {
        assistant.textContent = `Error: ${message}`;
        banner.textContent = message;
        banner.classList.add("show");
        busy = false;
        send.disabled = false;
        mic.disabled = false;
      },
    });
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    input.value = "";
    await runText(text);
  });

  if (restoreConfirm) {
    const last = thread.querySelector(".msg.assistant:last-of-type");
    if (last instanceof HTMLElement) {
      showConfirm(last, restoreConfirm, runText);
    }
  }

  let media: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];

  const startRec = async () => {
    if (busy || !sessionId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      media = new MediaRecorder(stream);
      media.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      media.start();
      mic.classList.add("recording");
      mic.textContent = "Listening…";
    } catch {
      banner.textContent = "Microphone permission denied (needs HTTPS + trusted CA).";
      banner.classList.add("show");
    }
  };

  const stopRec = async () => {
    if (!media || media.state === "inactive") return;
    const rec = media;
    media = null;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
      rec.stream.getTracks().forEach((t) => t.stop());
    });
    mic.classList.remove("recording");
    mic.textContent = "Hold to talk";
    const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
    chunks = [];
    if (!sessionId || blob.size < 1000) return;

    busy = true;
    send.disabled = true;
    mic.disabled = true;
    clearConfirmRow();
    const userMsg = el("div", "msg user", "…");
    thread.append(userMsg);
    const assistant = el("div", "msg assistant", "");
    thread.append(assistant);

    await streamAudioTurn(sessionId, blob, {
      onMeta: (id, transcript) => {
        sessionId = id;
        localStorage.setItem(SESSION_KEY, id);
        if (transcript) userMsg.textContent = transcript;
      },
      onToken: (t) => {
        assistant.textContent = (assistant.textContent ?? "") + t;
      },
      onDone: (reply, transcript, confirm) => {
        if (transcript) userMsg.textContent = transcript;
        if (reply) assistant.textContent = reply;
        busy = false;
        send.disabled = false;
        mic.disabled = false;
        if (confirm) showConfirm(assistant, confirm, runText);
        void speak(reply);
      },
      onError: (message) => {
        assistant.textContent = `Error: ${message}`;
        banner.textContent = message;
        banner.classList.add("show");
        busy = false;
        send.disabled = false;
        mic.disabled = false;
      },
    });
  };

  mic.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    void startRec();
  });
  mic.addEventListener("pointerup", (ev) => {
    ev.preventDefault();
    void stopRec();
  });
  mic.addEventListener("pointerleave", () => {
    void stopRec();
  });

  input.focus();
}

void main();
