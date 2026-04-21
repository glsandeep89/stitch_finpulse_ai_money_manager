import {
  getAiFeatureFlags,
  generateCashflowForecast,
  detectAnomalies,
  findSubscriptionVampires,
  generateBehaviorNudges,
  getSmartGoalAdjustments,
  getRetirementTaxCheck,
  getEscrowForecast,
} from "./intelligenceService.js";

/**
 * Recompute all modular AI outputs for the viewer after transaction sync / cron.
 * Uses `ai_feature_flags`: if the user has no rows, all modules run; otherwise only keys with `enabled: true` run.
 */
export async function refreshAiPipeline(viewerUserId: string, dataUserIds: string[]): Promise<{
  ok: boolean;
  modules: Record<string, "ok" | "skipped" | string>;
}> {
  const flags = await getAiFeatureFlags(viewerUserId);
  const useDefaults = Object.keys(flags).length === 0;
  const on = (key: string) => useDefaults || flags[key] === true;

  const modules: Record<string, "ok" | "skipped" | string> = {};

  const run = async (flagKey: string, name: string, fn: () => Promise<unknown>) => {
    if (!on(flagKey)) {
      modules[name] = "skipped";
      return;
    }
    try {
      await fn();
      modules[name] = "ok";
    } catch (e: unknown) {
      modules[name] = (e as Error).message;
    }
  };

  await run("forecast", "forecast", () => generateCashflowForecast(viewerUserId, dataUserIds, 30));
  await run("anomaly", "anomaly", () => detectAnomalies(viewerUserId, dataUserIds));
  await run("automation", "subscription_vampire", () => findSubscriptionVampires(viewerUserId, dataUserIds));
  await run("automation", "goal_adjustment", () => getSmartGoalAdjustments(viewerUserId, dataUserIds));
  await run("coaching", "nudge", () => generateBehaviorNudges(viewerUserId, dataUserIds));
  await run("compliance", "retirement_tax", () => getRetirementTaxCheck(viewerUserId, dataUserIds));
  await run("escrow", "escrow", () => getEscrowForecast(viewerUserId, dataUserIds));

  return { ok: true, modules };
}
