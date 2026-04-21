import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { scopeMiddleware } from "../middleware/scopeMiddleware.js";
import {
  generateInsights,
  generateRecommendations,
  generateWhatIf,
  generateForecast,
  generateChatReply,
} from "../services/ai/geminiService.js";
import {
  generateCashflowForecast,
  detectAnomalies,
  findSubscriptionVampires,
  runNlq,
  voiceQuickLogDraft,
  getSmartGoalAdjustments,
  autoCategorizeTransaction,
  generateBehaviorNudges,
  getRetirementTaxCheck,
  getEscrowForecast,
} from "../services/ai/intelligenceService.js";

export const aiRouter = Router();
aiRouter.use(authMiddleware);
aiRouter.use(scopeMiddleware);

const CHAT_WINDOW_MS = 60_000;
const CHAT_MAX_PER_WINDOW = 20;
const chatRate = new Map<string, { count: number; resetAt: number }>();

function allowChat(userId: string): boolean {
  const now = Date.now();
  const cur = chatRate.get(userId);
  if (!cur || now > cur.resetAt) {
    chatRate.set(userId, { count: 1, resetAt: now + CHAT_WINDOW_MS });
    return true;
  }
  if (cur.count >= CHAT_MAX_PER_WINDOW) return false;
  cur.count += 1;
  return true;
}

aiRouter.post("/chat", async (req, res) => {
  try {
    if (!allowChat(req.userId!)) {
      res.status(429).json({ error: "Too many chat requests. Try again in a minute." });
      return;
    }
    const body = z
      .object({
        messages: z
          .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
          .min(1)
          .max(30),
        routeHint: z.string().max(200).optional(),
      })
      .parse(req.body ?? {});
    const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
    if (!lastUser?.content?.trim()) {
      res.status(400).json({ error: "Last message must be from the user." });
      return;
    }
    const dataIds = req.effectiveUserIds ?? [req.userId!];
    const queryText = (lastUser.content ?? "").toLowerCase();
    if (
      queryText.startsWith("how much") ||
      queryText.includes("did i spend") ||
      queryText.includes("can i afford")
    ) {
      const nlq = await runNlq(req.userId!, dataIds, lastUser.content);
      res.json({ reply: nlq.answer, mode: "query", nlq });
      return;
    }
    const reply = await generateChatReply(req.userId!, dataIds, body.messages, body.routeHint);
    res.json({ reply, mode: "advice" });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

aiRouter.post("/nlq", async (req, res) => {
  try {
    const body = z.object({ query: z.string().min(1).max(1200) }).parse(req.body ?? {});
    const ids = req.effectiveUserIds ?? [req.userId!];
    const data = await runNlq(req.userId!, ids, body.query);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

aiRouter.post("/voice-log-draft", async (req, res) => {
  try {
    const body = z.object({ utterance: z.string().min(1).max(300) }).parse(req.body ?? {});
    const draft = await voiceQuickLogDraft(req.userId!, body.utterance);
    res.json({ draft });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

aiRouter.post("/forecast-advanced", async (req, res) => {
  try {
    const body = z.object({ days: z.union([z.literal(30), z.literal(60)]).default(30) }).parse(req.body ?? {});
    const ids = req.effectiveUserIds ?? [req.userId!];
    const data = await generateCashflowForecast(req.userId!, ids, body.days);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

aiRouter.post("/anomalies", async (req, res) => {
  try {
    const ids = req.effectiveUserIds ?? [req.userId!];
    const data = await detectAnomalies(req.userId!, ids);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

aiRouter.post("/subscription-vampires", async (req, res) => {
  try {
    const ids = req.effectiveUserIds ?? [req.userId!];
    const data = await findSubscriptionVampires(req.userId!, ids);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

aiRouter.post("/goal-adjustments", async (req, res) => {
  try {
    const ids = req.effectiveUserIds ?? [req.userId!];
    const data = await getSmartGoalAdjustments(req.userId!, ids);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

aiRouter.post("/auto-categorize", async (req, res) => {
  try {
    const body = z
      .object({
        merchant_name: z.string().min(1).max(200),
        amount: z.number().optional(),
        location_hint: z.string().max(120).optional(),
      })
      .parse(req.body ?? {});
    const data = await autoCategorizeTransaction(req.userId!, body);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

aiRouter.post("/nudges", async (req, res) => {
  try {
    const ids = req.effectiveUserIds ?? [req.userId!];
    const data = await generateBehaviorNudges(req.userId!, ids);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

aiRouter.post("/retirement-tax-check", async (req, res) => {
  try {
    const ids = req.effectiveUserIds ?? [req.userId!];
    const data = await getRetirementTaxCheck(req.userId!, ids);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

aiRouter.post("/escrow-forecast", async (req, res) => {
  try {
    const ids = req.effectiveUserIds ?? [req.userId!];
    const data = await getEscrowForecast(req.userId!, ids);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

aiRouter.post("/insights", async (req, res) => {
  try {
    const ids = req.effectiveUserIds ?? [req.userId!];
    const data = await generateInsights(req.userId!, ids);
    res.json({ insights: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

aiRouter.post("/recommendations", async (req, res) => {
  try {
    const ids = req.effectiveUserIds ?? [req.userId!];
    const data = await generateRecommendations(req.userId!, ids);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

aiRouter.post("/what-if", async (req, res) => {
  try {
    const body = z.object({ scenario: z.string().min(1) }).parse(req.body);
    const ids = req.effectiveUserIds ?? [req.userId!];
    const data = await generateWhatIf(req.userId!, ids, body.scenario);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

aiRouter.post("/forecast", async (req, res) => {
  try {
    const ids = req.effectiveUserIds ?? [req.userId!];
    const data = await generateForecast(req.userId!, ids);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});
