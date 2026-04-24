import { Router } from "express";
import { cronAuth } from "../middleware/auth.js";
import { syncTransactionsAllUsers } from "../jobs/syncTransactions.js";
import { computeAndStoreNetWorth } from "../jobs/networthSnapshot.js";
import { authMiddleware } from "../middleware/auth.js";
import { syncTransactionsForUser } from "../services/plaid/plaidService.js";
import { refreshAiPipeline } from "../services/ai/aiRefresh.js";
import { getDb } from "../services/db/supabase.js";

export const jobsRouter = Router();

/** Cron: sync all users (protect with x-cron-secret when CRON_SECRET is set). */
jobsRouter.post("/sync-transactions", cronAuth, async (_req, res) => {
  try {
    const out = await syncTransactionsAllUsers();
    res.json(out);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** User-scoped sync + snapshot (auth). */
jobsRouter.post("/sync-my-data", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId!;
    const sync = await syncTransactionsForUser(userId);
    const snapshot = await computeAndStoreNetWorth(userId);
    const aiRefresh = await refreshAiPipeline(userId, [userId]);
    res.json({ sync, snapshot, aiRefresh });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

jobsRouter.post("/networth-snapshot", authMiddleware, async (req, res) => {
  try {
    const data = await computeAndStoreNetWorth(req.userId!);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Cron: recompute modular AI outputs for every user with a linked financial connection. */
jobsRouter.post("/refresh-ai-modules", cronAuth, async (_req, res) => {
  try {
    const sb = getDb();
    const { data: rows, error } = await sb.from("plaid_items").select("user_id");
    if (error) throw error;
    const unique = [...new Set((rows ?? []).map((r) => r.user_id as string))];
    const results: { user_id: string; modules?: Record<string, string | "ok" | "skipped">; error?: string }[] = [];
    for (const userId of unique) {
      try {
        const out = await refreshAiPipeline(userId, [userId]);
        results.push({ user_id: userId, modules: out.modules });
      } catch (e: unknown) {
        results.push({ user_id: userId, error: (e as Error).message });
      }
    }
    res.json({ users: unique.length, results });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});
