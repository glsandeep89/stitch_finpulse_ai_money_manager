import { useCallback, useEffect, useMemo, useState } from "react";
import { AiOutputCard, AiOutputEmpty } from "../components/ai/AiOutputCard";
import Activity from "./Activity";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import type { AiOutputsResponse } from "../lib/aiOutputs";

type Account = {
  plaid_account_id: string;
  name: string | null;
  subtype: string | null;
  balance_current: number | null;
  balance_available: number | null;
};

type InvestmentsSnapshot = {
  checkingSavingsCd: Account[];
  wealthAndRetirement: Account[];
  totals: { cashLike: number; investments: number };
};

function money(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default function Investments() {
  const { session } = useAuth();
  const [data, setData] = useState<InvestmentsSnapshot | null>(null);
  const [retirementTax, setRetirementTax] = useState<AiOutputsResponse["byFamily"]>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setErr(null);
    try {
      const [snapshot, aiOut] = await Promise.all([
        api<InvestmentsSnapshot>("/analytics/investments", { accessToken: session.access_token }),
        api<AiOutputsResponse>("/ai-outputs?families=retirement_tax", { accessToken: session.access_token }).catch(
          () => ({ byFamily: {} as AiOutputsResponse["byFamily"] })
        ),
      ]);
      setData(snapshot);
      setRetirementTax(aiOut.byFamily ?? {});
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load investments");
    }
  }, [session?.access_token]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = useMemo(() => Number(data?.totals.cashLike ?? 0) + Number(data?.totals.investments ?? 0), [data]);

  const renderAccounts = (rows: Account[]) =>
    rows.length === 0 ? (
      <p className="text-sm text-on-surface-variant">No accounts in this group yet.</p>
    ) : (
      <div className="space-y-2">
        {rows.map((a) => (
          <div key={a.plaid_account_id} className="flex items-center justify-between text-sm">
            <span>
              {a.name ?? "Account"} <span className="text-on-surface-variant">({a.subtype ?? "unknown"})</span>
            </span>
            <span>{money(Number(a.balance_current ?? a.balance_available ?? 0))}</span>
          </div>
        ))}
      </div>
    );

  return (
    <div className="space-y-8">
      {err ? <p className="text-sm text-error">{err}</p> : null}
      <div>
        <h1 className="text-3xl font-headline font-bold text-on-background">Investments</h1>
        <p className="text-sm text-on-surface-variant">Checking, savings, CDs, wealth, and retirement in one place.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/15">
          <p className="text-xs text-on-surface-variant">Cash-like accounts</p>
          <p className="text-2xl font-headline font-bold">{money(Number(data?.totals.cashLike ?? 0))}</p>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/15">
          <p className="text-xs text-on-surface-variant">Investment/retirement</p>
          <p className="text-2xl font-headline font-bold">{money(Number(data?.totals.investments ?? 0))}</p>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/15">
          <p className="text-xs text-on-surface-variant">Combined total</p>
          <p className="text-2xl font-headline font-bold">{money(total)}</p>
        </div>
      </div>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/15 p-5">
          <h2 className="font-headline font-semibold mb-3">Checking, savings, CD</h2>
          {renderAccounts(data?.checkingSavingsCd ?? [])}
        </div>
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/15 p-5">
          <h2 className="font-headline font-semibold mb-3">Wealth and retirement</h2>
          {renderAccounts(data?.wealthAndRetirement ?? [])}
        </div>
      </section>

      <section>
        {retirementTax.retirement_tax ? (
          <AiOutputCard row={retirementTax.retirement_tax} label="Retirement and tax pacing" />
        ) : (
          <AiOutputEmpty message="Retirement/tax AI output appears after sync." />
        )}
      </section>

      <Activity
        title="Investment-related transactions"
        subtitle="Filters and exports for all non-credit, non-escrow accounts."
        defaultInvestmentScope
      />
    </div>
  );
}
