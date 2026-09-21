import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

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

  // Focus only once the lid has finished lifting. Focusing synchronously meant
  // the *same* Enter that opened the gate produced a keypress on the freshly
  // focused input, which implicitly submitted the form and skipped the prompt
  // entirely — one keystroke went from sealed straight to Earth.
  useEffect(() => {
    if (gate !== "open") return;
    const id = window.setTimeout(() => pinRef.current?.focus(), 520);
    return () => window.clearTimeout(id);
  }, [gate]);

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

  const lift = reduceMotion ? 0 : -1;

  return (
    <div className="ck-login" data-gate={gate}>
      <img className="ck-login-bg" src="/theme-static/login-plate.jpg" alt="" />
      <div className="ck-login-glow" aria-hidden="true" />

      {/* The badge is the lid: it lifts and the prompt is underneath. */}
      <motion.button
        type="button"
        className="ck-login-badge"
        aria-label={gate === "sealed" ? "Reveal sign-in" : "Hide sign-in"}
        aria-expanded={gate === "open"}
        // The badge is a lid, so it toggles. It never navigates — reaching
        // Earth is the Authorise button's job alone.
        onClick={() => setGate((g) => (g === "sealed" ? "open" : "sealed"))}
        animate={{
          y: gate === "open" ? lift * 92 : 0,
          scale: gate === "open" ? 0.78 : 1,
        }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 140, damping: 20, mass: 0.9 }
        }
      >
        <img src="/theme-static/login-badge.png" alt="JARVIS — home-lab AI cluster command center" />
      </motion.button>

      <AnimatePresence>
        {gate === "open" ? (
          <motion.form
            key="prompt"
            className="ck-login-card"
            initial={reduceMotion ? false : { opacity: 0, y: 26, clipPath: "inset(0 0 100% 0)" }}
            animate={{ opacity: 1, y: 0, clipPath: "inset(0 0 0% 0)" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, clipPath: "inset(0 0 100% 0)" }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.42, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
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
