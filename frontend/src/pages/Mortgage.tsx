import { useCallback, useEffect, useState } from "react";
import { AiOutputCard, AiOutputEmpty } from "../components/ai/AiOutputCard";
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

type MortgageSnapshot = {
  mortgageAccounts: Account[];
  autoLoanAccounts: Account[];
  escrowAi: unknown;
};

function money(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default function Mortgage() {
  const { session } = useAuth();
  const [data, setData] = useState<MortgageSnapshot | null>(null);
  const [escrowAi, setEscrowAi] = useState<AiOutputsResponse["byFamily"]>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setErr(null);
    try {
      const [snapshot, aiOut] = await Promise.all([
        api<MortgageSnapshot>("/analytics/mortgage", { accessToken: session.access_token }),
        api<AiOutputsResponse>("/ai-outputs?families=escrow", { accessToken: session.access_token }).catch(() => ({
          byFamily: {} as AiOutputsResponse["byFamily"],
        })),
      ]);
      setData(snapshot);
      setEscrowAi(aiOut.byFamily ?? {});
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load mortgage data");
    }
  }, [session?.access_token]);

  useEffect(() => {
    void load();
  }, [load]);

  const renderAccounts = (rows: Account[]) =>
    rows.length === 0 ? (
      <p className="text-sm text-on-surface-variant">No related accounts detected.</p>
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

  const loanCount = (data?.mortgageAccounts?.length ?? 0) + (data?.autoLoanAccounts?.length ?? 0);

  return (
    <div className="space-y-8">
      {err ? <p className="text-sm text-error">{err}</p> : null}
      <div>
        <h1 className="text-3xl font-headline font-bold text-on-background">Mortgage</h1>
        <p className="text-sm text-on-surface-variant">Home mortgage, auto loans, and escrow forecasting.</p>
      </div>

      {loanCount === 0 ? (
        <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/15 p-5">
          <h2 className="font-headline font-semibold mb-2">Linked loans</h2>
          <p className="text-sm text-on-surface-variant">No loan or mortgage accounts linked yet.</p>
        </section>
      ) : (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(data?.mortgageAccounts?.length ?? 0) > 0 ? (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/15 p-5">
              <h2 className="font-headline font-semibold mb-3">Mortgage and escrow accounts</h2>
              {renderAccounts(data?.mortgageAccounts ?? [])}
            </div>
          ) : null}
          {(data?.autoLoanAccounts?.length ?? 0) > 0 ? (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/15 p-5">
              <h2 className="font-headline font-semibold mb-3">Auto loan accounts</h2>
              {renderAccounts(data?.autoLoanAccounts ?? [])}
            </div>
          ) : null}
        </section>
      )}

      <section>
        {escrowAi.escrow ? (
          <AiOutputCard row={escrowAi.escrow} label="Escrow forecast" />
        ) : (
          <AiOutputEmpty message="Escrow AI output appears after sync." />
        )}
      </section>
    </div>
  );
}
