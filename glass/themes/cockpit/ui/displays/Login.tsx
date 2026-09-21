import { useEffect } from "react";

type Props = { onEnter: () => void; active: boolean };

export function Login({ onEnter, active }: Props) {
  useEffect(() => {
    // Every slide stays mounted, so an unguarded window listener fired on any
    // Enter anywhere — submitting the CMD channel or the NOC cmd bar yanked the
    // deck back to Earth. Only listen while the gate is the visible slide, and
    // never steal Enter from a field.
    if (!active) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Enter" || ev.defaultPrevented) return;
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
      onEnter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnter, active]);

  return (
    <div className="ck-login">
      <img className="ck-login-bg" src="/theme-static/login.jpg" alt="" />
      <span className="ck-login-tri" aria-hidden="true" />
      <button type="button" className="ck-login-gate" onClick={onEnter} aria-label="Enter" />
    </div>
  );
}
