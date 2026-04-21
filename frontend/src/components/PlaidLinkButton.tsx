import { useEffect, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { api, getApiBase } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

function LinkInstance({
  token,
  onDone,
  onLinkError,
}: {
  token: string;
  onDone: () => void;
  onLinkError: (message: string) => void;
}) {
  const { session } = useAuth();
  const opened = useRef(false);

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async (public_token) => {
      try {
        await api("/plaid/exchange_public_token", {
          method: "POST",
          body: JSON.stringify({ public_token }),
          accessToken: session?.access_token,
        });
        await api("/jobs/sync-my-data", {
          method: "POST",
          accessToken: session?.access_token,
        });
        onDone();
      } catch (e: unknown) {
        onLinkError(e instanceof Error ? e.message : "Could not finish linking");
      }
    },
    onExit: () => onDone(),
  });

  useEffect(() => {
    if (ready && !opened.current) {
      opened.current = true;
      open();
    }
  }, [ready, open]);

  return null;
}

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

export function PlaidLinkButton({ onLinked }: { onLinked?: () => void }) {
  const { session } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => {
    setErr(null);
    setBusy(true);
    try {
      const { link_token } = await api<{ link_token: string }>("/plaid/create_link_token", {
        method: "POST",
        body: "{}",
        accessToken: session?.access_token,
      });
      setToken(link_token);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not start Plaid Link";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  const errHint = err ? hintForApiFailure(err) : null;

  return (
    <>
      {token ? (
        <LinkInstance
          token={token}
          onDone={() => {
            setToken(null);
            onLinked?.();
          }}
          onLinkError={(message) => {
            setErr(message);
            setToken(null);
          }}
        />
      ) : null}
      <div className="flex flex-col gap-2 items-start">
        <button
          type="button"
          disabled={busy}
          onClick={start}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
        >
          {busy ? "Starting…" : "Link bank account"}
        </button>
        {err ? (
          <p className="text-sm text-error max-w-md">
            {err}
            {errHint ? <span className="text-on-surface-variant"> {errHint}</span> : null}
          </p>
        ) : null}
      </div>
    </>
  );
}
