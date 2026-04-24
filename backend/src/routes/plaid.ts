import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { scopeMiddleware } from "../middleware/scopeMiddleware.js";
import {
  getSimplefinConnectInfo,
  exchangePublicToken,
  refreshAccountsFromPlaid,
  syncTransactionsForUser,
  getIdentityForUser,
  getInvestmentsForUser,
  listPlaidItemsForUser,
  unlinkPlaidItemForUser,
} from "../services/plaid/plaidService.js";
import { getDb } from "../services/db/supabase.js";

export const plaidRouter = Router();
plaidRouter.use(authMiddleware);
plaidRouter.use(scopeMiddleware);

plaidRouter.post("/create_link_token", async (_req, res) => {
  try {
    res.json(getSimplefinConnectInfo());
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});

plaidRouter.post("/exchange_public_token", async (req, res) => {
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

plaidRouter.get("/accounts", async (req, res) => {
  try {
    const userId = req.userId!;
    const ids = req.effectiveUserIds ?? [userId];
    const refresh = req.query.refresh === "true";
    if (refresh) {
      const out = await refreshAccountsFromPlaid(userId);
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

plaidRouter.post("/transactions/sync", async (req, res) => {
  try {
    const userId = req.userId!;
    const out = await syncTransactionsForUser(userId);
    res.json(out);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});

plaidRouter.get("/identity", async (req, res) => {
  try {
    const userId = req.userId!;
    const out = await getIdentityForUser(userId);
    res.json(out);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});

plaidRouter.get("/investments", async (req, res) => {
  try {
    const userId = req.userId!;
    const out = await getInvestmentsForUser(userId);
    res.json(out);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});

plaidRouter.get("/items", async (req, res) => {
  try {
    const userId = req.userId!;
    const items = await listPlaidItemsForUser(userId);
    res.json({ items });
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});

plaidRouter.post("/unlink-item", async (req, res) => {
  try {
    const body = z
      .object({
        plaidItemId: z.string().uuid(),
        deleteHistory: z.boolean().default(false),
      })
      .parse(req.body ?? {});
    const userId = req.userId!;
    const out = await unlinkPlaidItemForUser(userId, body.plaidItemId, body.deleteHistory);
    res.json(out);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});
