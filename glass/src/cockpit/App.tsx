import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ConfirmPayload,
  type HealthPayload,
  type PulsePayload,
  fetchHealth,
  fetchPulse,
  fetchSession,
  fetchTtsObjectUrl,
  streamAudioTurn,
  streamTurn,
} from "../api.js";
import { Deck, type Slide } from "./deck/Deck.js";
import { Cmd } from "./displays/Cmd.js";
import { Earth } from "./displays/Earth.js";
import { Login } from "./displays/Login.js";
import { Noc } from "./displays/Noc.js";
import { type ChatMsg } from "./mock.js";
import { parseBriefing, SESSION_POLL_MS, type SessionBriefing } from "./state/session.js";
import { type EarthToast } from "./state/pulse.js";

const SESSION_KEY = "jarvis.session_id";

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function App() {
  const [slide, setSlide] = useState<Slide>(0);
  const [greeting, setGreeting] = useState("…");
  const [blurb, setBlurb] = useState("");
  const [briefing, setBriefing] = useState<SessionBriefing | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmPayload | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  const [pulse, setPulse] = useState<PulsePayload | null>(null);
  const [toast, setToast] = useState<EarthToast | null>(null);
  const [sessionAt, setSessionAt] = useState<number | null>(null);

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
    const poll = async () => {
      const next = await fetchPulse();
      if (alive) setPulse(next);
    };
    void poll();
    const id = window.setInterval(() => void poll(), 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const session = await fetchSession(sessionId.current);
      sessionId.current = session.session_id;
      localStorage.setItem(SESSION_KEY, session.session_id);
      setGreeting(session.greeting);
      setBlurb(session.briefing_blurb);
      setBriefing(parseBriefing(session.briefing));
      setSessionAt(Date.now());
      if (!busyRef.current) {
        const restored: ChatMsg[] = [];
        for (const m of session.messages) {
          if (m.role === "user" || m.role === "assistant") {
            restored.push({ id: nextId(), role: m.role, content: m.content });
          }
        }
        setMessages(restored);
        setConfirm(session.confirm ?? null);
      }
    } catch {
      setGreeting("Good evening.");
      setBlurb("Session unavailable.");
    }
  }, []);

  // The CMD header claims "Auto-refresh ON", so the briefing has to actually
  // refresh. build_cluster_briefing is ten Prometheus queries, so this is a
  // 5 minute poll, not the 2s pulse cadence. loadSession skips messages and
  // confirm while a turn is streaming.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (!alive) return;
      await loadSession();
    };
    void poll();
    const id = window.setInterval(() => void poll(), SESSION_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [loadSession]);

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
      // text already shown
    }
  }, []);

  const runText = useCallback(
    async (text: string) => {
      if (!text || !sessionId.current || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setConfirm(null);
      setToast({ user: text, asst: "" });
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
          setToast((prev) => (prev ? { ...prev, asst: prev.asst + t } : prev));
          setMessages((prev) =>
            prev.map((m) => (m.id === asstId ? { ...m, content: m.content + t } : m)),
          );
        },
        onDone: (reply, _transcript, nextConfirm) => {
          if (reply) {
            setToast((prev) => (prev ? { ...prev, asst: reply } : prev));
            setMessages((prev) =>
              prev.map((m) => (m.id === asstId ? { ...m, content: reply } : m)),
            );
          }
          busyRef.current = false;
          setBusy(false);
          if (nextConfirm) setConfirm(nextConfirm);
          void speak(reply);
        },
        onError: (message) => {
          setToast((prev) => (prev ? { ...prev, asst: `Error: ${message}` } : prev));
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstId ? { ...m, content: `Error: ${message}` } : m,
            ),
          );
          busyRef.current = false;
          setBusy(false);
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
    setConfirm(null);
    setToast({ user: "…", asst: "" });
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
          setToast((prev) => (prev ? { ...prev, user: transcript } : { user: transcript, asst: "" }));
          setMessages((prev) =>
            prev.map((m) => (m.id === userId ? { ...m, content: transcript } : m)),
          );
        }
      },
      onToken: (t) => {
        setToast((prev) => (prev ? { ...prev, asst: prev.asst + t } : prev));
        setMessages((prev) =>
          prev.map((m) => (m.id === asstId ? { ...m, content: m.content + t } : m)),
        );
      },
      onDone: (reply, transcript, nextConfirm) => {
        if (transcript) {
          setToast((prev) => (prev ? { ...prev, user: transcript } : { user: transcript, asst: reply }));
          setMessages((prev) =>
            prev.map((m) => (m.id === userId ? { ...m, content: transcript } : m)),
          );
        }
        if (reply) {
          setToast((prev) => (prev ? { ...prev, asst: reply } : prev));
          setMessages((prev) =>
            prev.map((m) => (m.id === asstId ? { ...m, content: reply } : m)),
          );
        }
        busyRef.current = false;
        setBusy(false);
        if (nextConfirm) setConfirm(nextConfirm);
        void speak(reply);
      },
      onError: (message) => {
        setToast((prev) => (prev ? { ...prev, asst: `Error: ${message}` } : prev));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstId ? { ...m, content: `Error: ${message}` } : m,
          ),
        );
        busyRef.current = false;
        setBusy(false);
      },
    });
  }, [speak]);

  const turnProps = {
    busy,
    recording,
    sttOk: sttOk && !micDenied,
    onSubmit: (text: string) => void runText(text),
    onPttStart: () => void startRec(),
    onPttStop: () => void stopRec(),
  };

  return (
    <Deck index={slide} onIndex={setSlide}>
      <Login onEnter={() => setSlide(1)} active={slide === 0} />
      <Earth
        health={health}
        unreachable={unreachable}
        pulse={pulse}
        toast={toast}
        confirm={confirm}
        active={slide === 1}
        {...turnProps}
      />
      <Cmd
        greeting={greeting}
        blurb={blurb}
        briefing={briefing}
        messages={messages}
        confirm={confirm}
        pulse={pulse}
        live={live}
        memoryFacts={health?.memory_facts ?? 0}
        sessionAt={sessionAt}
        onRefetchSession={() => {
          setSlide(2);
          void loadSession();
        }}
        onConfirm={() => void runText("yes")}
        onCancel={() => void runText("cancel")}
        {...turnProps}
      />
      <Noc live={live} pulse={pulse} confirm={confirm} {...turnProps} />
    </Deck>
  );
}
