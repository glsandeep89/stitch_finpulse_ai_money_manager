import { useState } from "react";
import { api, getApiBase } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

function hintForApiFailure(message: string): string | null {
  if (message !== "Failed to fetch") return null;
  const base = getApiBase();
  return [
    "The app could not reach the FinPulse API.",
    base.includes("localhost")
      ? "Production builds must set VITE_API_URL to your HTTPS API URL at build time."
      : "Check that the API is up, CORS allows this site, and the URL uses HTTPS.",
  ].join(" ");
}

/**
 * Connects accounts via SimpleFIN Bridge (setup token pasted once).
 * Kept export name `PlaidLinkButton` to avoid churn across pages.
 */
export function PlaidLinkButton({ onLinked }: { onLinked?: () => void }) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [setupToken, setSetupToken] = useState("");
  const [signupUrl, setSignupUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadSignup = async () => {
    setErr(null);
    if (!session?.access_token) {
      setErr("Session not ready. Refresh the page or sign in again, then try Link bank account.");
      return;
    }
    try {
      const info = await api<{
        signup_url?: string;
        help?: string;
        connect_api_version?: number;
      }>("/plaid/create_link_token", {
        method: "POST",
        body: "{}",
        accessToken: session.access_token,
      });
      if (info.connect_api_version !== 2) {
        setErr(
          "This site is talking to an older API build (missing SimpleFIN connect marker). Redeploy the FinPulse API from the current branch."
        );
        return;
      }
      setSignupUrl(info.signup_url ?? "https://bridge.simplefin.org/simplefin/create");
      setOpen(true);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not load SimpleFIN signup info");
    }
  };

  const connect = async () => {
    if (!session?.access_token) return;
    setErr(null);
    setBusy(true);
    try {
      await api("/plaid/exchange_public_token", {
        method: "POST",
        body: JSON.stringify({ setup_token: setupToken.trim() }),
        accessToken: session.access_token,
      });
      await api("/jobs/sync-my-data", {
        method: "POST",
        accessToken: session.access_token,
      });
      setSetupToken("");
      setOpen(false);
      onLinked?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not connect SimpleFIN");
    } finally {
      setBusy(false);
    }
  };

  const errHint = err ? hintForApiFailure(err) : null;

  return (
    <div className="flex flex-col gap-2 items-start max-w-md">
      <button
        type="button"
        disabled={busy}
        onClick={() => void loadSignup()}
        className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
      >
        {busy ? "Working…" : "Link bank account"}
      </button>

      {open ? (
        <div className="w-full rounded-xl border border-outline-variant/25 bg-surface-container-low p-4 space-y-3 text-sm font-body">
          <p className="text-on-surface-variant">
            FinPulse uses{" "}
            <a href="https://bridge.simplefin.org/info/developer" className="text-secondary underline" target="_blank" rel="noreferrer">
              SimpleFIN Bridge
            </a>
            . Create a one-time setup token, paste it below, and we exchange it for a private access URL stored on your
            account.
          </p>
          {signupUrl ? (
            <a
              href={signupUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-sm font-medium text-secondary hover:underline"
            >
              Open SimpleFIN token page
            </a>
          ) : null}
          <label className="block text-xs font-medium text-on-surface-variant">Setup token</label>
          <textarea
            className="w-full min-h-[88px] rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-xs text-on-surface font-mono"
            placeholder="Paste the base64 setup token from SimpleFIN Bridge"
            value={setupToken}
            onChange={(e) => setSetupToken(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !setupToken.trim()}
              onClick={() => void connect()}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-on-primary disabled:opacity-50"
            >
              Connect
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setErr(null);
              }}
              className="rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs text-on-surface"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {err ? (
        <p className="text-sm text-error max-w-md">
          {err}
          {errHint ? <span className="text-on-surface-variant"> {errHint}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
