import type { Request, Response, NextFunction } from "express";
import { getSupabaseService } from "../services/db/supabase.js";
import { config } from "../config.js";

/**
 * Validates the browser session JWT using Supabase Auth (same as Dashboard).
 * Avoids manual SUPABASE_JWT_SECRET + HS256 drift when keys rotate or settings change.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Bearer token" });
  }
  const token = auth.slice(7);
  getSupabaseService()
    .auth.getUser(token)
    .then(({ data, error }) => {
      if (error || !data.user) {
        const msg =
          error?.message && error.message !== "Invalid token"
            ? error.message
            : "Invalid token";
        return res.status(401).json({ error: msg });
      }
      req.userId = data.user.id;
      next();
    })
    .catch(() => {
      res.status(401).json({ error: "Invalid token" });
    });
}

/** Optional secondary header: x-finpulse-api-key when FINPULSE_API_KEY is set */
export function optionalApiKey(req: Request, res: Response, next: NextFunction) {
  const expected = config.finpulseApiKey;
  if (!expected) return next();
  const got = req.headers["x-finpulse-api-key"];
  if (got !== expected) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  return next();
}

export function cronAuth(req: Request, res: Response, next: NextFunction) {
  const secret = config.cronSecret;
  if (config.nodeEnv === "production" && !secret) {
    return res.status(503).json({ error: "CRON_SECRET not configured" });
  }
  if (!secret) return next();
  const got = req.headers["x-cron-secret"];
  if (got !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}
