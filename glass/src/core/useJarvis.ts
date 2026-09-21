import { useCallback, useEffect, useRef, useState } from "react";
import {
  INTERRUPTED_SUFFIX,
  isAbort,
  type ConfirmPayload,
  type HealthPayload,
  type PulsePayload,
  fetchHealth,
  fetchPulse,
  fetchSession,
  fetchTtsObjectUrl,
  streamAudioTurn,
  streamTurn,
} from "./api.js";
import { type ChatMsg, nextMsgId } from "./chat.js";
import { SESSION_POLL_MS, parseBriefing, type SessionBriefing } from "./session.js";

const SESSION_KEY = "jarvis.session_id";
const HEALTH_POLL_MS = 8_000;
const PULSE_POLL_MS = 2_000;

/** The last exchange, for themes that surface it outside the transcript
 *  (the cockpit draws it as a two-line toast over the globe). */
export type LastTurn = { user: string; assistant: string };

export type JarvisStatus = {
  /** Orchestrator answered and the talker is usable. */
  live: boolean;
  unreachable: boolean;
  degraded: boolean;
  reason: string | null;
  talker: boolean;
  hands: boolean;
  stt: boolean;
  tts: boolean;
  memoryFacts: number;
};

export type Jarvis = {
  greeting: string;
  blurb: string;
  briefing: SessionBriefing | null;
  messages: ChatMsg[];
  health: HealthPayload | null;
  pulse: PulsePayload | null;
  confirm: ConfirmPayload | null;
  status: JarvisStatus;
  busy: boolean;
  recording: boolean;
  micDenied: boolean;
  lastTurn: LastTurn | null;
  /** epoch ms of the last successful /v1/session fetch, or null. */
  sessionAt: number | null;
  /** True while a TTS reply is actually playing. */
  speaking: boolean;
  /** Cut JARVIS off: stop the audio, abort the stream, truncate the reply.
   *  No-op when nothing is in flight. send() and startPtt() call it first, so
   *  a theme only needs it for an explicit stop control. */
  interrupt: () => void;
  send: (text: string) => void;
  startPtt: () => void;
  stopPtt: () => void;
  /** Refetch the session. No navigation side effects — the theme routes. */
  refetchSession: () => void;
  answerConfirm: (accept: boolean) => void;
};

/**
 * Every theme gets the same data and the same verbs from here.
 *
 * This is the whole product behaviour — session, health and pulse polling,
 * streamed turns, TTS playback, push-to-talk capture, confirm handling — with
 * no opinion about layout, navigation, or how many displays exist. Themes
 * render it. Before this existed each theme carried its own copy, so a second
 * theme meant a second implementation of the same SSE and MediaRecorder code.
 */
export function useJarvis(): Jarvis {
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
  const [lastTurn, setLastTurn] = useState<LastTurn | null>(null);
  const [sessionAt, setSessionAt] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const sessionId = useRef<string | null>(localStorage.getItem(SESSION_KEY));
  const busyRef = useRef(false);
  const ttsOkRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // Bumped on every interrupt and every new turn, so a TTS clip that finishes
  // rendering after the operator cut in is discarded instead of played.
  const turnSeqRef = useRef(0);
  // Which assistant message the live stream is filling, so an interrupt can
  // mark that one truncated rather than guessing at the tail of the list.
  const activeAsstRef = useRef<string | null>(null);

  const talker = !unreachable && health?.llm !== false && health?.degraded !== true;
  const hands = !unreachable && health?.hands !== false;
  const stt = !unreachable && health?.stt !== false;
  const tts = !unreachable && health?.tts !== false;
  ttsOkRef.current = tts;

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
    const id = window.setInterval(() => void poll(), HEALTH_POLL_MS);
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
    const id = window.setInterval(() => void poll(), PULSE_POLL_MS);
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
      // A poll landing mid-stream must not clobber the live transcript.
      if (!busyRef.current) {
        const restored: ChatMsg[] = [];
        for (const m of session.messages) {
          if (m.role === "user" || m.role === "assistant") {
            restored.push({ id: nextMsgId(), role: m.role, content: m.content });
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

  const stopSpeaking = useCallback(() => {
    const audio = audioRef.current;
    audioRef.current = null;
    setSpeaking(false);
    if (!audio) return;
    audio.pause();
    const url = audio.src;
    audio.src = "";
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!ttsOkRef.current || !text.trim()) return;
      const turn = turnSeqRef.current;
      try {
        const url = await fetchTtsObjectUrl(text);
        if (!url) return;
        // The operator may have cut in while Piper was still rendering.
        if (turn !== turnSeqRef.current) {
          URL.revokeObjectURL(url);
          return;
        }
        stopSpeaking();
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (audioRef.current === audio) {
            audioRef.current = null;
            setSpeaking(false);
          }
        };
        await audio.play();
        setSpeaking(true);
      } catch {
        // The reply is already on screen; losing audio is not worth surfacing.
      }
    },
    [stopSpeaking],
  );

  /** Cut JARVIS off mid-reply: silence the audio, abort the stream, and mark
   *  the partial answer truncated so the transcript matches what was heard.
   *  The orchestrator persists the same marker when the socket drops. */
  const interrupt = useCallback(() => {
    turnSeqRef.current += 1;
    stopSpeaking();
    const ctrl = abortRef.current;
    abortRef.current = null;
    if (ctrl) ctrl.abort();
    const id = activeAsstRef.current;
    activeAsstRef.current = null;
    if (id) {
      setMessages((prev) =>
        prev.flatMap((m) => {
          if (m.id !== id) return [m];
          const body = m.content.trimEnd();
          // Nothing was said yet — drop the empty bubble rather than leave a
          // marker floating on its own.
          return body ? [{ ...m, content: body + INTERRUPTED_SUFFIX }] : [];
        }),
      );
      setLastTurn((prev) =>
        prev && prev.assistant.trim()
          ? { ...prev, assistant: prev.assistant.trimEnd() + INTERRUPTED_SUFFIX }
          : prev,
      );
    }
    busyRef.current = false;
    setBusy(false);
  }, [stopSpeaking]);

  /** Shared bookkeeping for both the typed and the spoken path. */
  const beginTurn = useCallback((userText: string) => {
    turnSeqRef.current += 1;
    busyRef.current = true;
    setBusy(true);
    setConfirm(null);
    setLastTurn({ user: userText, assistant: "" });
    const userId = nextMsgId();
    const asstId = nextMsgId();
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: userText },
      { id: asstId, role: "assistant", content: "" },
    ]);
    activeAsstRef.current = asstId;
    return { userId, asstId };
  }, []);

  const endTurn = useCallback(() => {
    busyRef.current = false;
    setBusy(false);
    abortRef.current = null;
    activeAsstRef.current = null;
  }, []);

  const setAsst = useCallback((id: string, update: (prev: string) => string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: update(m.content) } : m)));
  }, []);

  const runText = useCallback(
    async (text: string) => {
      if (!text || !sessionId.current) return;
      // Talking over JARVIS cuts it off rather than being ignored.
      if (busyRef.current || audioRef.current) interrupt();
      const { asstId } = beginTurn(text);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
      await streamTurn(sessionId.current, text, {
        onMeta: (id) => {
          sessionId.current = id;
          localStorage.setItem(SESSION_KEY, id);
        },
        onToken: (t) => {
          setLastTurn((prev) => (prev ? { ...prev, assistant: prev.assistant + t } : prev));
          setAsst(asstId, (c) => c + t);
        },
        onDone: (reply, _transcript, nextConfirm) => {
          if (reply) {
            setLastTurn((prev) => (prev ? { ...prev, assistant: reply } : prev));
            setAsst(asstId, () => reply);
          }
          endTurn();
          if (nextConfirm) setConfirm(nextConfirm);
          void speak(reply);
        },
        onError: (message) => {
          setLastTurn((prev) => (prev ? { ...prev, assistant: `Error: ${message}` } : prev));
          setAsst(asstId, () => `Error: ${message}`);
          endTurn();
        },
      }, ctrl.signal);
      } catch (e) {
        // interrupt() has already truncated the reply and cleared busy.
        if (!isAbort(e)) {
          setAsst(asstId, () => "Error: turn failed");
          endTurn();
        }
      }
    },
    [beginTurn, endTurn, interrupt, setAsst, speak],
  );

  const startPtt = useCallback(async () => {
    if (!sessionId.current) return;
    // Barge-in: reaching for the mic while JARVIS is talking stops it.
    if (busyRef.current || audioRef.current) interrupt();
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
  }, [interrupt]);

  const stopPtt = useCallback(async () => {
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

    const { userId, asstId } = beginTurn("…");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const applyTranscript = (transcript: string) => {
      setLastTurn((prev) => (prev ? { ...prev, user: transcript } : { user: transcript, assistant: "" }));
      setMessages((prev) => prev.map((m) => (m.id === userId ? { ...m, content: transcript } : m)));
    };

    try {
    await streamAudioTurn(sessionId.current, blob, {
      onMeta: (id, transcript) => {
        sessionId.current = id;
        localStorage.setItem(SESSION_KEY, id);
        if (transcript) applyTranscript(transcript);
      },
      onToken: (t) => {
        setLastTurn((prev) => (prev ? { ...prev, assistant: prev.assistant + t } : prev));
        setAsst(asstId, (c) => c + t);
      },
      onDone: (reply, transcript, nextConfirm) => {
        if (transcript) applyTranscript(transcript);
        if (reply) {
          setLastTurn((prev) => (prev ? { ...prev, assistant: reply } : prev));
          setAsst(asstId, () => reply);
        }
        endTurn();
        if (nextConfirm) setConfirm(nextConfirm);
        void speak(reply);
      },
      onError: (message) => {
        setLastTurn((prev) => (prev ? { ...prev, assistant: `Error: ${message}` } : prev));
        setAsst(asstId, () => `Error: ${message}`);
        endTurn();
      },
    }, ctrl.signal);
    } catch (e) {
      if (!isAbort(e)) {
        setAsst(asstId, () => "Error: turn failed");
        endTurn();
      }
    }
  }, [beginTurn, endTurn, interrupt, setAsst, speak]);

  return {
    greeting,
    blurb,
    briefing,
    messages,
    health,
    pulse,
    confirm,
    status: {
      live: talker && !unreachable,
      unreachable,
      degraded: health?.degraded === true,
      reason: health?.reason ?? null,
      talker,
      hands,
      stt: stt && !micDenied,
      tts,
      memoryFacts: health?.memory_facts ?? 0,
    },
    busy,
    recording,
    micDenied,
    lastTurn,
    sessionAt,
    speaking,
    send: (text: string) => void runText(text),
    startPtt: () => void startPtt(),
    stopPtt: () => void stopPtt(),
    interrupt,
    refetchSession: () => void loadSession(),
    // yes / cancel are themselves turns (D-0023 confirm gate).
    answerConfirm: (accept: boolean) => void runText(accept ? "yes" : "cancel"),
  };
}
