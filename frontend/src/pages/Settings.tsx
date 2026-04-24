import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getApiBase } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { SimplifinLinkButton } from "../components/SimplifinLinkButton";

const ADVANCED_STORAGE_KEY = "finpulse_show_advanced_settings";

function readShowAdvancedDefault(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem(ADVANCED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Settings() {
  const { session, user } = useAuth();
  const [features, setFeatures] = useState<{ aiInsightsAvailable: boolean; geminiModel?: string } | null>(null);
  const [health, setHealth] = useState<{ ok?: boolean; service?: string } | null>(null);
  const [profileName, setProfileName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdvancedNav, setShowAdvancedNav] = useState(readShowAdvancedDefault);
  const [simplifinItems, setSimplifinItems] = useState<
    {
      id: string;
      item_id: string;
      created_at: string | null;
      updated_at: string | null;
      accounts: { name: string | null; mask: string | null }[];
    }[]
  >([]);
  const [unlinkTarget, setUnlinkTarget] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [unlinkDeleteHistory, setUnlinkDeleteHistory] = useState(false);
  const [unlinkBusy, setUnlinkBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const h = await fetch(`${getApiBase()}/health`);
      setHealth(await h.json());
    } catch {
      setHealth(null);
    }
    if (!session?.access_token) return;
    try {
      const [feat, prof] = await Promise.all([
        api<{ aiInsightsAvailable: boolean; geminiModel?: string }>("/meta/features", {
          accessToken: session.access_token,
        }),
        api<{ profile: { display_name?: string | null } | null }>("/profile", {
          accessToken: session.access_token,
        }).catch(() => ({ profile: null })),
      ]);
      setFeatures(feat);
      setProfileName(prof.profile?.display_name ?? "");
      const linked = await api<{
        items: {
          id: string;
          item_id: string;
          created_at: string | null;
          updated_at: string | null;
          accounts: { name: string | null; mask: string | null }[];
        }[];
      }>("/plaid/items", {
        accessToken: session.access_token,
      }).catch(() => ({ items: [] }));
      setSimplifinItems(linked.items ?? []);
    } catch {
      setFeatures(null);
      setSimplifinItems([]);
    }
  }, [session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleAdvancedLink = () => {
    const next = !showAdvancedNav;
    setShowAdvancedNav(next);
    try {
      localStorage.setItem(ADVANCED_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.access_token) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await api("/profile", {
        method: "PATCH",
        accessToken: session.access_token,
        body: JSON.stringify({ display_name: profileName.trim() || null }),
      });
      setOk("Profile saved.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErr("Passwords do not match.");
      return;
    }
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword("");
      setConfirmPassword("");
      setOk("Password updated.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const refreshAccounts = async () => {
    if (!session?.access_token) return;
    setErr(null);
    setOk(null);
    setRefreshAccountsBusy(true);
    try {
      await api("/plaid/accounts?refresh=true", {
        accessToken: session.access_token,
      });
      setOk("Accounts refreshed from your bank (SimpleFIN).");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to refresh accounts");
    } finally {
      setRefreshAccountsBusy(false);
    }
  };

  const unlinkSelectedItem = async () => {
    if (!session?.access_token || !unlinkTarget) return;
    setErr(null);
    setOk(null);
    setUnlinkBusy(true);
    try {
      await api("/plaid/unlink-item", {
        method: "POST",
        accessToken: session.access_token,
        body: JSON.stringify({
          simplifinItemId: unlinkTarget.id,
          deleteHistory: unlinkDeleteHistory,
        }),
      });
      setOk(
        unlinkDeleteHistory
          ? "Connection unlinked and imported history deleted."
          : "Connection unlinked. Historical data was kept."
      );
      setUnlinkTarget(null);
      setUnlinkDeleteHistory(false);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to unlink item");
    } finally {
      setUnlinkBusy(false);
    }
  };

  return (
    <div className="space-y-10 pb-12 max-w-xl">
      <div>
        <h1 className="font-headline text-3xl font-bold text-on-background tracking-tight">Settings</h1>
        <p className="text-on-surface-variant mt-2 font-body text-sm">
          Connection status, profile, and account security.
        </p>
      </div>

      {err ? <p className="text-sm text-error font-body">{err}</p> : null}
      {ok ? <p className="text-sm text-primary font-body">{ok}</p> : null}

      <section
        className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/10 shadow-ambient"
        aria-labelledby="health-heading"
      >
        <h2 id="health-heading" className="font-headline text-lg font-semibold text-on-surface mb-4">
          Service health
        </h2>
        <ul className="space-y-2 text-sm font-body text-on-surface-variant">
          <li>
            API:{" "}
            <span className="text-on-surface">
              {health?.ok ? "reachable" : "unreachable or blocked"}
            </span>
            {health?.service ? ` (${health.service})` : ""}
          </li>
          <li>
            Gemini (Insights / assistant):{" "}
            <span className="text-on-surface">
              {features?.aiInsightsAvailable ? "configured" : "not configured"}
            </span>
            {features?.geminiModel ? ` · ${features.geminiModel}` : ""}
          </li>
          <li>
            Supabase auth:{" "}
            <span className="text-on-surface">{user?.email ? `signed in as ${user.email}` : "—"}</span>
          </li>
        </ul>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/10 shadow-ambient">
        <h2 className="font-headline text-lg font-semibold text-on-surface mb-2">Linked bank connections</h2>
        <p className="text-sm text-on-surface-variant font-body mb-4">
          Connect with a SimpleFIN setup token, or pull the latest account names, types, and balances from
          SimpleFIN.
        </p>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-start mb-6">
          <SimplifinLinkButton
            onLinked={() => {
              void load();
            }}
          />
          <div className="flex flex-col gap-1">
            <button
              type="button"
              disabled={!session || refreshAccountsBusy}
              onClick={() => void refreshAccounts()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-outline-variant/40 bg-surface-container-low px-4 py-2 text-sm font-medium text-on-surface hover:bg-surface-container disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-lg" aria-hidden>
                sync
              </span>
              {refreshAccountsBusy ? "Refreshing…" : "Refresh accounts"}
            </button>
            <p className="text-xs text-on-surface-variant max-w-md">
              Use this if account types still show as &quot;other&quot; or balances look stale.
            </p>
          </div>
        </div>
        {simplifinItems.length === 0 ? (
          <p className="text-sm text-on-surface-variant font-body">No bank connections linked (SimpleFIN).</p>
        ) : (
          <div className="space-y-3">
            {simplifinItems.map((item) => (
              <div key={item.id} className="rounded-lg border border-outline-variant/20 p-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-on-surface">
                      Item {item.item_id.slice(0, 10)}...
                    </p>
                    <p className="text-xs text-on-surface-variant mt-1">
                      {item.accounts.length} account{item.accounts.length === 1 ? "" : "s"} linked
                    </p>
                    <p className="text-xs text-on-surface-variant mt-1">
                      {item.accounts
                        .slice(0, 3)
                        .map((a) => `${a.name ?? "Account"}${a.mask ? ` •${a.mask}` : ""}`)
                        .join(", ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-error/10 text-error hover:bg-error/15"
                    onClick={() =>
                      setUnlinkTarget({
                        id: item.id,
                        label: `${item.accounts[0]?.name ?? "connection"} (${item.item_id.slice(0, 8)}...)`,
                      })
                    }
                  >
                    Unlink
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/10 shadow-ambient">
        <h2 className="font-headline text-lg font-semibold text-on-surface mb-4">Profile</h2>
        <form onSubmit={saveProfile} className="space-y-4">
          <div>
            <label htmlFor="display-name" className="block text-xs font-label text-on-surface-variant mb-1">
              Display name
            </label>
            <input
              id="display-name"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="w-full rounded-lg border border-outline-variant/40 px-3 py-2 text-sm text-on-surface bg-surface-container-lowest"
              maxLength={200}
              autoComplete="name"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !session}
            className="px-4 py-2 rounded-xl bg-secondary-container text-on-secondary-container text-sm font-medium disabled:opacity-50"
          >
            Save profile
          </button>
        </form>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/10 shadow-ambient">
        <h2 className="font-headline text-lg font-semibold text-on-surface mb-4">Change password</h2>
        <form onSubmit={changePassword} className="space-y-4">
          <div>
            <label htmlFor="new-pass" className="block text-xs font-label text-on-surface-variant mb-1">
              New password
            </label>
            <input
              id="new-pass"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-outline-variant/40 px-3 py-2 text-sm text-on-surface bg-surface-container-lowest"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label htmlFor="confirm-pass" className="block text-xs font-label text-on-surface-variant mb-1">
              Confirm password
            </label>
            <input
              id="confirm-pass"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-outline-variant/40 px-3 py-2 text-sm text-on-surface bg-surface-container-lowest"
              autoComplete="new-password"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !session}
            className="px-4 py-2 rounded-xl bg-secondary-container text-on-secondary-container text-sm font-medium disabled:opacity-50"
          >
            Update password
          </button>
        </form>
      </section>

      <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low/50 p-4 space-y-3">
        <p className="text-sm text-on-surface-variant font-body">
          AI feature flags, manual inputs, and nudge tuning live on a separate page.
        </p>
        {showAdvancedNav ? (
          <Link
            to="/settings/advanced"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            Open advanced settings
            <span className="material-symbols-outlined text-base">chevron_right</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={toggleAdvancedLink}
            className="text-sm text-on-surface-variant hover:text-on-surface underline font-body"
          >
            Show advanced settings link
          </button>
        )}
        {import.meta.env.DEV ? (
          <p className="text-xs text-on-surface-variant">Dev build: advanced link is always shown.</p>
        ) : null}
      </div>

      {unlinkTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-md rounded-xl bg-surface-container-lowest border border-outline-variant/20 p-5 shadow-ambient">
            <h3 className="font-headline text-lg font-semibold text-on-surface">Unlink connection?</h3>
            <p className="text-sm text-on-surface-variant mt-2">
              This will stop future syncs for <span className="font-medium text-on-surface">{unlinkTarget.label}</span>.
            </p>
            <label className="mt-4 flex items-start gap-3 text-sm text-on-surface">
              <input
                type="checkbox"
                checked={unlinkDeleteHistory}
                onChange={(e) => setUnlinkDeleteHistory(e.target.checked)}
                className="mt-1"
              />
              <span>Also delete imported transactions/subscriptions/refunds tied to this connection.</span>
            </label>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded-lg text-sm border border-outline-variant/30"
                onClick={() => {
                  setUnlinkTarget(null);
                  setUnlinkDeleteHistory(false);
                }}
                disabled={unlinkBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-lg text-sm bg-error text-on-error disabled:opacity-60"
                onClick={() => void unlinkSelectedItem()}
                disabled={unlinkBusy}
              >
                {unlinkBusy ? "Unlinking..." : "Confirm unlink"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
