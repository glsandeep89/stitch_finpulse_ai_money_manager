import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

export default function SettingsAdvanced() {
  const { session, user } = useAuth();
  const [features, setFeatures] = useState<{ aiInsightsAvailable: boolean; geminiModel?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiFlags, setAiFlags] = useState<Record<string, boolean>>({});
  const [manualType, setManualType] = useState("retirement_contribution_plan");
  const [manualJson, setManualJson] = useState('{"annual401kLimit":23000,"current401k":0,"annualHsaLimit":4150,"currentHsa":0}');
  const [signalType, setSignalType] = useState("property_tax_trend");
  const [signalValue, setSignalValue] = useState("8");
  const [nudgePref, setNudgePref] = useState({ enabled: true, quiet_start_hour: 21, quiet_end_hour: 8 });

  const load = useCallback(async () => {
    setErr(null);
    if (!session?.access_token) return;
    try {
      const [feat, flags, prefs] = await Promise.all([
        api<{ aiInsightsAvailable: boolean; geminiModel?: string }>("/meta/features", {
          accessToken: session.access_token,
        }),
        api<{ flags: Record<string, boolean> }>("/meta/ai-feature-flags", {
          accessToken: session.access_token,
        }).catch(() => ({ flags: {} })),
        api<{ preferences: { enabled: boolean; quiet_start_hour: number; quiet_end_hour: number } }>(
          "/meta/ai-nudge-preferences",
          { accessToken: session.access_token }
        ).catch(() => ({ preferences: { enabled: true, quiet_start_hour: 21, quiet_end_hour: 8 } })),
      ]);
      setFeatures(feat);
      setAiFlags(flags.flags ?? {});
      setNudgePref({
        enabled: prefs.preferences.enabled,
        quiet_start_hour: prefs.preferences.quiet_start_hour,
        quiet_end_hour: prefs.preferences.quiet_end_hour,
      });
    } catch {
      setFeatures(null);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveFlag = async (flagKey: string, enabled: boolean) => {
    if (!session?.access_token) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/meta/ai-feature-flags", {
        method: "POST",
        accessToken: session.access_token,
        body: JSON.stringify({ flag_key: flagKey, enabled }),
      });
      setAiFlags((p) => ({ ...p, [flagKey]: enabled }));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const saveManualInput = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.access_token) return;
    setBusy(true);
    setErr(null);
    try {
      const payload = JSON.parse(manualJson) as Record<string, unknown>;
      await api("/meta/ai-manual-inputs", {
        method: "POST",
        accessToken: session.access_token,
        body: JSON.stringify({ input_type: manualType, payload }),
      });
      setOk("Manual AI input saved.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Invalid JSON or save failed");
    } finally {
      setBusy(false);
    }
  };

  const saveSignal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.access_token) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/meta/ai-external-signals", {
        method: "POST",
        accessToken: session.access_token,
        body: JSON.stringify({
          signal_type: signalType,
          source: "manual",
          metric_key: "trend_pct",
          metric_value: Number(signalValue),
          observed_at: new Date().toISOString().slice(0, 10),
        }),
      });
      setOk("External signal saved.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const saveNudgePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.access_token) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/meta/ai-nudge-preferences", {
        method: "POST",
        accessToken: session.access_token,
        body: JSON.stringify({
          ...nudgePref,
          channels: ["in_app"],
        }),
      });
      setOk("Nudge preferences saved.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-10 pb-12 max-w-xl">
      <div>
        <p className="text-sm text-on-surface-variant font-body mb-2">
          <Link to="/settings" className="text-primary hover:underline">
            ← Back to settings
          </Link>
        </p>
        <h1 className="font-headline text-3xl font-bold text-on-background tracking-tight">Advanced</h1>
        <p className="text-on-surface-variant mt-2 font-body text-sm">
          AI rollout, manual inputs, and nudge controls for {user?.email ?? "your account"}.
        </p>
      </div>

      {err ? <p className="text-sm text-error font-body">{err}</p> : null}
      {ok ? <p className="text-sm text-primary font-body">{ok}</p> : null}

      {features ? (
        <p className="text-xs text-on-surface-variant font-body">
          Gemini: {features.aiInsightsAvailable ? `configured${features.geminiModel ? ` · ${features.geminiModel}` : ""}` : "not configured"}
        </p>
      ) : null}

      <section className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/10 shadow-ambient">
        <h2 className="font-headline text-lg font-semibold text-on-surface mb-4">AI rollout flags</h2>
        <div className="space-y-2 text-sm font-body">
          {["forecast", "anomaly", "nlq", "automation", "coaching", "compliance", "escrow"].map((k) => (
            <label key={k} className="flex items-center justify-between gap-3">
              <span className="text-on-surface">{k}</span>
              <input
                type="checkbox"
                checked={Boolean(aiFlags[k])}
                onChange={(e) => void saveFlag(k, e.target.checked)}
                disabled={busy}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/10 shadow-ambient">
        <h2 className="font-headline text-lg font-semibold text-on-surface mb-4">AI manual inputs</h2>
        <form onSubmit={saveManualInput} className="space-y-3">
          <input
            value={manualType}
            onChange={(e) => setManualType(e.target.value)}
            className="w-full rounded-lg border border-outline-variant/40 px-3 py-2 text-sm"
          />
          <textarea
            value={manualJson}
            onChange={(e) => setManualJson(e.target.value)}
            className="w-full rounded-lg border border-outline-variant/40 px-3 py-2 text-xs font-mono min-h-[120px]"
          />
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-secondary-container text-on-secondary-container text-sm"
          >
            Save manual input
          </button>
        </form>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/10 shadow-ambient">
        <h2 className="font-headline text-lg font-semibold text-on-surface mb-4">External trend signal</h2>
        <form onSubmit={saveSignal} className="space-y-3">
          <input
            value={signalType}
            onChange={(e) => setSignalType(e.target.value)}
            className="w-full rounded-lg border border-outline-variant/40 px-3 py-2 text-sm"
            placeholder="signal_type"
          />
          <input
            value={signalValue}
            onChange={(e) => setSignalValue(e.target.value)}
            className="w-full rounded-lg border border-outline-variant/40 px-3 py-2 text-sm"
            placeholder="metric value"
          />
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-secondary-container text-on-secondary-container text-sm"
          >
            Save external signal
          </button>
        </form>
      </section>

      <section className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/10 shadow-ambient">
        <h2 className="font-headline text-lg font-semibold text-on-surface mb-4">Nudge preferences</h2>
        <form onSubmit={saveNudgePrefs} className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={nudgePref.enabled}
              onChange={(e) => setNudgePref((p) => ({ ...p, enabled: e.target.checked }))}
            />
            Enable nudges
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              min={0}
              max={23}
              value={nudgePref.quiet_start_hour}
              onChange={(e) => setNudgePref((p) => ({ ...p, quiet_start_hour: Number(e.target.value) }))}
              className="rounded-lg border border-outline-variant/40 px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={0}
              max={23}
              value={nudgePref.quiet_end_hour}
              onChange={(e) => setNudgePref((p) => ({ ...p, quiet_end_hour: Number(e.target.value) }))}
              className="rounded-lg border border-outline-variant/40 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-secondary-container text-on-secondary-container text-sm"
          >
            Save nudge preferences
          </button>
        </form>
      </section>
    </div>
  );
}
