import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ConfirmPayload,
  type HealthPayload,
  fetchHealth,
  fetchSession,
  fetchTtsObjectUrl,
  streamAudioTurn,
  streamTurn,
} from "../api.js";
import { Globe, webglAvailable } from "../viz/globe/Globe.js";
import { Channel, type ChatMsg } from "./Channel.js";
import { Console } from "./Console.js";
import { ArcMeter, MemoryRing } from "./Meter.js";
import { Panel } from "./Panel.js";
import { Ribbon } from "./Ribbon.js";
import { Ticker } from "./Ticker.js";

const SESSION_KEY = "jarvis.session_id";

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function tickerFrom(
  health: HealthPayload | null,
  unreachable: boolean,
  confirm: ConfirmPayload | null,
  sttOk: boolean,
  ttsOk: boolean,
): string | null {
  if (unreachable) return "Cannot reach the orchestrator.";
  if (confirm) return confirm.summary || confirm.fact || "Confirm waiting.";
  if (!health) return null;
  if (health.degraded) {
    return health.reason
      ? `Degraded: ${health.reason}`
      : "Degraded: the talker is unavailable.";
  }
  if (health.hands === false) {
    return health.reason || "Hands unavailable — live rack questions will wait.";
  }
  if (!sttOk) return "Voice unavailable (STT). Typing still works.";
  if (!ttsOk) return "Speaker unavailable (TTS). Replies stay as text.";
  return null;
}

export function App() {
  const [greeting, setGreeting] = useState("…");
  const [blurb, setBlurb] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmPayload | null>(null);
  const [globeOk] = useState(() => webglAvailable());
  const [micDenied, setMicDenied] = useState(false);

  const sessionId = useRef<string | null>(localStorage.getItem(SESSION_KEY));
  const busyRef = useRef(false);
  const ttsOkRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const talkerOk = !unreachable && health?.llm !== false && health?.degraded !== true;
  const handsOk = !unreachable && health?.hands !== false;
  const sttOk = !unreachable && health?.stt !== false;
  const ttsOk = !unreachable && health?.tts !== false;
  ttsOkRef.current = ttsOk;
  const live = talkerOk && !unreachable;
  const frozen = unreachable || health?.degraded === true;

  const applyHealth = useCallback((next: HealthPayload | null, down = false) => {
    setUnreachable(down);
    setHealth(next);
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const h = await fetchHealth();
        if (alive) applyHealth(h);
      } catch {
        if (alive) applyHealth(null, true);
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 8000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [applyHealth]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const session = await fetchSession(sessionId.current);
        if (!alive) return;
        sessionId.current = session.session_id;
        localStorage.setItem(SESSION_KEY, session.session_id);
        setGreeting(session.greeting);
        setBlurb(session.briefing_blurb);
        const restored: ChatMsg[] = [];
        for (const m of session.messages) {
          if (m.role === "user" || m.role === "assistant") {
            restored.push({ id: nextId(), role: m.role, content: m.content });
          }
        }
        setMessages(restored);
        if (session.confirm) setConfirm(session.confirm);
      } catch {
        if (alive) {
          setGreeting("Good evening.");
          setBlurb("Session unavailable.");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!ttsOkRef.current || !text.trim()) return;
    try {
      const url = await fetchTtsObjectUrl(text);
      if (!url) return;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
      };
      await audio.play();
    } catch {
      // Autoplay / TTS failure — text already shown (D-0014).
    }
  }, []);

  const runText = useCallback(
    async (text: string) => {
      if (!text || !sessionId.current || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setStreaming(true);
      setConfirm(null);
      const userId = nextId();
      const asstId = nextId();
      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", content: text },
        { id: asstId, role: "assistant", content: "" },
      ]);

      await streamTurn(sessionId.current, text, {
        onMeta: (id) => {
          sessionId.current = id;
          localStorage.setItem(SESSION_KEY, id);
        },
        onToken: (t) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstId ? { ...m, content: m.content + t } : m,
            ),
          );
        },
        onDone: (reply, _transcript, nextConfirm) => {
          if (reply) {
            setMessages((prev) =>
              prev.map((m) => (m.id === asstId ? { ...m, content: reply } : m)),
            );
          }
          busyRef.current = false;
          setBusy(false);
          setStreaming(false);
          if (nextConfirm) setConfirm(nextConfirm);
          void speak(reply);
        },
        onError: (message) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstId ? { ...m, content: `Error: ${message}` } : m,
            ),
          );
          busyRef.current = false;
          setBusy(false);
          setStreaming(false);
        },
      });
    },
    [speak],
  );

  const startRec = useCallback(async () => {
    if (busyRef.current || !sessionId.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recRef.current = rec;
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.start();
      setRecording(true);
    } catch {
      setMicDenied(true);
    }
  }, []);

  const stopRec = useCallback(async () => {
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return;
    recRef.current = null;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
      rec.stream.getTracks().forEach((t) => t.stop());
    });
    setRecording(false);
    const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
    chunksRef.current = [];
    if (!sessionId.current || blob.size < 1000) return;

    busyRef.current = true;
    setBusy(true);
    setStreaming(true);
    setConfirm(null);
    const userId = nextId();
    const asstId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: "…" },
      { id: asstId, role: "assistant", content: "" },
    ]);

    await streamAudioTurn(sessionId.current, blob, {
      onMeta: (id, transcript) => {
        sessionId.current = id;
        localStorage.setItem(SESSION_KEY, id);
        if (transcript) {
          setMessages((prev) =>
            prev.map((m) => (m.id === userId ? { ...m, content: transcript } : m)),
          );
        }
      },
      onToken: (t) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstId ? { ...m, content: m.content + t } : m,
          ),
        );
      },
      onDone: (reply, transcript, nextConfirm) => {
        if (transcript) {
          setMessages((prev) =>
            prev.map((m) => (m.id === userId ? { ...m, content: transcript } : m)),
          );
        }
        if (reply) {
          setMessages((prev) =>
            prev.map((m) => (m.id === asstId ? { ...m, content: reply } : m)),
          );
        }
        busyRef.current = false;
        setBusy(false);
        setStreaming(false);
        if (nextConfirm) setConfirm(nextConfirm);
        void speak(reply);
      },
      onError: (message) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstId ? { ...m, content: `Error: ${message}` } : m,
          ),
        );
        busyRef.current = false;
        setBusy(false);
        setStreaming(false);
      },
    });
  }, [speak]);

  const ticker =
    micDenied && !confirm
      ? "Microphone permission denied (needs HTTPS + trusted CA)."
      : tickerFrom(health, unreachable, confirm, sttOk, ttsOk);

  return (
    <>
      {globeOk ? (
        <div className="hud-stage">
          <Globe live={live} streaming={streaming} alert={!!confirm} frozen={frozen} />
        </div>
      ) : null}
      <div className="hud-vignette" />
      <div className="hud-overlay">
        <Ribbon
          greeting={greeting}
          live={live}
          alert={!!confirm}
          ticks={[
            { id: "hands", label: "HANDS", live: handsOk },
            { id: "stt", label: "STT", live: sttOk },
            { id: "tts", label: "TTS", live: ttsOk },
          ]}
        />
        <Ticker text={ticker} />
        {blurb ? (
          <Panel className="hud-dossier" label="DOSSIER">
            <p className="blurb">{blurb}</p>
          </Panel>
        ) : null}
        <Channel
          messages={messages}
          confirm={confirm}
          onConfirm={() => void runText("yes")}
          onCancel={() => void runText("cancel")}
        />
        <div className="hud-systems">
          <div className="hud-panel-label">SYSTEMS</div>
          <ArcMeter label="TALKER" ok={talkerOk} live={live} />
          <ArcMeter label="HANDS" ok={handsOk} live={live} />
          <ArcMeter label="STT" ok={sttOk} live={live} />
          <ArcMeter label="TTS" ok={ttsOk} live={live} />
          <MemoryRing count={health?.memory_facts ?? 0} />
        </div>
        <Console
          busy={busy}
          recording={recording}
          sttOk={sttOk}
          onSubmit={(text) => void runText(text)}
          onPttStart={() => void startRec()}
          onPttStop={() => void stopRec()}
        />
      </div>
    </>
  );
}
