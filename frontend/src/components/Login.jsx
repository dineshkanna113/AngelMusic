import { useEffect, useState } from "react";
import { api, auth } from "../lib/api";
import Wordmark from "./Wordmark";

export default function Login() {
  const [mode, setMode] = useState("login");
  const [status, setStatus] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/auth/status")
      .then((s) => {
        setStatus(s);
        if (!s.has_users && s.registration_open) setMode("register");
      })
      .catch((err) => setError(err.message));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      auth.set(await api(path, { method: "POST", body: { username: username.trim(), password } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const firstRun = status && !status.has_users && status.registration_open;
  // A production server with no users yet: the admin is created on the server itself.
  const awaitingAdmin = status && !status.has_users && !status.registration_open;

  return (
    <main className="relative grid min-h-dvh overflow-hidden bg-surface-0 px-5 py-10 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:items-center md:gap-12 md:px-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(60% 50% at 15% 85%, color-mix(in oklab, var(--color-marigold) 22%, transparent), transparent 70%), radial-gradient(45% 40% at 85% 10%, color-mix(in oklab, var(--color-kingfisher) 16%, transparent), transparent 70%)" }} />
      <div className="relative mb-10 md:mb-0">
        <h1 className="sr-only">Yaapu</h1>
        <Wordmark size="text-[clamp(4.5rem,15vw,11rem)]" className="-ml-1" />
        <p className="mt-5 max-w-md font-display text-xl text-fg-2 md:text-2xl" style={{ fontStretch: "88%" }}>
          Hear what your friends are playing, and play it louder.
        </p>
      </div>
      <form onSubmit={submit} className="panel relative w-full max-w-sm space-y-5 justify-self-start p-7 md:justify-self-end">
        <p className="text-sm text-muted">
          {awaitingAdmin
            ? "This server has no accounts yet. Create the admin on the server with: python -m app.manage create-user <name> --admin"
            : firstRun
            ? "Create the admin account for this server."
            : mode === "login"
              ? "Sign in to Yaapu."
              : "Create an account."}
        </p>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted">Username</span>
          <input
            className="input"
            autoComplete="username"
            autoFocus
            required
            minLength={3}
            maxLength={32}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted">Password</span>
          <input
            className="input"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "login" ? 1 : 8}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === "register" && <span className="block text-xs text-muted">At least 8 characters.</span>}
        </label>

        {error && <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>

        {status?.has_users && status.registration_open && (
          <button
            type="button"
            className="w-full text-center text-sm text-muted hover:text-fg"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
          >
            {mode === "login" ? "No account? Create one" : "Have an account? Sign in"}
          </button>
        )}
      </form>
    </main>
  );
}
