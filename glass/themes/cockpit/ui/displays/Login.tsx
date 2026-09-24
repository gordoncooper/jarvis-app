import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

type Props = { onEnter: () => void; active: boolean };

/** sealed -> the badge is the only control; open -> the prompt is revealed. */
type Gate = "sealed" | "open";

const OPERATOR = "GORDON";

export function Login({ onEnter, active }: Props) {
  const [gate, setGate] = useState<Gate>("sealed");
  const [pin, setPin] = useState("");
  const reduceMotion = useReducedMotion();
  const pinRef = useRef<HTMLInputElement>(null);

  // Coming back to the gate re-seals it, so the lid is not left hanging open.
  useEffect(() => {
    if (!active) {
      setGate("sealed");
      setPin("");
    }
  }, [active]);

  // Focus only once the door has swung clear. Focusing synchronously meant
  // the *same* Enter that opened the gate produced a keypress on the freshly
  // focused input, which implicitly submitted the form and skipped the prompt
  // entirely — one keystroke went from sealed straight to Breath.
  useEffect(() => {
    if (gate !== "open") return;
    const id = window.setTimeout(() => pinRef.current?.focus(), reduceMotion ? 40 : 780);
    return () => window.clearTimeout(id);
  }, [gate, reduceMotion]);

  useEffect(() => {
    // Only while the gate is the visible slide, and never steal Enter from a
    // field — every slide stays mounted, so an unguarded listener would fire
    // on any Enter anywhere in the deck.
    if (!active) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented) return;
      const tag = (ev.target as HTMLElement | null)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON";
      if (ev.key === "Escape" && gate === "open") {
        setGate("sealed");
        return;
      }
      if (ev.key !== "Enter" || inField) return;
      // Enter lifts the lid. It does not authorise: only Authorise does, and
      // Enter inside the field is a form submit, which is the same thing.
      if (gate === "sealed") setGate("open");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnter, active, gate]);

  // A click on the plate, outside the prompt, lowers the door again.
  // The opening click itself still sees gate === "sealed" in this render,
  // so it cannot immediately close what it just opened.
  const onPlate = (ev: ReactPointerEvent) => {
    if (gate !== "open") return;
    const t = ev.target as HTMLElement | null;
    if (t?.closest(".ck-login-card")) return;
    setGate("sealed");
  };

  return (
    <div className="ck-login" data-gate={gate} onPointerDown={onPlate}>
      <img className="ck-login-bg" src="/theme-static/login-plate.jpg" alt="" />
      <div className="ck-login-glow" aria-hidden="true" />

      {/* The badge is a garage door: hinged at the top, it swings up and
          out of the way. It never navigates — Authorise does that. */}
      <motion.button
        type="button"
        className="ck-login-badge"
        aria-label={gate === "sealed" ? "Reveal sign-in" : "Hide sign-in"}
        aria-expanded={gate === "open"}
        aria-hidden={gate === "open"}
        tabIndex={gate === "open" ? -1 : 0}
        onClick={() => setGate("open")}
        initial={false}
        animate={
          gate === "open"
            ? { rotateX: reduceMotion ? 0 : 86, opacity: 0 }
            : { rotateX: 0, opacity: 1 }
        }
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: 0.72, ease: [0.45, 0.02, 0.15, 1] }
        }
        style={{ transformOrigin: "50% 0%", transformPerspective: 1200 }}
      >
        <img src="/theme-static/login-badge.png" alt="JARVIS — home-lab AI cluster command center" />
      </motion.button>

      <AnimatePresence>
        {gate === "open" ? (
          <motion.form
            key="prompt"
            className="ck-login-card"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.35, ease: [0.22, 1, 0.36, 1], delay: 0.28 }}
            onSubmit={(ev) => {
              ev.preventDefault();
              onEnter();
            }}
          >
            <div className="ck-login-rule" aria-hidden="true" />
            <label className="ck-login-field">
              OPERATOR
              <input value={OPERATOR} readOnly tabIndex={-1} />
            </label>
            <label className="ck-login-field">
              {/* Presence gate, not authentication — the orchestrator has no
                  auth yet and the field must not pretend otherwise. */}
              PASSPHRASE · NOT YET ENFORCED
              <input
                ref={pinRef}
                type="password"
                value={pin}
                onChange={(ev) => setPin(ev.target.value)}
                placeholder="optional"
                autoComplete="off"
              />
            </label>
            <button type="submit" className="ck-login-enter">
              Authorise
            </button>
            <p className="ck-login-note">LAN presence gate · no credential is checked</p>
          </motion.form>
        ) : null}
      </AnimatePresence>

      {gate === "sealed" ? <p className="ck-login-hint">Touch the mark to begin</p> : null}
    </div>
  );
}
