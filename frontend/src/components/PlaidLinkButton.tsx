import { useEffect, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

function LinkInstance({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const { session } = useAuth();
  const opened = useRef(false);

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async (public_token) => {
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

export function PlaidLinkButton({ onLinked }: { onLinked?: () => void }) {
  const { session } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const { link_token } = await api<{ link_token: string }>("/plaid/create_link_token", {
        method: "POST",
        body: "{}",
        accessToken: session?.access_token,
      });
      setToken(link_token);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {token ? (
        <LinkInstance
          token={token}
          onDone={() => {
            setToken(null);
            onLinked?.();
          }}
        />
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={start}
        className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
      >
        {busy ? "Starting…" : "Link bank account"}
      </button>
    </>
  );
}
