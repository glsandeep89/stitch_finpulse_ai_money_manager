import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AiOutputCard, AiOutputEmpty } from "../components/ai/AiOutputCard";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import type { AiOutputsResponse } from "../lib/aiOutputs";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type CreditSnapshot = {
  accounts: {
    plaid_account_id: string;
    name: string | null;
    mask: string | null;
    currentBalance: number | null;
    available: number | null;
  }[];
  spending: { plaid_transaction_id: string; merchant_name: string | null; amount: number; trans_date: string }[];
  cardPayments: { plaid_transaction_id: string; merchant_name: string | null; amount: number; trans_date: string }[];
  subscriptions: { id: string; name: string; amount: number | null; frequency: string | null; next_payment_date: string | null }[];
};

type CreditCardSummary = {
  creditCards: {
    plaid_account_id: string;
    name: string;
    mask?: string | null;
    currentBalance: number;
    available: number | null;
    note: string;
  }[];
  postedPayments: {
    plaid_transaction_id: string;
    merchant_name: string | null;
    amount: number;
    trans_date: string;
    category: string[] | null;
  }[];
  upcomingDueDates: {
    account: string;
    label: string;
    dueDisplay: string;
    minimumDueDisplay: string;
    statementBalanceDisplay: string;
  }[];
};

type RefundRow = {
  id: string;
  merchant_name: string | null;
  amount: number;
  trans_date: string;
  status: "pending" | "posted" | "expired" | "manual";
};

type BestCardResult = {
  merchant: string;
  category: string;
  spend_assumption: number;
  best: {
    plaid_account_id: string;
    card_name: string;
    issuer: string | null;
    category_match: string;
    reward_rate: number;
    projected_value: number;
    why_this_card: string;
  } | null;
  ranked: {
    plaid_account_id: string;
    card_name: string;
    issuer: string | null;
    category_match: string;
    reward_rate: number;
    projected_value: number;
    why_this_card: string;
  }[];
};

type AnnualFeeRoiResult = {
  cards: {
    plaid_account_id: string;
    card_name: string;
    annual_fee: number;
    rewards_earned_value: number;
    statement_credits_value: number;
    estimated_issuer_credits: number;
    earned_value: number;
    net_value: number;
    breakeven: boolean;
    period_start: string;
    period_end: string;
    enrichment_status: "pending" | "ready" | "failed";
  }[];
};

function money(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function sectionShell(extra = "") {
  return `bg-surface-container-lowest rounded-2xl border border-outline-variant/15 shadow-card ${extra}`.trim();
}

function refundStatusChip(status: RefundRow["status"]) {
  if (status === "posted") return "bg-emerald-100 text-emerald-800";
  if (status === "pending") return "bg-amber-100 text-amber-800";
  if (status === "expired") return "bg-rose-100 text-rose-800";
  return "bg-slate-200 text-slate-700";
}

const AUTO_PAYMENT_NAME_PATTERN =
  /\b(auto\s*pay(?:ment)?|autopay|card\s*payment|credit\s*card\s*payment|cc\s*payment|payment\s*thank\s*you|ach\s*payment|online\s*payment|statement\s*payment)\b/i;

function normalizeName(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}


export default function CreditCards() {
  const { session } = useAuth();
  const [data, setData] = useState<CreditSnapshot | null>(null);
  const [ccSummary, setCcSummary] = useState<CreditCardSummary | null>(null);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [ai, setAi] = useState<AiOutputsResponse["byFamily"]>({});
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bestMerchant, setBestMerchant] = useState("");
  const [bestAmount, setBestAmount] = useState("100");
  const [bestCard, setBestCard] = useState<BestCardResult | null>(null);
  const [annualRoi, setAnnualRoi] = useState<AnnualFeeRoiResult | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [rewardsStatus, setRewardsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [dismissedNudges, setDismissedNudges] = useState<Record<string, boolean>>({});
  const [recurringView, setRecurringView] = useState<"monthly" | "all">("monthly");

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    // #region agent log
    fetch("http://127.0.0.1:7644/ingest/08c63131-dd99-46a9-ab84-35d0c6143f04", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "efb39d" },
      body: JSON.stringify({
        sessionId: "efb39d",
        runId: "initial",
        hypothesisId: "H1",
        location: "CreditCards.tsx:load:start",
        message: "Starting credit cards load",
        data: { hasSession: Boolean(session?.access_token) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    setErr(null);
    setLoading(true);
    try {
      const [snapshot, refundOut, aiOut] = await Promise.all([
        api<CreditSnapshot>("/analytics/creditcards", { accessToken: session.access_token }),
        api<{ refunds: RefundRow[] }>("/refund-tracker", { accessToken: session.access_token }),
        api<AiOutputsResponse>("/ai-outputs?families=anomaly,subscription_vampire", {
          accessToken: session.access_token,
        }).catch(() => ({ byFamily: {} as AiOutputsResponse["byFamily"] })),
      ]);
      // #region agent log
      fetch("http://127.0.0.1:7644/ingest/08c63131-dd99-46a9-ab84-35d0c6143f04", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "efb39d" },
        body: JSON.stringify({
          sessionId: "efb39d",
          runId: "initial",
          hypothesisId: "H2",
          location: "CreditCards.tsx:load:coreData",
          message: "Loaded core data payloads",
          data: {
            accounts: snapshot?.accounts?.length ?? 0,
            refunds: refundOut?.refunds?.length ?? 0,
            hasAnomaly: Boolean(aiOut?.byFamily?.anomaly),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      setData(snapshot);
      const summary = await api<CreditCardSummary>("/analytics/credit-card-summary", {
        accessToken: session.access_token,
      });
      setCcSummary(summary);
      setRefunds(refundOut.refunds ?? []);
      setAi(aiOut.byFamily ?? {});
      setLastSyncedAt(new Date().toISOString());
      setRewardsStatus("loading");
      await api("/analytics/creditcards/rewards-profiles/enrich", {
        method: "POST",
        accessToken: session.access_token,
      }).catch(() => {
        // #region agent log
        fetch("http://127.0.0.1:7644/ingest/08c63131-dd99-46a9-ab84-35d0c6143f04", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "efb39d" },
          body: JSON.stringify({
            sessionId: "efb39d",
            runId: "initial",
            hypothesisId: "H3",
            location: "CreditCards.tsx:load:enrichError",
            message: "Rewards enrichment failed",
            data: { endpoint: "/analytics/creditcards/rewards-profiles/enrich" },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        setRewardsStatus("error");
        return null;
      });
      const roi = await api<AnnualFeeRoiResult>("/analytics/creditcards/annual-fee-roi", {
        accessToken: session.access_token,
      }).catch(() => {
        // #region agent log
        fetch("http://127.0.0.1:7644/ingest/08c63131-dd99-46a9-ab84-35d0c6143f04", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "efb39d" },
          body: JSON.stringify({
            sessionId: "efb39d",
            runId: "initial",
            hypothesisId: "H4",
            location: "CreditCards.tsx:load:roiError",
            message: "Annual fee ROI fetch failed",
            data: { endpoint: "/analytics/creditcards/annual-fee-roi" },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        setRewardsStatus("error");
        return { cards: [] };
      });
      setAnnualRoi(roi);
      setRewardsStatus("ready");
      // #region agent log
      fetch("http://127.0.0.1:7644/ingest/08c63131-dd99-46a9-ab84-35d0c6143f04", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "efb39d" },
        body: JSON.stringify({
          sessionId: "efb39d",
          runId: "initial",
          hypothesisId: "H5",
          location: "CreditCards.tsx:load:success",
          message: "Credit cards page data load completed",
          data: { roiCards: roi?.cards?.length ?? 0, rewardsStatus: "ready" },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
    } catch (e: unknown) {
      // #region agent log
      fetch("http://127.0.0.1:7644/ingest/08c63131-dd99-46a9-ab84-35d0c6143f04", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "efb39d" },
        body: JSON.stringify({
          sessionId: "efb39d",
          runId: "initial",
          hypothesisId: "H1",
          location: "CreditCards.tsx:load:catch",
          message: "Credit cards load threw",
          data: { error: e instanceof Error ? e.message : String(e) },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      setErr(e instanceof Error ? e.message : "Failed to load credit cards");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void load();
  }, [load]);

  const refundsThisCycle = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    return refunds
      .filter((r) => {
        const d = new Date(r.trans_date);
        return d.getFullYear() === y && d.getMonth() === m && r.status !== "expired";
      })
      .reduce((s, r) => s + Math.abs(Number(r.amount)), 0);
  }, [refunds]);

  const spendingForInsights = useMemo(() => {
    const paymentTxIds = new Set((data?.cardPayments ?? []).map((p) => p.plaid_transaction_id));
    return (data?.spending ?? []).filter((tx) => {
      if (paymentTxIds.has(tx.plaid_transaction_id)) return false;
      const merchantRaw = tx.merchant_name ?? "";
      const merchantNormalized = normalizeName(merchantRaw);
      if (!merchantNormalized) return true;
      return !AUTO_PAYMENT_NAME_PATTERN.test(merchantNormalized);
    });
  }, [data?.cardPayments, data?.spending]);

  const spendingThisCycle = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    return spendingForInsights
      .filter((tx) => {
        const d = new Date(tx.trans_date);
        return d.getFullYear() === y && d.getMonth() === m;
      })
      .reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);
  }, [spendingForInsights]);

  const recurringPaymentsCount = useMemo(() => (data?.subscriptions ?? []).length, [data?.subscriptions]);

  const merchantLoyaltyNudge = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const map = new Map<string, { visits: number; amount: number }>();
    for (const tx of spendingForInsights) {
      const d = new Date(tx.trans_date);
      if (d.getFullYear() !== y || d.getMonth() !== m) continue;
      const merchant = (tx.merchant_name ?? "Unknown").trim() || "Unknown";
      const current = map.get(merchant) ?? { visits: 0, amount: 0 };
      current.visits += 1;
      current.amount += Math.abs(Number(tx.amount));
      map.set(merchant, current);
    }
    const top = [...map.entries()]
      .map(([merchant, stats]) => ({ merchant, ...stats }))
      .sort((a, b) => b.visits - a.visits || b.amount - a.amount)[0];
    if (!top || top.visits < 4) return null;
    const share = spendingThisCycle > 0 ? (top.amount / spendingThisCycle) * 100 : 0;
    return { ...top, share };
  }, [spendingForInsights, spendingThisCycle]);

  const utilizationWarnings = useMemo(() => {
    return (data?.accounts ?? [])
      .map((a) => {
        const balance = Math.max(0, Number(a.currentBalance ?? 0));
        const available = Math.max(0, Number(a.available ?? 0));
        const limitProxy = balance + available;
        if (limitProxy <= 0) return null;
        const ratio = balance / limitProxy;
        return {
          plaid_account_id: a.plaid_account_id,
          name: a.name ?? "Card",
          ratio,
          balance,
          limitProxy,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => row.ratio >= 0.25)
      .sort((a, b) => b.ratio - a.ratio);
  }, [data?.accounts]);

  const refundWatchNudges = useMemo(() => {
    const now = new Date();
    return refunds
      .filter((r) => r.status === "pending")
      .map((r) => {
        const d = new Date(r.trans_date);
        const ageDays = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86400000));
        return { ...r, ageDays };
      })
      .filter((r) => r.ageDays >= 7)
      .sort((a, b) => b.ageDays - a.ageDays)
      .slice(0, 3);
  }, [refunds]);

  const bestCardConfidence = useMemo(() => {
    if (!bestCard?.best || bestCard.ranked.length === 0) return null;
    const top = bestCard.ranked[0]?.reward_rate ?? 0;
    const second = bestCard.ranked[1]?.reward_rate ?? 0;
    if (top >= 0.04 || top - second >= 0.01) return "High";
    if (top >= 0.025) return "Medium";
    return "Low";
  }, [bestCard]);

  const merchantChart = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of spendingForInsights) {
      const key = (tx.merchant_name ?? "Unknown").trim() || "Unknown";
      map.set(key, (map.get(key) ?? 0) + Math.abs(Number(tx.amount)));
    }
    return [...map.entries()]
      .map(([merchant, amount]) => ({ merchant, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  }, [spendingForInsights]);

  const monthlyTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of spendingForInsights) {
      const d = new Date(tx.trans_date);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map.set(key, (map.get(key) ?? 0) + Math.abs(Number(tx.amount)));
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, spend]) => ({ month, spend }));
  }, [spendingForInsights]);

  const setRefundStatus = async (id: string, status: RefundRow["status"]) => {
    if (!session?.access_token) return;
    try {
      await api(`/refund-tracker/${id}/status`, {
        method: "POST",
        accessToken: session.access_token,
        body: JSON.stringify({ status }),
      });
      setRefunds((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to update refund status");
    }
  };

  const findBestCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.access_token || !bestMerchant.trim()) return;
    const qp = new URLSearchParams();
    qp.set("merchant", bestMerchant.trim());
    const amountNum = Number(bestAmount);
    if (Number.isFinite(amountNum) && amountNum > 0) qp.set("amount", String(amountNum));
    try {
      const out = await api<BestCardResult>(`/analytics/creditcards/best-card?${qp.toString()}`, {
        accessToken: session.access_token,
      });
      setBestCard(out);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to find best card");
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {err ? <p className="text-sm text-error">{err}</p> : null}

      <header className={`${sectionShell("p-6 md:p-8 relative overflow-hidden")}`}>
        <div className="absolute inset-0 pointer-events-none opacity-60 bg-gradient-to-br from-primary/10 via-transparent to-tertiary-fixed/20" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-headline font-bold text-on-background">Credit Cards</h1>
            <p className="text-sm text-on-surface-variant mt-1">
              Premium view for card health, transactions, subscriptions, and refunds.
            </p>
            {lastSyncedAt ? (
              <p className="text-[11px] text-on-surface-variant mt-2">
                Last synced: {new Date(lastSyncedAt).toLocaleString()}
              </p>
            ) : null}
          </div>
          {loading ? <p className="text-xs text-on-surface-variant">Refreshing latest data…</p> : null}
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`${sectionShell("p-5")}`}>
          <p className="text-xs uppercase tracking-wide text-on-surface-variant">Card accounts</p>
          <p className="text-2xl font-headline font-bold mt-1">{data?.accounts.length ?? 0}</p>
        </div>
        <div className={`${sectionShell("p-5")}`}>
          <p className="text-xs uppercase tracking-wide text-on-surface-variant">Spending this cycle</p>
          <p className="text-2xl font-headline font-bold mt-1">{money(spendingThisCycle)}</p>
        </div>
        <Link to="/subscriptions" className={`${sectionShell("p-5 block hover:border-primary/35 transition-colors")}`}>
          <p className="text-xs uppercase tracking-wide text-on-surface-variant">Active recurring payments</p>
          <p className="text-2xl font-headline font-bold mt-1">{recurringPaymentsCount}</p>
          <p className="text-[11px] text-primary mt-1">Open recurring tracker</p>
        </Link>
        <div className={`${sectionShell("p-5")}`}>
          <p className="text-xs uppercase tracking-wide text-on-surface-variant">Refunds this cycle</p>
          <p className="text-2xl font-headline font-bold mt-1">{money(refundsThisCycle)}</p>
        </div>
      </section>

      <nav className={`${sectionShell("p-3 flex flex-wrap gap-2")}`} aria-label="Credit card section shortcuts">
        <a href="#cc-refunds" className="px-3 py-1.5 rounded-full bg-surface-container text-sm hover:bg-surface-container-high">Refunds</a>
      </nav>

      <section className={`${sectionShell("p-5 md:p-6")}`}>
        <h2 className="font-headline font-semibold text-lg mb-2">Credit card summary</h2>
        <p className="text-xs text-on-surface-variant font-body mb-4">
          Posted payments inferred from transactions; due/min from Liabilities when available.
        </p>
        {!ccSummary || ccSummary.creditCards.length === 0 ? (
          <p className="text-sm text-on-surface-variant font-body">No credit cards linked yet.</p>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ccSummary.creditCards.map((c) => (
                <div
                  key={c.plaid_account_id}
                  className="rounded-xl border border-outline-variant/20 p-4 bg-surface-container-low/70"
                >
                  <div className="font-semibold text-on-surface font-body">
                    {c.name}
                    {c.mask ? <span className="text-on-surface-variant"> · {c.mask}</span> : null}
                  </div>
                  <div className="mt-2 text-sm text-on-surface-variant font-body">
                    Balance <span className="font-semibold text-on-surface">{money(c.currentBalance)}</span>
                  </div>
                  {c.available != null ? (
                    <div className="mt-1 text-xs text-on-surface-variant">Available {money(c.available)}</div>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-outline-variant/10 p-4 bg-surface-container-low/40">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Recurring tracker</h3>
                <div className="flex rounded-full bg-surface-container p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setRecurringView("monthly")}
                    className={`px-2 py-1 rounded-full ${recurringView === "monthly" ? "bg-surface-container-lowest font-semibold" : "text-on-surface-variant"}`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecurringView("all")}
                    className={`px-2 py-1 rounded-full ${recurringView === "all" ? "bg-surface-container-lowest font-semibold" : "text-on-surface-variant"}`}
                  >
                    All recurring
                  </button>
                </div>
              </div>
              {((data?.subscriptions ?? []).length === 0) ? (
                <p className="text-xs text-on-surface-variant">No recurring transactions detected yet.</p>
              ) : (
                <div className="space-y-2">
                  {(data?.subscriptions ?? [])
                    .filter((s) => recurringView === "all" || (s.frequency ?? "").toLowerCase().includes("month"))
                    .sort((a, b) => String(a.next_payment_date ?? "").localeCompare(String(b.next_payment_date ?? "")))
                    .slice(0, 12)
                    .map((s) => (
                      <div key={s.id} className="flex items-center justify-between rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 py-2">
                        <div>
                          <p className="text-sm font-medium text-on-surface">{s.name}</p>
                          <p className="text-xs text-on-surface-variant">
                            {s.next_payment_date ? `${s.next_payment_date}` : "Next date unavailable"} · {s.frequency ?? "Recurring"}
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-on-surface">
                          {s.amount != null ? money(Number(s.amount)) : "—"}
                        </p>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ai.anomaly ? (
          <AiOutputCard row={ai.anomaly} label="Spending anomalies" />
        ) : (
          <AiOutputEmpty message="No anomaly output yet." />
        )}
        {ai.subscription_vampire ? (
          <AiOutputCard row={ai.subscription_vampire} label="Subscription price watch" />
        ) : (
          <AiOutputEmpty message="No subscription watch output yet." />
        )}
      </section>

      <section className={`${sectionShell("p-5 md:p-6")}`}>
        <h2 className="font-headline font-semibold text-lg mb-1">Behavioral nudges</h2>
        <p className="text-xs text-on-surface-variant mb-4">Real-time prompts to turn card activity into actionable decisions.</p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {!dismissedNudges.merchantLoyalty ? (
          <div className="rounded-xl border border-outline-variant/15 p-4 bg-surface-container-low/40">
            <div className="flex items-start justify-between gap-3">
            <p className="text-xs uppercase tracking-wide text-on-surface-variant mb-2">Merchant loyalty wake-up call</p>
              <button
                type="button"
                className="text-[11px] text-on-surface-variant hover:text-on-surface"
                onClick={() => setDismissedNudges((prev) => ({ ...prev, merchantLoyalty: true }))}
              >
                Dismiss
              </button>
            </div>
            {merchantLoyaltyNudge ? (
              <p className="text-sm">
                You visited <strong>{merchantLoyaltyNudge.merchant}</strong> {merchantLoyaltyNudge.visits} times this month for{" "}
                <strong>{money(merchantLoyaltyNudge.amount)}</strong> ({Math.round(merchantLoyaltyNudge.share)}% of card spend).
              </p>
            ) : (
              <p className="text-sm text-on-surface-variant">No high-frequency merchant pattern yet this month.</p>
            )}
            <Link to="/transactions" className="text-xs text-primary hover:underline mt-2 inline-block">
              Review transactions
            </Link>
          </div>
          ) : null}

          {!dismissedNudges.utilization ? (
          <div className="rounded-xl border border-outline-variant/15 p-4 bg-surface-container-low/40">
            <div className="flex items-start justify-between gap-3">
            <p className="text-xs uppercase tracking-wide text-on-surface-variant mb-2">Utilization heatmap</p>
              <button
                type="button"
                className="text-[11px] text-on-surface-variant hover:text-on-surface"
                onClick={() => setDismissedNudges((prev) => ({ ...prev, utilization: true }))}
              >
                Dismiss
              </button>
            </div>
            {utilizationWarnings.length > 0 ? (
              <div className="space-y-2">
                {utilizationWarnings.slice(0, 2).map((u) => (
                  <p key={u.plaid_account_id} className="text-sm">
                    <strong>{u.name}</strong> is at <strong>{Math.round(u.ratio * 100)}%</strong> utilization.
                    Balance {money(u.balance)} / limit proxy {money(u.limitProxy)}.
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-on-surface-variant">All visible cards are below the 25% warning zone.</p>
            )}
          </div>
          ) : null}

          {!dismissedNudges.refundWatch ? (
          <div className="rounded-xl border border-outline-variant/15 p-4 bg-surface-container-low/40">
            <div className="flex items-start justify-between gap-3">
            <p className="text-xs uppercase tracking-wide text-on-surface-variant mb-2">Price drop / refund watchdog</p>
              <button
                type="button"
                className="text-[11px] text-on-surface-variant hover:text-on-surface"
                onClick={() => setDismissedNudges((prev) => ({ ...prev, refundWatch: true }))}
              >
                Dismiss
              </button>
            </div>
            {refundWatchNudges.length > 0 ? (
              <div className="space-y-2">
                {refundWatchNudges.map((r) => (
                  <p key={r.id} className="text-sm">
                    <strong>{r.merchant_name ?? "Unknown merchant"}</strong> refund of {money(Math.abs(Number(r.amount)))} is still
                    pending after {r.ageDays} days.
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-on-surface-variant">No delayed pending refunds over 7 days right now.</p>
            )}
            <a href="#cc-refunds" className="text-xs text-primary hover:underline mt-2 inline-block">
              Open refund tracker
            </a>
          </div>
          ) : null}
        </div>
      </section>

      <section className={`${sectionShell("p-5 md:p-6")}`}>
        <h2 className="font-headline font-semibold text-lg mb-1">Spending insights</h2>
        <p className="text-xs text-on-surface-variant mb-4">
          Useful patterns by merchant and monthly trend (auto-payments excluded).
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-outline-variant/15 p-4 bg-surface-container-low/40">
            <h3 className="text-sm font-semibold mb-3">Top merchants (current data)</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={merchantChart} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`} />
                  <YAxis type="category" dataKey="merchant" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => money(Number(v))} />
                  <Bar dataKey="amount" fill="#2f9e77" radius={[4, 4, 4, 4]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-xl border border-outline-variant/15 p-4 bg-surface-container-low/40">
            <h3 className="text-sm font-semibold mb-3">Monthly spend trend</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyTrend} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip formatter={(v: number) => money(Number(v))} />
                  <Line dataKey="spend" stroke="#4f6db8" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      <section className={`${sectionShell("p-5 md:p-6")}`}>
        <h2 className="font-headline font-semibold text-lg mb-1">Best card to use</h2>
        <p className="text-xs text-on-surface-variant mb-4">
          Search a merchant to get the highest reward-rate recommendation.
          {rewardsStatus === "loading" ? " Refreshing reward profiles..." : ""}
          {rewardsStatus === "error" ? " Reward profiles may be partially stale." : ""}
        </p>
        <form onSubmit={findBestCard} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            className="rounded-xl border border-outline-variant/30 px-3 py-2.5 text-sm"
            placeholder="Search merchant (e.g. Whole Foods)"
            value={bestMerchant}
            onChange={(e) => setBestMerchant(e.target.value)}
          />
          <input
            type="number"
            min={1}
            className="rounded-xl border border-outline-variant/30 px-3 py-2.5 text-sm"
            value={bestAmount}
            onChange={(e) => setBestAmount(e.target.value)}
            placeholder="Spend amount"
          />
          <button type="submit" className="rounded-xl bg-primary text-on-primary px-4 py-2.5 text-sm font-medium">
            Find best card
          </button>
        </form>
        {bestCard?.best ? (
          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <p className="text-xs text-on-surface-variant mb-1">Best match for {bestCard.merchant}</p>
            <p className="font-semibold text-on-surface">{bestCard.best.card_name}</p>
            <p className="text-xs text-on-surface-variant mt-1">{bestCard.best.why_this_card}</p>
            <p className="text-xs text-on-surface-variant mt-1">
              Confidence: {bestCardConfidence ?? "Unknown"} · Category used: {bestCard.category}
            </p>
            <p className="text-sm mt-2">
              Estimated value: <span className="font-semibold">{money(bestCard.best.projected_value)}</span>
            </p>
          </div>
        ) : null}
        {bestCard && bestCard.ranked.length > 1 ? (
          <div className="mt-3 space-y-2">
            {bestCard.ranked.slice(1, 4).map((row) => (
              <div key={row.plaid_account_id} className="rounded-lg border border-outline-variant/15 px-3 py-2 text-sm">
                <span className="font-medium">{row.card_name}</span>
                <span className="text-on-surface-variant"> · {(row.reward_rate * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className={`${sectionShell("p-5 md:p-6")}`}>
        <h2 className="font-headline font-semibold text-lg mb-1">Annual fee tracker</h2>
        <p className="text-xs text-on-surface-variant mb-4">
          Cardmember-year ROI using cashback-equivalent valuation (including statement credits).
        </p>
        {!(annualRoi?.cards.length) ? (
          <div>
            <p className="text-sm text-on-surface-variant">No linked card profiles available yet.</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Retry loading rewards data
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {annualRoi?.cards.map((card) => (
              <div key={card.plaid_account_id} className="rounded-xl border border-outline-variant/15 p-4 bg-surface-container-low/40">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{card.card_name}</p>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${
                      card.breakeven ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {card.breakeven ? "Fee covered" : "Below fee"}
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant mt-1">
                  {card.period_start} to {card.period_end}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-on-surface-variant">Earned value</p>
                    <p className="font-medium">{money(card.earned_value)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-on-surface-variant">Annual fee</p>
                    <p className="font-medium">{money(card.annual_fee)}</p>
                  </div>
                </div>
                <p className={`mt-3 text-sm font-semibold ${card.net_value >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  Net: {money(card.net_value)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="cc-refunds" className={`${sectionShell("p-5 md:p-6")}`}>
        <h2 className="font-headline font-semibold mb-3 text-lg">Refund tracker</h2>
        {refunds.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No refunds yet from linked credit-card transactions.</p>
        ) : (
          <div className="space-y-3">
            {refunds.slice(0, 25).map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 text-sm rounded-xl border border-outline-variant/15 px-3 py-2">
                <div>
                  <p className="font-medium flex items-center gap-2">
                    {r.merchant_name ?? "Unknown merchant"}
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${refundStatusChip(r.status)}`}>{r.status}</span>
                  </p>
                  <p className="text-xs text-on-surface-variant">Posted {r.trans_date}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-on-tertiary-container">{money(Math.abs(Number(r.amount)))}</span>
                  <select
                    className="rounded-lg border border-outline-variant/20 px-2 py-1 text-xs"
                    value={r.status}
                    onChange={(e) => void setRefundStatus(r.id, e.target.value as RefundRow["status"])}
                  >
                    <option value="pending">pending</option>
                    <option value="posted">posted</option>
                    <option value="expired">expired</option>
                    <option value="manual">manual</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
