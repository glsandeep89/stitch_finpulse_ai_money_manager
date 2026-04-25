import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RowActionMenu } from "../components/RowActionMenu";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { cleanDisplayMerchant, MerchantLogo } from "../lib/merchantBranding";

type Sub = {
  id: string;
  name: string;
  merchant_name: string | null;
  amount: number | null;
  next_payment_date: string | null;
  frequency: string | null;
  raw?: {
    payment_account_name?: string | null;
    category?: string | null;
    merchant_key?: string | null;
  } | null;
};

type RecurringTab = "monthly" | "all";

function money(v: number | null | undefined) {
  if (!Number.isFinite(v)) return "—";
  return Number(v).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function monthlyEquivalent(amount: number | null, frequency: string | null): number {
  if (amount == null || !Number.isFinite(amount)) return 0;
  const f = (frequency || "").toLowerCase();
  if (f.includes("year") || f.includes("annual")) return amount / 12;
  if (f.includes("week")) return amount * 4.33;
  if (f.includes("quarter")) return amount / 3;
  return amount;
}


function dateLabel(date: string | null) {
  if (!date) return "—";
  const dt = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) return "—";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dt.getTime() - today.getTime()) / 86400000);
  const prefix = dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (diffDays === 0) return `${prefix} (Today)`;
  if (diffDays > 0) return `${prefix} (${diffDays} days)`;
  return `${prefix} (${Math.abs(diffDays)} days ago)`;
}

export default function Subscriptions() {
  const { session } = useAuth();
  const [subs, setSubs] = useState<Sub[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<RecurringTab>("monthly");
  const [categories, setCategories] = useState<string[]>([]);
  const [editingSub, setEditingSub] = useState<Sub | null>(null);
  const [viewingSub, setViewingSub] = useState<Sub | null>(null);
  const [merchantFixName, setMerchantFixName] = useState("");
  const [merchantFixCategory, setMerchantFixCategory] = useState("");
  const [merchantFixBusy, setMerchantFixBusy] = useState(false);
  const merchantFixNameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setErr(null);
    setLoading(true);
    try {
      const s = await api<{ subscriptions: Sub[] }>("/subscriptions", {
        accessToken: session.access_token,
      });
      setSubs(s.subscriptions);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!session?.access_token) return;
    void api<{ categories: string[] }>("/meta/transaction-categories", { accessToken: session.access_token })
      .then((r) => setCategories(r.categories ?? []))
      .catch(() => setCategories([]));
  }, [session?.access_token]);

  useEffect(() => {
    if (!editingSub) return;
    const id = window.requestAnimationFrame(() => merchantFixNameRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditingSub(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [editingSub]);

  const openMerchantFix = (sub: Sub) => {
    setEditingSub(sub);
    setMerchantFixName(cleanDisplayMerchant(sub.merchant_name || sub.name));
    setMerchantFixCategory("");
  };

  const saveMerchantFix = async () => {
    if (!session?.access_token || !editingSub || !merchantFixName.trim()) return;
    const pattern = String(editingSub.raw?.merchant_key || editingSub.merchant_name || editingSub.name || "").trim();
    if (!pattern) return;
    setMerchantFixBusy(true);
    setErr(null);
    try {
      await api("/meta/merchant-overrides", {
        method: "POST",
        accessToken: session.access_token,
        body: JSON.stringify({
          merchant_pattern: pattern,
          canonical_merchant: merchantFixName.trim(),
          category_override: merchantFixCategory.trim() || null,
        }),
      });
      setEditingSub(null);
      setMerchantFixName("");
      setMerchantFixCategory("");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to update merchant details");
    } finally {
      setMerchantFixBusy(false);
    }
  };

  const markNotRecurring = async (sub: Sub) => {
    if (!session?.access_token) return;
    const merchantKey = String(sub.raw?.merchant_key || sub.merchant_name || sub.name || "").trim();
    if (!merchantKey) return;
    setErr(null);
    try {
      await api("/subscriptions/merchant-recurring-preference", {
        method: "POST",
        accessToken: session.access_token,
        body: JSON.stringify({ merchant_key: merchantKey, isRecurring: false }),
      });
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to update recurring status");
    }
  };

  const monthlyOnly = useMemo(
    () => subs.filter((s) => (s.frequency ?? "").toLowerCase().includes("month")),
    [subs]
  );
  const visibleSubs = tab === "monthly" ? monthlyOnly : subs;

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const upcoming = useMemo(
    () =>
      visibleSubs
        .filter((s) => s.next_payment_date)
        .filter((s) => new Date(`${s.next_payment_date}T00:00:00.000Z`).getTime() >= today.getTime())
        .sort((a, b) => (a.next_payment_date ?? "").localeCompare(b.next_payment_date ?? "")),
    [visibleSubs, today]
  );
  const complete = useMemo(
    () =>
      visibleSubs
        .filter((s) => s.next_payment_date)
        .filter((s) => new Date(`${s.next_payment_date}T00:00:00.000Z`).getTime() < today.getTime())
        .sort((a, b) => (b.next_payment_date ?? "").localeCompare(a.next_payment_date ?? "")),
    [visibleSubs, today]
  );

  const incomeTotal = 0;
  const expenseTotal = useMemo(
    () => visibleSubs.reduce((sum, s) => sum + monthlyEquivalent(s.amount, s.frequency), 0),
    [visibleSubs]
  );
  const creditCardTotal = 0;

  const monthLabel = useMemo(
    () => new Date().toLocaleString(undefined, { month: "long", year: "numeric" }),
    []
  );

  return (
    <div className="space-y-5 pb-8">
      <div className="flex items-center gap-6">
        <h1 className="font-headline text-2xl font-semibold text-primary">Recurring</h1>
        <div className="flex items-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => setTab("monthly")}
            className={`pb-1 border-b-2 ${tab === "monthly" ? "border-primary text-primary font-medium" : "border-transparent text-on-surface-variant"}`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setTab("all")}
            className={`pb-1 border-b-2 ${tab === "all" ? "border-primary text-primary font-medium" : "border-transparent text-on-surface-variant"}`}
          >
            All recurring
          </button>
        </div>
      </div>

      {err ? <p className="text-sm text-error">{err}</p> : null}
      {loading ? (
        <p className="text-sm text-on-surface-variant font-body" aria-live="polite">
          Loading recurring transactions...
        </p>
      ) : null}

      <section className="rounded-xl border border-outline-variant/25 bg-surface-container-lowest overflow-hidden">
        <div className="px-5 py-4 border-b border-outline-variant/20">
          <h2 className="font-headline text-xl text-primary">{monthLabel}</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3">
          <div className="px-5 py-4 border-r border-outline-variant/20">
            <p className="text-xs uppercase tracking-wide text-on-surface-variant">Income</p>
            <p className="mt-1 text-sm text-primary font-medium">{money(incomeTotal)} total</p>
          </div>
          <div className="px-5 py-4 border-r border-outline-variant/20">
            <p className="text-xs uppercase tracking-wide text-on-surface-variant">Expenses</p>
            <p className="mt-1 text-sm text-primary font-medium">{money(expenseTotal)} total</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-on-surface-variant">Credit cards</p>
            <p className="mt-1 text-sm text-primary font-medium">{money(creditCardTotal)} total</p>
          </div>
        </div>
      </section>

      <RecurringTable title="Upcoming" rows={upcoming} onViewMerchant={setViewingSub} onEditMerchant={openMerchantFix} onMarkNotRecurring={markNotRecurring} />
      <RecurringTable title="Complete" rows={complete} onViewMerchant={setViewingSub} onEditMerchant={openMerchantFix} onMarkNotRecurring={markNotRecurring} />
      {editingSub ? (
        <div role="presentation" className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4" onClick={() => setEditingSub(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl bg-surface-container-lowest border border-outline-variant/20 p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-headline text-base font-semibold text-on-surface">Correct merchant and category</h4>
            <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">
              Corrections apply to similar recurring merchant descriptions. Merchant key:{" "}
              <span className="font-mono text-[11px] text-on-surface">{editingSub.raw?.merchant_key ?? "—"}</span>
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="sub-fix-name" className="block text-xs font-medium text-on-surface-variant mb-1">Display name</label>
                <input
                  id="sub-fix-name"
                  ref={merchantFixNameRef}
                  value={merchantFixName}
                  onChange={(e) => setMerchantFixName(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant/20 px-3 py-2 text-sm bg-surface-container-lowest"
                />
              </div>
              <div>
                <label htmlFor="sub-fix-category" className="block text-xs font-medium text-on-surface-variant mb-1">Category</label>
                <select
                  id="sub-fix-category"
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
              <button type="button" onClick={() => setEditingSub(null)} className="text-sm text-on-surface-variant px-3 py-2 rounded-lg hover:bg-surface-container-high/80">
                Cancel
              </button>
              <button type="button" disabled={merchantFixBusy} onClick={() => void saveMerchantFix()} className="rounded-lg bg-primary text-on-primary px-4 py-2 text-sm font-medium disabled:opacity-60">
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {viewingSub ? (
        <div role="presentation" className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4" onClick={() => setViewingSub(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl bg-surface-container-lowest border border-outline-variant/20 p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-headline text-base font-semibold text-on-surface">Merchant details</h4>
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-on-surface"><span className="text-on-surface-variant">Display:</span> {cleanDisplayMerchant(viewingSub.merchant_name || viewingSub.name)}</p>
              <p className="text-on-surface"><span className="text-on-surface-variant">Merchant key:</span> {viewingSub.raw?.merchant_key ?? "—"}</p>
              <p className="text-on-surface"><span className="text-on-surface-variant">Category:</span> {viewingSub.raw?.category || "Subscription"}</p>
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setViewingSub(null)} className="text-sm text-on-surface-variant px-3 py-2 rounded-lg hover:bg-surface-container-high/80">
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RecurringTable({
  title,
  rows,
  onViewMerchant,
  onEditMerchant,
  onMarkNotRecurring,
}: {
  title: string;
  rows: Sub[];
  onViewMerchant: (sub: Sub) => void;
  onEditMerchant: (sub: Sub) => void;
  onMarkNotRecurring: (sub: Sub) => void;
}) {
  return (
    <section className="rounded-xl border border-outline-variant/25 bg-surface-container-lowest overflow-hidden">
      <div className="px-5 py-3 border-b border-outline-variant/20 flex items-center justify-between">
        <h3 className="font-headline text-base font-semibold text-primary">{title}</h3>
        <span className="text-xs text-on-surface-variant">{rows.length} items</span>
      </div>
      <div className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-on-surface-variant">No recurring items in this section yet.</p>
        ) : (
          <table className="w-full min-w-[860px] text-left">
            <thead className="bg-surface text-xs uppercase tracking-wide text-on-surface-variant">
              <tr>
                <th className="px-5 py-3 font-medium">Merchant</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Payment Account</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/15">
              {rows.map((s) => {
                const displayMerchant = cleanDisplayMerchant(s.merchant_name || s.name);
                return (
                  <tr key={s.id} className="hover:bg-surface-container-low/70">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <MerchantLogo merchantName={displayMerchant} />
                        <div>
                          <p className="text-sm font-medium text-primary">{displayMerchant}</p>
                          <p className="text-xs text-on-surface-variant">{s.frequency ?? "Recurring"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-on-surface">{dateLabel(s.next_payment_date)}</td>
                    <td className="px-4 py-3 text-sm text-on-surface">
                      {s.raw?.payment_account_name || "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-on-surface">
                      {s.raw?.category || "Subscription"}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-primary">
                      {money(s.amount)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RowActionMenu
                        label="Recurring actions"
                        items={[
                          {
                            id: "view",
                            label: "View merchant",
                            icon: "visibility",
                            onClick: () => onViewMerchant(s),
                          },
                          {
                            id: "edit",
                            label: "Edit merchant details",
                            icon: "edit",
                            onClick: () => onEditMerchant(s),
                          },
                          {
                            id: "not-recurring",
                            label: "Mark merchant as not recurring",
                            icon: "close",
                            variant: "danger",
                            onClick: () => onMarkNotRecurring(s),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
