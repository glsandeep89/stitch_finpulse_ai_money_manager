import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { scopeMiddleware } from "../middleware/scopeMiddleware.js";
import {
  getSimplefinConnectInfo,
  exchangePublicToken,
  refreshAccountsFromSimplifin,
  syncTransactionsForUser,
  getIdentityForUser,
  getInvestmentsForUser,
  listSimplifinItemsForUser,
  unlinkSimplifinItemForUser,
} from "../services/simplifin/simplifinService.js";
import { getDb } from "../services/db/supabase.js";

export const simplifinRouter = Router();
simplifinRouter.use(authMiddleware);
simplifinRouter.use(scopeMiddleware);

simplifinRouter.post("/create_link_token", async (_req, res) => {
  try {
    res.json(getSimplefinConnectInfo());
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});

simplifinRouter.post("/exchange_public_token", async (req, res) => {
  try {
    const schema = z
      .object({
        public_token: z.string().min(1).optional(),
        setup_token: z.string().min(1).optional(),
      })
      .refine((b) => Boolean(b.public_token || b.setup_token), {
        message: "Provide public_token (SimpleFIN setup token) or setup_token.",
      });
    const body = schema.parse(req.body ?? {});
    const token = body.public_token ?? body.setup_token!;
    const userId = req.userId!;
    const out = await exchangePublicToken(userId, token);
    res.json(out);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});

simplifinRouter.get("/accounts", async (req, res) => {
  try {
    const userId = req.userId!;
    const ids = req.effectiveUserIds ?? [userId];
    const refresh = req.query.refresh === "true";
    if (refresh) {
      const out = await refreshAccountsFromSimplifin(userId);
      return res.json(out);
    }
    const sb = getDb();
    const { data, error } = await sb
      .from("linked_accounts")
      .select("*")
      .in("user_id", ids);
    if (error) throw error;
    res.json({ accounts: data ?? [] });
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});

simplifinRouter.post("/transactions/sync", async (req, res) => {
  try {
    const userId = req.userId!;
    const out = await syncTransactionsForUser(userId);
    res.json(out);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});

simplifinRouter.get("/identity", async (req, res) => {
  try {
    const userId = req.userId!;
    const out = await getIdentityForUser(userId);
    res.json(out);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});

simplifinRouter.get("/investments", async (req, res) => {
  try {
    const userId = req.userId!;
    const out = await getInvestmentsForUser(userId);
    res.json(out);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});

simplifinRouter.get("/items", async (req, res) => {
  try {
    const userId = req.userId!;
    const items = await listSimplifinItemsForUser(userId);
    res.json({ items });
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});

simplifinRouter.post("/unlink-item", async (req, res) => {
  try {
    const body = z
      .object({
        plaidItemId: z.string().uuid().optional(),
        simplifinItemId: z.string().uuid().optional(),
        deleteHistory: z.boolean().default(false),
      })
      .refine((b) => Boolean(b.plaidItemId || b.simplifinItemId), {
        message: "Provide simplifinItemId or legacy plaidItemId (same UUID).",
      })
      .parse(req.body ?? {});
    const itemId = body.simplifinItemId ?? body.plaidItemId!;
    const userId = req.userId!;
    const out = await unlinkSimplifinItemForUser(userId, itemId, body.deleteHistory);
    res.json(out);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});
