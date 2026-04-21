import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AiOutputCard, AiOutputEmpty } from "../components/ai/AiOutputCard";
import { api } from "../lib/api";
import type { AiOutputRow, AiOutputsResponse } from "../lib/aiOutputs";
import { useAuth } from "../contexts/AuthContext";

type Insight = {
  id: string;
  insight_type: string;
  title: string | null;
  body: string | null;
  created_at: string;
};

function cashOutlookChartData(series: { date: string; income: number; spend: number }[]) {
  let cum = 0;
  const daily: { label: string; cashBalance: number; segment: string }[] = [];
  for (const s of series) {
    cum += s.income - s.spend;
    daily.push({ label: s.date.slice(5), cashBalance: cum, segment: "history" });
  }
  const last = daily.length ? daily[daily.length - 1]!.cashBalance : 0;
  const tail = daily.slice(-24);
  return [
    ...tail,
    { label: "+30d", cashBalance: last, segment: "proj" },
    { label: "+60d", cashBalance: last, segment: "proj" },
    { label: "+90d", cashBalance: last, segment: "proj" },
  ];
}

export default function Insights() {
  const { session } = useAuth();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [chartRows, setChartRows] = useState<{ label: string; cashBalance: number; segment: string }[]>([]);
  const [purchase, setPurchase] = useState("");
  const [timeline, setTimeline] = useState("current_month");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [nudgeRow, setNudgeRow] = useState<AiOutputRow | null>(null);

  const load = useCallback(async () => {
    if (!session?.access_token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [r, cf, feat, aiNudge] = await Promise.all([
        api<{ insights: Insight[] }>("/insights", {
          accessToken: session.access_token,
        }),
        api<{ series: { date: string; income: number; spend: number }[] }>(
          (() => {
            const to = new Date();
            const from = new Date();
            from.setDate(from.getDate() - 90);
            return `/analytics/cash-flow?from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`;
          })(),
          { accessToken: session.access_token }
        ).catch(() => ({ series: [] as { date: string; income: number; spend: number }[] })),
        api<{ aiInsightsAvailable: boolean; geminiModel?: string }>("/meta/features", {
          accessToken: session.access_token,
        }).catch(() => ({ aiInsightsAvailable: false })),
        api<AiOutputsResponse>("/ai-outputs?families=nudge", {
          accessToken: session.access_token,
        }).catch(() => ({ byFamily: {} as AiOutputsResponse["byFamily"] })),
      ]);
      setInsights(r.insights);
      setChartRows(cashOutlookChartData(cf.series));
      setAiAvailable(feat.aiInsightsAvailable);
      setNudgeRow(aiNudge.byFamily?.nudge ?? null);
    } catch {
      setInsights([]);
      setChartRows([]);
      setAiAvailable(false);
      setNudgeRow(null);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  const highlightCards = useMemo(() => {
    const sorted = [...insights].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const anomaly =
      sorted.find((i) => i.insight_type === "risk" || i.insight_type === "spending") ?? sorted[0];
    const positive = sorted.find(
      (i) =>
        i.id !== anomaly?.id &&
        (i.insight_type === "recommendation" ||
          i.insight_type === "savings" ||
          i.insight_type === "forecast")
    );
    return { anomaly, positive };
  }, [insights]);

  const latestWhatIf = useMemo(() => {
    return [...insights]
      .filter((i) => i.insight_type === "what_if")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  }, [insights]);

  const optimalBadge = useMemo(() => {
    const hasRisk = insights.some((i) => i.insight_type === "risk");
    return !hasRisk;
  }, [insights]);

  const run = async (path: string, body?: object) => {
    if (!session?.access_token || aiAvailable === false) return;
    setBusy(path);
    setErr(null);
    try {
      await api(path, {
        method: "POST",
        body: body ? JSON.stringify(body) : "{}",
        accessToken: session.access_token,
      });
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  };

  const runScenario = async () => {
    const amt = Number(purchase.replace(/[^0-9.-]/g, "")) || 0;
    const tl =
      timeline === "current_month"
        ? "this month"
        : timeline === "quarter"
          ? "over the next quarter"
          : "over the next year";
    const scenario = `Simulated major purchase of $${amt.toFixed(2)} ${tl}. What is the estimated impact on my cash balance and runway?`;
    await run("/ai/what-if", { scenario });
  };

  const impactLine = useMemo(() => {
    if (!latestWhatIf?.body) return "—";
    const m = latestWhatIf.body.match(/-?\$[\d,]+(?:\.\d{2})?/);
    return m ? m[0] : "See narrative";
  }, [latestWhatIf]);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background pb-12">
      <div className="mb-10 max-w-4xl">
        <h2 className="text-[3.5rem] leading-none font-headline font-bold text-on-surface tracking-tight mb-4">
          Intelligence Hub
        </h2>
        <p className="text-lg text-on-surface-variant font-body">
          Turning your spending patterns into clear next steps.
        </p>
      </div>

      {aiAvailable === false ? (
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant mb-6 font-body">
          AI-powered actions on this page need <code className="text-xs">GEMINI_API_KEY</code> on the server.
          Charts and saved insights still work.
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-on-surface-variant mb-4 font-body" aria-live="polite">
          Loading…
        </p>
      ) : null}

      {err ? (
        <div className="rounded-xl border border-error-container bg-error-container/30 px-4 py-3 text-sm text-on-error-container mb-6 whitespace-pre-wrap">
          {err}
        </div>
      ) : null}

      <section className="mb-8 max-w-4xl space-y-3" aria-label="Behavior nudges">
        <h3 className="font-headline text-base font-semibold text-on-surface">Behavior nudges</h3>
        {nudgeRow ? (
          Array.isArray((nudgeRow.payload as { nudges?: { title: string; body: string }[] })?.nudges) &&
          ((nudgeRow.payload as { nudges: { title: string; body: string }[] }).nudges?.length ?? 0) > 0 ? (
            <ul className="space-y-2">
              {(nudgeRow.payload as { nudges: { title: string; body: string }[] }).nudges.map((n, i) => (
                <li
                  key={`${n.title}-${i}`}
                  className="rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 py-2 text-sm font-body text-on-surface"
                >
                  <span className="font-semibold text-on-background block">{n.title}</span>
                  <span className="text-on-surface-variant">{n.body}</span>
                </li>
              ))}
            </ul>
          ) : (
            <AiOutputCard row={nudgeRow} label="Behavior nudges" />
          )
        ) : (
          <AiOutputEmpty message="Nudges appear after your accounts sync (no manual run needed)." />
        )}
      </section>

      {/* insights_web/code.html — single 3-col grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <section className="lg:col-span-2 bg-surface-container-lowest rounded-xl p-8 ambient-shadow ghost-border relative overflow-hidden flex flex-col">
          <div className="flex justify-between items-start mb-8 z-10">
            <div>
              <h3 className="text-xl font-headline font-semibold text-on-surface">Cash outlook</h3>
              <p className="text-sm text-on-surface-variant mt-1">Estimated cash balance (next 90 days)</p>
            </div>
            <div className="bg-surface-container px-3 py-1.5 rounded-full flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${optimalBadge ? "bg-tertiary-fixed" : "bg-error"}`} />
              <span className="text-xs font-semibold text-on-surface uppercase tracking-wider">
                {optimalBadge ? "Optimal" : "Review"}
              </span>
            </div>
          </div>
          <p className="text-xs text-on-surface-variant mb-4 z-10">
            Live cumulative net cash flow + illustrative +30/+60/+90 points (see export disclaimer).
          </p>
          <div className="flex-1 min-h-[240px] relative z-10 w-full">
            {chartRows.length === 0 ? (
              <p className="text-sm text-on-surface-variant font-body">Link accounts and sync transactions.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="horizonFillStitch" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4edea3" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#4edea3" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#c6c6cd" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#45464d" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#45464d" width={48} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: "1px solid #c6c6cd" }}
                    formatter={(v: number) => [
                      v.toLocaleString(undefined, { style: "currency", currency: "USD" }),
                      "Cash (estimated)",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="cashBalance"
                    stroke="#009668"
                    strokeWidth={2}
                    fill="url(#horizonFillStitch)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="bg-surface-container-low rounded-xl p-8 flex flex-col gap-6">
          <h3 className="text-lg font-headline font-semibold text-on-surface">Highlights</h3>
          <div className="flex flex-col gap-4">
            <div className="bg-secondary-container p-4 rounded-xl ghost-border flex gap-4 items-start">
              <span className="material-symbols-outlined text-secondary mt-0.5">warning</span>
              <div>
                <h4 className="text-sm font-semibold text-on-secondary-container">Cash-Flow Anomaly</h4>
                <p className="text-xs text-secondary mt-1 leading-relaxed font-body">
                  {(() => {
                    const b = highlightCards.anomaly?.body;
                    const t = highlightCards.anomaly?.title;
                    if (b && b.length > 200) return b.slice(0, 200) + "…";
                    if (b) return b;
                    return t ?? "Use “Refresh AI insights” below to fill this card.";
                  })()}
                </p>
              </div>
            </div>
            <div className="bg-surface-container-lowest p-4 rounded-xl ghost-border flex gap-4 items-start ambient-shadow">
              <span className="material-symbols-outlined text-on-tertiary-container mt-0.5">trending_up</span>
              <div>
                <h4 className="text-sm font-semibold text-on-surface">Savings highlights</h4>
                <p className="text-xs text-on-surface-variant mt-1 leading-relaxed font-body">
                  {(() => {
                    const b = highlightCards.positive?.body;
                    const t = highlightCards.positive?.title;
                    if (b && b.length > 200) return b.slice(0, 200) + "…";
                    if (b) return b;
                    return t ?? "Positive trends appear after recommendations or savings insights.";
                  })()}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="lg:col-span-1 bg-primary text-on-primary rounded-xl p-8 relative overflow-hidden flex flex-col justify-between min-h-[280px]">
          <div className="absolute inset-0 bg-gradient-to-br from-primary to-primary-container opacity-80 pointer-events-none" />
          <div className="relative z-10">
            <span className="material-symbols-outlined text-3xl mb-4 text-tertiary-fixed">target</span>
            <h3 className="text-xl font-headline font-semibold mb-2">Quick actions</h3>
            <p className="text-sm text-on-primary-container font-body leading-relaxed mb-8">
              Execute recommended transfers to optimize yield across accounts.
            </p>
          </div>
          <div className="relative z-10 flex flex-col gap-2">
            <button
              type="button"
              disabled={!!busy || aiAvailable === false}
              onClick={() => run("/ai/recommendations")}
              className="w-full bg-surface-container-lowest text-primary py-3 px-4 rounded-xl text-sm font-semibold hover:bg-surface-bright transition-colors flex items-center justify-center gap-2"
            >
              Review Actions
              <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </button>
            <Link
              to="/creditcards"
              className="text-center text-sm text-on-primary-container hover:text-on-primary underline font-body"
            >
              View transactions
            </Link>
          </div>
        </section>

        <section className="lg:col-span-2 bg-surface-container-lowest rounded-xl p-8 ambient-shadow ghost-border">
          <div className="flex items-center gap-3 mb-6">
            <span className="material-symbols-outlined text-on-surface-variant">tune</span>
            <h3 className="text-lg font-headline font-semibold text-on-surface">What if…</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2 font-label">
                  Simulated Major Purchase
                </label>
                <input
                  className="w-full bg-transparent border-0 border-b-[1.5px] border-outline-variant/30 focus:border-primary focus:ring-0 px-0 py-2 text-xl font-headline text-on-surface placeholder:text-outline-variant transition-colors"
                  placeholder="$0.00"
                  type="text"
                  value={purchase}
                  onChange={(e) => setPurchase(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2 font-label">
                  Timeline Adjustment
                </label>
                <select
                  className="w-full bg-transparent border-0 border-b-[1.5px] border-outline-variant/30 focus:border-primary focus:ring-0 px-0 py-2 text-base font-body text-on-surface transition-colors"
                  value={timeline}
                  onChange={(e) => setTimeline(e.target.value)}
                >
                  <option value="current_month">Current Month</option>
                  <option value="quarter">Next 3 Months</option>
                  <option value="year">End of Year</option>
                </select>
              </div>
              <button
                type="button"
                disabled={!!busy || aiAvailable === false}
                onClick={runScenario}
                className="bg-primary text-on-primary px-6 py-3 rounded-xl text-sm font-medium"
              >
                {busy === "/ai/what-if" ? "…" : "Run scenario"}
              </button>
            </div>
            <div className="bg-surface-container-low rounded-xl p-6 flex flex-col justify-center border border-outline-variant/10">
              <p className="text-sm text-on-surface-variant font-label mb-2">Estimated impact on your cash</p>
              <div className="text-3xl font-headline font-bold text-on-surface mb-2">{impactLine}</div>
              <p className="text-xs text-secondary font-label flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">info</span>
                {latestWhatIf
                  ? "Narrative from latest what-if insight (not a cash guarantee)."
                  : "Run a scenario to generate AI output."}
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="flex flex-wrap gap-2 items-center justify-between border-t border-outline-variant/20 pt-8 mt-10">
        <p className="text-xs text-on-surface-variant font-body">
          {aiAvailable
            ? "AI features use Google Gemini on the server."
            : "Configure the server with GEMINI_API_KEY to enable AI refresh, recommendations, forecast, and what-if."}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy || aiAvailable === false}
            onClick={() => run("/ai/insights")}
            className="rounded-full border border-outline-variant px-4 py-2 text-xs font-medium hover:bg-surface-container-low"
          >
            {busy === "/ai/insights" ? "…" : "Refresh AI insights"}
          </button>
          <button
            type="button"
            disabled={!!busy || aiAvailable === false}
            onClick={() => run("/ai/forecast")}
            className="rounded-full border border-outline-variant px-4 py-2 text-xs font-medium hover:bg-surface-container-low"
          >
            {busy === "/ai/forecast" ? "…" : "Generate forecast"}
          </button>
        </div>
      </div>

      <section className="mt-10">
        <h2 className="font-headline font-semibold text-on-background mb-4">Saved insights</h2>
        <ul className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {insights.length === 0 ? (
            <li className="text-sm text-on-surface-variant font-body">No saved insights yet.</li>
          ) : (
            insights.map((i) => (
              <li
                key={i.id}
                className="bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/10 shadow-ambient text-sm"
              >
                <div className="text-xs text-on-surface-variant mb-1 font-body">
                  {i.insight_type} · {new Date(i.created_at).toLocaleString()}
                </div>
                {i.title ? <div className="font-semibold text-on-surface font-headline">{i.title}</div> : null}
                <p className="mt-1 text-on-surface-variant whitespace-pre-wrap font-body">{i.body}</p>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
