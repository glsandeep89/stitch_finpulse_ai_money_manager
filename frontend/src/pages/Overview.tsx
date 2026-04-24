import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { AiOutputCard, AiOutputEmpty } from "../components/ai/AiOutputCard";
import { api } from "../lib/api";
import type { AiOutputRow, AiOutputsResponse } from "../lib/aiOutputs";
import { useAuth } from "../contexts/AuthContext";
import {
  densifyCashFlow,
  formatLocalYmd,
  presetDateRange,
  sumNetCashFlow,
  type CashFlowPoint,
} from "../lib/cashFlowChart";

type NetWorth = {
  snapshot: {
    total_net_worth: number | null;
    liquid_assets: number | null;
    investments: number | null;
  } | null;
  computed: { liquid_assets: number; investments: number };
};

type ChartPreset = "7d" | "30d" | "90d" | "custom";

function fmt(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function clampToToday(from: string, to: string): { from: string; to: string } {
  const today = formatLocalYmd(new Date());
  let t = to > today ? today : to;
  let f = from > t ? t : from;
  if (f > t) f = t;
  return { from: f, to: t };
}

function OverviewAiCard({
  row,
  label,
  empty,
  formatChildren,
}: {
  row: AiOutputRow | null | undefined;
  label: string;
  empty: string;
  formatChildren: (row: AiOutputRow) => ReactNode;
}) {
  if (!row) {
    return (
      <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4">
        <h3 className="font-headline text-sm font-semibold text-on-surface mb-2">{label}</h3>
        <AiOutputEmpty message={empty} />
      </div>
    );
  }
  return <AiOutputCard row={row} label={label}>{formatChildren(row)}</AiOutputCard>;
}

export default function Overview() {
  const { session } = useAuth();
  const [nw, setNw] = useState<NetWorth | null>(null);
  const [accounts, setAccounts] = useState<Record<string, unknown>[]>([]);
  const [rawSeries, setRawSeries] = useState<{ date: string; income: number; spend: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loadingStatic, setLoadingStatic] = useState(true);
  const [loadingCf, setLoadingCf] = useState(true);
  const [budgetAlerts, setBudgetAlerts] = useState<{ category: string; pct?: number }[]>([]);
  const [aiByFamily, setAiByFamily] = useState<AiOutputsResponse["byFamily"] | null>(null);
  const [refreshAccountsBusy, setRefreshAccountsBusy] = useState(false);

  const [chartPreset, setChartPreset] = useState<ChartPreset>("30d");
  const [dateFrom, setDateFrom] = useState(() => presetDateRange(30).from);
  const [dateTo, setDateTo] = useState(() => presetDateRange(30).to);
  const [customFrom, setCustomFrom] = useState(() => presetDateRange(30).from);
  const [customTo, setCustomTo] = useState(() => presetDateRange(30).to);

  const applyPreset = useCallback((preset: "7d" | "30d" | "90d") => {
    setChartPreset(preset);
    if (preset === "7d") {
      const r = presetDateRange(7);
      setDateFrom(r.from);
      setDateTo(r.to);
      setCustomFrom(r.from);
      setCustomTo(r.to);
    } else if (preset === "30d") {
      const r = presetDateRange(30);
      setDateFrom(r.from);
      setDateTo(r.to);
      setCustomFrom(r.from);
      setCustomTo(r.to);
    } else if (preset === "90d") {
      const r = presetDateRange(90);
      setDateFrom(r.from);
      setDateTo(r.to);
      setCustomFrom(r.from);
      setCustomTo(r.to);
    }
  }, []);

  const applyCustomRange = useCallback(() => {
    const { from, to } = clampToToday(customFrom, customTo);
    setCustomFrom(from);
    setCustomTo(to);
    setDateFrom(from);
    setDateTo(to);
    setChartPreset("custom");
  }, [customFrom, customTo]);

  const loadStatic = useCallback(async () => {
    if (!session?.access_token) return;
    setErr(null);
    setLoadingStatic(true);
    try {
      const [n, a] = await Promise.all([
        api<NetWorth>("/net-worth", { accessToken: session.access_token }),
        api<{ accounts: Record<string, unknown>[] }>("/plaid/accounts", {
          accessToken: session.access_token,
        }),
      ]);
      setNw(n);
      setAccounts(a.accounts);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoadingStatic(false);
    }
  }, [session?.access_token]);

  const loadAiOutputs = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const out = await api<AiOutputsResponse>("/ai-outputs?families=forecast", {
        accessToken: session.access_token,
      });
      setAiByFamily(out.byFamily);
    } catch {
      setAiByFamily({});
    }
  }, [session?.access_token]);

  const loadCashFlow = useCallback(async () => {
    if (!session?.access_token) return;
    setLoadingCf(true);
    try {
      const cf = await api<{ series: { date: string; income: number; spend: number }[] }>(
        `/analytics/cash-flow?from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}`,
        { accessToken: session.access_token }
      );
      setRawSeries(cf.series);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load cash flow");
    } finally {
      setLoadingCf(false);
    }
  }, [session?.access_token, dateFrom, dateTo]);

  const refreshAccounts = useCallback(async () => {
    if (!session?.access_token) return;
    setErr(null);
    setRefreshAccountsBusy(true);
    try {
      await api("/plaid/accounts?refresh=true", {
        accessToken: session.access_token,
      });
      await loadStatic();
      void loadCashFlow();
      void loadAiOutputs();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to refresh accounts");
    } finally {
      setRefreshAccountsBusy(false);
    }
  }, [session?.access_token, loadStatic, loadCashFlow, loadAiOutputs]);

  useEffect(() => {
    loadStatic();
  }, [loadStatic]);

  useEffect(() => {
    void loadAiOutputs();
  }, [loadAiOutputs]);

  useEffect(() => {
    loadCashFlow();
  }, [loadCashFlow]);

  useEffect(() => {
    if (!session?.access_token) return;
    (async () => {
      try {
        const b = await api<{ budgets: { category: string; pct?: number }[] }>("/budgets", {
          accessToken: session.access_token,
        });
        setBudgetAlerts(b.budgets.filter((x) => (x.pct ?? 0) >= 85));
      } catch {
        setBudgetAlerts([]);
      }
    })();
  }, [session?.access_token]);

  const chartData: CashFlowPoint[] = useMemo(
    () => densifyCashFlow(dateFrom, dateTo, rawSeries),
    [dateFrom, dateTo, rawSeries]
  );

  const netInRange = useMemo(() => sumNetCashFlow(chartData), [chartData]);

  const rangeDescription = useMemo(() => {
    if (chartPreset === "7d") return "Last 7 days";
    if (chartPreset === "30d") return "Last 30 days";
    if (chartPreset === "90d") return "Last 90 days";
    return `${dateFrom} → ${dateTo}`;
  }, [chartPreset, dateFrom, dateTo]);

  const total =
    nw?.snapshot?.total_net_worth ??
    (nw?.computed ? nw.computed.liquid_assets + nw.computed.investments : 0);

  const liquid = nw?.snapshot?.liquid_assets ?? nw?.computed.liquid_assets ?? 0;
  const inv = nw?.snapshot?.investments ?? nw?.computed.investments ?? 0;

  const tooltipFmt = (value: number | undefined, name: string | number) => [
    fmt(Number(value ?? 0)),
    name === "income" ? "Income" : name === "spend" ? "Spending" : String(name),
  ];

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-headline text-3xl font-bold text-on-background tracking-tight">Overview</h1>
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
      </div>
      {err ? <p className="text-sm text-error font-body">{err}</p> : null}
      {loadingStatic ? (
        <p className="text-sm text-on-surface-variant font-body" aria-live="polite">
          Loading balances…
        </p>
      ) : null}

      {budgetAlerts.length > 0 ? (
        <section
          className="rounded-xl border border-amber-200/80 bg-amber-50/90 dark:bg-amber-950/30 dark:border-amber-800/50 p-4"
          aria-label="Budget alerts"
        >
          <h2 className="font-headline text-sm font-semibold text-on-surface mb-2">Budget alerts</h2>
          <ul className="list-disc list-inside text-sm font-body text-on-surface-variant space-y-1">
            {budgetAlerts.map((b) => (
              <li key={b.category}>
                <span className="text-on-surface font-medium">{b.category}</span> is at{" "}
                {Math.round(b.pct ?? 0)}% of its limit this period.
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-8 relative overflow-hidden rounded-xl gradient-bg p-8 shadow-ambient">
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-end gap-6">
          <div>
            <h2 className="font-headline text-on-primary-container text-sm uppercase tracking-wider mb-2">
              Total Net Worth
            </h2>
            <div className="font-headline text-on-primary text-5xl md:text-6xl font-bold mb-4">{fmt(total)}</div>
            {err ? (
              <div className="flex items-center gap-2 text-error bg-error/10 px-3 py-1 rounded-full text-sm font-medium w-fit font-body border border-error/25">
                <span className="material-symbols-outlined text-sm">cloud_off</span>
                <span>Balances unavailable</span>
                <span className="text-on-surface-variant ml-1 text-xs font-normal">Fix API connection</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-tertiary-fixed bg-tertiary-container px-3 py-1 rounded-full text-sm font-medium w-fit font-body">
                <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                  arrow_upward
                </span>
                <span>Live</span>
                <span className="text-on-tertiary-fixed-variant ml-1 text-xs">Linked accounts</span>
              </div>
            )}
          </div>
          <div className="flex gap-4">
            <div className="bg-surface-container-low/10 backdrop-blur-md rounded-xl p-4 min-w-[140px] border border-white/10">
              <div className="text-on-primary-container text-xs mb-1 font-medium font-body">Liquid Assets</div>
              <div className="text-on-primary font-headline text-xl font-semibold">{fmt(liquid)}</div>
            </div>
            <div className="bg-surface-container-low/10 backdrop-blur-md rounded-xl p-4 min-w-[140px] border border-white/10">
              <div className="text-on-primary-container text-xs mb-1 font-medium font-body">Investments</div>
              <div className="text-on-primary font-headline text-xl font-semibold">{fmt(inv)}</div>
            </div>
          </div>
        </div>
        <div
          className="absolute right-0 top-0 w-1/2 h-full opacity-20 pointer-events-none"
          style={{ background: "radial-gradient(circle at top right, #6ffbbe 0%, transparent 70%)" }}
        />
      </section>

      <section className="space-y-3" aria-label="AI outlook">
        <h2 className="font-headline text-lg font-semibold text-on-background">AI outlook</h2>
        <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
          <OverviewAiCard
            row={aiByFamily?.forecast ?? null}
            label="30-day cash forecast"
            empty="Forecast appears after accounts sync."
            formatChildren={(row) => {
              const p = row.payload as
                | { projectedEndBalance?: number; currentBalance?: number; days?: number }
                | undefined;
              if (!p) return null;
              return (
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs font-body text-on-surface-variant">
                  {p.projectedEndBalance != null ? (
                    <>
                      <dt>Projected balance</dt>
                      <dd className="text-on-surface font-medium">{fmt(p.projectedEndBalance)}</dd>
                    </>
                  ) : null}
                  {p.days != null ? (
                    <>
                      <dt>Horizon</dt>
                      <dd>{p.days} days</dd>
                    </>
                  ) : null}
                </dl>
              );
            }}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section
            className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient relative overflow-hidden border border-outline-variant/10"
            aria-labelledby="cash-flow-heading"
          >
            <div className="flex flex-col gap-4 mb-6">
              <div>
                <h3 id="cash-flow-heading" className="font-headline text-on-surface text-xl font-semibold">
                  Income vs spending
                </h3>
                <p className="text-xs text-on-surface-variant font-body mt-1">
                  Cash flow by day · {rangeDescription}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap bg-surface-container-low rounded-lg p-1 font-body text-xs gap-0.5">
                  {(
                    [
                      ["7d", "7D"],
                      ["30d", "30D"],
                      ["90d", "90D"],
                    ] as const
                  ).map(([preset, label]) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                        chartPreset === preset
                          ? "bg-surface-container-lowest text-on-surface shadow-sm"
                          : "text-on-surface-variant hover:text-on-surface"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setCustomFrom(dateFrom);
                      setCustomTo(dateTo);
                      setChartPreset("custom");
                    }}
                    className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                      chartPreset === "custom"
                        ? "bg-surface-container-lowest text-on-surface shadow-sm"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    Custom
                  </button>
                </div>
              </div>
              {chartPreset === "custom" ? (
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs font-label text-on-surface-variant mb-1">From</label>
                    <input
                      type="date"
                      value={customFrom}
                      max={customTo}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="text-sm rounded-lg border border-outline-variant/40 px-2 py-1.5 text-on-surface bg-surface-container-lowest font-body"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-label text-on-surface-variant mb-1">To</label>
                    <input
                      type="date"
                      value={customTo}
                      min={customFrom}
                      max={formatLocalYmd(new Date())}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="text-sm rounded-lg border border-outline-variant/40 px-2 py-1.5 text-on-surface bg-surface-container-lowest font-body"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={applyCustomRange}
                    className="text-sm font-medium bg-secondary-container text-on-secondary-container px-4 py-2 rounded-xl hover:opacity-90"
                  >
                    Apply range
                  </button>
                </div>
              ) : null}
            </div>
            <div className="h-72" role="img" aria-label={`Income versus spending chart for ${rangeDescription}`}>
              {loadingCf ? (
                <p className="text-sm text-on-surface-variant font-body">Loading chart…</p>
              ) : accounts.length === 0 ? (
                <p className="text-sm text-on-surface-variant font-body">Link an account and sync.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dce9ff" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#45464d" />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="#45464d"
                      tickFormatter={(v) =>
                        Number(v).toLocaleString(undefined, { maximumFractionDigits: 0, notation: "compact" })
                      }
                    />
                    <Tooltip
                      formatter={tooltipFmt as never}
                      contentStyle={{ borderRadius: 12, border: "1px solid #c6c6cd" }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12 }}
                      formatter={(value) => (value === "income" ? "Income" : value === "spend" ? "Spending" : value)}
                    />
                    <Line
                      type="monotone"
                      dataKey="income"
                      name="income"
                      stroke="#009668"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="spend"
                      name="spend"
                      stroke="#515f74"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          <section className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-headline text-on-surface text-xl font-semibold">Linked Accounts</h3>
            </div>
            <div className="space-y-4">
              {accounts.length === 0 ? (
                <p className="text-sm text-on-surface-variant font-body">No accounts linked yet.</p>
              ) : (
                accounts.map((a) => (
                  <div
                    key={String(a.plaid_account_id)}
                    className="flex items-center justify-between p-4 bg-surface-container-low rounded-xl hover:bg-surface-container transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-primary">
                        <span className="material-symbols-outlined">
                          {(a.type as string)?.toLowerCase() === "credit" ? "credit_card" : "account_balance"}
                        </span>
                      </div>
                      <div>
                        <div className="font-medium text-on-surface font-body">{(a.name as string) ?? "Account"}</div>
                        <div className="text-xs text-on-surface-variant font-body mt-1">
                          {String(a.subtype ?? a.type ?? "")}
                          {a.mask ? ` • …${a.mask}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-headline font-semibold text-on-surface text-lg">
                        {fmt(Number(a.balance_current ?? 0))}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

        </div>

        <div className="lg:col-span-1 space-y-8">
          <section className="grid grid-cols-2 gap-4">
            <div className="bg-surface-container-lowest p-4 rounded-xl shadow-ambient border border-outline-variant/15 flex flex-col justify-between min-h-[120px]">
              <span className="material-symbols-outlined text-secondary mb-2">trending_down</span>
              <div>
                <div className="text-xs text-on-surface-variant mb-1 font-body leading-snug">Net cash flow</div>
                <div className="text-[10px] text-on-surface-variant/80 font-body mb-1 truncate" title={rangeDescription}>
                  {rangeDescription}
                </div>
                <div className="font-headline font-semibold text-on-surface text-sm">{fmt(netInRange)}</div>
              </div>
            </div>
            <div className="bg-surface-container-lowest p-4 rounded-xl shadow-ambient border border-outline-variant/15 flex flex-col justify-between min-h-[120px]">
              <span className="material-symbols-outlined text-tertiary-fixed-dim mb-2">savings</span>
              <div>
                <div className="text-xs text-on-surface-variant mb-1 font-body">Liquid + inv</div>
                <div className="font-headline font-semibold text-on-surface">Synced</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
