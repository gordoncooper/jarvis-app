import { type FormEvent, type PointerEvent, useRef } from "react";

type Props = {
  busy: boolean;
  recording: boolean;
  sttOk: boolean;
  onSubmit: (text: string) => void;
  onPttStart: () => void;
  onPttStop: () => void;
};

export function Console({
  busy,
  recording,
  sttOk,
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

  const down = (ev: PointerEvent) => {
    ev.preventDefault();
    onPttStart();
  };
  const up = (ev: PointerEvent) => {
    ev.preventDefault();
    onPttStop();
  };

  return (
    <form className="hud-console" onSubmit={submit}>
      <span className="hud-console-label">CMD</span>
      <input
        ref={input}
        type="text"
        placeholder="Speak freely…"
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
      />
      <button className="hud-send" type="submit" disabled={busy}>
        Send
      </button>
      <button
        type="button"
        className={`mic ${recording ? "recording" : ""}`}
        disabled={busy || !sttOk}
        onPointerDown={down}
        onPointerUp={up}
        onPointerLeave={() => onPttStop()}
      >
        {recording ? "Listening…" : "Hold to talk"}
      </button>
    </form>
  );
}
