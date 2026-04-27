import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AiOutputCard, AiOutputEmpty } from "../components/ai/AiOutputCard";
import { RowActionMenu } from "../components/RowActionMenu";
import { api } from "../lib/api";
import type { AiOutputRow, AiOutputsResponse } from "../lib/aiOutputs";
import { useAuth } from "../contexts/AuthContext";
import { cleanDisplayMerchant, MerchantLogo, walletRailLabelFromMetadata } from "../lib/merchantBranding";

type Tx = {
  plaid_transaction_id: string;
  plaid_account_id: string | null;
  merchant_name: string | null;
  raw_merchant_name?: string | null;
  amount: number;
  trans_date: string;
  category: string[] | null;
  wallet_rail?: string | null;
};

type Account = { plaid_account_id: string; name: string; type?: string; subtype?: string };

type ActivityProps = {
  title?: string;
  subtitle?: string;
  compactTableView?: boolean;
  defaultCreditOnly?: boolean;
  defaultInvestmentScope?: boolean;
  hideAnomalyCard?: boolean;
  hideTopSummaryCards?: boolean;
  hideAssistantTools?: boolean;
};

function monthBounds() {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth(), 1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function primaryCategory(t: Tx): string {
  return (t.category ?? [])[0] ?? "Other";
}

function exportLedgerCsv(txs: Tx[], accountMap: Record<string, string>) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [
    ["Date", "Merchant", "Category", "Account", "Amount"].join(","),
    ...txs.map((t) =>
      [
        esc(t.trans_date),
        esc(t.merchant_name ?? ""),
        esc((t.category ?? []).join(" / ")),
        esc(t.plaid_account_id ? accountMap[t.plaid_account_id] ?? t.plaid_account_id : ""),
        esc(String(t.amount)),
      ].join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `finpulse-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Ported from `reference/stitch-html/activity_web/code.html` */
export default function Activity({
  title = "Transactions",
  subtitle = "Monitor and refine your financial flows.",
  compactTableView = false,
  defaultCreditOnly = false,
  defaultInvestmentScope = false,
  hideAnomalyCard = false,
  hideTopSummaryCards = false,
  hideAssistantTools = false,
}: ActivityProps) {
  // Kept for backward compatibility with existing call sites; summary cards were removed.
  void hideTopSummaryCards;
  const { session } = useAuth();
  const [searchParams] = useSearchParams();
  const [txs, setTxs] = useState<Tx[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const defaults = monthBounds();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [merchantFilter, setMerchantFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(
    () => new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("category") ?? ""
  );
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const accountsSeeded = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [labelsByTx, setLabelsByTx] = useState<Record<string, string>>({});
  const [labelTxId, setLabelTxId] = useState("");
  const [labelText, setLabelText] = useState("");
  const [labelShared, setLabelShared] = useState(false);
  const [voiceUtterance, setVoiceUtterance] = useState("");
  const [voiceDraft, setVoiceDraft] = useState<{ amount: number; category: string; merchant_name: string } | null>(null);
  const [autoMerchant, setAutoMerchant] = useState("SQ *LITTLE LUNCH");
  const [autoCategory, setAutoCategory] = useState<{ category: string; confidence: number; rationale: string } | null>(
    null
  );
  const [anomalyRow, setAnomalyRow] = useState<AiOutputRow | null>(null);
  const [groupView, setGroupView] = useState<"category" | "merchant">("category");
  const [flowView, setFlowView] = useState<"expense" | "income">("expense");
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "pending">("all");
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [recurringBusyTx, setRecurringBusyTx] = useState<string | null>(null);
  const [recurringMarked, setRecurringMarked] = useState<Record<string, "yes" | "no">>({});
  const [editingMerchantTx, setEditingMerchantTx] = useState<Tx | null>(null);
  const [viewingMerchantTx, setViewingMerchantTx] = useState<Tx | null>(null);
  const [merchantFixName, setMerchantFixName] = useState("");
  const [merchantFixCategory, setMerchantFixCategory] = useState("");
  const [merchantFixBusy, setMerchantFixBusy] = useState(false);

  const filtersRef = useRef({
    dateFrom,
    dateTo,
    merchantFilter,
    categoryFilter,
    minAmount,
    maxAmount,
  });
  filtersRef.current = { dateFrom, dateTo, merchantFilter, categoryFilter, minAmount, maxAmount };

  useEffect(() => {
    const c = searchParams.get("category");
    if (c !== null) setCategoryFilter(c);
  }, [searchParams]);

  useEffect(() => {
    if (!editingMerchantTx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditingMerchantTx(null);
    };
    window.addEventListener("keydown", onKey);
    const id = window.requestAnimationFrame(() => merchantFixNameRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      window.cancelAnimationFrame(id);
    };
  }, [editingMerchantTx]);

  const loadMeta = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const [cats, acc] = await Promise.all([
        api<{ categories: string[] }>("/meta/transaction-categories", { accessToken: session.access_token }),
        api<{ accounts: Record<string, unknown>[] }>("/plaid/accounts", { accessToken: session.access_token }),
      ]);
      setCategories(cats.categories);
      setAccounts(
        (acc.accounts ?? []).map((a) => ({
          plaid_account_id: String(a.plaid_account_id),
          name: String(a.name ?? "Account"),
          type: String(a.type ?? ""),
          subtype: String(a.subtype ?? ""),
        }))
      );
    } catch {
      /* optional */
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (accounts.length > 0 && !accountsSeeded.current) {
      if (defaultCreditOnly) {
        const credit = accounts
          .filter((a) => {
            const t = (a.type ?? "").toLowerCase();
            const st = (a.subtype ?? "").toLowerCase();
            return t === "credit" || st.includes("credit");
          })
          .map((a) => a.plaid_account_id);
        setSelectedAccountIds(new Set(credit.length > 0 ? credit : accounts.map((a) => a.plaid_account_id)));
      } else if (defaultInvestmentScope) {
        const investmentScope = accounts
          .filter((a) => {
            const t = (a.type ?? "").toLowerCase();
            const st = (a.subtype ?? "").toLowerCase();
            const n = (a.name ?? "").toLowerCase();
            if (t === "credit" || st.includes("credit")) return false;
            if (
              st.includes("escrow") ||
              st.includes("mortgage") ||
              st.includes("auto") ||
              st.includes("car") ||
              n.includes("escrow") ||
              n.includes("mortgage") ||
              n.includes("auto loan") ||
              n.includes("car loan")
            ) {
              return false;
            }
            return true;
          })
          .map((a) => a.plaid_account_id);
        setSelectedAccountIds(
          new Set(investmentScope.length > 0 ? investmentScope : accounts.map((a) => a.plaid_account_id))
        );
      } else {
        setSelectedAccountIds(new Set(accounts.map((a) => a.plaid_account_id)));
      }
      accountsSeeded.current = true;
    }
  }, [accounts, defaultCreditOnly, defaultInvestmentScope]);

  const load = useCallback(async () => {
    if (!session?.access_token) {
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    const f = filtersRef.current;
    const catFromUrl = searchParams.get("category");
    const qFromUrl = searchParams.get("q")?.trim() ?? "";
    try {
      const params = new URLSearchParams();
      if (f.dateFrom) params.set("from", f.dateFrom);
      if (f.dateTo) params.set("to", f.dateTo);
      if (qFromUrl) params.set("q", qFromUrl);
      else if (f.merchantFilter.trim()) params.set("merchant", f.merchantFilter.trim());
      const cat = catFromUrl?.trim() || f.categoryFilter.trim();
      if (cat) params.set("category", cat);
      if (f.minAmount.trim() !== "") {
        const n = Number(f.minAmount);
        if (!Number.isNaN(n)) params.set("minAmount", String(n));
      }
      if (f.maxAmount.trim() !== "") {
        const n = Number(f.maxAmount);
        if (!Number.isNaN(n)) params.set("maxAmount", String(n));
      }
      params.set("limit", "5000");
      const q = params.toString() ? `?${params.toString()}` : "";
      const t = await api<{ transactions: Tx[] }>(`/transactions${q}`, { accessToken: session.access_token });
      setTxs(t.transactions);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, searchParams]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (!session?.access_token) return;
    load();
  }, [session?.access_token, load, searchParams]);

  useEffect(() => {
    if (!session?.access_token) return;
    void (async () => {
      try {
        const out = await api<AiOutputsResponse>("/ai-outputs?families=anomaly", {
          accessToken: session.access_token,
        });
        setAnomalyRow(out.byFamily?.anomaly ?? null);
      } catch {
        setAnomalyRow(null);
      }
    })();
  }, [session?.access_token]);

  useEffect(() => {
    if (!session?.access_token || txs.length === 0) {
      setLabelsByTx({});
      return;
    }
    const ids = txs.slice(0, 400).map((t) => t.plaid_transaction_id);
    const qs = ids.join(",");
    if (!qs) return;
    void api<{ labels: { plaid_transaction_id: string; label: string }[] }>(
      `/meta/transaction-labels?ids=${encodeURIComponent(qs)}`,
      { accessToken: session.access_token }
    )
      .then((r) => {
        const m: Record<string, string> = {};
        for (const l of r.labels ?? []) m[l.plaid_transaction_id] = l.label;
        setLabelsByTx(m);
      })
      .catch(() => setLabelsByTx({}));
  }, [session?.access_token, txs]);

  const accountMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of accounts) m[a.plaid_account_id] = a.name;
    return m;
  }, [accounts]);

  const visibleAccounts = useMemo(() => {
    if (!defaultCreditOnly) return accounts;
    if (defaultCreditOnly) {
      return accounts.filter((a) => {
        const t = (a.type ?? "").toLowerCase();
        const st = (a.subtype ?? "").toLowerCase();
        return t === "credit" || st.includes("credit");
      });
    }
    if (defaultInvestmentScope) {
      return accounts.filter((a) => {
        const t = (a.type ?? "").toLowerCase();
        const st = (a.subtype ?? "").toLowerCase();
        const n = (a.name ?? "").toLowerCase();
        if (t === "credit" || st.includes("credit")) return false;
        if (
          st.includes("escrow") ||
          st.includes("mortgage") ||
          st.includes("auto") ||
          st.includes("car") ||
          n.includes("escrow") ||
          n.includes("mortgage") ||
          n.includes("auto loan") ||
          n.includes("car loan")
        ) {
          return false;
        }
        return true;
      });
    }
    return accounts.filter((a) => {
      const t = (a.type ?? "").toLowerCase();
      const st = (a.subtype ?? "").toLowerCase();
      return t === "credit" || st.includes("credit");
    });
  }, [accounts, defaultCreditOnly, defaultInvestmentScope]);

  const filteredTxs = useMemo(() => {
    const scopedIds = new Set(visibleAccounts.map((a) => a.plaid_account_id));
    const source =
      (defaultCreditOnly || defaultInvestmentScope) && scopedIds.size > 0
        ? txs.filter((t) => t.plaid_account_id && scopedIds.has(t.plaid_account_id))
        : txs;
    if (visibleAccounts.length === 0 || selectedAccountIds.size === 0) return source;
    if (selectedAccountIds.size >= visibleAccounts.length) return source;
    return source.filter((t) => t.plaid_account_id && selectedAccountIds.has(t.plaid_account_id));
  }, [txs, selectedAccountIds, visibleAccounts, defaultCreditOnly, defaultInvestmentScope]);

  const groupedSpend = useMemo(() => {
    const by = new Map<string, number>();
    for (const t of filteredTxs) {
      const amt = Number(t.amount);
      const isIncomeCategory = (t.category ?? []).some((c) =>
        /income|paycheck|salary|payroll|interest|dividend|deposit|benefit/i.test(c)
      );
      // Supports mixed provider sign conventions by using both sign and semantic category hints.
      const isLikelyExpense = amt > 0 || (amt < 0 && !isIncomeCategory);
      const isLikelyIncome = amt < 0 && isIncomeCategory;
      if (flowView === "expense" && !isLikelyExpense) continue;
      if (flowView === "income" && !isLikelyIncome) continue;
      const key = groupView === "category" ? primaryCategory(t) : (t.merchant_name ?? "Unknown");
      by.set(key, (by.get(key) ?? 0) + Math.abs(amt));
    }
    const total = [...by.values()].reduce((s, n) => s + n, 0);
    return {
      total,
      rows: [...by.entries()]
        .map(([name, amount]) => ({ name, amount, sharePct: total > 0 ? (amount / total) * 100 : 0 }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 12),
    };
  }, [filteredTxs, groupView, flowView]);

  const compactRows = useMemo(() => {
    return filteredTxs.filter((t) => {
      if (statusFilter === "all") return true;
      const pending = uncertainRecurringByTx.has(t.plaid_transaction_id);
      if (statusFilter === "pending") return pending;
      return !pending;
    });
  }, [filteredTxs, statusFilter, uncertainRecurringByTx]);

  const uncertainRecurringByTx = useMemo(() => {
    const byMerchant = new Map<string, Tx[]>();
    for (const t of filteredTxs) {
      const key = (t.merchant_name ?? "").trim().toLowerCase();
      if (!key) continue;
      if (Number(t.amount) <= 0) continue;
      const arr = byMerchant.get(key) ?? [];
      arr.push(t);
      byMerchant.set(key, arr);
    }

    const out = new Map<string, string>();
    for (const txsForMerchant of byMerchant.values()) {
      if (txsForMerchant.length < 2 || txsForMerchant.length > 4) continue;
      const ordered = [...txsForMerchant].sort((a, b) => a.trans_date.localeCompare(b.trans_date));
      const gaps: number[] = [];
      for (let i = 1; i < ordered.length; i++) {
        const prev = new Date(`${ordered[i - 1]!.trans_date}T00:00:00.000Z`).getTime();
        const curr = new Date(`${ordered[i]!.trans_date}T00:00:00.000Z`).getTime();
        if (Number.isFinite(prev) && Number.isFinite(curr)) {
          gaps.push(Math.round((curr - prev) / 86400000));
        }
      }
      if (gaps.length === 0) continue;
      const meanGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const spread = Math.max(...gaps) - Math.min(...gaps);
      const amounts = ordered.map((t) => Math.abs(Number(t.amount))).filter((n) => Number.isFinite(n) && n > 0);
      const avg = amounts.reduce((s, n) => s + n, 0) / Math.max(1, amounts.length);
      const maxDev = Math.max(...amounts.map((n) => Math.abs(n - avg)));
      const amountVarianceRatio = avg > 0 ? maxDev / avg : 0;
      const unsure =
        (meanGap >= 14 && meanGap <= 45 && spread > 9) ||
        (meanGap >= 14 && meanGap <= 45 && amountVarianceRatio > 0.4) ||
        txsForMerchant.length === 2;
      if (!unsure) continue;
      for (const t of txsForMerchant) {
        out.set(t.plaid_transaction_id, "This merchant looks recurring but confidence is low.");
      }
    }
    return out;
  }, [filteredTxs]);

  const labelDisplayByTx = useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of filteredTxs) {
      const manualLabel = labelsByTx[t.plaid_transaction_id];
      if (manualLabel && manualLabel.trim()) {
        out[t.plaid_transaction_id] = manualLabel;
        continue;
      }
      const walletLabel = walletRailLabelFromMetadata(t.wallet_rail);
      if (walletLabel) out[t.plaid_transaction_id] = walletLabel;
    }
    return out;
  }, [filteredTxs, labelsByTx]);

  const setRecurringPreference = async (tx: Tx, isRecurring: boolean) => {
    if (!session?.access_token) return;
    setErr(null);
    setRecurringBusyTx(tx.plaid_transaction_id);
    try {
      await api("/subscriptions/recurring-preference", {
        method: "POST",
        accessToken: session.access_token,
        body: JSON.stringify({ plaid_transaction_id: tx.plaid_transaction_id, isRecurring }),
      });
      setRecurringMarked((prev) => ({ ...prev, [tx.plaid_transaction_id]: isRecurring ? "yes" : "no" }));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to update recurring preference");
    } finally {
      setRecurringBusyTx(null);
    }
  };

  const merchantFixNameRef = useRef<HTMLInputElement>(null);

  const openMerchantFix = (tx: Tx) => {
    setEditingMerchantTx(tx);
    setMerchantFixName(cleanDisplayMerchant(tx.merchant_name));
    setMerchantFixCategory("");
  };

  const saveMerchantFix = async () => {
    if (!session?.access_token || !editingMerchantTx) return;
    const normalizedPattern = String(editingMerchantTx.raw_merchant_name ?? editingMerchantTx.merchant_name ?? "").trim();
    if (!normalizedPattern || !merchantFixName.trim()) return;
    setMerchantFixBusy(true);
    setErr(null);
    try {
      await api<{ id: string; merchant_pattern: string; canonical_merchant: string; category_override: string | null }>(
        "/meta/merchant-overrides",
        {
          method: "POST",
          accessToken: session.access_token,
          body: JSON.stringify({
            merchant_pattern: normalizedPattern,
            canonical_merchant: merchantFixName.trim(),
            category_override: merchantFixCategory.trim() || null,
          }),
        }
      );
      const canonical = merchantFixName.trim();
      const overrideCat = merchantFixCategory.trim();
      setTxs((prev) =>
        prev.map((t) =>
          t.plaid_transaction_id === editingMerchantTx.plaid_transaction_id
            ? {
                ...t,
                merchant_name: canonical,
                category: overrideCat ? [overrideCat] : editingMerchantTx.category?.length ? editingMerchantTx.category : ["Uncategorized"],
              }
            : t
        )
      );
      setEditingMerchantTx(null);
      setMerchantFixName("");
      setMerchantFixCategory("");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to save merchant fix");
    } finally {
      setMerchantFixBusy(false);
    }
  };

  const saveLabel = async () => {
    if (!session?.access_token || !labelTxId.trim() || !labelText.trim()) return;
    setErr(null);
    try {
      await api("/meta/transaction-labels", {
        method: "POST",
        accessToken: session.access_token,
        body: JSON.stringify({
          plaid_transaction_id: labelTxId.trim(),
          label: labelText.trim(),
          shared: labelShared,
        }),
      });
      setLabelsByTx((prev) => ({ ...prev, [labelTxId.trim()]: labelText.trim() }));
      setLabelTxId("");
      setLabelText("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to save label");
    }
  };

  const buildVoiceDraft = async () => {
    if (!session?.access_token || !voiceUtterance.trim()) return;
    setErr(null);
    try {
      const out = await api<{ draft: { amount: number; category: string; merchant_name: string } }>(
        "/ai/voice-log-draft",
        {
          method: "POST",
          accessToken: session.access_token,
          body: JSON.stringify({ utterance: voiceUtterance.trim() }),
        }
      );
      setVoiceDraft(out.draft);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to draft");
    }
  };

  const runAutoCategorize = async () => {
    if (!session?.access_token || !autoMerchant.trim()) return;
    setErr(null);
    try {
      const out = await api<{ category: string; confidence: number; rationale: string }>("/ai/auto-categorize", {
        method: "POST",
        accessToken: session.access_token,
        body: JSON.stringify({ merchant_name: autoMerchant.trim() }),
      });
      setAutoCategory(out);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to categorize");
    }
  };

  const toggleAccount = (id: string) => {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllAccounts = () => {
    setSelectedAccountIds(new Set(visibleAccounts.map((a) => a.plaid_account_id)));
  };

  if (compactTableView) {
    return (
      <main className="w-full overflow-y-auto">
        {err ? <p className="text-sm text-error mb-4">{err}</p> : null}
        <section className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-headline text-3xl font-bold text-on-surface tracking-tight">Transactions History</h2>
              <p className="font-body text-sm text-on-surface-variant mt-1">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => exportLedgerCsv(compactRows, accountMap)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary text-on-primary px-4 py-2.5 text-sm font-semibold shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              Export Data
            </button>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-xl border border-outline-variant/20 px-3 py-2 text-sm bg-surface-container-lowest"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-xl border border-outline-variant/20 px-3 py-2 text-sm bg-surface-container-lowest"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-xl border border-outline-variant/20 px-3 py-2 text-sm bg-surface-container-lowest"
            >
              <option value="">Category</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={maxAmount}
              placeholder="Amount"
              onChange={(e) => setMaxAmount(e.target.value)}
              className="w-32 rounded-xl border border-outline-variant/20 px-3 py-2 text-sm bg-surface-container-lowest"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "completed" | "pending")}
              className="rounded-xl border border-outline-variant/20 px-3 py-2 text-sm bg-surface-container-lowest"
            >
              <option value="all">Status</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
            </select>
            <button
              type="button"
              onClick={() => setMoreFiltersOpen((v) => !v)}
              className="rounded-xl border border-outline-variant/20 px-4 py-2 text-sm bg-surface-container-lowest"
            >
              More Filters
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-xl bg-secondary-container text-on-secondary-container px-4 py-2 text-sm font-semibold"
            >
              Apply
            </button>
          </div>
          {moreFiltersOpen ? (
            <div className="mt-3 flex flex-wrap gap-3">
              <input
                value={merchantFilter}
                onChange={(e) => setMerchantFilter(e.target.value)}
                className="rounded-xl border border-outline-variant/20 px-3 py-2 text-sm"
                placeholder="Merchant"
              />
              <input
                type="number"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                className="w-28 rounded-xl border border-outline-variant/20 px-3 py-2 text-sm"
                placeholder="Min"
              />
              <select
                value=""
                onChange={() => {}}
                className="rounded-xl border border-outline-variant/20 px-3 py-2 text-sm"
              >
                <option value="">Accounts ({selectedAccountIds.size}/{visibleAccounts.length})</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  const d = monthBounds();
                  setDateFrom(d.from);
                  setDateTo(d.to);
                  setMerchantFilter("");
                  setCategoryFilter("");
                  setMinAmount("");
                  setMaxAmount("");
                  setStatusFilter("all");
                  selectAllAccounts();
                  setTimeout(() => load(), 0);
                }}
                className="rounded-xl border border-outline-variant/20 px-4 py-2 text-sm text-on-surface-variant"
              >
                Reset
              </button>
            </div>
          ) : null}

          <div className="mt-6 overflow-x-auto rounded-2xl border border-outline-variant/15 bg-surface">
            <table className="w-full min-w-[980px] text-left">
              <thead className="bg-surface-container-low/70 text-xs uppercase tracking-wide text-on-surface-variant">
                <tr>
                  <th className="px-5 py-3 font-semibold">Date</th>
                  <th className="px-5 py-3 font-semibold">Description</th>
                  <th className="px-5 py-3 font-semibold">Category</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Label</th>
                  <th className="px-5 py-3 font-semibold">Account</th>
                  <th className="px-5 py-3 font-semibold text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/15">
                {compactRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-sm text-on-surface-variant">
                      No transactions match these filters.
                    </td>
                  </tr>
                ) : (
                  compactRows.map((t) => {
                    const pending = uncertainRecurringByTx.has(t.plaid_transaction_id);
                    return (
                      <tr key={t.plaid_transaction_id} className="hover:bg-surface-container-low/60">
                        <td className="px-5 py-4 text-sm text-on-surface-variant">{t.trans_date}</td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2 min-w-0">
                            <MerchantLogo merchantName={cleanDisplayMerchant(t.merchant_name)} sizeClass="h-8 w-8" />
                            <span className="text-sm font-medium text-on-surface truncate">{cleanDisplayMerchant(t.merchant_name)}</span>
                            <RowActionMenu
                              label="Merchant actions"
                              items={[
                                { id: "view", label: "View merchant", icon: "visibility", onClick: () => setViewingMerchantTx(t) },
                                { id: "edit", label: "Edit merchant details", icon: "edit", onClick: () => openMerchantFix(t) },
                              ]}
                            />
                          </div>
                        </td>
                        <td className="px-5 py-4 text-sm text-on-surface">{(t.category ?? []).join(" · ") || "—"}</td>
                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs border ${
                              pending ? "bg-tertiary-container/40 border-tertiary-container text-on-surface" : "bg-secondary-container/40 border-secondary-container text-on-surface"
                            }`}
                          >
                            <span className="material-symbols-outlined text-[14px]">{pending ? "schedule" : "check_circle"}</span>
                            {pending ? "Pending" : "Completed"}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-sm text-on-surface-variant">{labelDisplayByTx[t.plaid_transaction_id] ?? "—"}</td>
                        <td className="px-5 py-4 text-sm text-on-surface-variant">
                          {t.plaid_account_id ? accountMap[t.plaid_account_id] ?? "—" : "—"}
                        </td>
                        <td className="px-5 py-4 text-right text-sm font-semibold text-on-surface">
                          {Math.abs(t.amount).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="w-full overflow-y-auto">
      {err ? <p className="text-sm text-error mb-4">{err}</p> : null}

      <div className="mb-10">
        <h2 className="font-headline text-3xl font-bold text-on-surface tracking-tight">{title}</h2>
        <p className="font-body text-sm text-on-surface-variant mt-2">{subtitle}</p>
        {loading ? (
          <p className="text-xs text-on-surface-variant mt-2 font-body" aria-live="polite">
            Loading…
          </p>
        ) : null}
      </div>

      {!hideAnomalyCard ? <section className="mb-8" aria-label="Spending anomalies">
        {anomalyRow ? (
          <AiOutputCard row={anomalyRow} label="Spending anomalies">
            {Array.isArray((anomalyRow.payload as { anomalies?: unknown })?.anomalies) &&
            ((anomalyRow.payload as { anomalies: { merchant: string; amount: number; reason: string }[] }).anomalies
              ?.length ?? 0) > 0 ? (
              <ul className="mt-3 space-y-2 text-sm font-body text-on-surface">
                {(
                  (anomalyRow.payload as { anomalies: { merchant: string; amount: number; reason: string }[] })
                    .anomalies ?? []
                ).map((a, i) => (
                  <li
                    key={`${a.merchant}-${i}`}
                    className="rounded-lg bg-surface-container-low px-3 py-2 border border-outline-variant/10"
                  >
                    <span className="font-medium text-on-background">{a.merchant}</span> ·{" "}
                    {Math.abs(a.amount).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                    <p className="text-xs text-on-surface-variant mt-1">{a.reason}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-on-surface-variant font-body">No spike or duplicate-pattern flags right now.</p>
            )}
          </AiOutputCard>
        ) : (
          <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4">
            <h3 className="font-headline text-sm font-semibold text-on-surface mb-1">Spending anomalies</h3>
            <AiOutputEmpty message="Anomaly scan runs after account sync." />
          </div>
        )}
      </section> : null}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        <aside className="xl:col-span-3 space-y-8">
          <div className="bg-surface-container-lowest rounded-xl p-6 ambient-shadow ring-1 ring-outline-variant/10">
            <h3 className="font-headline text-sm font-bold text-on-surface mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">tune</span>
              Refine
            </h3>
            <div className="mb-6">
              <label className="block font-body text-xs font-semibold text-on-surface-variant mb-3">Date Range</label>
              <div className="space-y-3">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full text-sm font-body text-on-surface rounded-xl border border-outline-variant/20 px-3 py-2 bg-surface-container-lowest"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full text-sm font-body text-on-surface rounded-xl border border-outline-variant/20 px-3 py-2 bg-surface-container-lowest"
                />
              </div>
            </div>
            <div className="mb-6">
              <label className="block font-body text-xs font-semibold text-on-surface-variant mb-3">Category</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full text-sm font-body text-on-surface rounded-xl border border-outline-variant/20 px-3 py-2 bg-transparent"
              >
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-8">
              <label className="block font-body text-xs font-semibold text-on-surface-variant mb-3">Account</label>
              <div className="space-y-2">
                {visibleAccounts.map((a) => (
                  <label key={a.plaid_account_id} className="flex items-center gap-3 group cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedAccountIds.has(a.plaid_account_id)}
                      onChange={() => toggleAccount(a.plaid_account_id)}
                      className="rounded text-primary border-outline-variant focus:ring-primary w-4 h-4"
                    />
                    <span className="font-body text-sm text-on-surface group-hover:text-primary transition-colors">
                      {a.name}
                    </span>
                  </label>
                ))}
              </div>
              <button type="button" onClick={selectAllAccounts} className="text-xs text-on-secondary-container mt-2">
                Select all
              </button>
            </div>
            <div className="mb-6">
              <label className="block font-body text-xs font-semibold text-on-surface-variant mb-1">Merchant</label>
              <input
                value={merchantFilter}
                onChange={(e) => setMerchantFilter(e.target.value)}
                className="w-full text-sm font-body rounded-xl border border-outline-variant/20 px-3 py-2"
                placeholder="Optional"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 mb-6">
              <input
                type="number"
                placeholder="Min"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                className="text-sm rounded-xl border border-outline-variant/20 px-2 py-2"
              />
              <input
                type="number"
                placeholder="Max"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                className="text-sm rounded-xl border border-outline-variant/20 px-2 py-2"
              />
            </div>
            <button
              type="button"
              onClick={load}
              className="w-full py-2.5 bg-secondary-container text-on-secondary-container rounded-xl font-body text-sm font-semibold hover:bg-surface-dim transition-colors"
            >
              Apply Filters
            </button>
            <button
              type="button"
              onClick={() => {
                const d = monthBounds();
                setDateFrom(d.from);
                setDateTo(d.to);
                setMerchantFilter("");
                setCategoryFilter("");
                setMinAmount("");
                setMaxAmount("");
                selectAllAccounts();
                setTimeout(() => load(), 0);
              }}
              className="w-full mt-2 text-xs text-on-surface-variant"
            >
              Reset month
            </button>
            {!hideAssistantTools ? <div className="mt-8 pt-6 border-t border-outline-variant/15">
              <h4 className="font-headline text-xs font-bold text-on-surface mb-3">Transaction label</h4>
              <p className="text-[10px] text-on-surface-variant font-body mb-2">
                Paste a transaction id from the table below. Optional: share with household when joined.
              </p>
              <input
                value={labelTxId}
                onChange={(e) => setLabelTxId(e.target.value)}
                placeholder="Transaction id"
                className="w-full text-xs rounded-lg border border-outline-variant/20 px-2 py-2 mb-2 font-mono"
              />
              <input
                value={labelText}
                onChange={(e) => setLabelText(e.target.value)}
                placeholder="Label"
                className="w-full text-xs rounded-lg border border-outline-variant/20 px-2 py-2 mb-2"
              />
              <label className="flex items-center gap-2 text-xs text-on-surface-variant font-body mb-2">
                <input
                  type="checkbox"
                  checked={labelShared}
                  onChange={(e) => setLabelShared(e.target.checked)}
                  className="rounded border-outline-variant"
                />
                Share with household
              </label>
              <button
                type="button"
                onClick={() => void saveLabel()}
                className="w-full py-2 text-xs bg-secondary-container text-on-secondary-container rounded-xl font-semibold"
              >
                Save label
              </button>
            </div> : null}
            {!hideAssistantTools ? <div className="mt-6 pt-6 border-t border-outline-variant/15">
              <h4 className="font-headline text-xs font-bold text-on-surface mb-2">Voice quick-log draft</h4>
              <input
                value={voiceUtterance}
                onChange={(e) => setVoiceUtterance(e.target.value)}
                placeholder="Hey Tracker, I just spent 25 dollars on badminton court fees"
                className="w-full text-xs rounded-lg border border-outline-variant/20 px-2 py-2 mb-2"
              />
              <button
                type="button"
                onClick={() => void buildVoiceDraft()}
                className="w-full py-2 text-xs bg-secondary-container text-on-secondary-container rounded-xl font-semibold"
              >
                Parse voice text
              </button>
              {voiceDraft ? (
                <p className="text-[10px] mt-2 text-on-surface-variant font-body">
                  Draft: {voiceDraft.merchant_name} · ${voiceDraft.amount.toFixed(2)} · {voiceDraft.category}
                </p>
              ) : null}
            </div> : null}
            <div className="mt-6 pt-6 border-t border-outline-variant/15">
              <h4 className="font-headline text-xs font-bold text-on-surface mb-2">Auto-categorization 2.0</h4>
              <input
                value={autoMerchant}
                onChange={(e) => setAutoMerchant(e.target.value)}
                className="w-full text-xs rounded-lg border border-outline-variant/20 px-2 py-2 mb-2"
                placeholder="Merchant string"
              />
              <button
                type="button"
                onClick={() => void runAutoCategorize()}
                className="w-full py-2 text-xs bg-secondary-container text-on-secondary-container rounded-xl font-semibold"
              >
                Suggest category
              </button>
              {autoCategory ? (
                <p className="text-[10px] mt-2 text-on-surface-variant font-body">
                  {autoCategory.category} ({Math.round(autoCategory.confidence * 100)}%): {autoCategory.rationale}
                </p>
              ) : null}
            </div>
          </div>
        </aside>

        <div className="xl:col-span-9 space-y-8">
          <section className="bg-surface-container-lowest rounded-xl p-6 ambient-shadow ring-1 ring-outline-variant/10">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="font-headline text-lg font-semibold text-on-surface">Spend breakdown</h3>
              <div className="flex items-center gap-2 text-xs">
                <div className="flex rounded-lg border border-outline-variant/20 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setFlowView("expense")}
                    className={`px-3 py-1.5 ${flowView === "expense" ? "bg-surface-container text-on-surface font-semibold" : "text-on-surface-variant"}`}
                  >
                    Expenses
                  </button>
                  <button
                    type="button"
                    onClick={() => setFlowView("income")}
                    className={`px-3 py-1.5 ${flowView === "income" ? "bg-surface-container text-on-surface font-semibold" : "text-on-surface-variant"}`}
                  >
                    Income
                  </button>
                </div>
                <div className="flex rounded-lg border border-outline-variant/20 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setGroupView("category")}
                    className={`px-3 py-1.5 ${groupView === "category" ? "bg-surface-container text-on-surface font-semibold" : "text-on-surface-variant"}`}
                  >
                    Category
                  </button>
                  <button
                    type="button"
                    onClick={() => setGroupView("merchant")}
                    className={`px-3 py-1.5 ${groupView === "merchant" ? "bg-surface-container text-on-surface font-semibold" : "text-on-surface-variant"}`}
                  >
                    Merchant
                  </button>
                </div>
              </div>
            </div>
            {groupedSpend.rows.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No rows in current filter for this grouping.</p>
            ) : (
              <div className="space-y-3">
                {groupedSpend.rows.map((row) => (
                  <div key={row.name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-on-surface">{row.name}</span>
                      <span className="text-on-surface-variant">
                        {row.amount.toLocaleString(undefined, { style: "currency", currency: "USD" })} ({row.sharePct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
                      <div className="h-full bg-secondary-container rounded-full" style={{ width: `${Math.max(2, row.sharePct)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="bg-surface-container-lowest rounded-xl ambient-shadow ring-1 ring-outline-variant/10 overflow-hidden">
            <div className="p-6 border-b border-surface-container-low flex justify-between items-center bg-surface-bright">
              <h3 className="font-headline text-lg font-bold text-on-surface">All transactions</h3>
              <button
                type="button"
                onClick={() => exportLedgerCsv(filteredTxs, accountMap)}
                className="text-sm font-body text-on-surface-variant hover:text-primary flex items-center gap-1 transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                Export
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low/50">
                    <th scope="col" className="px-6 py-4 font-body text-xs font-semibold text-on-surface-variant w-32">
                      Date
                    </th>
                    <th scope="col" className="px-6 py-4 font-body text-xs font-semibold text-on-surface-variant">
                      Merchant
                    </th>
                    <th scope="col" className="px-6 py-4 font-body text-xs font-semibold text-on-surface-variant">
                      Category
                    </th>
                    <th scope="col" className="px-6 py-4 font-body text-xs font-semibold text-on-surface-variant">
                      Label
                    </th>
                    <th scope="col" className="px-6 py-4 font-body text-xs font-semibold text-on-surface-variant">
                      Account
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-4 font-body text-xs font-semibold text-on-surface-variant text-right"
                    >
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTxs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-on-surface-variant font-body text-sm">
                        No transactions match.
                      </td>
                    </tr>
                  ) : (
                    filteredTxs.map((t, i) => (
                      <tr
                        key={t.plaid_transaction_id}
                        className={`hover:bg-surface-container-low/50 transition-colors ${i % 2 === 1 ? "bg-surface-bright" : ""}`}
                      >
                        <td className="px-6 py-5 font-body text-sm text-on-surface-variant">{t.trans_date}</td>
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2 min-w-0">
                            <MerchantLogo merchantName={cleanDisplayMerchant(t.merchant_name)} sizeClass="h-8 w-8" />
                            <span className="font-body font-medium text-on-surface truncate min-w-0 flex-1">
                              {cleanDisplayMerchant(t.merchant_name)}
                            </span>
                            <RowActionMenu
                              label="Merchant actions"
                              items={[
                                {
                                  id: "view",
                                  label: "View merchant",
                                  icon: "visibility",
                                  onClick: () => setViewingMerchantTx(t),
                                },
                                {
                                  id: "edit",
                                  label: "Edit merchant details",
                                  icon: "edit",
                                  onClick: () => openMerchantFix(t),
                                },
                              ]}
                            />
                          </div>
                        </td>
                        <td className="px-6 py-5 font-body text-sm text-on-surface-variant">
                          {(t.category ?? []).join(" · ") || "—"}
                        </td>
                        <td className="px-6 py-5 font-body text-sm text-on-surface-variant">
                          {labelDisplayByTx[t.plaid_transaction_id] ?? "—"}
                        </td>
                        <td className="px-6 py-5 font-body text-sm text-on-surface-variant">
                          {t.plaid_account_id ? accountMap[t.plaid_account_id] ?? "—" : "—"}
                        </td>
                      <td
                          className={`px-6 py-5 font-body font-medium text-right ${
                            t.amount < 0 ? "text-on-tertiary-container" : "text-on-surface"
                          }`}
                        >
                          {Math.abs(t.amount).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                        {uncertainRecurringByTx.has(t.plaid_transaction_id) ? (
                          <div className="mt-1">
                            <p className="text-[10px] text-on-surface-variant mb-0.5">
                              {uncertainRecurringByTx.get(t.plaid_transaction_id)}
                            </p>
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                disabled={recurringBusyTx === t.plaid_transaction_id}
                                onClick={() => void setRecurringPreference(t, true)}
                                className={`text-[11px] hover:underline disabled:opacity-50 ${recurringMarked[t.plaid_transaction_id] === "yes" ? "text-primary font-semibold" : "text-primary"}`}
                              >
                                Mark recurring
                              </button>
                              <button
                                type="button"
                                disabled={recurringBusyTx === t.plaid_transaction_id}
                                onClick={() => void setRecurringPreference(t, false)}
                                className={`text-[11px] hover:underline disabled:opacity-50 ${recurringMarked[t.plaid_transaction_id] === "no" ? "text-primary font-semibold" : "text-on-surface-variant"}`}
                              >
                                Not recurring
                              </button>
                            </div>
                          </div>
                        ) : recurringMarked[t.plaid_transaction_id] === "yes" ? (
                          <div className="mt-1 text-[11px] text-primary">Recurring ✓</div>
                        ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      {editingMerchantTx ? (
        <div
          role="presentation"
          className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4"
          onClick={() => setEditingMerchantTx(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="merchant-fix-title"
            className="w-full max-w-md rounded-xl bg-surface-container-lowest border border-outline-variant/20 p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="merchant-fix-title" className="font-headline text-base font-semibold text-on-surface">
              Correct merchant and category
            </h4>
            <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">
              Shown name for this merchant. Corrections apply to similar statement descriptions. Bank text:{" "}
              <span className="font-mono text-[11px] text-on-surface">
                {editingMerchantTx.raw_merchant_name ?? editingMerchantTx.merchant_name ?? "—"}
              </span>
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="merchant-fix-name" className="block text-xs font-medium text-on-surface-variant mb-1">
                  Display name
                </label>
                <input
                  id="merchant-fix-name"
                  ref={merchantFixNameRef}
                  value={merchantFixName}
                  onChange={(e) => setMerchantFixName(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant/20 px-3 py-2 text-sm bg-surface-container-lowest"
                />
              </div>
              <div>
                <label htmlFor="merchant-fix-category" className="block text-xs font-medium text-on-surface-variant mb-1">
                  Category
                </label>
                <select
                  id="merchant-fix-category"
                  value={merchantFixCategory}
                  onChange={(e) => setMerchantFixCategory(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant/20 px-3 py-2 text-sm bg-surface-container-lowest"
                >
                  <option value="">Use automatic category</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingMerchantTx(null)}
                className="text-sm text-on-surface-variant px-3 py-2 rounded-lg hover:bg-surface-container-high/80"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={merchantFixBusy}
                onClick={() => void saveMerchantFix()}
                className="rounded-lg bg-primary text-on-primary px-4 py-2 text-sm font-medium disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {viewingMerchantTx ? (
        <div
          role="presentation"
          className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4"
          onClick={() => setViewingMerchantTx(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl bg-surface-container-lowest border border-outline-variant/20 p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="font-headline text-base font-semibold text-on-surface">Merchant details</h4>
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-on-surface"><span className="text-on-surface-variant">Display:</span> {cleanDisplayMerchant(viewingMerchantTx.merchant_name)}</p>
              <p className="text-on-surface"><span className="text-on-surface-variant">Raw:</span> {viewingMerchantTx.raw_merchant_name ?? "—"}</p>
              <p className="text-on-surface"><span className="text-on-surface-variant">Category:</span> {(viewingMerchantTx.category ?? []).join(" · ") || "—"}</p>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setViewingMerchantTx(null)}
                className="text-sm text-on-surface-variant px-3 py-2 rounded-lg hover:bg-surface-container-high/80"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
