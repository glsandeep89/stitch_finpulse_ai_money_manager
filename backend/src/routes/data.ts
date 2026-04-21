import { Router, type Request } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { scopeMiddleware } from "../middleware/scopeMiddleware.js";
import { config } from "../config.js";
import {
  listTransactions,
  spendingByMerchant,
  getBudgetsWithProgress,
  createBudget,
  getBudgetProjects,
  createBudgetProject,
  getSubscriptions,
  getNetWorth,
  getCreditCardPayments,
  getCreditCardSummary,
  getCreditCardsSnapshot,
  getInvestmentsSnapshot,
  getMortgageSnapshot,
  getDistinctTransactionCategories,
  cashFlowSeries,
  listCategoryMappings,
  createCategoryMapping,
  deleteCategoryMapping,
  listTransactionLabels,
  upsertTransactionLabel,
  listRefundTracker,
  setRefundEventStatus,
  listCreditCardRewardsProfiles,
  getBestCardRecommendation,
  getAnnualFeeRoi,
  enrichCreditCardRewardsProfiles,
} from "../services/data/dataService.js";
import {
  getAiFeatureFlags,
  upsertAiFeatureFlag,
  listManualInputs,
  upsertManualInput,
  listExternalSignals,
  insertExternalSignal,
  getNudgePreferences,
  upsertNudgePreferences,
  listLatestAiOutputs,
  AI_OUTPUT_FAMILIES,
} from "../services/ai/intelligenceService.js";
import { getDb } from "../services/db/supabase.js";

export const dataRouter = Router();
dataRouter.use(authMiddleware);
dataRouter.use(scopeMiddleware);

function scopedIds(req: Request): string[] {
  return req.effectiveUserIds ?? [req.userId!];
}

dataRouter.get("/meta/features", async (req, res) => {
  try {
    const flags = await getAiFeatureFlags(req.userId!);
    res.json({
      aiInsightsAvailable: Boolean(config.geminiApiKey && config.geminiApiKey.trim().length > 0),
      geminiModel: config.geminiModel,
      aiFlags: flags,
    });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/meta/ai-feature-flags", async (req, res) => {
  try {
    const flags = await getAiFeatureFlags(req.userId!);
    res.json({ flags });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.post("/meta/ai-feature-flags", async (req, res) => {
  try {
    const body = z
      .object({
        flag_key: z.string().min(1).max(120),
        enabled: z.boolean(),
      })
      .parse(req.body ?? {});
    const data = await upsertAiFeatureFlag(req.userId!, body.flag_key, body.enabled);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/meta/ai-manual-inputs", async (req, res) => {
  try {
    const data = await listManualInputs(scopedIds(req));
    res.json({ inputs: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.post("/meta/ai-manual-inputs", async (req, res) => {
  try {
    const body = z
      .object({
        input_type: z.string().min(1).max(120),
        payload: z.record(z.string(), z.unknown()),
        effective_month: z.string().optional().nullable(),
      })
      .parse(req.body ?? {});
    const data = await upsertManualInput(req.userId!, body);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/meta/ai-external-signals", async (req, res) => {
  try {
    const q = z.object({ signal_type: z.string().optional() }).parse(req.query);
    const data = await listExternalSignals(scopedIds(req), q.signal_type);
    res.json({ signals: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.post("/meta/ai-external-signals", async (req, res) => {
  try {
    const body = z
      .object({
        signal_type: z.string().min(1).max(120),
        source: z.string().min(1).max(120),
        metric_key: z.string().min(1).max(120),
        metric_value: z.number(),
        observed_at: z.string(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(req.body ?? {});
    const data = await insertExternalSignal(req.userId!, body);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/meta/ai-nudge-preferences", async (req, res) => {
  try {
    const data = await getNudgePreferences(req.userId!);
    res.json({ preferences: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.post("/meta/ai-nudge-preferences", async (req, res) => {
  try {
    const body = z
      .object({
        enabled: z.boolean(),
        quiet_start_hour: z.number().int().min(0).max(23),
        quiet_end_hour: z.number().int().min(0).max(23),
        channels: z.array(z.string()).min(1).max(10),
      })
      .parse(req.body ?? {});
    const data = await upsertNudgePreferences(req.userId!, body);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/transactions", async (req, res) => {
  try {
    const q = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        merchant: z.string().optional(),
        accountId: z.string().optional(),
        category: z.string().optional(),
        minAmount: z.coerce.number().optional(),
        maxAmount: z.coerce.number().optional(),
        limit: z.coerce.number().optional(),
        q: z.string().optional(),
      })
      .parse(req.query);
    const data = await listTransactions(scopedIds(req), q);
    res.json({ transactions: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/meta/category-mappings", async (req, res) => {
  try {
    const data = await listCategoryMappings(scopedIds(req));
    res.json({ mappings: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.post("/meta/category-mappings", async (req, res) => {
  try {
    const body = z
      .object({
        plaid_category_pattern: z.string().min(1).max(200),
        budget_category: z.string().min(1).max(200),
      })
      .parse(req.body ?? {});
    const data = await createCategoryMapping(req.userId!, body);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.delete("/meta/category-mappings/:id", async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await deleteCategoryMapping(req.userId!, id);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/meta/transaction-labels", async (req, res) => {
  try {
    const q = z.object({ ids: z.string().min(1) }).parse(req.query);
    const ids = q.ids
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200);
    const data = await listTransactionLabels(scopedIds(req), ids);
    res.json({ labels: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.post("/meta/transaction-labels", async (req, res) => {
  try {
    const body = z
      .object({
        plaid_transaction_id: z.string().min(1),
        label: z.string().min(1).max(500),
        shared: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const data = await upsertTransactionLabel(req.userId!, body);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/meta/transaction-categories", async (req, res) => {
  try {
    const categories = await getDistinctTransactionCategories(scopedIds(req));
    res.json({ categories });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/analytics/credit-card-summary", async (req, res) => {
  try {
    const data = await getCreditCardSummary(scopedIds(req));
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/analytics/creditcards", async (req, res) => {
  try {
    const data = await getCreditCardsSnapshot(scopedIds(req));
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/analytics/investments", async (req, res) => {
  try {
    const data = await getInvestmentsSnapshot(scopedIds(req));
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/analytics/mortgage", async (req, res) => {
  try {
    const data = await getMortgageSnapshot(scopedIds(req));
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/analytics/creditcards/rewards-profiles", async (req, res) => {
  try {
    const data = await listCreditCardRewardsProfiles(scopedIds(req));
    res.json({ profiles: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.post("/analytics/creditcards/rewards-profiles/enrich", async (req, res) => {
  try {
    const data = await enrichCreditCardRewardsProfiles(req.userId!, scopedIds(req));
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/analytics/creditcards/best-card", async (req, res) => {
  try {
    const q = z
      .object({
        merchant: z.string().min(1),
        category: z.string().optional(),
        amount: z.coerce.number().positive().optional(),
      })
      .parse(req.query);
    const data = await getBestCardRecommendation(scopedIds(req), q);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/analytics/creditcards/annual-fee-roi", async (req, res) => {
  try {
    const data = await getAnnualFeeRoi(scopedIds(req));
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/analytics/spending-by-merchant", async (req, res) => {
  try {
    const q = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(req.query);
    const data = await spendingByMerchant(scopedIds(req), q.from, q.to);
    res.json({ merchants: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/analytics/cash-flow", async (req, res) => {
  try {
    const q = z
      .object({
        from: z.string(),
        to: z.string(),
      })
      .parse(req.query);
    const data = await cashFlowSeries(scopedIds(req), q.from, q.to);
    res.json({ series: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/budgets", async (req, res) => {
  try {
    const data = await getBudgetsWithProgress(scopedIds(req));
    res.json({ budgets: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.post("/budgets", async (req, res) => {
  try {
    const body = z
      .object({
        category: z.string(),
        amount_limit: z.number(),
        period_start: z.string(),
        period_end: z.string().nullable().optional(),
      })
      .parse(req.body);
    const data = await createBudget(req.userId!, body);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/budget-projects", async (req, res) => {
  try {
    const data = await getBudgetProjects(scopedIds(req));
    res.json({ projects: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.post("/budget-projects", async (req, res) => {
  try {
    const body = z
      .object({
        name: z.string(),
        target_amount: z.number(),
        spent_amount: z.number().optional(),
        start_date: z.string().nullable().optional(),
        end_date: z.string().nullable().optional(),
      })
      .parse(req.body);
    const data = await createBudgetProject(req.userId!, body);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/subscriptions", async (req, res) => {
  try {
    const data = await getSubscriptions(scopedIds(req));
    res.json({ subscriptions: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/net-worth", async (req, res) => {
  try {
    const data = await getNetWorth(scopedIds(req));
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/credit-card-payments", async (req, res) => {
  try {
    const q = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(req.query);
    const data = await getCreditCardPayments(scopedIds(req), q.from, q.to);
    res.json({ payments: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/refund-tracker", async (req, res) => {
  try {
    const data = await listRefundTracker(scopedIds(req));
    res.json({ refunds: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.post("/refund-tracker/:id/status", async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const body = z
      .object({ status: z.enum(["pending", "posted", "expired", "manual"]) })
      .parse(req.body ?? {});
    const data = await setRefundEventStatus(req.userId!, id, body.status);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

dataRouter.get("/insights", async (req, res) => {
  try {
    const sb = getDb();
    const ids = scopedIds(req);
    const { data, error } = await sb
      .from("insights")
      .select("*")
      .in("user_id", ids)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ insights: data ?? [] });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** Latest modular AI output per family (from `ai_outputs`), scoped like other reads. */
dataRouter.get("/ai-outputs", async (req, res) => {
  try {
    const raw = req.query.families;
    let families: string[] | undefined;
    if (typeof raw === "string" && raw.trim()) {
      families = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const f of families) {
        if (!(AI_OUTPUT_FAMILIES as readonly string[]).includes(f)) {
          res.status(400).json({ error: `Unknown output family: ${f}` });
          return;
        }
      }
    }
    const { byFamily } = await listLatestAiOutputs(scopedIds(req), families);
    res.json({ byFamily });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});
