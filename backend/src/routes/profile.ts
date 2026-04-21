import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { getDb } from "../services/db/supabase.js";

export const profileRouter = Router();
profileRouter.use(authMiddleware);

profileRouter.patch("/profile", async (req, res) => {
  try {
    const body = z.object({ display_name: z.string().max(200).optional() }).parse(req.body ?? {});
    const userId = req.userId!;
    const sb = getDb();
    const { data, error } = await sb
      .from("profiles")
      .upsert(
        { id: userId, display_name: body.display_name ?? null },
        { onConflict: "id" }
      )
      .select()
      .single();
    if (error) throw error;
    res.json({ profile: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

profileRouter.get("/profile", async (req, res) => {
  try {
    const sb = getDb();
    const { data, error } = await sb.from("profiles").select("*").eq("id", req.userId!).maybeSingle();
    if (error) throw error;
    res.json({ profile: data });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});
