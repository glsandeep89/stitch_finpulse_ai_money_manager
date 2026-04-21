import type { Request, Response, NextFunction } from "express";
import { resolveHouseholdUserIds } from "../services/household/householdService.js";

function readScope(req: Request): "me" | "household" {
  const raw = (req.headers["x-finpulse-scope"] ?? req.query.scope ?? "me").toString().toLowerCase();
  return raw === "household" ? "household" : "me";
}

/** After auth: sets `req.scope` and `req.effectiveUserIds` for read aggregations. Writes should still use `req.userId` only. */
export function scopeMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) {
    return next();
  }
  const scope = readScope(req);
  req.scope = scope;
  if (scope === "household") {
    resolveHouseholdUserIds(req.userId)
      .then((ids) => {
        req.effectiveUserIds = ids;
        next();
      })
      .catch(next);
  } else {
    req.effectiveUserIds = [req.userId];
    next();
  }
}
