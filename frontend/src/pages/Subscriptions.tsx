import { useCallback, useEffect, useMemo, useState } from "react";
import { AiOutputCard, AiOutputEmpty } from "../components/ai/AiOutputCard";
import { api } from "../lib/api";
import type { AiOutputRow, AiOutputsResponse } from "../lib/aiOutputs";
import { useAuth } from "../contexts/AuthContext";

type Sub = {
  id: string;
  name: string;
  merchant_name: string | null;
  amount: number | null;
  next_payment_date: string | null;
  frequency: string | null;
};

function monthlyEquivalent(amount: number | null, frequency: string | null): number {
  if (amount == null || !Number.isFinite(amount)) return 0;
  const f = (frequency || "").toLowerCase();
  if (f.includes("year") || f.includes("annual")) return amount / 12;
  if (f.includes("week")) return amount * 4.33;
  if (f.includes("quarter")) return amount / 3;
  return amount;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

function formatMoney(n: number): { whole: string; cents: string } {
  const abs = Math.abs(n);
  const wholeNum = Math.floor(abs);
  const centsNum = Math.min(99, Math.round((abs - wholeNum) * 100));
  const whole =
    (n < 0 ? "-" : "") + wholeNum.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const cents = centsNum.toString().padStart(2, "0");
  return { whole, cents };
}

export default function Subscriptions() {
  const { session } = useAuth();
  const [subs, setSubs] = useState<Sub[]>([]);
  const [payments, setPayments] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [vampireRow, setVampireRow] = useState<AiOutputRow | null>(null);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setErr(null);
    setLoading(true);
    try {
      const [s, p, v] = await Promise.all([
        api<{ subscriptions: Sub[] }>("/subscriptions", {
          accessToken: session.access_token,
        }),
        api<{ payments: Record<string, unknown>[] }>("/credit-card-payments", {
          accessToken: session.access_token,
        }),
        api<AiOutputsResponse>("/ai-outputs?families=subscription_vampire", {
          accessToken: session.access_token,
        }).catch(() => ({ byFamily: {} as AiOutputsResponse["byFamily"] })),
      ]);
      setSubs(s.subscriptions);
      setPayments(p.payments.slice(0, 20));
      setVampireRow(v.byFamily?.subscription_vampire ?? null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  const monthlyTotal = useMemo(
    () => subs.reduce((sum, s) => sum + monthlyEquivalent(s.amount, s.frequency), 0),
    [subs]
  );

  const upcoming = useMemo(() => {
    const withDates = subs
      .filter((s) => s.next_payment_date)
      .map((s) => ({ sub: s, t: new Date(s.next_payment_date as string).getTime() }))
      .filter((x) => !Number.isNaN(x.t))
      .sort((a, b) => a.t - b.t)
      .slice(0, 12)
      .map((x) => x.sub);
    return withDates;
  }, [subs]);

  const calendarLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleString(undefined, { month: "long", year: "numeric" });
  }, []);

  const largest = useMemo(() => {
    if (subs.length === 0) return null;
    return subs.reduce((best, s) => {
      const m = monthlyEquivalent(s.amount, s.frequency);
      const bm = monthlyEquivalent(best.amount, best.frequency);
      return m > bm ? s : best;
    });
  }, [subs]);

  const { whole, cents } = formatMoney(monthlyTotal);

  return (
    <div className="space-y-8 pb-8">
      {err ? <p className="text-sm text-error">{err}</p> : null}
      {loading ? (
        <p className="text-sm text-on-surface-variant font-body" aria-live="polite">
          Loading subscriptions…
        </p>
      ) : null}

      {/* Header — subscriptions_web/code.html */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-primary tracking-tight">Recurring Commitments</h1>
          <p className="font-body text-sm text-on-surface-variant mt-1">
            Manage and optimize your monthly subscriptions.
          </p>
        </div>
        <button
          type="button"
          className="bg-primary text-on-primary px-6 py-2.5 rounded-xl font-medium text-sm flex items-center gap-2 hover:bg-primary-container transition-colors shadow-[0_8px_16px_rgba(11,28,48,0.1)]"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Add Subscription
        </button>
      </div>

      <section className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4 mb-6" aria-label="Subscription price changes">
        {vampireRow ? (
          <AiOutputCard row={vampireRow} label="Price change watch">
            {Array.isArray((vampireRow.payload as { flags?: unknown })?.flags) &&
            ((vampireRow.payload as { flags: { name: string; oldAmount: number; newAmount: number; reason: string }[] })
              .flags?.length ?? 0) > 0 ? (
              <ul className="mt-3 space-y-2 text-sm font-body">
                {(
                  (vampireRow.payload as { flags: { name: string; oldAmount: number; newAmount: number; reason: string }[] })
                    .flags ?? []
                ).map((f, i) => (
                  <li key={`${f.name}-${i}`} className="text-on-surface">
                    <strong>{f.name}</strong>: {f.oldAmount.toFixed(2)} → {f.newAmount.toFixed(2)}{" "}
                    <span className="text-on-surface-variant text-xs block sm:inline">— {f.reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-on-surface-variant font-body">No recent subscription price spikes detected.</p>
            )}
          </AiOutputCard>
        ) : (
          <>
            <h3 className="font-headline text-sm font-semibold text-on-surface mb-1">Price change watch</h3>
            <AiOutputEmpty message="Runs after sync—compares latest charges to your baseline." />
          </>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Hero stat — span 4 */}
        <div className="col-span-1 lg:col-span-4 bg-gradient-to-br from-primary to-primary-container rounded-xl p-8 flex flex-col justify-between relative overflow-hidden shadow-[0_20px_40px_rgba(11,28,48,0.15)] text-on-primary min-h-[240px]">
          <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
            <span className="material-symbols-outlined text-8xl">autorenew</span>
          </div>
          <div>
            <span className="font-label text-sm uppercase tracking-wider text-on-primary-container">Monthly Total</span>
            <h2 className="font-headline text-5xl font-extrabold mt-2">
              ${whole}
              <span className="text-2xl text-on-primary-container font-medium">.{cents}</span>
            </h2>
          </div>
          <div className="mt-8 flex items-center gap-2 bg-white/10 w-fit px-3 py-1.5 rounded-full backdrop-blur-sm">
            <span className="material-symbols-outlined text-sm text-tertiary-fixed">trending_up</span>
            <span className="font-body text-xs text-white">
              {subs.length === 0
                ? "Add recurring items to track spend"
                : `${subs.length} active recurring ${subs.length === 1 ? "item" : "items"}`}
            </span>
          </div>
        </div>

        {/* Tips — span 8 */}
        <div className="col-span-1 lg:col-span-8 bg-surface-container-lowest rounded-xl p-6 shadow-[0_10px_30px_rgba(11,28,48,0.04)] outline outline-1 outline-outline-variant/15 flex flex-col justify-between min-h-[240px]">
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-tertiary-fixed-dim bg-surface-container-low p-1.5 rounded-lg">
              tips_and_updates
            </span>
            <h3 className="font-headline font-semibold text-primary">Tips</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-surface-container-low rounded-lg p-4 flex gap-4 items-start border-l-2 border-secondary-container">
              <div className="mt-1">
                <span className="material-symbols-outlined text-secondary text-xl">analytics</span>
              </div>
              <div>
                <h4 className="font-body font-medium text-sm text-primary mb-1">Recurring snapshot</h4>
                <p className="font-body text-xs text-on-surface-variant">
                  {largest
                    ? `Largest monthly equivalent: ${largest.name} at ${monthlyEquivalent(largest.amount, largest.frequency).toLocaleString(undefined, { style: "currency", currency: "USD" })}.`
                    : "No subscription rows yet. Populate from recurring transaction detection or add via API."}
                </p>
              </div>
            </div>
            <div className="bg-surface-container-low rounded-lg p-4 flex gap-4 items-start border-l-2 border-tertiary-fixed-dim">
              <div className="mt-1">
                <span className="material-symbols-outlined text-tertiary-fixed-dim text-xl">credit_card</span>
              </div>
              <div>
                <h4 className="font-body font-medium text-sm text-primary mb-1">Likely card payments</h4>
                <p className="font-body text-xs text-on-surface-variant">
                  {payments.length === 0
                    ? "None detected in recent transactions."
                    : `Heuristic match: ${String(payments[0].merchant_name ?? "Merchant")} (${String(payments[0].amount)}). Review in Activity.`}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Upcoming timeline — full width */}
        <div className="col-span-1 lg:col-span-12 bg-surface-container-lowest rounded-xl p-6 shadow-[0_10px_30px_rgba(11,28,48,0.04)] outline outline-1 outline-outline-variant/15 mt-2">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-headline font-semibold text-primary">Upcoming Payments</h3>
            <span className="font-label text-sm text-on-surface-variant">{calendarLabel}</span>
          </div>
          {upcoming.length === 0 ? (
            <p className="font-body text-sm text-on-surface-variant">
              Set <span className="font-medium text-primary">next payment</span> dates on subscriptions to see a timeline.
            </p>
          ) : (
            <div className="flex justify-between items-end gap-2 overflow-x-auto pb-4 hide-scrollbar">
              {upcoming.map((s) => {
                const d = new Date(s.next_payment_date as string);
                const label = d.toLocaleString(undefined, { month: "short", day: "numeric" });
                const amt = s.amount != null ? s.amount : 0;
                const hClass =
                  amt >= 50 ? "h-24" : amt >= 25 ? "h-16" : "h-12";
                const fillPct = Math.min(100, Math.max(25, (amt / 60) * 100));
                return (
                  <div key={s.id} className="flex flex-col items-center gap-3 min-w-[60px]">
                    <div className="font-body text-xs text-on-surface-variant">{label}</div>
                    <div className={`${hClass} w-1 bg-surface-container-high rounded-full relative`}>
                      <div
                        className="absolute bottom-0 w-full bg-secondary-container rounded-full"
                        style={{ height: `${fillPct}%` }}
                      />
                    </div>
                    <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-xs font-bold text-secondary">
                      {initials(s.name)}
                    </div>
                    <div className="font-body text-xs font-medium text-primary">
                      {s.amount != null
                        ? s.amount.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })
                        : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Table — full width */}
        <div className="col-span-1 lg:col-span-12 bg-surface-container-lowest rounded-xl p-0 shadow-[0_10px_30px_rgba(11,28,48,0.04)] outline outline-1 outline-outline-variant/15 mt-2 overflow-hidden">
          <div className="p-6 border-b border-surface-container-low flex justify-between items-center bg-surface-bright/50">
            <h3 className="font-headline font-semibold text-primary">All Active Subscriptions</h3>
            <span className="text-sm font-medium text-secondary flex items-center gap-1">
              Filter <span className="material-symbols-outlined text-sm">filter_list</span>
            </span>
          </div>
          <div className="overflow-x-auto">
            {subs.length === 0 ? (
              <p className="p-6 font-body text-sm text-on-surface-variant">No subscriptions yet.</p>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface border-b border-surface-container-low">
                    <th className="font-label text-xs font-medium text-on-surface-variant uppercase tracking-wider py-4 px-6">
                      Service
                    </th>
                    <th className="font-label text-xs font-medium text-on-surface-variant uppercase tracking-wider py-4 px-6">
                      Billing Cycle
                    </th>
                    <th className="font-label text-xs font-medium text-on-surface-variant uppercase tracking-wider py-4 px-6">
                      Category
                    </th>
                    <th className="font-label text-xs font-medium text-on-surface-variant uppercase tracking-wider py-4 px-6 text-right">
                      Amount
                    </th>
                    <th className="py-4 px-6" />
                  </tr>
                </thead>
                <tbody className="font-body text-sm divide-y divide-surface-container-low/50">
                  {subs.map((s) => (
                    <tr key={s.id} className="hover:bg-surface-container-low/50 transition-colors group">
                      <td className="py-4 px-6 align-top">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-surface-container flex items-center justify-center text-primary font-bold shrink-0">
                            {initials(s.name)}
                          </div>
                          <div>
                            <p className="font-medium text-primary">{s.name}</p>
                            <p className="text-xs text-on-surface-variant mt-0.5">
                              {s.next_payment_date
                                ? `Renews ${new Date(s.next_payment_date).toLocaleDateString()}`
                                : s.merchant_name || "—"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-on-surface-variant align-top">
                        {s.frequency || "—"}
                      </td>
                      <td className="py-4 px-6 align-top">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-surface-container text-secondary">
                          Subscription
                        </span>
                      </td>
                      <td className="py-4 px-6 text-right font-medium text-primary align-top">
                        {s.amount != null
                          ? s.amount.toLocaleString(undefined, { style: "currency", currency: "USD" })
                          : "—"}
                      </td>
                      <td className="py-4 px-6 text-right align-top">
                        <button
                          type="button"
                          className="text-on-surface-variant hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="More options"
                        >
                          <span className="material-symbols-outlined text-xl">more_vert</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
