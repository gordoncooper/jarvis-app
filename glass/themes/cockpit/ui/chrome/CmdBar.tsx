import {
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type MutableRefObject,
  type Ref,
  useRef,
  useState,
} from "react";
import { cmdBarEnterSends } from "./cmdEnter.js";

type Props = {
  busy: boolean;
  recording: boolean;
  sttOk: boolean;
  /** True while a TTS reply is playing. */
  speaking?: boolean;
  prompt?: string;
  placeholder?: string;
  variant?: "stage" | "cmd" | "noc";
  inputRef?: MutableRefObject<HTMLTextAreaElement | null>;
  onSubmit: (text: string) => void;
  onPttStart: () => void;
  onPttStop: () => void;
  onInterrupt?: () => void;
};

export function CmdBar({
  busy,
  recording,
  sttOk,
  speaking = false,
  prompt = "> cmd",
  placeholder = "Speak freely.",
  variant = "stage",
  inputRef,
  onSubmit,
  onPttStart,
  onPttStop,
  onInterrupt,
}: Props) {
  // Responding covers both halves: tokens still arriving, or audio still playing.
  const responding = busy || speaking;
  const local = useRef<HTMLTextAreaElement>(null);
  const input = inputRef ?? local;
  const [multiline, setMultiline] = useState(false);

  /** Grow with the text, up to the CSS max-height, then scroll. */
  const fit = (el: HTMLTextAreaElement) => {
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
    const line = parseFloat(getComputedStyle(el).lineHeight);
    setMultiline(Number.isFinite(line) && el.scrollHeight > line * 1.6);
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const el = input.current;
    const value = el?.value.trim() ?? "";
    if (!value || !el) return;
    el.value = "";
    fit(el);
    onSubmit(value);
    el.focus();
  };

  const onKeyDown = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!cmdBarEnterSends(ev.key, {
      shift: ev.shiftKey,
      alt: ev.altKey,
      composing: ev.nativeEvent.isComposing,
    })) return;
    ev.preventDefault();
    ev.currentTarget.form?.requestSubmit();
  };

  return (
    <form className={`ck-cmdbar ck-cmdbar-${variant}${multiline ? " is-multiline" : ""}`} onSubmit={submit}>
      <span className="ck-cmd-prompt">{prompt}</span>
      <textarea
        ref={input as Ref<HTMLTextAreaElement>}
        rows={1}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        title="Enter to send. Shift+Enter for a new line."
        onKeyDown={onKeyDown}
        onInput={(ev) => fit(ev.currentTarget)}
      />
      {variant === "noc" ? (
        <span className="ck-cmd-block" aria-hidden="true" />
      ) : (
        <>
          {responding && onInterrupt ? (
            <button
              type="button"
              className="ck-stop"
              title="Stop JARVIS (Esc)"
              onClick={onInterrupt}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
              </svg>
              {variant === "stage" ? <span className="ck-send-label">Stop</span> : null}
            </button>
          ) : null}
          <button className="ck-send" type="submit" title="Send">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path fill="currentColor" d="M3.4 20.6 21 12 3.4 3.4l.1 6.7L15 12 3.5 13.9z" />
            </svg>
            {variant === "stage" ? <span className="ck-send-label">Send</span> : null}
          </button>
          <button
            type="button"
            className={`ck-mic ${recording ? "is-rec" : ""}`}
            disabled={!sttOk}
            title="Hold to talk — or hold the space bar"
            onPointerDown={(ev: PointerEvent) => {
              ev.preventDefault();
              ev.currentTarget.setPointerCapture(ev.pointerId);
              onPttStart();
            }}
            onPointerUp={(ev: PointerEvent) => {
              ev.preventDefault();
              if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
                ev.currentTarget.releasePointerCapture(ev.pointerId);
              }
              onPttStop();
            }}
          >
            {variant === "cmd" ? (
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
                <path
                  d="M5 11a7 7 0 0 0 14 0M12 18v3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
            ) : recording ? (
              "Listening…"
            ) : (
              <>
                Hold to talk <kbd className="ck-kbd">space</kbd>
              </>
            )}
          </button>
        </>
      )}
    </form>
  );
}
