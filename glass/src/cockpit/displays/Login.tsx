import { type FormEvent, useState } from "react";

type Props = { onEnter: () => void };

export function Login({ onEnter }: Props) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    onEnter();
  };

  return (
    <div className="ck-login">
      <img className="ck-login-bg" src="/theme-static/login.jpg" alt="" />
      <form className="ck-login-card" onSubmit={submit}>
        <label className="ck-login-field">
          <span>OPERATOR</span>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
            placeholder="gordon"
          />
        </label>
        <label className="ck-login-field">
          <span>ACCESS KEY</span>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </label>
        <button className="ck-login-enter" type="submit">
          Enter
        </button>
        <p className="ck-login-note">Stub auth — no credentials checked yet.</p>
      </form>
    </div>
  );
}
