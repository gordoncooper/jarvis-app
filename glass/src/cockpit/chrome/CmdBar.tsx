import { type FormEvent, type PointerEvent, useRef } from "react";

type Props = {
  busy: boolean;
  recording: boolean;
  sttOk: boolean;
  prompt?: string;
  placeholder?: string;
  variant?: "stage" | "cmd" | "noc";
  onSubmit: (text: string) => void;
  onPttStart: () => void;
  onPttStop: () => void;
};

export function CmdBar({
  busy,
  recording,
  sttOk,
  prompt = "cmd",
  placeholder = "Speak freely…",
  variant = "stage",
  onSubmit,
  onPttStart,
  onPttStop,
}: Props) {
  const input = useRef<HTMLInputElement>(null);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const value = input.current?.value.trim() ?? "";
    if (input.current) input.current.value = "";
    onSubmit(value);
    input.current?.focus();
  };

  return (
    <form className={`ck-cmdbar ck-cmdbar-${variant}`} onSubmit={submit}>
      <span className="ck-cmd-prompt">{prompt}</span>
      <input
        ref={input}
        type="text"
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
      />
      {variant === "noc" ? (
        <span className="ck-cmd-block" aria-hidden="true" />
      ) : (
        <>
          <button className="ck-send" type="submit" disabled={busy} title="Send">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="currentColor" d="M3.4 20.6 21 12 3.4 3.4l.1 6.7L15 12 3.5 13.9z" />
            </svg>
            {variant === "stage" ? <span>Send</span> : null}
          </button>
          <button
            type="button"
            className={`ck-mic ${recording ? "is-rec" : ""}`}
            disabled={busy || !sttOk}
            onPointerDown={(ev: PointerEvent) => {
              ev.preventDefault();
              onPttStart();
            }}
            onPointerUp={(ev: PointerEvent) => {
              ev.preventDefault();
              onPttStop();
            }}
            onPointerLeave={() => onPttStop()}
          >
            {recording ? "Listening…" : "Hold to talk"}
          </button>
        </>
      )}
    </form>
  );
}
