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
import { stripForSpeech, takeSentences } from "./speech.js";
import { SESSION_POLL_MS, parseBriefing, type SessionBriefing } from "./session.js";

const SESSION_KEY = "jarvis.session_id";
const HEALTH_POLL_MS = 8_000;
const PULSE_POLL_MS = 2_000;
/** Concurrent Piper renders. Two keeps the queue ahead without hammering it. */
const MAX_TTS_IN_FLIGHT = 2;

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
  // Sentence-at-a-time speech. Text not yet forming a full sentence waits in
  // pendingRef; queueRef holds sentences waiting their turn to be spoken.
  const pendingRef = useRef("");
  /** Sentences not yet handed to Piper. */
  const textQueueRef = useRef<string[]>([]);
  /** Renders in flight or finished, in playback order. */
  const audioQueueRef = useRef<Array<Promise<string | null>>>([]);
  const inFlightRef = useRef(0);
  const speakingRef = useRef(false);
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
      const requested = sessionId.current;
      const session = await fetchSession(requested);
      // A session command may have moved us on while this fetch was in flight.
      if (sessionId.current !== requested) return;
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
    pendingRef.current = "";
    textQueueRef.current = [];
    // Renders already in flight resolve into nothing: the turn counter has
    // moved on, so playSpeech drops them and revokes their URLs.
    audioQueueRef.current = [];
    speakingRef.current = false;
    const audio = audioRef.current;
    audioRef.current = null;
    setSpeaking(false);
    if (!audio) return;
    audio.pause();
    const url = audio.src;
    audio.src = "";
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }, []);

  /** Render sentences as soon as they exist and play them in order.
   *
   *  Rendering must not wait on playback. Piper is ~8x faster than real time,
   *  so keeping a couple of renders in flight means the next clip is ready
   *  before the current one ends and the speech is continuous. A first
   *  version only started the next render when the previous clip finished,
   *  which left a render-length silence between every sentence. */
  const pumpSpeech = useCallback(() => {
    const turn = turnSeqRef.current;
    while (inFlightRef.current < MAX_TTS_IN_FLIGHT && textQueueRef.current.length) {
      const text = textQueueRef.current.shift() as string;
      inFlightRef.current += 1;
      const p = fetchTtsObjectUrl(text)
        .catch(() => null)
        .finally(() => {
          inFlightRef.current -= 1;
          // Freeing a slot may let the next sentence start rendering.
          if (turn === turnSeqRef.current) pumpSpeech();
        });
      audioQueueRef.current.push(p);
    }
  }, []);

  const playSpeech = useCallback(async () => {
    if (speakingRef.current) return;
    speakingRef.current = true;
    const turn = turnSeqRef.current;
    try {
      while (audioQueueRef.current.length) {
        if (turn !== turnSeqRef.current) break;
        const url = await (audioQueueRef.current.shift() as Promise<string | null>);
        pumpSpeech();
        if (turn !== turnSeqRef.current) {
          if (url) URL.revokeObjectURL(url);
          break;
        }
        if (!url) continue;
        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          audioRef.current = audio;
          const finish = () => {
            URL.revokeObjectURL(url);
            if (audioRef.current === audio) audioRef.current = null;
            resolve();
          };
          audio.onended = finish;
          audio.onerror = finish;
          void audio.play().then(
            () => {
              if (turn === turnSeqRef.current) setSpeaking(true);
            },
            finish,
          );
        });
      }
    } finally {
      speakingRef.current = false;
      if (turn === turnSeqRef.current && !audioQueueRef.current.length) setSpeaking(false);
    }
  }, [pumpSpeech]);

  /** Feed streamed text in; complete sentences start rendering immediately. */
  const feedSpeech = useCallback(
    (chunk: string, final = false) => {
      if (!ttsOkRef.current) return;
      pendingRef.current += chunk;
      const { ready, rest } = takeSentences(pendingRef.current, { final });
      pendingRef.current = rest;
      for (const sentence of ready) {
        const spoken = stripForSpeech(sentence);
        if (spoken) textQueueRef.current.push(spoken);
      }
      if (!ready.length) return;
      pumpSpeech();
      void playSpeech();
    },
    [pumpSpeech, playSpeech],
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

  const resetRef = useRef(false);
  const adoptSession = useCallback((id: string, reset?: "discard" | "rotate") => {
    sessionId.current = id;
    localStorage.setItem(SESSION_KEY, id);
    if (!reset) return;
    resetRef.current = true;
    setMessages([]);
    setConfirm(null);
    setLastTurn(null);
  }, []);
  const finishIfReset = useCallback(
    (reset?: "discard" | "rotate") => {
      if (!reset && !resetRef.current) return false;
      resetRef.current = false;
      setMessages([]);
      setConfirm(null);
      setLastTurn(null);
      endTurn();
      return true;
    },
    [endTurn],
  );

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
        onMeta: (id, _transcript, reset) => {
          adoptSession(id, reset);
        },
        onToken: (t) => {
          if (resetRef.current) return;
          setLastTurn((prev) => (prev ? { ...prev, assistant: prev.assistant + t } : prev));
          setAsst(asstId, (c) => c + t);
          feedSpeech(t);
        },
        onDone: (reply, _transcript, nextConfirm, reset) => {
          if (finishIfReset(reset)) return;
          if (reply) {
            setLastTurn((prev) => (prev ? { ...prev, assistant: reply } : prev));
            setAsst(asstId, () => reply);
          }
          endTurn();
          if (nextConfirm) setConfirm(nextConfirm);
          // Speak the tail; the body has been going out sentence by sentence.
          feedSpeech("", true);
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
    [adoptSession, beginTurn, endTurn, feedSpeech, finishIfReset, interrupt, setAsst],
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
      onMeta: (id, transcript, reset) => {
        adoptSession(id, reset);
        if (!reset && transcript) applyTranscript(transcript);
      },
      onToken: (t) => {
        if (resetRef.current) return;
        setLastTurn((prev) => (prev ? { ...prev, assistant: prev.assistant + t } : prev));
        setAsst(asstId, (c) => c + t);
        feedSpeech(t);
      },
      onDone: (reply, transcript, nextConfirm, reset) => {
        if (finishIfReset(reset)) return;
        if (transcript) applyTranscript(transcript);
        if (reply) {
          setLastTurn((prev) => (prev ? { ...prev, assistant: reply } : prev));
          setAsst(asstId, () => reply);
        }
        endTurn();
        if (nextConfirm) setConfirm(nextConfirm);
        feedSpeech("", true);
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
  }, [adoptSession, beginTurn, endTurn, feedSpeech, finishIfReset, interrupt, setAsst]);

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
