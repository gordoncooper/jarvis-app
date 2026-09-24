import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

type Props = { onEnter: () => void; active: boolean };

/** sealed -> the badge is the only control; open -> the prompt is revealed. */
type Gate = "sealed" | "open";

const OPERATOR = "GORDON";

/** Deterministic rack lamps. Delays are staggered so they never blink as one. */
const RACK_LEDS = Array.from({ length: 42 }, (_, i) => {
  const row = Math.floor(i / 6);
  const col = i % 6;
  return {
    x: 8 + col * 15,
    y: 3 + row * 13.4,
    delay: ((i * 0.47) % 5.8).toFixed(2),
    dur: (1.15 + (i % 7) * 0.38).toFixed(2),
    warn: i % 13 === 0,
    soft: i % 5 === 0,
  };
});

const WALL_SEAMS = [
  { y: "14%", delay: "0s" },
  { y: "31%", delay: "3.4s" },
  { y: "63%", delay: "7.1s" },
  { y: "81%", delay: "1.8s" },
];

function LoginLife() {
  return (
    <div className="ck-login-life" aria-hidden="true">
      {(["l", "r"] as const).map((side) => (
        <div key={side} className={`ck-login-rack is-${side}`}>
          {RACK_LEDS.map((led, i) => (
            <i
              key={i}
              className={led.warn ? "is-warn" : led.soft ? "is-soft" : undefined}
              style={{
                left: `${led.x}%`,
                top: `${led.y}%`,
                animationDelay: `${led.delay}s`,
                animationDuration: `${led.dur}s`,
              }}
            />
          ))}
        </div>
      ))}
      <div className="ck-login-wall">
        {WALL_SEAMS.map((seam) => (
          <span key={seam.y} className="ck-login-seam" style={{ top: seam.y, animationDelay: seam.delay }} />
        ))}
        <span className="ck-login-seam is-v" style={{ left: "11%", animationDelay: "2.2s" }} />
        <span className="ck-login-seam is-v" style={{ left: "86%", animationDelay: "6.4s" }} />
        <span className="ck-login-scan" />
      </div>
      <div className="ck-login-floor" />
    </div>
  );
}

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
    const id = window.setTimeout(() => pinRef.current?.focus(), reduceMotion ? 40 : 620);
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
      <LoginLife />

      {/* The mark shears into three bands and clears. It never navigates. */}
      <button
        type="button"
        className="ck-login-badge"
        aria-label={gate === "sealed" ? "Reveal sign-in" : "Hide sign-in"}
        aria-expanded={gate === "open"}
        aria-hidden={gate === "open"}
        tabIndex={gate === "open" ? -1 : 0}
        onClick={() => setGate("open")}
      >
        <span className="ck-login-badge-face">
          <img className="ck-login-badge-spacer" src="/theme-static/login-badge.png" alt="" />
          {(
            [
              ["inset(0 0 66.8% 0)", "is-out"],
              ["inset(32.8% 0 33.2% 0)", "is-in"],
              ["inset(66.4% 0 0 0)", "is-out is-late"],
            ] as const
          ).map(([inset, tone]) => (
            <span key={inset} className={`ck-login-band ${tone}`} style={{ clipPath: inset }}>
              <img src="/theme-static/login-badge.png" alt="" />
            </span>
          ))}
          <span className="ck-login-burst" aria-hidden="true" />
          <span className="ck-login-sheen" aria-hidden="true">
            <span className="ck-login-streak" />
          </span>
        </span>
      </button>

      <AnimatePresence>
        {gate === "open" ? (
          <motion.form
            key="prompt"
            className="ck-login-card"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: 0.34 }}
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
