import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../store.jsx";

// screens: login | register | verify (6-digit code after sign-up) | forgot | reset
export default function Auth() {
  const { acceptAuth } = useApp();
  const [screen, setScreen] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", code: "" });
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const go = (s) => {
    setScreen(s);
    setErr("");
    setInfo("");
  };

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const run = async (fn) => {
    setErr("");
    setInfo("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
      if (e.retryAfter && e.retryAfter < 120) setWait(e.retryAfter);
    } finally {
      setBusy(false);
    }
  };

  const email = form.email.trim();

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (screen === "login") acceptAuth(await api.login({ email, password: form.password }));
      else if (screen === "register") {
        const r = await api.register({ name: form.name, email, password: form.password });
        if (r.token) return acceptAuth(r);
        setWait(r.resendIn || 60);
        setForm((f) => ({ ...f, code: "" }));
        go("verify");
        setInfo(`We sent a 6-digit code to ${r.email}. Check your inbox (and spam).`);
      } else if (screen === "verify") acceptAuth(await api.verify({ email, code: form.code.trim() }));
      else if (screen === "forgot") {
        const r = await api.forgot({ email });
        setWait(r.resendIn || 60);
        setForm((f) => ({ ...f, code: "", password: "" }));
        go("reset");
        setInfo("If that email has an account, a 6-digit code is on its way.");
      } else if (screen === "reset") acceptAuth(await api.reset({ email, code: form.code.trim(), password: form.password }));
    });
  };

  const resend = () =>
    run(async () => {
      const r = screen === "verify" ? await api.resend({ email }) : await api.forgot({ email });
      setWait(r.resendIn || 60);
      setInfo("New code sent.");
    });

  const title = { login: "Log in", register: "Create account", verify: "Verify your email", forgot: "Reset password", reset: "Choose a new password" }[screen];
  const btn = { login: "Log in", register: "Send verification code", verify: "Verify & continue", forgot: "Send code", reset: "Save password & log in" }[screen];
  const codeScreen = screen === "verify" || screen === "reset";

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <img className="auth-logo" src="/logo.png" alt="HiMusic" width="84" height="84" />
        <h1 className="logo big">Hi<span>Music</span></h1>
        <h2 className="auth-title">{title}</h2>

        {screen === "register" && (
          <input placeholder="Name" value={form.name} onChange={set("name")} autoComplete="name" required maxLength={60} />
        )}
        <input
          type="email"
          placeholder={screen === "register" ? "Gmail address" : "Email"}
          value={form.email}
          onChange={set("email")}
          autoComplete="email"
          readOnly={codeScreen}
          required
        />
        {codeScreen && (
          <input
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="6-digit code"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, "") })}
            autoComplete="one-time-code"
            className="code-input"
            required
          />
        )}
        {(screen === "login" || screen === "register" || screen === "reset") && (
          <input
            type="password"
            placeholder={screen === "login" ? "Password" : screen === "reset" ? "New password (min 8)" : "Password (min 8 characters)"}
            value={form.password}
            onChange={set("password")}
            autoComplete={screen === "login" ? "current-password" : "new-password"}
            minLength={screen === "login" ? undefined : 8}
            required
          />
        )}

        {info && <div className="info">{info}</div>}
        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={busy}>{busy ? "Please wait..." : btn}</button>

        {codeScreen && (
          <button type="button" className="link" disabled={busy || wait > 0} onClick={resend}>
            {wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
          </button>
        )}
        {screen === "login" && (
          <>
            <button type="button" className="link" onClick={() => go("forgot")}>Forgot password?</button>
            <button type="button" className="link" onClick={() => go("register")}>New here? Create account</button>
          </>
        )}
        {screen !== "login" && (
          <button type="button" className="link" onClick={() => go("login")}>Back to log in</button>
        )}
        <p className="muted small">First request may take ~30s if the server is waking up.</p>
      </form>
    </div>
  );
}
