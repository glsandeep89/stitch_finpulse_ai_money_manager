import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

type Summary = {
  inHousehold: boolean;
  householdId: string | null;
  name: string | null;
  joinCode: string | null;
  memberIds: string[];
};

export default function Household() {
  const { session } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setErr(null);
    try {
      const s = await api<Summary>("/households/me", { accessToken: session.access_token });
      setSummary(s);
      if (s.name) setRenameValue(s.name);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, [session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.access_token) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/households", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() || undefined }),
        accessToken: session.access_token,
      });
      setName("");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.access_token) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/households/join", {
        method: "POST",
        body: JSON.stringify({ join_code: joinCode.trim() }),
        accessToken: session.access_token,
      });
      setJoinCode("");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.access_token || !renameValue.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/households/me", {
        method: "PATCH",
        body: JSON.stringify({ name: renameValue.trim() }),
        accessToken: session.access_token,
      });
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!session?.access_token) return;
    if (!window.confirm("Leave this household? You can create or join another later.")) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/households/leave", { method: "POST", accessToken: session.access_token });
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8 pb-8 max-w-2xl">
      <div>
        <h1 className="font-headline text-3xl font-bold text-on-background tracking-tight">Household</h1>
        <p className="text-on-surface-variant mt-2 font-body text-sm">
          Link accounts stay per person. Choose <strong className="text-on-surface">Household</strong> in the top
          bar to combine spending and balances across everyone here.
        </p>
      </div>

      {err ? <p className="text-sm text-error font-body">{err}</p> : null}

      {summary?.inHousehold ? (
        <section className="bg-surface-container-lowest rounded-xl p-6 ambient-shadow ring-1 ring-outline-variant/10 border border-outline-variant/10">
          <h2 className="font-headline font-semibold text-on-surface mb-2">Your household</h2>
          <p className="text-sm text-on-surface-variant font-body mb-4">
            <span className="font-medium text-on-surface">{summary.name ?? "Household"}</span> —{" "}
            {summary.memberIds.length} member{summary.memberIds.length === 1 ? "" : "s"}
          </p>
          {summary.joinCode ? (
            <p className="font-body text-sm text-on-surface">
              Invite code:{" "}
              <code className="bg-surface-container-low px-2 py-1 rounded-md text-primary font-mono">
                {summary.joinCode}
              </code>
            </p>
          ) : null}
          <form onSubmit={rename} className="mt-6 space-y-3">
            <div>
              <label className="block text-xs font-label text-on-surface-variant mb-1">Rename household (owner)</label>
              <input
                className="w-full rounded-lg border border-outline-variant/40 px-3 py-2 text-sm text-on-surface bg-surface-container-lowest"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="text-sm bg-secondary-container text-on-secondary-container px-4 py-2 rounded-xl disabled:opacity-60"
            >
              Save name
            </button>
          </form>
          <div className="mt-6 pt-6 border-t border-outline-variant/15">
            <button
              type="button"
              onClick={() => void leave()}
              disabled={busy}
              className="text-sm text-error border border-error/40 px-4 py-2 rounded-xl hover:bg-error/5 disabled:opacity-60"
            >
              Leave household
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="bg-surface-container-lowest rounded-xl p-6 ambient-shadow ring-1 ring-outline-variant/10 border border-outline-variant/10">
            <h2 className="font-headline font-semibold text-on-surface mb-4">Create a household</h2>
            <form onSubmit={create} className="space-y-4">
              <div>
                <label className="block text-xs font-label text-on-surface-variant mb-1">Name (optional)</label>
                <input
                  className="w-full rounded-lg border border-outline-variant/40 px-3 py-2 text-sm text-on-surface bg-surface-container-lowest"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. The Smiths"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="bg-primary text-on-primary px-6 py-2.5 rounded-xl text-sm font-medium disabled:opacity-60"
              >
                {busy ? "…" : "Create"}
              </button>
            </form>
          </section>

          <section className="bg-surface-container-lowest rounded-xl p-6 ambient-shadow ring-1 ring-outline-variant/10 border border-outline-variant/10">
            <h2 className="font-headline font-semibold text-on-surface mb-4">Join with a code</h2>
            <form onSubmit={join} className="space-y-4">
              <div>
                <label className="block text-xs font-label text-on-surface-variant mb-1">Join code</label>
                <input
                  className="w-full rounded-lg border border-outline-variant/40 px-3 py-2 text-sm text-on-surface bg-surface-container-lowest font-mono uppercase"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="8 characters"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="border border-outline-variant text-on-surface px-6 py-2.5 rounded-xl text-sm font-medium disabled:opacity-60"
              >
                {busy ? "…" : "Join household"}
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
