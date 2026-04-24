import { getDb } from "../db/supabase.js";
import { getHouseholdIdForUser } from "../household/householdService.js";
import { config } from "../../config.js";

function effectiveBudgetTitles(
  txCats: string[] | null,
  mappings: { plaid_category_pattern: string; budget_category: string }[]
): string[] {
  const raw = txCats ?? [];
  const out = new Set<string>();
  for (const rc of raw) {
    out.add(rc);
    const cl = rc.toLowerCase();
    for (const m of mappings) {
      if (cl.includes(m.plaid_category_pattern.toLowerCase())) {
        out.add(m.budget_category);
      }
    }
  }
  return [...out];
}

function matchesBudgetCategory(
  txCats: string[] | null,
  budgetCat: string,
  mappings: { plaid_category_pattern: string; budget_category: string }[]
): boolean {
  const b = budgetCat.toLowerCase().trim();
  if (!b) return false;
  for (const title of effectiveBudgetTitles(txCats, mappings)) {
    const c = title.toLowerCase();
    if (c === b || c.includes(b) || b.includes(c)) return true;
  }
  return false;
}

export async function listCategoryMappings(userIds: string[]) {
  if (userIds.length === 0) return [];
  const sb = getDb();
  const { data, error } = await sb
    .from("category_budget_mappings")
    .select("*")
    .in("user_id", userIds);
  if (error) throw error;
  return data ?? [];
}

export async function createCategoryMapping(
  userId: string,
  body: { plaid_category_pattern: string; budget_category: string }
) {
  const sb = getDb();
  const { data, error } = await sb
    .from("category_budget_mappings")
    .insert({
      user_id: userId,
      plaid_category_pattern: body.plaid_category_pattern.trim(),
      budget_category: body.budget_category.trim(),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCategoryMapping(userId: string, id: string) {
  const sb = getDb();
  const { error } = await sb.from("category_budget_mappings").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

export async function listTransactions(
  userIds: string[],
  opts: {
    from?: string;
    to?: string;
    merchant?: string;
    accountId?: string;
    limit?: number;
    /** Partial match against Plaid category labels */
    category?: string;
    minAmount?: number;
    maxAmount?: number;
    /** Search merchant name or any category substring (in-memory filter after range query) */
    q?: string;
  }
) {
  if (userIds.length === 0) return [];
  const sb = getDb();
  const cap = Math.min(opts.limit ?? 500, 5000);
  let q = sb
    .from("transactions")
    .select("*")
    .in("user_id", userIds)
    .order("trans_date", { ascending: false })
    .limit(cap);

  if (opts.from) q = q.gte("trans_date", opts.from);
  if (opts.to) q = q.lte("trans_date", opts.to);
  if (opts.merchant && !opts.q) q = q.ilike("merchant_name", `%${opts.merchant}%`);
  if (opts.accountId) q = q.eq("plaid_account_id", opts.accountId);
  if (opts.minAmount !== undefined) q = q.gte("amount", opts.minAmount);
  if (opts.maxAmount !== undefined) q = q.lte("amount", opts.maxAmount);

  const { data, error } = await q;
  if (error) throw error;
  const overrides = await userMerchantCategoryOverrides(userIds);
  let rows = (data ?? []).map((row) => {
    const merchant = canonicalMerchantName((row as { merchant_name?: string | null }).merchant_name);
    let resolvedCategory: string | null = null;
    for (const [pattern, category] of overrides.entries()) {
      if (pattern && normalizeText(merchant).includes(pattern)) {
        resolvedCategory = category;
        break;
      }
    }
    if (!resolvedCategory) {
      const firstNative = ((row as { category?: string[] | null }).category ?? [])[0] ?? null;
      resolvedCategory = firstNative && firstNative.trim() ? firstNative : systemCategoryFromMerchant(merchant);
    }
    return {
      ...row,
      merchant_name: merchant,
      category: [resolvedCategory],
    };
  });
  if (opts.category) {
    const needle = opts.category.toLowerCase();
    rows = rows.filter((t: { category?: string[] | null }) =>
      (t.category ?? []).some((c) => c.toLowerCase().includes(needle))
    );
  }
  if (opts.q) {
    const needle = opts.q.trim().toLowerCase();
    if (needle.length > 0) {
      rows = rows.filter((t: { merchant_name?: string | null; category?: string[] | null }) => {
        const m = (t.merchant_name ?? "").toLowerCase();
        if (m.includes(needle)) return true;
        return (t.category ?? []).some((c) => c.toLowerCase().includes(needle));
      });
    }
  }
  return rows;
}

export async function spendingByMerchant(
  userIds: string[],
  from?: string,
  to?: string
) {
  const txs = await listTransactions(userIds, { from, to, limit: 5000 });
  const map = new Map<string, number>();
  for (const t of txs as { merchant_name: string | null; amount: number }[]) {
    const m = t.merchant_name || "Unknown";
    map.set(m, (map.get(m) ?? 0) + Number(t.amount));
  }
  return [...map.entries()]
    .map(([merchant_name, total_amount]) => ({ merchant_name, total_amount }))
    .sort((a, b) => Math.abs(b.total_amount) - Math.abs(a.total_amount));
}

export async function getBudgets(userIds: string[]) {
  if (userIds.length === 0) return [];
  const sb = getDb();
  const { data, error } = await sb.from("budgets").select("*").in("user_id", userIds);
  if (error) throw error;
  return data ?? [];
}

export async function createBudget(
  userId: string,
  body: {
    category: string;
    amount_limit: number;
    period_start: string;
    period_end?: string | null;
  }
) {
  const sb = getDb();
  const { data, error } = await sb
    .from("budgets")
    .insert({ user_id: userId, ...body })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getBudgetProjects(userIds: string[]) {
  if (userIds.length === 0) return [];
  const sb = getDb();
  const { data, error } = await sb
    .from("budget_projects")
    .select("*")
    .in("user_id", userIds);
  if (error) throw error;
  return data ?? [];
}

export async function createBudgetProject(
  userId: string,
  body: {
    name: string;
    target_amount: number;
    spent_amount?: number;
    start_date?: string | null;
    end_date?: string | null;
  }
) {
  const sb = getDb();
  const { data, error } = await sb
    .from("budget_projects")
    .insert({
      user_id: userId,
      spent_amount: body.spent_amount ?? 0,
      ...body,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getSubscriptions(userIds: string[]) {
  if (userIds.length === 0) return [];
  const sb = getDb();
  const { data: existing, error } = await sb
    .from("subscriptions")
    .select("*")
    .in("user_id", userIds);
  if (error) throw error;
  const txs = (await listTransactions(userIds, { limit: 5000 })) as {
    user_id: string;
    merchant_name: string | null;
    amount: number;
    trans_date: string;
  }[];

  const forcedRecurring = new Set<string>();
  const forcedExcluded = new Set<string>();
  for (const row of existing ?? []) {
    const raw = (row.raw ?? {}) as Record<string, unknown>;
    const k = normalizeText(String(raw.merchant_key ?? row.merchant_name ?? row.name ?? ""));
    if (!k) continue;
    if (raw.force_recurring === true) forcedRecurring.add(k);
    if (raw.force_recurring === false) forcedExcluded.add(k);
  }

  const byMerchant = new Map<string, { user_id: string; amounts: number[]; dates: Date[]; name: string }>();
  for (const t of txs) {
    const amt = Number(t.amount);
    if (!Number.isFinite(amt) || amt === 0) continue;
    const key = normalizeText(t.merchant_name);
    if (!key) continue;
    if (isCardPaymentLike({ amount: amt, category: null, merchant_name: t.merchant_name })) continue;
    const d = new Date(`${t.trans_date}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) continue;
    const cur = byMerchant.get(key) ?? {
      user_id: t.user_id,
      amounts: [],
      dates: [],
      name: canonicalMerchantName(t.merchant_name),
    };
    cur.amounts.push(amt);
    cur.dates.push(d);
    byMerchant.set(key, cur);
  }

  const inferred: Array<{
    user_id: string;
    name: string;
    merchant_name: string;
    amount: number;
    frequency: string;
    next_payment_date: string | null;
    raw: Record<string, unknown>;
  }> = [];

  for (const [key, group] of byMerchant.entries()) {
    group.dates.sort((a, b) => a.getTime() - b.getTime());
    if (group.dates.length < 2 && !forcedRecurring.has(key)) continue;
    if (forcedExcluded.has(key)) continue;
    const avgAmount = group.amounts.reduce((s, a) => s + Math.abs(a), 0) / Math.max(1, group.amounts.length);
    if (avgAmount < 2 && !forcedRecurring.has(key)) continue;

    let frequency = "monthly";
    let next: string | null = null;
    if (group.dates.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < group.dates.length; i++) {
        gaps.push(Math.round((group.dates[i]!.getTime() - group.dates[i - 1]!.getTime()) / 86400000));
      }
      const mean = gaps.reduce((s, n) => s + n, 0) / gaps.length;
      if (mean <= 10) frequency = "weekly";
      else if (mean <= 20) frequency = "biweekly";
      else if (mean <= 40) frequency = "monthly";
      else frequency = "quarterly";
      const last = group.dates[group.dates.length - 1]!;
      const nextDate = new Date(last);
      nextDate.setUTCDate(nextDate.getUTCDate() + Math.max(7, Math.round(mean)));
      next = nextDate.toISOString().slice(0, 10);
    } else if (forcedRecurring.has(key)) {
      const last = group.dates[group.dates.length - 1]!;
      const nextDate = new Date(last);
      nextDate.setUTCDate(nextDate.getUTCDate() + 30);
      next = nextDate.toISOString().slice(0, 10);
    }

    inferred.push({
      user_id: group.user_id,
      name: group.name,
      merchant_name: group.name,
      amount: Number(avgAmount.toFixed(2)),
      frequency,
      next_payment_date: next,
      raw: {
        source: "auto-recurring-v1",
        merchant_key: key,
        sample_count: group.dates.length,
        force_recurring: forcedRecurring.has(key) ? true : forcedExcluded.has(key) ? false : null,
      },
    });
  }

  for (const row of inferred) {
    const { data: existingRow, error: existingErr } = await sb
      .from("subscriptions")
      .select("id")
      .eq("user_id", row.user_id)
      .eq("name", row.name)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existingRow?.id) {
      const { error: updateErr } = await sb
        .from("subscriptions")
        .update({
          merchant_name: row.merchant_name,
          amount: row.amount,
          frequency: row.frequency,
          next_payment_date: row.next_payment_date,
          raw: row.raw,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingRow.id);
      if (updateErr) throw updateErr;
    } else {
      const { error: insertErr } = await sb.from("subscriptions").insert(row);
      if (insertErr) throw insertErr;
    }
  }

  const { data: refreshed, error: refreshedErr } = await sb
    .from("subscriptions")
    .select("*")
    .in("user_id", userIds);
  if (refreshedErr) throw refreshedErr;
  return refreshed ?? [];
}

export async function getNetWorth(userIds: string[]) {
  if (userIds.length === 0) {
    return {
      snapshot: null,
      computed: { liquid_assets: 0, investments: 0, accounts: [] },
    };
  }
  const sb = getDb();
  const { data: latest } = await sb
    .from("networth_snapshots")
    .select("*")
    .in("user_id", userIds)
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: accounts } = await sb
    .from("linked_accounts")
    .select("*")
    .in("user_id", userIds);

  let liquid = 0;
  let investments = 0;
  for (const a of accounts ?? []) {
    const bal = Number(a.balance_current ?? a.balance_available ?? 0);
    const t = (a.type as string)?.toLowerCase() ?? "";
    if (t === "depository") liquid += bal;
    else if (t === "investment") investments += bal;
  }

  return {
    snapshot: latest,
    computed: {
      liquid_assets: liquid,
      investments,
      accounts: accounts ?? [],
    },
  };
}

/** Best-effort: outflows that look like card payments (Plaid sandbox categories vary). */
export async function getCreditCardPayments(userIds: string[], from?: string, to?: string) {
  const txs = await listTransactions(userIds, { from, to, limit: 500 });
  const filtered = (txs as { merchant_name: string | null; amount: number; category: string[] | null; name?: string }[]).filter(
    (t) => Number(t.amount) < 0 && isCardPaymentLike(t)
  );
  return filtered;
}

export async function getDistinctTransactionCategories(userIds: string[]) {
  const txs = await listTransactions(userIds, { limit: 3000 });
  const set = new Set<string>();
  for (const t of txs as { category: string[] | null }[]) {
    for (const c of t.category ?? []) {
      if (c) set.add(c);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export async function getCreditCardSummary(userIds: string[]) {
  if (userIds.length === 0) {
    return {
      creditCards: [],
      postedPayments: [],
      upcomingDueDates: [],
    };
  }
  const sb = getDb();
  const { data: accounts } = await sb
    .from("linked_accounts")
    .select("*")
    .in("user_id", userIds);

  const creditCards = (accounts ?? []).filter((a) => {
    const t = (a.type as string)?.toLowerCase() ?? "";
    const st = (a.subtype as string)?.toLowerCase() ?? "";
    return t === "credit" || st.includes("credit");
  });

  const txs = await listTransactions(userIds, { limit: 5000 });
  const cardIds = new Set(creditCards.map((c) => c.plaid_account_id as string));

  const postedPayments = (txs as {
    plaid_transaction_id: string;
    plaid_account_id: string | null;
    merchant_name: string | null;
    amount: number;
    trans_date: string;
    category: string[] | null;
  }[])
    .filter((t) => {
      if (!t.plaid_account_id || !cardIds.has(t.plaid_account_id)) return false;
      return Number(t.amount) < 0 && isCardPaymentLike(t);
    })
    .slice(0, 25);

  return {
    creditCards: creditCards.map((c) => ({
      plaid_account_id: c.plaid_account_id,
      name: c.name,
      mask: c.mask,
      currentBalance: Number(c.balance_current ?? 0),
      available: c.balance_available != null ? Number(c.balance_available) : null,
      note:
        "Minimum due and exact statement dates usually require Plaid Liabilities. Current balance is a proxy for statement balance in Sandbox.",
    })),
    postedPayments,
    upcomingDueDates: creditCards.map((c) => ({
      account: c.name,
      label: "Due date (estimate)",
      /** Placeholder until Liabilities product */
      dueDisplay: "—",
      minimumDueDisplay: "—",
      statementBalanceDisplay: Number(c.balance_current ?? 0).toFixed(2),
    })),
  };
}

export async function getBudgetsWithProgress(userIds: string[]) {
  const budgets = await getBudgets(userIds);
  const mappings = (await listCategoryMappings(userIds)) as {
    plaid_category_pattern: string;
    budget_category: string;
  }[];
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const txs = await listTransactions(userIds, { from: start, to: end, limit: 5000 });

  return budgets.map((b) => {
    let spent = 0;
    for (const t of txs as { category: string[] | null; amount: number }[]) {
      if (matchesBudgetCategory(t.category, String(b.category), mappings) && Number(t.amount) > 0) {
        spent += Number(t.amount);
      }
    }
    const limitAmt = Number(b.amount_limit);
    const remaining = Math.max(0, limitAmt - spent);
    const pct = limitAmt > 0 ? Math.min(100, (spent / limitAmt) * 100) : 0;
    const over = spent > limitAmt ? spent - limitAmt : 0;
    return {
      ...b,
      periodLabel: `${start} → ${end}`,
      spent,
      remaining,
      pct,
      projectedOverage: over,
    };
  });
}

export async function cashFlowSeries(
  userIds: string[],
  from: string,
  to: string
) {
  const txs = await listTransactions(userIds, { from, to, limit: 5000 });
  const byDay = new Map<string, { income: number; spend: number }>();
  for (const t of txs as { trans_date: string; amount: number }[]) {
    const day = t.trans_date;
    const cur = byDay.get(day) ?? { income: 0, spend: 0 };
    const amt = Number(t.amount);
    if (amt < 0) cur.income += -amt;
    else cur.spend += amt;
    byDay.set(day, cur);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));
}

export async function listTransactionLabels(userIds: string[], plaidTransactionIds: string[]) {
  if (userIds.length === 0 || plaidTransactionIds.length === 0) return [];
  const sb = getDb();
  const { data, error } = await sb
    .from("transaction_labels")
    .select("*")
    .in("user_id", userIds)
    .in("plaid_transaction_id", plaidTransactionIds);
  if (error) throw error;
  return data ?? [];
}

export async function upsertTransactionLabel(
  userId: string,
  body: { plaid_transaction_id: string; label: string; shared?: boolean }
) {
  const sb = getDb();
  let householdId: string | null = null;
  if (body.shared) {
    householdId = await getHouseholdIdForUser(userId);
    if (!householdId) throw new Error("Join a household to share labels.");
  }
  const { data, error } = await sb
    .from("transaction_labels")
    .upsert(
      {
        user_id: userId,
        plaid_transaction_id: body.plaid_transaction_id,
        label: body.label.trim(),
        shared: Boolean(body.shared),
        household_id: householdId,
      },
      { onConflict: "user_id,plaid_transaction_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

type AccountRow = {
  plaid_account_id: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  balance_current: number | null;
  balance_available: number | null;
};

export type RewardCategoryRates = Record<string, number>;
export type IssuerCreditRule = { label: string; amount: number };
export type CreditCardRewardsProfileRow = {
  id: string;
  user_id: string;
  plaid_account_id: string;
  card_name: string;
  issuer: string | null;
  program: string | null;
  annual_fee: number;
  cardmember_year_start_month: number;
  cardmember_year_start_day: number;
  points_cpp: number;
  base_rate: number;
  category_rates: RewardCategoryRates | null;
  issuer_credits: IssuerCreditRule[] | null;
  enrichment_status: "pending" | "ready" | "failed";
  enrichment_source: string | null;
  enrichment_error: string | null;
  last_enriched_at: string | null;
  updated_at: string;
};

function asLower(v: string | null | undefined): string {
  return String(v ?? "").toLowerCase();
}

function isCreditAccount(a: AccountRow): boolean {
  return asLower(a.type) === "credit" || asLower(a.subtype).includes("credit");
}

function isCardPaymentLike(t: { amount: number; category: string[] | null; merchant_name: string | null }): boolean {
  const cat = (t.category ?? []).join(" ").toLowerCase();
  const merchant = asLower(t.merchant_name);
  return (
    cat.includes("payment") ||
    cat.includes("transfer") ||
    merchant.includes("payment") ||
    merchant.includes("autopay") ||
    merchant.includes("thank you")
  );
}

function isRefundLikeTx(t: { amount: number; category: string[] | null; merchant_name: string | null }): boolean {
  const cat = (t.category ?? []).join(" ").toLowerCase();
  const merchant = asLower(t.merchant_name);
  const amount = Number(t.amount);
  if (isCardPaymentLike(t)) return false;
  if (amount >= 0) return false;
  return cat.includes("refund") || cat.includes("return") || merchant.includes("refund") || merchant.includes("return");
}

function asNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toTitleCase(input: string): string {
  return input
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const MERCHANT_CLEAN_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /sampay\*?\s*doordash|doordash|door dash/i, replacement: "DoorDash" },
  { pattern: /home\s*depot|homedepot/i, replacement: "Home Depot" },
  { pattern: /\bchase\b/i, replacement: "Chase" },
  { pattern: /\bamerican\s+express\b|\bamex\b/i, replacement: "American Express" },
  { pattern: /\bgoogle\b/i, replacement: "Google" },
  { pattern: /\bnetflix\b/i, replacement: "Netflix" },
  { pattern: /\bspotify\b/i, replacement: "Spotify" },
  { pattern: /\bapple\b/i, replacement: "Apple" },
  { pattern: /\bamazon\b/i, replacement: "Amazon" },
  { pattern: /\bwalmart\b/i, replacement: "Walmart" },
  { pattern: /\btarget\b/i, replacement: "Target" },
];

function canonicalMerchantName(raw: string | null | undefined): string {
  const source = String(raw ?? "").trim();
  if (!source) return "Unknown";

  for (const rule of MERCHANT_CLEAN_RULES) {
    if (rule.pattern.test(source)) return rule.replacement;
  }

  let cleaned = source
    .replace(/^(pos|dbt|debit|visa|mc|mastercard|ach|online|web|card)\s+/i, "")
    .replace(/^(payment|transfer)\s+/i, "")
    .replace(/[0-9]{3,}/g, " ")
    .replace(/\*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Keep only the leading human-readable merchant fragment.
  cleaned = cleaned.split(/ {2,}| - | \/ /)[0]?.trim() ?? cleaned;
  if (!cleaned) return "Unknown";
  return toTitleCase(cleaned.toLowerCase());
}

function systemCategoryFromMerchant(merchant: string): string {
  const m = normalizeText(merchant);
  if (/(doordash|ubereats|grubhub|restaurant|cafe|coffee)/.test(m)) return "Restaurants";
  if (/(home depot|lowes|ace hardware)/.test(m)) return "Home Improvements";
  if (/(walmart|target|costco|whole foods|trader joes|heb|kroger|grocery)/.test(m)) return "Groceries";
  if (/(shell|chevron|exxon|fuel|gas)/.test(m)) return "Auto Maintenance";
  if (/(verizon|att|t mobile|xfinity|spectrum|internet|phone)/.test(m)) return "Business Utilities & Communication";
  if (/(amazon|best buy|shopping|store|retail)/.test(m)) return "Shopping";
  if (/(payroll|paycheck|salary)/.test(m)) return "Paychecks";
  if (/(interest)/.test(m)) return "Interest";
  if (/(rent|mortgage)/.test(m)) return "Housing";
  return "Uncategorized";
}

async function userMerchantCategoryOverrides(userIds: string[]): Promise<Map<string, string>> {
  const mappings = (await listCategoryMappings(userIds)) as { plaid_category_pattern: string; budget_category: string }[];
  const out = new Map<string, string>();
  for (const m of mappings) {
    const k = normalizeText(m.plaid_category_pattern);
    if (k) out.set(k, m.budget_category.trim());
  }
  return out;
}

export function categoryKeyForRecommendation(merchant: string, category?: string): string {
  const haystack = `${normalizeText(merchant)} ${normalizeText(category)}`;
  if (/(grocery|whole foods|trader joe|costco|supermarket)/.test(haystack)) return "grocery";
  if (/(restaurant|dining|food|cafe|coffee|doordash|ubereats)/.test(haystack)) return "dining";
  if (/(gas|fuel|shell|chevron|exxon)/.test(haystack)) return "gas";
  if (/(flight|airline|hotel|travel|uber|lyft|airbnb)/.test(haystack)) return "travel";
  if (/(amazon|target|walmart|shopping|shop|retail)/.test(haystack)) return "shopping";
  return "other";
}

export function cardmemberYearWindow(startMonth: number, startDay: number, now = new Date()) {
  const month = Math.min(12, Math.max(1, Math.trunc(startMonth)));
  const day = Math.min(31, Math.max(1, Math.trunc(startDay)));
  let start = new Date(now.getFullYear(), month - 1, day);
  if (start > now) start = new Date(now.getFullYear() - 1, month - 1, day);
  const end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function profileRateForCategory(profile: CreditCardRewardsProfileRow, categoryKey: string): number {
  const rates = (profile.category_rates ?? {}) as RewardCategoryRates;
  const base = asNum(profile.base_rate, 0.01);
  const hit = asNum(rates[categoryKey], 0);
  return hit > 0 ? hit : base;
}

export async function listCreditCardRewardsProfiles(userIds: string[]) {
  if (userIds.length === 0) return [];
  const sb = getDb();
  const { data, error } = await sb
    .from("credit_card_rewards_profiles")
    .select("*")
    .in("user_id", userIds)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CreditCardRewardsProfileRow[];
}

const REWARDS_CATALOG: {
  pattern: RegExp;
  issuer: string;
  program: string;
  annual_fee: number;
  base_rate: number;
  category_rates: RewardCategoryRates;
  issuer_credits: IssuerCreditRule[];
  points_cpp: number;
}[] = [
  {
    pattern: /sapphire preferred/i,
    issuer: "Chase",
    program: "Ultimate Rewards",
    annual_fee: 95,
    base_rate: 0.01,
    category_rates: { dining: 0.03, travel: 0.02, grocery: 0.01, other: 0.01 },
    issuer_credits: [],
    points_cpp: 0.01,
  },
  {
    pattern: /amex gold|american express gold/i,
    issuer: "American Express",
    program: "Membership Rewards",
    annual_fee: 325,
    base_rate: 0.01,
    category_rates: { dining: 0.04, grocery: 0.04, travel: 0.03, other: 0.01 },
    issuer_credits: [{ label: "Dining credits", amount: 120 }],
    points_cpp: 0.01,
  },
  {
    pattern: /citi double cash/i,
    issuer: "Citi",
    program: "ThankYou",
    annual_fee: 0,
    base_rate: 0.02,
    category_rates: { other: 0.02 },
    issuer_credits: [],
    points_cpp: 0.01,
  },
];

function inferCardProfile(cardName: string | null | undefined) {
  if (!config.enableRewardsCatalogFallback) return null;
  const name = String(cardName ?? "");
  for (const item of REWARDS_CATALOG) {
    if (item.pattern.test(name)) return item;
  }
  return null;
}

export async function enrichCreditCardRewardsProfiles(userId: string, userIds: string[]) {
  const sb = getDb();
  const { data: linked, error } = await sb
    .from("linked_accounts")
    .select("plaid_account_id,name,type,subtype")
    .in("user_id", userIds);
  if (error) throw error;

  const cards = (linked ?? []).filter((a) => {
    const type = asLower((a as { type?: string | null }).type);
    const subtype = asLower((a as { subtype?: string | null }).subtype);
    return type === "credit" || subtype.includes("credit");
  }) as { plaid_account_id: string; name: string | null }[];

  let upserted = 0;
  for (const card of cards) {
    const inferred = inferCardProfile(card.name);
    const row = {
      user_id: userId,
      plaid_account_id: card.plaid_account_id,
      card_name: card.name ?? "Credit card",
      issuer: inferred?.issuer ?? null,
      program: inferred?.program ?? null,
      annual_fee: inferred?.annual_fee ?? 0,
      cardmember_year_start_month: 1,
      cardmember_year_start_day: 1,
      points_cpp: inferred?.points_cpp ?? 0.01,
      base_rate: inferred?.base_rate ?? 0.01,
      category_rates: inferred?.category_rates ?? { other: 0.01 },
      issuer_credits: inferred?.issuer_credits ?? [],
      enrichment_status: inferred ? "ready" : "pending",
      enrichment_source: inferred ? "catalog-v1" : "unmatched",
      enrichment_error: inferred ? null : "No issuer-program match found yet",
      last_enriched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error: upsertErr } = await sb
      .from("credit_card_rewards_profiles")
      .upsert(row, { onConflict: "user_id,plaid_account_id" });
    if (upsertErr) throw upsertErr;
    upserted += 1;
  }
  return { ok: true, upserted };
}

export async function getBestCardRecommendation(
  userIds: string[],
  input: { merchant: string; category?: string; amount?: number }
) {
  const profiles = await listCreditCardRewardsProfiles(userIds);
  const spend = asNum(input.amount, 100);
  const catKey = categoryKeyForRecommendation(input.merchant, input.category);
  const ranked = profiles
    .filter((p) => p.enrichment_status !== "failed")
    .map((p) => {
      const rate = profileRateForCategory(p, catKey);
      const projectedValue = spend * rate;
      return {
        plaid_account_id: p.plaid_account_id,
        card_name: p.card_name,
        issuer: p.issuer,
        category_match: catKey,
        reward_rate: rate,
        projected_value: Number(projectedValue.toFixed(2)),
        why_this_card: `${p.card_name} gives ${(rate * 100).toFixed(1)}% equivalent on ${catKey}.`,
      };
    })
    .sort((a, b) => b.projected_value - a.projected_value || b.reward_rate - a.reward_rate);

  return {
    merchant: input.merchant,
    category: catKey,
    spend_assumption: spend,
    best: ranked[0] ?? null,
    ranked,
  };
}

export async function getAnnualFeeRoi(userIds: string[]) {
  const profiles = await listCreditCardRewardsProfiles(userIds);
  const txs = (await listTransactions(userIds, { limit: 5000 })) as {
    plaid_account_id: string | null;
    amount: number;
    trans_date: string;
    merchant_name: string | null;
    category: string[] | null;
  }[];

  const cards = profiles.map((profile) => {
    const window = cardmemberYearWindow(profile.cardmember_year_start_month, profile.cardmember_year_start_day);
    const cardTx = txs.filter((t) => {
      if (!t.plaid_account_id || t.plaid_account_id !== profile.plaid_account_id) return false;
      return t.trans_date >= window.start && t.trans_date <= window.end;
    });

    let rewardsEarnedValue = 0;
    let statementCreditsValue = 0;
    for (const tx of cardTx) {
      const amt = asNum(tx.amount, 0);
      if (amt > 0) {
        const catKey = categoryKeyForRecommendation(tx.merchant_name ?? "", (tx.category ?? []).join(" "));
        rewardsEarnedValue += amt * profileRateForCategory(profile, catKey);
      } else {
        const merchant = normalizeText(tx.merchant_name);
        if (merchant.includes("credit") || merchant.includes("reward")) {
          statementCreditsValue += Math.abs(amt);
        }
      }
    }
    const estimatedIssuerCredits = (profile.issuer_credits ?? []).reduce((s, c) => s + asNum(c.amount, 0), 0);
    const earnedValue = rewardsEarnedValue + statementCreditsValue + estimatedIssuerCredits;
    const annualFee = asNum(profile.annual_fee, 0);
    const netValue = earnedValue - annualFee;
    return {
      plaid_account_id: profile.plaid_account_id,
      card_name: profile.card_name,
      annual_fee: Number(annualFee.toFixed(2)),
      rewards_earned_value: Number(rewardsEarnedValue.toFixed(2)),
      statement_credits_value: Number(statementCreditsValue.toFixed(2)),
      estimated_issuer_credits: Number(estimatedIssuerCredits.toFixed(2)),
      earned_value: Number(earnedValue.toFixed(2)),
      net_value: Number(netValue.toFixed(2)),
      breakeven: netValue >= 0,
      period_start: window.start,
      period_end: window.end,
      enrichment_status: profile.enrichment_status,
    };
  });

  return { cards };
}

export async function getCreditCardsSnapshot(userIds: string[]) {
  if (userIds.length === 0) {
    return { accounts: [], spending: [], cardPayments: [], refunds: [], subscriptions: [] };
  }
  const sb = getDb();
  const { data: rawAccounts, error } = await sb
    .from("linked_accounts")
    .select("plaid_account_id,name,mask,type,subtype,balance_current,balance_available")
    .in("user_id", userIds);
  if (error) throw error;
  const accounts = ((rawAccounts ?? []) as AccountRow[]).filter(isCreditAccount);
  const cardIds = new Set(accounts.map((a) => a.plaid_account_id));

  const txs = (await listTransactions(userIds, { limit: 5000 })) as {
    id: string;
    plaid_transaction_id: string;
    plaid_account_id: string | null;
    merchant_name: string | null;
    amount: number;
    trans_date: string;
    category: string[] | null;
  }[];

  const cardTx = txs.filter((t) => t.plaid_account_id && cardIds.has(t.plaid_account_id));
  const spending = cardTx.filter((t) => Number(t.amount) > 0).slice(0, 200);
  const cardPayments = cardTx
    .filter((t) => Number(t.amount) < 0 && isCardPaymentLike(t))
    .slice(0, 100);
  const refunds = cardTx.filter(isRefundLikeTx).slice(0, 200);

  const subscriptions = await getSubscriptions(userIds);
  return { accounts, spending, cardPayments, refunds, subscriptions };
}

export async function getInvestmentsSnapshot(userIds: string[]) {
  if (userIds.length === 0) {
    return { checkingSavingsCd: [], wealthAndRetirement: [], totals: { cashLike: 0, investments: 0 } };
  }
  const sb = getDb();
  const { data, error } = await sb
    .from("linked_accounts")
    .select("plaid_account_id,name,mask,type,subtype,balance_current,balance_available")
    .in("user_id", userIds);
  if (error) throw error;
  const rows = (data ?? []) as AccountRow[];

  const checkingSavingsCd = rows.filter((a) => {
    const t = asLower(a.type);
    const st = asLower(a.subtype);
    return t === "depository" && (st.includes("checking") || st.includes("savings") || st.includes("cd"));
  });

  const wealthAndRetirement = rows.filter((a) => {
    const t = asLower(a.type);
    const st = asLower(a.subtype);
    const name = asLower(a.name);
    return (
      t === "investment" ||
      st.includes("brokerage") ||
      st.includes("ira") ||
      st.includes("401k") ||
      name.includes("retirement") ||
      name.includes("wealth")
    );
  });

  const cashLike = checkingSavingsCd.reduce(
    (s, a) => s + Number(a.balance_current ?? a.balance_available ?? 0),
    0
  );
  const investments = wealthAndRetirement.reduce(
    (s, a) => s + Number(a.balance_current ?? a.balance_available ?? 0),
    0
  );

  return {
    checkingSavingsCd,
    wealthAndRetirement,
    totals: { cashLike, investments },
  };
}

export async function getMortgageSnapshot(userIds: string[]) {
  if (userIds.length === 0) {
    return { mortgageAccounts: [], autoLoanAccounts: [], escrowAi: null };
  }
  const sb = getDb();
  const { data, error } = await sb
    .from("linked_accounts")
    .select("plaid_account_id,name,mask,type,subtype,balance_current,balance_available")
    .in("user_id", userIds);
  if (error) throw error;
  const rows = (data ?? []) as AccountRow[];

  const isLoanLike = (a: AccountRow): boolean => {
    const t = asLower(a.type);
    const st = asLower(a.subtype);
    return t === "loan" || st.includes("loan") || st.includes("mortgage");
  };

  const mortgageAccounts = rows.filter((a) => {
    if (!isLoanLike(a)) return false;
    const st = asLower(a.subtype);
    const n = asLower(a.name);
    return st.includes("mortgage") || n.includes("mortgage") || n.includes("escrow");
  });
  const autoLoanAccounts = rows.filter((a) => {
    if (!isLoanLike(a)) return false;
    const st = asLower(a.subtype);
    const n = asLower(a.name);
    return st.includes("auto") || st.includes("car") || n.includes("auto loan") || n.includes("car loan");
  });

  const { data: escrowAi } = await sb
    .from("ai_outputs")
    .select("*")
    .in("user_id", userIds)
    .eq("output_family", "escrow")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { mortgageAccounts, autoLoanAccounts, escrowAi: escrowAi ?? null };
}

export async function listRefundTracker(userIds: string[]) {
  if (userIds.length === 0) return [];
  const snapshot = await getCreditCardsSnapshot(userIds);
  const sb = getDb();

  const tableExists = async () => {
    try {
      const { error } = await sb.from("refund_events").select("id").limit(1);
      if (error) {
        const msg = String((error as { message?: string }).message ?? "");
        if (msg.includes("Could not find the table")) return false;
        throw error;
      }
      return true;
    } catch {
      return false;
    }
  };

  if (!(await tableExists())) return [];

  for (const tx of snapshot.refunds as {
    id: string;
    plaid_transaction_id: string;
    plaid_account_id: string | null;
    merchant_name: string | null;
    amount: number;
    trans_date: string;
    user_id?: string;
  }[]) {
    const merchant = asLower(tx.merchant_name);
    const status = merchant.includes("pending") ? "pending" : "manual";
    const { error } = await sb.from("refund_events").upsert(
      {
        user_id: tx.user_id ?? userIds[0],
        transaction_id: tx.id,
        plaid_transaction_id: tx.plaid_transaction_id,
        plaid_account_id: tx.plaid_account_id,
        merchant_name: tx.merchant_name,
        amount: Number(tx.amount),
        trans_date: tx.trans_date,
        status,
      },
      { onConflict: "user_id,plaid_transaction_id" }
    );
    if (error) throw error;
  }

  const { data, error } = await sb
    .from("refund_events")
    .select("*")
    .in("user_id", userIds)
    .order("trans_date", { ascending: false })
    .limit(300);
  if (error) throw error;
  return data ?? [];
}

export async function setRefundEventStatus(userId: string, id: string, status: string) {
  const sb = getDb();
  const { error: probeErr } = await sb.from("refund_events").select("id").limit(1);
  if (probeErr) {
    const msg = String((probeErr as { message?: string }).message ?? "");
    if (msg.includes("Could not find the table")) {
      throw new Error("refund_events table is missing. Apply latest Supabase migrations first.");
    }
  }
  const { data, error } = await sb
    .from("refund_events")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setRecurringPreference(
  userId: string,
  body: { plaid_transaction_id: string; isRecurring: boolean }
) {
  const sb = getDb();
  const { data: tx, error: txErr } = await sb
    .from("transactions")
    .select("merchant_name")
    .eq("user_id", userId)
    .eq("plaid_transaction_id", body.plaid_transaction_id)
    .maybeSingle();
  if (txErr) throw txErr;
  if (!tx) throw new Error("Transaction not found.");

  const merchant = canonicalMerchantName((tx as { merchant_name?: string | null }).merchant_name ?? null);
  const merchantKey = normalizeText(merchant);
  if (!merchantKey) throw new Error("Transaction merchant unavailable.");

  const { data: existing, error: existingErr } = await sb
    .from("subscriptions")
    .select("id, raw")
    .eq("user_id", userId)
    .eq("name", merchant)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing?.id) {
    const currentRaw = (existing.raw ?? {}) as Record<string, unknown>;
    const { error: updErr } = await sb
      .from("subscriptions")
      .update({
        raw: {
          ...currentRaw,
          merchant_key: merchantKey,
          force_recurring: body.isRecurring,
          override_source: "user",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (updErr) throw updErr;
  } else {
    const { error: insErr } = await sb.from("subscriptions").insert({
      user_id: userId,
      name: merchant,
      merchant_name: merchant,
      amount: null,
      frequency: "monthly",
      next_payment_date: null,
      raw: {
        merchant_key: merchantKey,
        force_recurring: body.isRecurring,
        override_source: "user",
      },
    });
    if (insErr) throw insErr;
  }
  return { ok: true };
}
