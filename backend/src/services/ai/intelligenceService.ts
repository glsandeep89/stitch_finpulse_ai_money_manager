import { getDb } from "../db/supabase.js";
import { listTransactions, getBudgetsWithProgress, getSubscriptions } from "../data/dataService.js";

type Tx = {
  plaid_transaction_id: string;
  merchant_name: string | null;
  amount: number;
  trans_date: string;
  category: string[] | null;
};

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function isWeekend(ymd: string): boolean {
  const d = new Date(`${ymd}T00:00:00`);
  const day = d.getDay();
  return day === 0 || day === 6;
}

async function saveOutput(
  userId: string,
  out: {
    output_family: string;
    title: string;
    summary: string;
    confidence?: number;
    assumptions?: unknown;
    payload?: unknown;
    metadata?: unknown;
  }
) {
  const sb = getDb();
  const { data, error } = await sb
    .from("ai_outputs")
    .insert({
      user_id: userId,
      output_family: out.output_family,
      title: out.title,
      summary: out.summary,
      confidence: out.confidence ?? null,
      assumptions: out.assumptions ?? null,
      payload: out.payload ?? null,
      metadata: out.metadata ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getAiFeatureFlags(userId: string) {
  const sb = getDb();
  const { data, error } = await sb.from("ai_feature_flags").select("flag_key, enabled").eq("user_id", userId);
  if (error) throw error;
  const map: Record<string, boolean> = {};
  for (const row of data ?? []) {
    map[String(row.flag_key)] = Boolean(row.enabled);
  }
  return map;
}

export async function upsertAiFeatureFlag(userId: string, flagKey: string, enabled: boolean) {
  const sb = getDb();
  const { data, error } = await sb
    .from("ai_feature_flags")
    .upsert({ user_id: userId, flag_key: flagKey, enabled }, { onConflict: "user_id,flag_key" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function upsertManualInput(
  userId: string,
  body: { input_type: string; payload: Record<string, unknown>; effective_month?: string | null }
) {
  const sb = getDb();
  const { data, error } = await sb
    .from("ai_manual_inputs")
    .upsert(
      {
        user_id: userId,
        input_type: body.input_type,
        payload: body.payload,
        effective_month: body.effective_month ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,input_type,effective_month" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listManualInputs(userIds: string[]) {
  if (userIds.length === 0) return [];
  const sb = getDb();
  const { data, error } = await sb
    .from("ai_manual_inputs")
    .select("*")
    .in("user_id", userIds)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function insertExternalSignal(
  userId: string,
  body: {
    signal_type: string;
    source: string;
    metric_key: string;
    metric_value: number;
    observed_at: string;
    metadata?: Record<string, unknown>;
  }
) {
  const sb = getDb();
  const { data, error } = await sb
    .from("ai_external_signals")
    .insert({ user_id: userId, ...body })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listExternalSignals(userIds: string[], signalType?: string) {
  if (userIds.length === 0) return [];
  const sb = getDb();
  let q = sb.from("ai_external_signals").select("*").in("user_id", userIds).order("observed_at", { ascending: false });
  if (signalType) q = q.eq("signal_type", signalType);
  const { data, error } = await q.limit(300);
  if (error) throw error;
  return data ?? [];
}

export async function upsertNudgePreferences(
  userId: string,
  body: { enabled: boolean; quiet_start_hour: number; quiet_end_hour: number; channels: string[] }
) {
  const sb = getDb();
  const { data, error } = await sb
    .from("ai_nudge_preferences")
    .upsert(
      {
        user_id: userId,
        enabled: body.enabled,
        quiet_start_hour: body.quiet_start_hour,
        quiet_end_hour: body.quiet_end_hour,
        channels: body.channels,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getNudgePreferences(userId: string) {
  const sb = getDb();
  const { data, error } = await sb.from("ai_nudge_preferences").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return (
    data ?? {
      enabled: true,
      quiet_start_hour: 21,
      quiet_end_hour: 8,
      channels: ["in_app"],
    }
  );
}

export async function generateCashflowForecast(userId: string, userIds: string[], days: 30 | 60) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 120);
  const txs = (await listTransactions(userIds, {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    limit: 5000,
  })) as Tx[];

  const incomeDaily: number[] = [];
  const spendDaily: number[] = [];
  const weekendSpend: number[] = [];
  const weekdaySpend: number[] = [];
  const byDay = new Map<string, { income: number; spend: number }>();
  for (const t of txs) {
    const day = t.trans_date;
    const cur = byDay.get(day) ?? { income: 0, spend: 0 };
    const amt = Number(t.amount);
    if (amt < 0) cur.income += -amt;
    else cur.spend += amt;
    byDay.set(day, cur);
  }
  for (const [day, v] of byDay.entries()) {
    incomeDaily.push(v.income);
    spendDaily.push(v.spend);
    if (isWeekend(day)) weekendSpend.push(v.spend);
    else weekdaySpend.push(v.spend);
  }
  const avgIncome = avg(incomeDaily);
  const avgSpend = avg(spendDaily);
  const avgWeekend = avg(weekendSpend) || avgSpend;
  const avgWeekday = avg(weekdaySpend) || avgSpend;

  const sb = getDb();
  const { data: accounts } = await sb.from("linked_accounts").select("balance_current,balance_available").in("user_id", userIds);
  const currentBalance = (accounts ?? []).reduce(
    (s, a) => s + Number(a.balance_current ?? a.balance_available ?? 0),
    0
  );
  let projected = currentBalance;
  const points: { day: number; projected_balance: number }[] = [];
  const start = new Date();
  for (let i = 1; i <= days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const spend = isWeekend(d.toISOString().slice(0, 10)) ? avgWeekend : avgWeekday;
    projected += avgIncome - spend;
    points.push({ day: i, projected_balance: Number(projected.toFixed(2)) });
  }
  const output = {
    days,
    currentBalance: Number(currentBalance.toFixed(2)),
    projectedEndBalance: Number(projected.toFixed(2)),
    assumptions: {
      avgIncome: Number(avgIncome.toFixed(2)),
      avgSpendWeekday: Number(avgWeekday.toFixed(2)),
      avgSpendWeekend: Number(avgWeekend.toFixed(2)),
    },
    points,
  };
  await saveOutput(userId, {
    output_family: "forecast",
    title: `Cash flow forecast (${days} days)`,
    summary: `Projected balance in ${days} days: $${output.projectedEndBalance.toLocaleString()}.`,
    confidence: 0.62,
    assumptions: output.assumptions,
    payload: output,
  });
  return output;
}

export async function detectAnomalies(userId: string, userIds: string[]) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 365);
  const txs = (await listTransactions(userIds, {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    limit: 5000,
  })) as Tx[];
  const byMerchant = new Map<string, number[]>();
  for (const t of txs) {
    if (Number(t.amount) <= 0) continue;
    const m = (t.merchant_name ?? "Unknown").toLowerCase();
    if (!byMerchant.has(m)) byMerchant.set(m, []);
    byMerchant.get(m)!.push(Number(t.amount));
  }
  const recent = txs.filter((t) => {
    const d = new Date(t.trans_date).getTime();
    return d >= Date.now() - 30 * 86400000;
  });
  const anomalies: Array<{ type: string; merchant: string; amount: number; reason: string; confidence: number }> = [];
  for (const t of recent) {
    const m = (t.merchant_name ?? "Unknown").toLowerCase();
    const hist = byMerchant.get(m) ?? [];
    if (hist.length >= 4 && Number(t.amount) > 0) {
      const mean = avg(hist);
      if (mean > 0 && Number(t.amount) >= mean * 1.4) {
        anomalies.push({
          type: "spike",
          merchant: t.merchant_name ?? "Unknown",
          amount: Number(t.amount),
          reason: `${t.merchant_name ?? "Merchant"} is ${(Number(t.amount) / mean).toFixed(2)}x your 12-month average.`,
          confidence: 0.71,
        });
      }
    }
  }
  const dupWindow = new Map<string, Tx[]>();
  for (const t of recent) {
    const key = `${(t.merchant_name ?? "").toLowerCase()}|${Number(t.amount).toFixed(2)}`;
    if (!dupWindow.has(key)) dupWindow.set(key, []);
    dupWindow.get(key)!.push(t);
  }
  for (const [key, arr] of dupWindow.entries()) {
    if (arr.length >= 2) {
      const [merchant, amount] = key.split("|");
      anomalies.push({
        type: "possible_double_charge",
        merchant: merchant || "Unknown",
        amount: Number(amount),
        reason: `Detected ${arr.length} similar charges in a short period.`,
        confidence: 0.68,
      });
    }
  }
  const out = anomalies.slice(0, 12);
  await saveOutput(userId, {
    output_family: "anomaly",
    title: "Spending anomalies",
    summary: out.length === 0 ? "No major anomalies detected." : `${out.length} anomalies detected.`,
    confidence: out.length === 0 ? 0.7 : 0.66,
    payload: { anomalies: out },
  });
  return { anomalies: out };
}

export async function findSubscriptionVampires(userId: string, userIds: string[]) {
  const subs = (await getSubscriptions(userIds)) as Array<{
    id: string;
    name: string;
    merchant_name: string | null;
    amount: number | null;
    frequency: string | null;
  }>;
  const txs = (await listTransactions(userIds, { limit: 5000 })) as Tx[];
  const spikes: Array<{ name: string; oldAmount: number; newAmount: number; reason: string }> = [];
  for (const s of subs) {
    const key = (s.merchant_name || s.name || "").toLowerCase();
    if (!key) continue;
    const vals = txs
      .filter((t) => (t.merchant_name ?? "").toLowerCase().includes(key) && Number(t.amount) > 0)
      .slice(0, 8)
      .map((t) => Number(t.amount));
    if (vals.length >= 3) {
      const latest = vals[0];
      const baseline = avg(vals.slice(1));
      if (baseline > 0 && latest > baseline * 1.15) {
        spikes.push({
          name: s.name,
          oldAmount: Number(baseline.toFixed(2)),
          newAmount: Number(latest.toFixed(2)),
          reason: `Latest charge is ${(latest / baseline).toFixed(2)}x baseline.`,
        });
      }
    }
  }
  const out = spikes.slice(0, 10);
  await saveOutput(userId, {
    output_family: "subscription_vampire",
    title: "Subscription changes",
    summary: out.length === 0 ? "No recent subscription price spikes." : `${out.length} price hikes flagged.`,
    confidence: 0.6,
    payload: { flags: out },
  });
  return { flags: out };
}

export async function runNlq(userId: string, userIds: string[], query: string) {
  const q = query.toLowerCase();
  const txs = (await listTransactions(userIds, { limit: 5000 })) as Tx[];
  const monthMatch = q.match(/last month|this month/);
  let filtered = txs;
  if (monthMatch) {
    const now = new Date();
    const start = monthMatch[0] === "last month"
      ? new Date(now.getFullYear(), now.getMonth() - 1, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = monthMatch[0] === "last month"
      ? new Date(now.getFullYear(), now.getMonth(), 0)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0);
    filtered = filtered.filter((t) => {
      const d = new Date(t.trans_date);
      return d >= start && d <= end;
    });
  }
  const foodHint = q.includes("thai") ? ["thai", "restaurant", "food"] : [];
  if (foodHint.length) {
    filtered = filtered.filter((t) => {
      const m = (t.merchant_name ?? "").toLowerCase();
      const c = (t.category ?? []).join(" ").toLowerCase();
      return foodHint.some((h) => m.includes(h) || c.includes(h));
    });
  }
  const spend = filtered.filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const answer =
    filtered.length === 0
      ? "No matching transactions found in the selected context."
      : `I found ${filtered.length} matching transactions totaling $${spend.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}.`;
  await saveOutput(userId, {
    output_family: "nlq",
    title: "Natural language query",
    summary: answer,
    confidence: 0.58,
    payload: { query, count: filtered.length, total: spend },
  });
  return { answer, count: filtered.length, total: Number(spend.toFixed(2)) };
}

export async function voiceQuickLogDraft(userId: string, utterance: string) {
  const amount = Number((utterance.match(/(\d+(?:\.\d{1,2})?)/)?.[1] ?? "0"));
  const lower = utterance.toLowerCase();
  const category = lower.includes("food") || lower.includes("cafe") || lower.includes("restaurant")
    ? "Food and Drink"
    : lower.includes("gas") || lower.includes("fuel")
      ? "Transportation"
      : lower.includes("court") || lower.includes("badminton") || lower.includes("cricket")
        ? "Recreation"
        : "Other";
  const merchantGuess = utterance
    .replace(/hey tracker[,]?/i, "")
    .replace(/i just spent/i, "")
    .replace(/\$?\d+(?:\.\d{1,2})?/g, "")
    .replace(/on/gi, "")
    .trim()
    .slice(0, 80);

  const draft = {
    amount,
    category,
    merchant_name: merchantGuess || "Manual Voice Log",
    trans_date: new Date().toISOString().slice(0, 10),
  };
  await saveOutput(userId, {
    output_family: "voice_log_draft",
    title: "Voice quick-log draft",
    summary: `Drafted ${draft.merchant_name} for $${amount.toFixed(2)} in ${category}.`,
    confidence: 0.55,
    payload: draft,
  });
  return draft;
}

export async function getSmartGoalAdjustments(userId: string, userIds: string[]) {
  const budgets = (await getBudgetsWithProgress(userIds)) as Array<{
    category: string;
    amount_limit: number;
    spent?: number;
    pct?: number;
  }>;
  const overspent = budgets.filter((b) => (b.pct ?? 0) > 100);
  const under = budgets.filter((b) => (b.pct ?? 0) < 70);
  const adjustments: Array<{ from: string; to: string; amount: number; reason: string }> = [];
  for (const o of overspent) {
    const source = under.shift();
    if (!source) break;
    const amount = Math.max(0, Math.min(200, Number(source.amount_limit) * 0.1));
    adjustments.push({
      from: source.category,
      to: o.category,
      amount: Number(amount.toFixed(2)),
      reason: `${o.category} is over target while ${source.category} has available buffer.`,
    });
  }
  await saveOutput(userId, {
    output_family: "goal_adjustment",
    title: "Suggested goal adjustments",
    summary: adjustments.length === 0 ? "No category rebalancing needed." : `${adjustments.length} adjustments suggested.`,
    confidence: 0.64,
    payload: { adjustments },
  });
  return { adjustments };
}

export async function autoCategorizeTransaction(
  userId: string,
  body: { merchant_name: string; amount?: number; location_hint?: string }
) {
  const m = body.merchant_name.toLowerCase();
  let category = "Other";
  let confidence = 0.45;
  if (m.includes("sq *") || m.includes("coffee") || m.includes("cafe") || m.includes("lunch")) {
    category = "Food and Drink";
    confidence = 0.74;
  } else if (m.includes("uber") || m.includes("lyft") || m.includes("shell") || m.includes("chevron")) {
    category = "Transportation";
    confidence = 0.71;
  } else if (m.includes("target") || m.includes("walmart") || m.includes("sam")) {
    category = "Shopping";
    confidence = 0.68;
  } else if (m.includes("pest") || m.includes("insurance") || m.includes("utility")) {
    category = "Rent and Utilities";
    confidence = 0.66;
  }
  const rationale = body.location_hint
    ? `Categorized using merchant token + location context (${body.location_hint}).`
    : "Categorized using merchant token patterns and historical common mappings.";
  const out = { category, confidence, rationale };
  await saveOutput(userId, {
    output_family: "auto_categorization",
    title: "Auto-categorization 2.0",
    summary: `${body.merchant_name} -> ${category} (${Math.round(confidence * 100)}% confidence).`,
    confidence,
    payload: { merchant: body.merchant_name, ...out },
  });
  return out;
}

export async function generateBehaviorNudges(userId: string, userIds: string[]) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 90);
  const txs = (await listTransactions(userIds, {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    limit: 5000,
  })) as Tx[];
  const friSpend: number[] = [];
  const weekdaySpend: number[] = [];
  for (const t of txs) {
    if (Number(t.amount) <= 0) continue;
    const day = new Date(t.trans_date).getDay();
    if (day === 5) friSpend.push(Number(t.amount));
    else if (day >= 1 && day <= 4) weekdaySpend.push(Number(t.amount));
  }
  const friAvg = avg(friSpend);
  const weekdayAvg = avg(weekdaySpend);
  const nudges: Array<{ title: string; body: string; confidence: number }> = [];
  if (friAvg > weekdayAvg * 1.25 && friAvg > 20) {
    nudges.push({
      title: "Friday dining trend",
      body: `You typically spend around $${friAvg.toFixed(0)} on Fridays. Skipping one outing this week could accelerate your goals.`,
      confidence: 0.69,
    });
  }
  if (nudges.length === 0) {
    nudges.push({
      title: "Steady spending",
      body: "Your recent spending pattern is stable. Keep monitoring your highest-variance categories.",
      confidence: 0.61,
    });
  }
  await saveOutput(userId, {
    output_family: "nudge",
    title: "Behavior nudges",
    summary: nudges[0].body,
    confidence: nudges[0].confidence,
    payload: { nudges },
  });
  return { nudges };
}

export async function getRetirementTaxCheck(userId: string, userIds: string[]) {
  const manual = await listManualInputs(userIds);
  const contribution = manual.find((m) => String(m.input_type) === "retirement_contribution_plan");
  const tax = manual.find((m) => String(m.input_type) === "tax_withholding_plan");
  const contribPayload = (contribution?.payload as Record<string, unknown> | undefined) ?? {};
  const taxPayload = (tax?.payload as Record<string, unknown> | undefined) ?? {};
  const annual401kLimit = Number(contribPayload.annual401kLimit ?? 23000);
  const current401k = Number(contribPayload.current401k ?? 0);
  const annualHsaLimit = Number(contribPayload.annualHsaLimit ?? 4150);
  const currentHsa = Number(contribPayload.currentHsa ?? 0);
  const now = new Date();
  const monthsLeft = Math.max(1, 12 - now.getMonth() - 1);
  const monthly401kNeeded = Math.max(0, (annual401kLimit - current401k) / monthsLeft);
  const monthlyHsaNeeded = Math.max(0, (annualHsaLimit - currentHsa) / monthsLeft);
  const expectedTaxDue = Number(taxPayload.expectedTaxDue ?? 0);
  const withheldToDate = Number(taxPayload.withheldToDate ?? 0);
  const suggestedExtraWithholding = Math.max(0, (expectedTaxDue - withheldToDate) / monthsLeft);
  const out = {
    contributionPacing: {
      annual401kLimit,
      current401k,
      monthly401kNeeded: Number(monthly401kNeeded.toFixed(2)),
      annualHsaLimit,
      currentHsa,
      monthlyHsaNeeded: Number(monthlyHsaNeeded.toFixed(2)),
    },
    taxLiability: {
      expectedTaxDue,
      withheldToDate,
      suggestedExtraWithholding: Number(suggestedExtraWithholding.toFixed(2)),
    },
  };
  await saveOutput(userId, {
    output_family: "retirement_tax",
    title: "Retirement + tax pacing check",
    summary: `Estimated monthly 401k pacing: $${out.contributionPacing.monthly401kNeeded.toFixed(0)}.`,
    confidence: 0.63,
    assumptions: { monthsLeft },
    payload: out,
  });
  return out;
}

export async function getEscrowForecast(userId: string, userIds: string[]) {
  const manual = await listManualInputs(userIds);
  const escrow = manual.find((m) => String(m.input_type) === "mortgage_escrow_profile");
  const e = (escrow?.payload as Record<string, unknown> | undefined) ?? {};
  const monthlyMortgage = Number(e.monthlyMortgage ?? 4832);
  const currentEscrowPortion = Number(e.currentEscrowPortion ?? 1500);
  const signals = await listExternalSignals(userIds, "property_tax_trend");
  const avgTrendPct =
    signals.length === 0
      ? 0.05
      : avg(signals.map((s) => Number((s as { metric_value: number }).metric_value ?? 0))) / 100;
  const projectedEscrow = currentEscrowPortion * (1 + avgTrendPct);
  const shortfall = Math.max(0, projectedEscrow - currentEscrowPortion);
  const out = {
    monthlyMortgage,
    currentEscrowPortion: Number(currentEscrowPortion.toFixed(2)),
    projectedEscrowPortion: Number(projectedEscrow.toFixed(2)),
    expectedMonthlyShortfall: Number(shortfall.toFixed(2)),
    trendAssumptionPct: Number((avgTrendPct * 100).toFixed(2)),
  };
  await saveOutput(userId, {
    output_family: "escrow",
    title: "Escrow shortfall forecast",
    summary:
      shortfall > 0
        ? `Projected monthly escrow shortfall: $${shortfall.toFixed(2)}.`
        : "No escrow shortfall detected with current trend assumptions.",
    confidence: 0.56,
    payload: out,
  });
  return out;
}

/** Families written by `refreshAiPipeline` / lab POST routes. */
export const AI_OUTPUT_FAMILIES = [
  "forecast",
  "anomaly",
  "subscription_vampire",
  "goal_adjustment",
  "nudge",
  "retirement_tax",
  "escrow",
] as const;

export type AiOutputRow = {
  id: string;
  output_family: string;
  title: string;
  summary: string;
  confidence: number | null;
  assumptions: unknown;
  payload: unknown;
  metadata: unknown;
  generated_at: string;
};

/** Latest row per `output_family` across `userIds` (household), by most recent `generated_at`. */
export async function listLatestAiOutputs(
  userIds: string[],
  families?: readonly string[]
): Promise<{ byFamily: Record<string, AiOutputRow | null> }> {
  const fams = families?.length ? [...families] : [...AI_OUTPUT_FAMILIES];
  const byFamily: Record<string, AiOutputRow | null> = {};
  for (const f of fams) {
    byFamily[f] = null;
  }
  if (userIds.length === 0 || fams.length === 0) {
    return { byFamily };
  }
  const sb = getDb();
  const { data, error } = await sb
    .from("ai_outputs")
    .select("id, output_family, title, summary, confidence, assumptions, payload, metadata, generated_at")
    .in("user_id", userIds)
    .in("output_family", fams)
    .order("generated_at", { ascending: false });
  if (error) throw error;
  const rows = [...(data ?? [])].sort(
    (a, b) => new Date(String(b.generated_at)).getTime() - new Date(String(a.generated_at)).getTime()
  );
  for (const row of rows) {
    const fam = String(row.output_family);
    if (fam in byFamily && byFamily[fam] === null) {
      byFamily[fam] = row as AiOutputRow;
    }
  }
  return { byFamily };
}
