import { useEffect, useRef } from "react";

/**
 * Hold Space to talk — the keyboard twin of the "Hold to talk" button.
 *
 * The engine owns *what* push-to-talk does (`startPtt` / `stopPtt` on
 * useJarvis); a key binding is a theme decision, so it lives here. Another
 * theme is free to bind something else, or nothing.
 */
type Options = {
  /** False on rooms without a cmd bar (the login gate). */
  enabled: boolean;
  recording: boolean;
  busy: boolean;
  sttOk: boolean;
  onStart: () => void;
  onStop: () => void;
  /** Escape cuts JARVIS off. Holding space does too, but via onStart —
   *  the engine barges in for us. */
  onInterrupt: () => void;
};

const KEY = " ";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  // BUTTON matters as much as INPUT: Space activates a focused button, so
  // without this the mic button's own click and this handler both fire.
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || el.isContentEditable;
}

export function useHoldToTalk({
  enabled,
  recording,
  busy,
  sttOk,
  onStart,
  onStop,
  onInterrupt,
}: Options): void {
  // Only release what this hook started, so a key-up cannot cut short a
  // recording the operator began by holding the button.
  const held = useRef(false);

  useEffect(() => {
    const release = () => {
      if (!held.current) return;
      held.current = false;
      onStop();
    };

    if (!enabled) {
      release();
      return;
    }

    const down = (ev: KeyboardEvent) => {
      // Escape is the explicit stop, and works from inside the cmd input too —
      // you may well be typing when you decide you have heard enough.
      if (ev.key === "Escape" && !ev.defaultPrevented) {
        onInterrupt();
        return;
      }
      if (ev.key !== KEY || ev.defaultPrevented) return;
      if (isTyping(ev.target)) return;
      // keydown autorepeats ~30x/s while held; without this each repeat would
      // spin up another MediaRecorder.
      if (ev.repeat) {
        ev.preventDefault();
        return;
      }
      // Space scrolls the page by default.
      ev.preventDefault();
      // busy is deliberately not a blocker: the engine interrupts first.
      if (held.current || recording || !sttOk) return;
      held.current = true;
      onStart();
    };

    const up = (ev: KeyboardEvent) => {
      if (ev.key !== KEY) return;
      if (!held.current) return;
      ev.preventDefault();
      release();
    };

    // A key-up never arrives if the window loses focus mid-hold, which would
    // otherwise leave the mic recording until the operator came back.
    const onHidden = () => {
      if (document.visibilityState === "hidden") release();
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [enabled, recording, busy, sttOk, onStart, onStop, onInterrupt]);
}
