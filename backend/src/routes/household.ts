import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import {
  createHousehold,
  getHouseholdSummary,
  joinHousehold,
  leaveHousehold,
  renameHousehold,
} from "../services/household/householdService.js";

export const householdRouter = Router();
householdRouter.use(authMiddleware);

householdRouter.get("/me", async (req, res) => {
  try {
    const data = await getHouseholdSummary(req.userId!);
    res.json(data);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

householdRouter.post("/", async (req, res) => {
  try {
    const body = z.object({ name: z.string().optional() }).parse(req.body ?? {});
    const out = await createHousehold(req.userId!, body.name);
    res.json(out);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

householdRouter.post("/join", async (req, res) => {
  try {
    const body = z.object({ join_code: z.string().min(1) }).parse(req.body);
    const out = await joinHousehold(req.userId!, body.join_code);
    res.json(out);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

householdRouter.post("/leave", async (req, res) => {
  try {
    const out = await leaveHousehold(req.userId!);
    res.json(out);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

householdRouter.patch("/me", async (req, res) => {
  try {
    const body = z.object({ name: z.string().min(1).max(120) }).parse(req.body ?? {});
    const out = await renameHousehold(req.userId!, body.name);
    res.json(out);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});
