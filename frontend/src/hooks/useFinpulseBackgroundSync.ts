import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../lib/api";

/**
 * After auth: one full sync (Plaid + net worth + AI). On each subsequent route change,
 * incremental Plaid transactions sync only.
 */
export function useFinpulseBackgroundSync(userId: string | undefined, accessToken: string | undefined) {
  const { pathname } = useLocation();
  const initialFullSyncedForUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!accessToken || !userId) return;

    if (initialFullSyncedForUserId.current !== userId) {
      initialFullSyncedForUserId.current = userId;
      void api("/jobs/sync-my-data", {
        method: "POST",
        accessToken,
      }).catch((e: unknown) =>
        console.warn("[FinPulse] sync-my-data failed", e instanceof Error ? e.message : e)
      );
      return;
    }

    void api("/plaid/transactions/sync", {
      method: "POST",
      accessToken,
    }).catch((e: unknown) =>
      console.warn("[FinPulse] transactions/sync failed", e instanceof Error ? e.message : e)
    );
  }, [userId, accessToken, pathname]);
}
