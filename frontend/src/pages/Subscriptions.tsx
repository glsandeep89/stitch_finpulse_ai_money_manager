import { useCallback, useEffect, useMemo, useState } from "react";
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

      <RecurringTable title="Upcoming" rows={upcoming} />
      <RecurringTable title="Complete" rows={complete} />
    </div>
  );
}

function RecurringTable({ title, rows }: { title: string; rows: Sub[] }) {
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
