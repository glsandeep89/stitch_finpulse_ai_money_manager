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

export async function listUserMerchantOverrides(userIds: string[]) {
  return userMerchantOverrides(userIds);
}

export async function createUserMerchantOverride(
  userId: string,
  body: { merchant_pattern: string; canonical_merchant: string; category_override?: string | null }
) {
  const sb = getDb();
  const normalizedPattern = normalizeText(body.merchant_pattern.trim());
  if (!normalizedPattern) {
    throw new Error("merchant_pattern is required and must contain matching text after normalization.");
  }
  const canonical = body.canonical_merchant.trim();
  if (!canonical) throw new Error("canonical_merchant is required.");
  const row = {
    user_id: userId,
    merchant_pattern: normalizedPattern,
    canonical_merchant: canonical,
    category_override: body.category_override?.trim() || null,
  };
  const { data, error } = await sb
    .from("user_merchant_overrides")
    .upsert(row, { onConflict: "user_id,merchant_pattern" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteUserMerchantOverride(userId: string, id: string) {
  const sb = getDb();
  const { error } = await sb.from("user_merchant_overrides").delete().eq("id", id).eq("user_id", userId);
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
  const categoryOverrides = await userMerchantCategoryOverrides(userIds);
  const merchantOverrides = await userMerchantOverrides(userIds);
  const merchantAliases = await merchantAliasesCatalog();
  let rows = (data ?? []).map((row) => {
    const rawMerchant = (row as { merchant_name?: string | null }).merchant_name ?? null;
    const merchantResolution = resolveCanonicalMerchant(rawMerchant, merchantAliases, merchantOverrides);
    const merchant = merchantResolution.canonical;
    let resolvedCategory: string | null = null;
    for (const [pattern, category] of categoryOverrides.entries()) {
      if (pattern && normalizeText(merchant).includes(pattern)) {
        resolvedCategory = category;
        break;
      }
    }
    if (!resolvedCategory && merchantResolution.categoryOverride) {
      resolvedCategory = merchantResolution.categoryOverride;
    }
    if (!resolvedCategory) {
      const firstNative = ((row as { category?: string[] | null }).category ?? [])[0] ?? null;
      const systemCategory = systemCategoryFromMerchant(merchant);
      resolvedCategory =
        systemCategory !== "Uncategorized"
          ? systemCategory
          : firstNative && firstNative.trim()
            ? firstNative
            : "Uncategorized";
    }
    return {
      ...row,
      raw_merchant_name: rawMerchant,
      merchant_name: merchant,
      category: [resolvedCategory],
      merchant_resolution_confidence: merchantResolution.confidence,
      merchant_resolution_source: merchantResolution.source,
      wallet_rail: merchantResolution.walletRail,
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
    plaid_account_id: string | null;
    category: string[] | null;
    amount: number;
    trans_date: string;
  }[];
  const { data: linkedAccounts } = await sb
    .from("linked_accounts")
    .select("user_id,plaid_account_id,name")
    .in("user_id", userIds);
  const accountNameMap = new Map<string, string>();
  for (const a of linkedAccounts ?? []) {
    const key = `${String(a.user_id)}::${String(a.plaid_account_id)}`;
    accountNameMap.set(key, String(a.name ?? "Account"));
  }

  const forcedRecurring = new Set<string>();
  const forcedExcluded = new Set<string>();
  for (const row of existing ?? []) {
    const raw = (row.raw ?? {}) as Record<string, unknown>;
    const k = normalizeText(String(raw.merchant_key ?? row.merchant_name ?? row.name ?? ""));
    if (!k) continue;
    if (raw.force_recurring === true) forcedRecurring.add(k);
    if (raw.force_recurring === false) forcedExcluded.add(k);
  }

  const byMerchant = new Map<
    string,
    {
      user_id: string;
      amounts: number[];
      dates: Date[];
      name: string;
      payment_account_name: string | null;
      payment_account_id: string | null;
      category: string | null;
    }
  >();
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
      payment_account_name: null as string | null,
      payment_account_id: null as string | null,
      category: null as string | null,
    };
    if (t.plaid_account_id) {
      cur.payment_account_id = t.plaid_account_id;
      cur.payment_account_name = accountNameMap.get(`${t.user_id}::${t.plaid_account_id}`) ?? null;
    }
    cur.category = ((t.category ?? [])[0] as string | undefined) ?? cur.category;
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
    let confidence = 0.35;
    if (group.dates.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < group.dates.length; i++) {
        gaps.push(Math.round((group.dates[i]!.getTime() - group.dates[i - 1]!.getTime()) / 86400000));
      }
      const mean = gaps.reduce((s, n) => s + n, 0) / gaps.length;
      const gapSpread = Math.max(...gaps) - Math.min(...gaps);
      if (mean <= 10) frequency = "weekly";
      else if (mean <= 20) frequency = "biweekly";
      else if (mean <= 40) frequency = "monthly";
      else frequency = "quarterly";
      confidence = group.dates.length >= 4 ? 0.9 : group.dates.length === 3 ? 0.7 : 0.55;
      if (gapSpread > 10) confidence -= 0.2;
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
        recurrence_confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(2)),
        needs_user_confirmation: !forcedRecurring.has(key) && group.dates.length < 3,
        payment_account_name: group.payment_account_name,
        payment_account_id: group.payment_account_id,
        category: group.category,
        force_recurring: forcedRecurring.has(key) ? true : forcedExcluded.has(key) ? false : null,
      },
    });
  }

  const existingByUser = new Map<string, Array<{ id: string; name: string | null; merchant_name: string | null; raw: Record<string, unknown> | null }>>();
  for (const row of (existing ?? []) as Array<{ user_id: string; id: string; name: string | null; merchant_name: string | null; raw: Record<string, unknown> | null }>) {
    const arr = existingByUser.get(row.user_id) ?? [];
    arr.push({ id: row.id, name: row.name, merchant_name: row.merchant_name, raw: row.raw ?? null });
    existingByUser.set(row.user_id, arr);
  }

  for (const row of inferred) {
    const dedupeKey = normalizeText(String((row.raw ?? {}).merchant_key ?? row.merchant_name ?? row.name ?? ""));
    const userRows = existingByUser.get(row.user_id) ?? [];
    const matches = userRows.filter((x) => {
      const key = normalizeText(String((x.raw ?? {}).merchant_key ?? x.merchant_name ?? x.name ?? ""));
      return key && key === dedupeKey;
    });
    const existingRow = matches[0] ?? null;
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
      if (matches.length > 1) {
        const duplicateIds = matches.slice(1).map((m) => m.id);
        if (duplicateIds.length > 0) {
          const { error: delErr } = await sb.from("subscriptions").delete().in("id", duplicateIds);
          if (delErr) throw delErr;
        }
      }
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
  const deduped = dedupeSubscriptionRows(
    (refreshed ?? []) as Array<{
      id: string;
      updated_at: string | null;
      name: string | null;
      merchant_name: string | null;
      amount: number | null;
      frequency: string | null;
      next_payment_date: string | null;
      raw: unknown;
    }>
  );
  return deduped as typeof refreshed;
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

function isIncomeLikeTx(t: { amount: number; category: string[] | null; merchant_name: string | null }): boolean {
  const cat = (t.category ?? []).join(" ").toLowerCase();
  const merchant = asLower(t.merchant_name);
  const amount = Number(t.amount);
  const incomeHint =
    /(payroll|paycheck|salary|direct deposit|deposit|income|bonus|interest|dividend|benefit|ssi|social security|tax refund|irs|treasury|ach credit|zelle in|venmo cashout)/.test(
      `${cat} ${merchant}`
    );
  if (!incomeHint) return false;
  // In this app, credits can appear as either sign depending on source feed conventions.
  return amount !== 0;
}

function isRefundLikeTx(t: { amount: number; category: string[] | null; merchant_name: string | null }): boolean {
  const cat = (t.category ?? []).join(" ").toLowerCase();
  const merchant = asLower(t.merchant_name);
  const amount = Number(t.amount);
  if (isCardPaymentLike(t)) return false;
  if (isIncomeLikeTx(t)) return false;
  if (amount >= 0) return false;
  const hasRefundSignal =
    cat.includes("refund") ||
    cat.includes("return") ||
    cat.includes("reversal") ||
    cat.includes("merchant credit") ||
    merchant.includes("refund") ||
    merchant.includes("return") ||
    merchant.includes("reversal");
  if (!hasRefundSignal) return false;
  // Exclude non-merchant/system credits even when category text is noisy.
  const looksSystemCredit = /(deposit|income|payroll|salary|payment|transfer|ach)/.test(`${cat} ${merchant}`);
  return !looksSystemCredit;
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
  { pattern: /\bcursor\b.*(ai\s*powered)?/i, replacement: "Cursor" },
  { pattern: /\b(sampay|samsung\s*pay)\b.*\bh[\s\-]*e[\s\-]*b\b/i, replacement: "H-E-B" },
  { pattern: /sampay\*?\s*doordash|doordash|door dash/i, replacement: "DoorDash" },
  { pattern: /sampay\*?\s*foodistaan|foodistaan/i, replacement: "Foodistaan" },
  { pattern: /signature\s*pest/i, replacement: "Signature Pest Management" },
  { pattern: /disney(\s*plus)?/i, replacement: "Disney+" },
  { pattern: /pedernales\s*electric/i, replacement: "Pedernales Electric Cooperative" },
  { pattern: /real\s*green\s*service|trugreen/i, replacement: "Real Green Service" },
  { pattern: /zee5/i, replacement: "ZEE5" },
  { pattern: /\boptimum\b/i, replacement: "Optimum" },
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

type MerchantAliasRow = {
  merchant_pattern: string;
  match_type: "exact" | "regex";
  canonical_merchant: string;
  default_category: string | null;
  priority: number | null;
};

type MerchantOverrideRow = {
  merchant_pattern: string;
  canonical_merchant: string;
  category_override: string | null;
};

type MerchantResolution = {
  canonical: string;
  confidence: number;
  source: "user_override" | "alias_exact" | "alias_regex" | "clean_rule" | "fallback";
  categoryOverride: string | null;
  walletRail: "Samsung Pay" | "Apple Pay" | "Google Pay" | null;
};

function extractWalletRail(rawMerchant: string): {
  cleanedMerchant: string;
  walletRail: MerchantResolution["walletRail"];
} {
  const source = String(rawMerchant ?? "").trim();
  const lower = source.toLowerCase();
  const railChecks: Array<{ pattern: RegExp; rail: MerchantResolution["walletRail"] }> = [
    { pattern: /\b(sampay|samsung\s*pay)\b/i, rail: "Samsung Pay" },
    { pattern: /\b(apple\s*pay)\b/i, rail: "Apple Pay" },
    { pattern: /\b(google\s*pay|gpay)\b/i, rail: "Google Pay" },
  ];
  for (const check of railChecks) {
    if (!check.pattern.test(lower)) continue;
    const cleaned = source.replace(check.pattern, " ").replace(/\s+/g, " ").trim();
    return { cleanedMerchant: cleaned || source, walletRail: check.rail };
  }
  return { cleanedMerchant: source, walletRail: null };
}

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
    .replace(/\b(tx|ca|ar|ny|nj|fl|il|oh|wa|pa|co)\b/gi, " ")
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
  if (/(disney|netflix|spotify|hulu|youtube|zee5|entertainment)/.test(m)) return "Entertainment & Recreation";
  if (/(home depot|lowes|ace hardware)/.test(m)) return "Home Improvements";
  if (/(real green|trugreen|signature pest|pest)/.test(m)) return "Home Improvements";
  if (/(walmart|target|costco|whole foods|trader joes|heb|h e b|kroger|grocery)/.test(m)) return "Groceries";
  if (/(shell|chevron|exxon|fuel|gas)/.test(m)) return "Auto Maintenance";
  if (/(verizon|att|t mobile|xfinity|spectrum|internet|phone)/.test(m)) return "Internet & Cable";
  if (/(pedernales electric|electric|utility|utilities|water|power)/.test(m)) return "Business Utilities & Communication";
  if (/(amazon|best buy|shopping|store|retail)/.test(m)) return "Shopping";
  if (/(payroll|paycheck|salary)/.test(m)) return "Paychecks";
  if (/(interest)/.test(m)) return "Interest";
  if (/(rent|mortgage)/.test(m)) return "Housing";
  return "Uncategorized";
}

async function merchantAliasesCatalog(): Promise<MerchantAliasRow[]> {
  const sb = getDb();
  const { data, error } = await sb
    .from("merchant_aliases")
    .select("merchant_pattern,match_type,canonical_merchant,default_category,priority")
    .eq("active", true)
    .order("priority", { ascending: true });
  if (error) {
    const msg = String((error as { message?: string }).message ?? "");
    if (msg.includes("Could not find the table")) return [];
    throw error;
  }
  return (data ?? []) as MerchantAliasRow[];
}

async function userMerchantOverrides(userIds: string[]): Promise<MerchantOverrideRow[]> {
  if (userIds.length === 0) return [];
  const sb = getDb();
  const { data, error } = await sb
    .from("user_merchant_overrides")
    .select("merchant_pattern,canonical_merchant,category_override")
    .in("user_id", userIds)
    .order("created_at", { ascending: false });
  if (error) {
    const msg = String((error as { message?: string }).message ?? "");
    if (msg.includes("Could not find the table")) return [];
    throw error;
  }
  return (data ?? []) as MerchantOverrideRow[];
}

function userOverrideMatches(normalizedRaw: string, pattern: string): boolean {
  if (!pattern) return false;
  if (normalizedRaw === pattern) return true;
  if (pattern.length < 4) return false;
  return normalizedRaw.includes(pattern);
}

function resolveCanonicalMerchant(
  rawMerchant: string | null | undefined,
  aliases: MerchantAliasRow[],
  overrides: MerchantOverrideRow[]
): MerchantResolution {
  const raw = String(rawMerchant ?? "");
  const { cleanedMerchant, walletRail } = extractWalletRail(raw);
  const normalizedRaw = normalizeText(cleanedMerchant);

  const sortedOverrides = [...overrides].sort((a, b) => {
    const la = normalizeText(a.merchant_pattern).length;
    const lb = normalizeText(b.merchant_pattern).length;
    return lb - la;
  });
  for (const row of sortedOverrides) {
    const pattern = normalizeText(row.merchant_pattern);
    if (!pattern) continue;
    if (userOverrideMatches(normalizedRaw, pattern)) {
      return {
        canonical: row.canonical_merchant.trim() || canonicalMerchantName(raw),
        confidence: 1,
        source: "user_override",
        categoryOverride: row.category_override ?? null,
        walletRail,
      };
    }
  }

  for (const row of aliases) {
    const pattern = normalizeText(row.merchant_pattern);
    if (!pattern || row.match_type !== "exact") continue;
    if (normalizedRaw === pattern || normalizedRaw.includes(pattern)) {
      return {
        canonical: row.canonical_merchant.trim() || canonicalMerchantName(raw),
        confidence: 0.96,
        source: "alias_exact",
        categoryOverride: row.default_category ?? null,
        walletRail,
      };
    }
  }

  for (const row of aliases) {
    if (row.match_type !== "regex") continue;
    try {
      const re = new RegExp(row.merchant_pattern, "i");
      if (!re.test(raw)) continue;
      return {
        canonical: row.canonical_merchant.trim() || canonicalMerchantName(raw),
        confidence: 0.9,
        source: "alias_regex",
        categoryOverride: row.default_category ?? null,
        walletRail,
      };
    } catch {
      continue;
    }
  }

  const cleaned = canonicalMerchantName(cleanedMerchant);
  for (const rule of MERCHANT_CLEAN_RULES) {
    if (rule.pattern.test(cleanedMerchant)) {
      return { canonical: cleaned, confidence: 0.82, source: "clean_rule", categoryOverride: null, walletRail };
    }
  }
  return { canonical: cleaned, confidence: 0.62, source: "fallback", categoryOverride: null, walletRail };
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

function subDedupeKey(row: { name?: string | null; merchant_name?: string | null; raw?: unknown }): string {
  const raw = (row.raw ?? {}) as Record<string, unknown>;
  return normalizeText(String(raw.merchant_key ?? row.merchant_name ?? row.name ?? ""));
}

function dedupeSubscriptionRows<
  T extends { id?: string; updated_at?: string | null; name?: string | null; merchant_name?: string | null; raw?: unknown }
>(rows: T[]): T[] {
  const bestByKey = new Map<string, T>();
  for (const row of rows) {
    const key = subDedupeKey(row);
    if (!key) continue;
    const prev = bestByKey.get(key);
    if (!prev) {
      bestByKey.set(key, row);
      continue;
    }
    const prevTs = Date.parse(String(prev.updated_at ?? ""));
    const currTs = Date.parse(String(row.updated_at ?? ""));
    const keepCurrent = (Number.isFinite(currTs) ? currTs : 0) >= (Number.isFinite(prevTs) ? prevTs : 0);
    if (keepCurrent) bestByKey.set(key, row);
  }
  return [...bestByKey.values()];
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

  const { data: existingEvents, error: existingErr } = await sb
    .from("refund_events")
    .select("id,user_id,plaid_transaction_id,status")
    .in("user_id", userIds);
  if (existingErr) throw existingErr;

  const existingStatus = new Map<string, string>();
  for (const row of existingEvents ?? []) {
    const plaidTxId = String((row as { plaid_transaction_id?: string }).plaid_transaction_id ?? "");
    const status = String((row as { status?: string }).status ?? "");
    if (plaidTxId) existingStatus.set(plaidTxId, status);
  }

  for (const tx of snapshot.refunds as {
    id: string;
    plaid_transaction_id: string;
    plaid_account_id: string | null;
    merchant_name: string | null;
    amount: number;
    trans_date: string;
    user_id?: string;
  }[]) {
    const status = existingStatus.get(tx.plaid_transaction_id) ?? "pending";
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

  const activeRefundIds = new Set(
    (snapshot.refunds as { plaid_transaction_id: string }[]).map((r) => r.plaid_transaction_id)
  );
  const staleEventIds = (existingEvents ?? [])
    .filter((row) => {
      const plaidTxId = String((row as { plaid_transaction_id?: string }).plaid_transaction_id ?? "");
      const status = String((row as { status?: string }).status ?? "");
      if (!plaidTxId || activeRefundIds.has(plaidTxId)) return false;
      // Keep explicit manual rows, remove stale auto-detected rows.
      return status !== "manual";
    })
    .map((row) => String((row as { id?: string }).id ?? ""))
    .filter(Boolean);
  if (staleEventIds.length > 0) {
    const { error: deleteErr } = await sb.from("refund_events").delete().in("id", staleEventIds);
    if (deleteErr) throw deleteErr;
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

export async function setRecurringMerchantPreference(
  userId: string,
  body: { merchant_key: string; isRecurring: boolean }
) {
  const sb = getDb();
  const merchantKey = normalizeText(body.merchant_key);
  if (!merchantKey) throw new Error("merchant_key is required.");

  const { data: existingRows, error: readErr } = await sb
    .from("subscriptions")
    .select("id, name, merchant_name, raw")
    .eq("user_id", userId);
  if (readErr) throw readErr;
  const matches = (existingRows ?? []).filter((row) => {
    const key = normalizeText(String(((row.raw ?? {}) as Record<string, unknown>).merchant_key ?? row.merchant_name ?? row.name ?? ""));
    return key === merchantKey;
  });
  if (matches.length === 0) throw new Error("Recurring merchant not found.");

  for (const row of matches) {
    const currentRaw = (row.raw ?? {}) as Record<string, unknown>;
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
      .eq("id", row.id);
    if (updErr) throw updErr;
  }
  return { ok: true };
}
