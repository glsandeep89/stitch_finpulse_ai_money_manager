import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { FinPulseLogo } from "../components/FinPulseLogo";

function getErrorMessage(e: unknown): string {
  const raw =
    e instanceof Error
      ? e.message
      : e && typeof e === "object" && "message" in e
        ? String((e as { message: unknown }).message)
        : "";

  const code =
    e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";

  if (
    code === "over_email_send_rate_limit" ||
    /rate limit|too many emails/i.test(raw)
  ) {
    return [
      "Supabase has temporarily limited how many signup/confirmation emails it will send (to prevent spam).",
      "Wait an hour or try again tomorrow, or in Supabase go to Authentication → Providers → Email and turn off “Confirm email” for local development so sign-up does not send mail.",
    ].join(" ");
  }

  if (raw) return raw;
  return "Something went wrong. Check the browser console and your Supabase / .env settings.";
}

export default function Login() {
  const { signIn, signUp, user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await signIn(email, password);
      } else {
        const { needsEmailConfirmation } = await signUp(email, password);
        if (needsEmailConfirmation) {
          setNotice(
            "Account created. Open the confirmation link in the email from Supabase, then return here and sign in."
          );
        }
      }
    } catch (e: unknown) {
      setErr(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6 text-on-background">
      <div className="w-full max-w-md rounded-xl bg-surface-container-lowest p-8 ambient-shadow ring-1 ring-outline-variant/15 border border-outline-variant/10">
        <div className="flex items-center gap-3 mb-2">
          <FinPulseLogo size={40} className="rounded-lg shadow-sm" />
          <h1 className="font-headline text-2xl font-bold text-primary">FinPulse</h1>
        </div>
        <p className="text-sm text-on-surface-variant font-body mb-6">
          Sign in to connect accounts via SimpleFIN Bridge and view your data.
        </p>
        {!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY ? (
          <p className="text-sm text-on-surface bg-surface-container-low border border-outline-variant/30 rounded-lg p-3 mb-4 font-body">
            Missing <code className="text-xs">VITE_SUPABASE_URL</code> or{" "}
            <code className="text-xs">VITE_SUPABASE_ANON_KEY</code> in Vite env (<code className="text-xs">frontend/.env</code>{" "}
            for local or your hosting env vars in production). Auth cannot work until these are set (restart{" "}
            <code className="text-xs">npm run dev</code> after saving).
          </p>
        ) : null}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium font-label text-on-surface-variant mb-1">Email</label>
            <input
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium font-label text-on-surface-variant mb-1">Password</label>
            <input
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {err ? <p className="text-sm text-error font-body">{err}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-on-primary shadow-[0_8px_16px_rgba(11,28,48,0.1)] disabled:opacity-60 hover:bg-primary-container transition-colors"
          >
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        {notice ? (
          <p className="mt-4 text-sm text-on-tertiary-container bg-tertiary-fixed/30 border border-outline-variant/30 rounded-lg p-3 font-body">
            {notice}
          </p>
        ) : null}
        <button
          type="button"
          className="mt-4 text-sm text-secondary hover:text-primary hover:underline w-full text-center font-body"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setErr(null);
            setNotice(null);
          }}
        >
          {mode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
