import { CountryCode, Products, type AccountBase, type Transaction } from "plaid";
import { plaidClient } from "./plaidClient.js";
import { getDb } from "../db/supabase.js";

const PRODUCTS = [Products.Transactions, Products.Identity];

export async function createLinkToken(userId: string, redirectUri?: string) {
  const res = await plaidClient.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "FinPulse",
    products: PRODUCTS,
    country_codes: [CountryCode.Us],
    language: "en",
    redirect_uri: redirectUri,
  });
  return { link_token: res.data.link_token, expiration: res.data.expiration };
}

export async function exchangePublicToken(userId: string, publicToken: string) {
  const ex = await plaidClient.itemPublicTokenExchange({
    public_token: publicToken,
  });
  const accessToken = ex.data.access_token;
  const itemId = ex.data.item_id;

  const sb = getDb();
  const { data: itemRow, error: itemErr } = await sb
    .from("plaid_items")
    .upsert(
      {
        user_id: userId,
        item_id: itemId,
        access_token: accessToken,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,item_id" }
    )
    .select("id")
    .single();

  if (itemErr) throw itemErr;

  const plaidItemUuid = itemRow!.id as string;

  const accountsRes = await plaidClient.accountsGet({ access_token: accessToken });
  const accounts = accountsRes.data.accounts;

  for (const a of accounts) {
    await upsertLinkedAccount(userId, plaidItemUuid, itemId, a);
  }

  return { item_id: itemId, accounts_synced: accounts.length };
}

async function upsertLinkedAccount(
  userId: string,
  plaidItemUuid: string,
  itemId: string,
  account: AccountBase
) {
  const sb = getDb();
  const row = {
    user_id: userId,
    plaid_item_id: plaidItemUuid,
    plaid_account_id: account.account_id,
    name: account.name,
    mask: account.mask ?? null,
    type: account.type,
    subtype: account.subtype ?? null,
    balance_current: account.balances.current ?? null,
    balance_available: account.balances.available ?? null,
    iso_currency_code: account.balances.iso_currency_code ?? null,
    raw: account as unknown as Record<string, unknown>,
  };

  const { error } = await sb.from("linked_accounts").upsert(row, {
    onConflict: "user_id,plaid_account_id",
  });
  if (error) throw error;
}

export async function refreshAccountsFromPlaid(userId: string) {
  const sb = getDb();
  const { data: items, error } = await sb
    .from("plaid_items")
    .select("id, item_id, access_token")
    .eq("user_id", userId);

  if (error) throw error;
  if (!items?.length) return { accounts: [] as Record<string, unknown>[] };

  const all: Record<string, unknown>[] = [];
  for (const item of items) {
    const res = await plaidClient.accountsGet({
      access_token: item.access_token as string,
    });
    for (const a of res.data.accounts) {
      await upsertLinkedAccount(
        userId,
        item.id as string,
        item.item_id as string,
        a
      );
      all.push(a as unknown as Record<string, unknown>);
    }
  }

  const { data: dbAccounts } = await sb
    .from("linked_accounts")
    .select("*")
    .eq("user_id", userId);

  return { accounts: dbAccounts ?? [] };
}

export async function syncTransactionsForUser(userId: string) {
  const sb = getDb();
  const { data: items, error } = await sb
    .from("plaid_items")
    .select("id, item_id, access_token, transactions_cursor")
    .eq("user_id", userId);

  if (error) throw error;
  if (!items?.length) return { added: 0, modified: 0, removed: 0 };

  let totalAdded = 0;
  let totalModified = 0;
  let totalRemoved = 0;

  const accountMap = await loadAccountMap(userId);

  for (const item of items) {
    let cursor = (item.transactions_cursor as string | null) ?? undefined;
    let hasMore = true;

    while (hasMore) {
      const res = await plaidClient.transactionsSync({
        access_token: item.access_token as string,
        cursor: cursor ?? undefined,
        count: 200,
      });

      const d = res.data;
      hasMore = d.has_more;
      cursor = d.next_cursor;

      for (const t of d.added) {
        await upsertTransaction(userId, accountMap, t, item.id as string);
        totalAdded++;
      }
      for (const t of d.modified) {
        await upsertTransaction(userId, accountMap, t, item.id as string);
        totalModified++;
      }
      for (const r of d.removed) {
        await sb
          .from("transactions")
          .delete()
          .eq("user_id", userId)
          .eq("plaid_transaction_id", r.transaction_id);
        totalRemoved++;
      }
    }

    await sb
      .from("plaid_items")
      .update({
        transactions_cursor: cursor,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
  }

  return { added: totalAdded, modified: totalModified, removed: totalRemoved };
}

async function loadAccountMap(
  userId: string
): Promise<Map<string, string>> {
  const sb = getDb();
  const { data } = await sb
    .from("linked_accounts")
    .select("id, plaid_account_id")
    .eq("user_id", userId);

  const m = new Map<string, string>();
  for (const row of data ?? []) {
    m.set(row.plaid_account_id as string, row.id as string);
  }
  return m;
}

async function upsertTransaction(
  userId: string,
  accountMap: Map<string, string>,
  t: Transaction,
  plaidItemUuid: string
) {
  const sb = getDb();
  const linkedId =
    accountMap.get(t.account_id) ??
    (await ensureAccountLinked(userId, plaidItemUuid, t.account_id));

  const category = t.category?.length
    ? t.category
    : t.personal_finance_category?.detailed
      ? [t.personal_finance_category.primary, t.personal_finance_category.detailed]
      : null;

  const row = {
    user_id: userId,
    linked_account_id: linkedId,
    plaid_transaction_id: t.transaction_id,
    plaid_account_id: t.account_id,
    amount: t.amount,
    trans_date: t.date,
    authorized_date: t.authorized_date ?? null,
    merchant_name: t.merchant_name ?? t.name ?? null,
    merchant_entity_id: t.merchant_entity_id ?? null,
    category,
    pending: t.pending ?? false,
    payment_channel: t.payment_channel ?? null,
    raw: t as unknown as Record<string, unknown>,
  };

  const { error } = await sb.from("transactions").upsert(row, {
    onConflict: "user_id,plaid_transaction_id",
  });
  if (error) throw error;
}

async function ensureAccountLinked(
  userId: string,
  plaidItemUuid: string,
  plaidAccountId: string
): Promise<string | null> {
  const sb = getDb();
  const { data: item } = await sb
    .from("plaid_items")
    .select("item_id, access_token")
    .eq("id", plaidItemUuid)
    .single();

  if (!item) return null;

  const res = await plaidClient.accountsGet({
    access_token: item.access_token as string,
  });
  const acc = res.data.accounts.find((a) => a.account_id === plaidAccountId);
  if (!acc) return null;

  await upsertLinkedAccount(
    userId,
    plaidItemUuid,
    item.item_id as string,
    acc
  );

  const { data: row } = await sb
    .from("linked_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("plaid_account_id", plaidAccountId)
    .single();

  return (row?.id as string) ?? null;
}

export async function getIdentityForUser(userId: string) {
  const sb = getDb();
  const { data: items } = await sb
    .from("plaid_items")
    .select("access_token")
    .eq("user_id", userId)
    .limit(1);

  if (!items?.length) return { identity: null as unknown };
  const access_token = items[0].access_token as string;
  const res = await plaidClient.identityGet({ access_token });
  return res.data;
}

export async function getInvestmentsForUser(userId: string) {
  const sb = getDb();
  const { data: items } = await sb
    .from("plaid_items")
    .select("access_token")
    .eq("user_id", userId)
    .limit(1);

  if (!items?.length) {
    return { holdings: [], message: "No linked items" };
  }

  try {
    const access_token = items[0].access_token as string;
    const holdings = await plaidClient.investmentsHoldingsGet({ access_token });
    return holdings.data;
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error_code?: string } } };
    if (err.response?.data?.error_code === "PRODUCTS_NOT_SUPPORTED") {
      return { holdings: [], message: "Investments not enabled for this item" };
    }
    throw e;
  }
}

export async function listPlaidItemsForUser(userId: string) {
  const sb = getDb();
  const { data: items, error } = await sb
    .from("plaid_items")
    .select("id,item_id,created_at,updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const ids = (items ?? []).map((i) => i.id as string);
  if (ids.length === 0) return [];

  const { data: accounts, error: accErr } = await sb
    .from("linked_accounts")
    .select("plaid_item_id,name,mask")
    .eq("user_id", userId)
    .in("plaid_item_id", ids);
  if (accErr) throw accErr;

  const grouped = new Map<string, { name: string | null; mask: string | null }[]>();
  for (const row of accounts ?? []) {
    const k = row.plaid_item_id as string;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push({
      name: (row.name as string | null) ?? null,
      mask: (row.mask as string | null) ?? null,
    });
  }

  return (items ?? []).map((item) => ({
    id: item.id,
    item_id: item.item_id,
    created_at: item.created_at,
    updated_at: item.updated_at,
    accounts: grouped.get(item.id as string) ?? [],
  }));
}

export async function unlinkPlaidItemForUser(
  userId: string,
  plaidItemId: string,
  deleteHistory: boolean
) {
  const sb = getDb();
  const { data: item, error } = await sb
    .from("plaid_items")
    .select("id, access_token")
    .eq("id", plaidItemId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!item) throw new Error("Linked item not found.");

  const { data: accounts, error: accErr } = await sb
    .from("linked_accounts")
    .select("id, plaid_account_id")
    .eq("user_id", userId)
    .eq("plaid_item_id", plaidItemId);
  if (accErr) throw accErr;
  const linkedAccountIds = (accounts ?? []).map((a) => a.id as string);
  const plaidAccountIds = (accounts ?? []).map((a) => a.plaid_account_id as string);

  if (deleteHistory && linkedAccountIds.length > 0) {
    const { error: txErr } = await sb
      .from("transactions")
      .delete()
      .eq("user_id", userId)
      .in("linked_account_id", linkedAccountIds);
    if (txErr) throw txErr;

    if (plaidAccountIds.length > 0) {
      const { error: refundErr } = await sb
        .from("refund_events")
        .delete()
        .eq("user_id", userId)
        .in("plaid_account_id", plaidAccountIds);
      const refundMsg = String((refundErr as { message?: string } | null)?.message ?? "");
      if (refundErr && !refundMsg.includes("Could not find the table")) throw refundErr;

      const { error: rewardsErr } = await sb
        .from("credit_card_rewards_profiles")
        .delete()
        .eq("user_id", userId)
        .in("plaid_account_id", plaidAccountIds);
      const rewardsMsg = String((rewardsErr as { message?: string } | null)?.message ?? "");
      if (rewardsErr && !rewardsMsg.includes("Could not find the table")) throw rewardsErr;
    }

    // Recurring subscriptions are derived from transaction history; reset to regenerate from remaining items.
    const { error: subsErr } = await sb.from("subscriptions").delete().eq("user_id", userId);
    if (subsErr) throw subsErr;
  }

  const { error: delErr } = await sb
    .from("plaid_items")
    .delete()
    .eq("id", plaidItemId)
    .eq("user_id", userId);
  if (delErr) throw delErr;

  try {
    await plaidClient.itemRemove({ access_token: item.access_token as string });
  } catch {
    // Ignore Plaid-side revoke failures after local unlink succeeds.
  }

  return { ok: true, deletedHistory: deleteHistory };
}
