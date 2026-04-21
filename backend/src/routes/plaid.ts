import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { scopeMiddleware } from "../middleware/scopeMiddleware.js";
import {
  createLinkToken,
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

plaidRouter.post("/create_link_token", async (req, res) => {
  try {
    const schema = z.object({
      redirect_uri: z.string().url().optional(),
    });
    const body = schema.parse(req.body ?? {});
    const userId = req.userId!;
    const out = await createLinkToken(userId, body.redirect_uri);
    res.json(out);
  } catch (e: unknown) {
    const err = e as Error;
    res.status(400).json({ error: err.message });
  }
});

plaidRouter.post("/exchange_public_token", async (req, res) => {
  try {
    const schema = z.object({ public_token: z.string().min(1) });
    const { public_token } = schema.parse(req.body);
    const userId = req.userId!;
    const out = await exchangePublicToken(userId, public_token);
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
