import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

const apiBase = import.meta.env.VITE_API_URL || "http://localhost:3001";

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

  const load = useCallback(async () => {
    setErr(null);
    try {
      const h = await fetch(`${apiBase}/health`);
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
    } catch {
      setFeatures(null);
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
    </div>
  );
}
