import { useState } from "react";
import { useApp } from "../store.jsx";

export default function Auth() {
  const { authenticate } = useApp();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await authenticate(mode, form);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1 className="logo big">Hi<span>Music</span></h1>
        <p className="muted">Ad-free music. Audio-only to save data.</p>
        {mode === "register" && (
          <input placeholder="Name" value={form.name} onChange={set("name")} required />
        )}
        <input type="email" placeholder="Email" value={form.email} onChange={set("email")} required />
        <input
          type="password"
          placeholder="Password (min 6)"
          value={form.password}
          onChange={set("password")}
          minLength={6}
          required
        />
        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={busy}>
          {busy ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setErr("");
          }}
        >
          {mode === "login" ? "New here? Create account" : "Have an account? Login"}
        </button>
        <p className="muted small">First request may take ~30s if the server is waking up.</p>
      </form>
    </div>
  );
}
