import { useEffect } from "react";

type Props = { onEnter: () => void };

export function Login({ onEnter }: Props) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter") onEnter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnter]);

  return (
    <div className="ck-login">
      <img className="ck-login-bg" src="/theme-static/login.jpg" alt="" />
      <span className="ck-login-tri" aria-hidden="true" />
      <button type="button" className="ck-login-gate" onClick={onEnter} aria-label="Enter" />
    </div>
  );
}
