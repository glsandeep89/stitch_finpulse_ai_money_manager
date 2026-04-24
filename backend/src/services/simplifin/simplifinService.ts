/**
 * Financial aggregation via SimpleFIN Bridge (https://bridge.simplefin.org).
 * Express still mounts these handlers at legacy `/plaid/*`; DB columns keep `plaid_*` names.
 */
import crypto from "crypto";
import { getDb } from "../db/supabase.js";
import { config } from "../../config.js";
import {
  connectionLabel,
  inferPlaidStyleAccountType,
  type SimplefinConnection,
} from "./simplifinAccountClassification.js";

const DEFAULT_SIGNUP_URL = "https://bridge.simplefin.org/simplefin/create";

type SimplefinTx = {
  id?: string;
  posted?: number | string;
  amount?: number | string;
  description?: string;
  pending?: boolean;
};

type SimplefinAccount = {
  id?: string;
  name?: string;
  /** v2: links to Account Set `connections` */
  conn_id?: string;
  org?: { id?: string; name?: string };
  currency?: string;
  balance?: number | string;
  "available-balance"?: number | string;
  "balance-date"?: number | string;
  transactions?: SimplefinTx[];
  errlist?: unknown[];
  extra?: Record<string, unknown>;
};

type SimplefinAccountsPayload = {
  accounts?: SimplefinAccount[];
  connections?: SimplefinConnection[];
  errors?: string[];
  errlist?: { code?: string; msg?: string }[];
};

/** Bridge rejects ranges over ~45 days (gen.api); use this as max seconds per request. */
const SIMPLEFIN_MAX_RANGE_SEC = 44 * 86400;

export function getSimplefinConnectInfo() {
  return {
    provider: "simplefin",
    /** Present on current API; missing on stale Plaid-only deployments. */
    connect_api_version: 2 as const,
    signup_url: config.simplefinBridgeSignupUrl || DEFAULT_SIGNUP_URL,
    help:
      "Open the signup URL, create a SimpleFIN setup token, paste it in FinPulse, then we exchange it once for a private access URL stored on your account.",
  };
}

function shaShort(...parts: string[]) {
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** SimpleFIN `GET /accounts?version=2` requires `start-date` / `end-date` as Unix epoch seconds (integer), not YYYY-MM-DD. */
function unixStartOfUtcDaySec(d: Date): string {
  return String(Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000));
}

/** Protocol: `end-date` is exclusive (transactions strictly before this instant). Use first second after UTC calendar day `d`. */
function unixExclusiveEndAfterUtcDaySec(d: Date): string {
  return String(Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000));
}

function parsePosted(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = Number(v);
      const ms = n > 1e12 ? n : n * 1000;
      return new Date(ms).toISOString().slice(0, 10);
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return ymd(new Date());
}

/** Trim BOM/quotes/newlines from claim/access URL bodies (Bridge returns plain text). */
function normalizeSfinUrl(text: string): string {
  let s = text.trim().replace(/^\uFEFF/, "").replace(/\r|\n/g, "");
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Same as SimpleFIN Bridge Python sample: split userinfo on first `:`, host/path on first `@`.
 * Fallback when `new URL()` fails or drops credentials for unusual encodings.
 */
function parseSfinAccessPythonStyle(accessUrl: string): { baseUrl: string; user: string; pass: string } | null {
  const raw = normalizeSfinUrl(accessUrl);
  const schemeSep = raw.indexOf("//");
  if (schemeSep < 0) return null;
  const scheme = raw.slice(0, schemeSep + 2);
  const afterScheme = raw.slice(schemeSep + 2);
  const at = afterScheme.indexOf("@");
  if (at < 0) return null;
  const auth = afterScheme.slice(0, at);
  const hostPath = afterScheme.slice(at + 1);
  const colon = auth.indexOf(":");
  if (colon < 0) return null;
  const user = auth.slice(0, colon);
  const pass = auth.slice(colon + 1);
  if (!user || !pass) return null;
  const slash = hostPath.indexOf("/");
  const hostOnly = slash < 0 ? hostPath : hostPath.slice(0, slash);
  const pathSuffix = slash < 0 ? "" : hostPath.slice(slash).replace(/\/$/, "");
  const baseUrl = `${scheme}${hostOnly}${pathSuffix}`;
  return { baseUrl, user, pass };
}

/**
 * Split stored access URL into origin+path prefix and Basic credentials.
 * Prefer WHATWG `URL` (correct percent-decoding). Fall back to Python-style split on first `@` / first `:`
 * so passwords containing `:` match the Bridge developer guide sample.
 */
function parseSfinAccessForApi(accessUrl: string): { baseUrl: string; user: string; pass: string } {
  const raw = normalizeSfinUrl(accessUrl);
  try {
    const u = new URL(raw);
    const user = u.username;
    const pass = u.password;
    if (user && pass) {
      const pathPrefix = u.pathname.replace(/\/$/, "");
      const baseUrl = `${u.protocol}//${u.host}${pathPrefix}`;
      return { baseUrl, user, pass };
    }
  } catch {
    /* use fallback */
  }
  const fb = parseSfinAccessPythonStyle(accessUrl);
  if (fb) return fb;
  throw new Error("SimpleFIN access URL is missing credentials or could not be parsed.");
}

async function simplefinGetAccounts(
  accessUrl: string,
  query: Record<string, string | undefined>
): Promise<SimplefinAccountsPayload> {
  const { baseUrl, user, pass } = parseSfinAccessForApi(accessUrl);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== "") params.set(k, v);
  }
  const url = `${baseUrl}/accounts?${params.toString()}`;
  const basic = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
  const res = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Basic ${basic}` },
    redirect: "follow",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `SimpleFIN accounts request failed (${res.status})`);
  let payload: SimplefinAccountsPayload;
  try {
    payload = JSON.parse(text) as SimplefinAccountsPayload;
  } catch {
    throw new Error("SimpleFIN returned non-JSON from /accounts");
  }
  const errs = payload.errlist ?? [];
  const hasAccounts = (payload.accounts?.length ?? 0) > 0;
  if (errs.length && !hasAccounts) {
    let msg = errs.map((e) => e.msg ?? e.code ?? "?").join("; ");
    if (errs.some((e) => e.code === "gen.auth")) {
      msg +=
        " Setup tokens are one-time: create a fresh token in SimpleFIN Bridge, finish any bank login/MFA there, then paste again.";
    }
    throw new Error(msg || "SimpleFIN /accounts returned no accounts");
  }
  if (errs.length) {
    console.warn("SimpleFIN /accounts errlist (partial data)", errs);
  }
  return payload;
}

/** Split [rangeStart, rangeEnd] UTC calendar days into ≤44-day spans (SimpleFIN Bridge limit). */
async function simplefinForEachAccountChunk(
  accessUrl: string,
  rangeStart: Date,
  rangeEnd: Date,
  baseQuery: Record<string, string | undefined>,
  onChunk: (payload: SimplefinAccountsPayload) => Promise<void>
): Promise<void> {
  const endExclusive = Number(unixExclusiveEndAfterUtcDaySec(rangeEnd));
  let startSec = Number(unixStartOfUtcDaySec(rangeStart));
  while (startSec < endExclusive) {
    const chunkEnd = Math.min(startSec + SIMPLEFIN_MAX_RANGE_SEC, endExclusive);
    if (chunkEnd <= startSec) break;
    const payload = await simplefinGetAccounts(accessUrl, {
      ...baseQuery,
      "start-date": String(startSec),
      "end-date": String(chunkEnd),
    });
    await onChunk(payload);
    startSec = chunkEnd;
  }
}

export async function claimSimplefinSetupToken(setupTokenBase64: string): Promise<string> {
  const trimmed = setupTokenBase64.trim();
  let claimUrl: string;
  try {
    claimUrl = Buffer.from(trimmed, "base64").toString("utf8").trim();
  } catch {
    throw new Error("Invalid setup token (expected base64).");
  }
  if (!/^https?:\/\//i.test(claimUrl)) {
    throw new Error("Decoded setup token is not a valid claim URL.");
  }
  const res = await fetch(claimUrl, {
    method: "POST",
    headers: { "Content-Length": "0" },
    redirect: "follow",
  });
  const accessUrl = normalizeSfinUrl(await res.text());
  if (!res.ok) {
    throw new Error(accessUrl || `SimpleFIN claim failed (${res.status})`);
  }
  if (!/^https?:\/\//i.test(accessUrl)) {
    throw new Error("SimpleFIN claim did not return an access URL.");
  }
  return accessUrl;
}

function stableAccountId(acc: SimplefinAccount): string {
  const orgId = acc.org?.id ?? acc.org?.name ?? "org";
  if (acc.id && String(acc.id).trim()) return `sf_${String(acc.id).trim()}`;
  return `sf_${shaShort("acct", orgId, acc.name ?? "unnamed")}`;
}

function stableTxId(accountId: string, tx: SimplefinTx, idx: number): string {
  if (tx.id && String(tx.id).trim()) return `sf_${accountId}_${String(tx.id).trim()}`;
  const posted = String(tx.posted ?? "");
  const amt = String(tx.amount ?? "");
  const desc = String(tx.description ?? "");
  return `sf_${accountId}_${shaShort(posted, amt, desc, String(idx))}`;
}

function toNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

async function upsertLinkedFromSimplefin(
  userId: string,
  itemUuid: string,
  _itemKey: string,
  acc: SimplefinAccount,
  accountId: string,
  payload: SimplefinAccountsPayload | undefined
) {
  const sb = getDb();
  const bal = acc.balance != null ? toNumber(acc.balance) : null;
  const avail =
    acc["available-balance"] != null && acc["available-balance"] !== ""
      ? toNumber(acc["available-balance"])
      : null;
  const connHint =
    connectionLabel(payload?.connections, acc.conn_id) ?? acc.org?.name ?? acc.org?.id ?? null;
  const { type, subtype } = inferPlaidStyleAccountType(acc, { connectionLabel: connHint });
  const row = {
    user_id: userId,
    plaid_item_id: itemUuid,
    plaid_account_id: accountId,
    name: acc.name ?? "Account",
    mask: null,
    type,
    subtype,
    balance_current: bal,
    balance_available: avail,
    iso_currency_code: typeof acc.currency === "string" && acc.currency.length ? acc.currency : "USD",
    raw: acc as unknown as Record<string, unknown>,
  };
  const { error } = await sb.from("linked_accounts").upsert(row, {
    onConflict: "user_id,plaid_account_id",
  });
  if (error) throw error;
}

type CursorState = { lastEnd?: string };

function parseCursor(raw: string | null | undefined): CursorState | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CursorState;
  } catch {
    return null;
  }
}

async function upsertTransactionsFromPayload(
  userId: string,
  itemUuid: string,
  itemKey: string,
  payload: SimplefinAccountsPayload
) {
  const sb = getDb();
  const accountMap = await loadAccountMap(userId);

  for (const acc of payload.accounts ?? []) {
    if (Array.isArray(acc.errlist) && acc.errlist.length) {
      console.warn("SimpleFIN account errlist", acc.name, acc.errlist);
    }
    const accountId = stableAccountId(acc);
    const linkedId =
      accountMap.get(accountId) ?? (await ensureAccountLinked(userId, itemUuid, itemKey, accountId, acc, payload));
    if (!linkedId) continue;

    const txs = acc.transactions ?? [];
    for (let i = 0; i < txs.length; i++) {
      const t = txs[i]!;
      const txId = stableTxId(accountId, t, i);
      const row = {
        user_id: userId,
        linked_account_id: linkedId,
        plaid_transaction_id: txId,
        plaid_account_id: accountId,
        amount: toNumber(t.amount),
        trans_date: parsePosted(t.posted),
        authorized_date: null,
        merchant_name: t.description ?? null,
        merchant_entity_id: null,
        category: null,
        pending: Boolean(t.pending),
        payment_channel: "other",
        raw: t as unknown as Record<string, unknown>,
      };
      const { error } = await sb.from("transactions").upsert(row, {
        onConflict: "user_id,plaid_transaction_id",
      });
      if (error) throw error;
    }
  }
}

/**
 * `publicToken` is the SimpleFIN **setup token** (base64) from the Bridge UI.
 */
export async function exchangePublicToken(userId: string, publicToken: string) {
  const accessUrl = await claimSimplefinSetupToken(publicToken);
  /** Same as beta guide `curl -L "${ACCESS_URL}/accounts?version=2"` — validates Basic auth before DB write. */
  await simplefinGetAccounts(accessUrl, { version: "2" });

  const itemKey = `simplefin-${crypto.randomUUID()}`;

  const sb = getDb();
  const { data: itemRow, error: itemErr } = await sb
    .from("plaid_items")
    .upsert(
      {
        user_id: userId,
        item_id: itemKey,
        access_token: accessUrl,
        transactions_cursor: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,item_id" }
    )
    .select("id")
    .single();

  if (itemErr) throw itemErr;
  const itemUuid = itemRow!.id as string;

  const end = new Date();
  const start = new Date(end.getTime() - 89 * 86400000);
  const seenAcct = new Set<string>();
  await simplefinForEachAccountChunk(
    accessUrl,
    start,
    end,
    { version: "2", pending: "1" },
    async (payload) => {
      for (const acc of payload.accounts ?? []) {
        const accountId = stableAccountId(acc);
        seenAcct.add(accountId);
        await upsertLinkedFromSimplefin(userId, itemUuid, itemKey, acc, accountId, payload);
      }
      await upsertTransactionsFromPayload(userId, itemUuid, itemKey, payload);
    }
  );
  const count = seenAcct.size;

  await sb
    .from("plaid_items")
    .update({
      transactions_cursor: JSON.stringify({ lastEnd: ymd(end) } satisfies CursorState),
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemUuid);

  return { item_id: itemKey, accounts_synced: count };
}

export async function refreshAccountsFromSimplifin(userId: string) {
  const sb = getDb();
  const { data: items, error } = await sb
    .from("plaid_items")
    .select("id, item_id, access_token")
    .eq("user_id", userId);

  if (error) throw error;
  if (!items?.length) return { accounts: [] as Record<string, unknown>[] };

  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86400000);

  for (const item of items) {
    const accessUrl = item.access_token as string;
    const payload = await simplefinGetAccounts(accessUrl, {
      version: "2",
      "start-date": unixStartOfUtcDaySec(start),
      "end-date": unixExclusiveEndAfterUtcDaySec(end),
    });
    for (const acc of payload.accounts ?? []) {
      const accountId = stableAccountId(acc);
      await upsertLinkedFromSimplefin(userId, item.id as string, item.item_id as string, acc, accountId, payload);
    }
  }

  const { data: dbAccounts } = await sb.from("linked_accounts").select("*").eq("user_id", userId);
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

  const end = new Date();
  const endStr = ymd(end);
  let added = 0;

  for (const item of items) {
    const accessUrl = item.access_token as string;
    const cur = parseCursor(item.transactions_cursor as string | null);
    let start = new Date(end.getTime() - 89 * 86400000);
    if (cur?.lastEnd) {
      const d = new Date(`${cur.lastEnd}T00:00:00.000Z`);
      if (!Number.isNaN(d.getTime())) {
        d.setUTCDate(d.getUTCDate() + 1);
        if (d < end) start = d;
      }
    }
    await simplefinForEachAccountChunk(
      accessUrl,
      start,
      end,
      { version: "2", pending: "1" },
      async (payload) => {
        await upsertTransactionsFromPayload(userId, item.id as string, item.item_id as string, payload);
        added += (payload.accounts ?? []).reduce((n, a) => n + (a.transactions?.length ?? 0), 0);
      }
    );

    await sb
      .from("plaid_items")
      .update({
        transactions_cursor: JSON.stringify({ lastEnd: endStr } satisfies CursorState),
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
  }

  return { added, modified: 0, removed: 0 };
}

async function loadAccountMap(userId: string): Promise<Map<string, string>> {
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

async function ensureAccountLinked(
  userId: string,
  itemUuid: string,
  _itemKey: string,
  accountId: string,
  acc: SimplefinAccount,
  payload: SimplefinAccountsPayload
): Promise<string | null> {
  await upsertLinkedFromSimplefin(userId, itemUuid, _itemKey, acc, accountId, payload);
  const sb = getDb();
  const { data: row } = await sb
    .from("linked_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("plaid_account_id", accountId)
    .single();
  return (row?.id as string) ?? null;
}

export async function getIdentityForUser(userId: string) {
  const sb = getDb();
  const { data: accounts } = await sb
    .from("linked_accounts")
    .select("name, subtype, plaid_account_id")
    .eq("user_id", userId)
    .limit(50);
  return {
    provider: "simplefin",
    accounts: accounts ?? [],
  };
}

export async function getInvestmentsForUser(userId: string) {
  void userId;
  return {
    holdings: [],
    securities: [],
    message: "Investment holdings are not available via SimpleFIN Bridge in FinPulse.",
  };
}

export async function listSimplifinItemsForUser(userId: string) {
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

export async function unlinkSimplifinItemForUser(userId: string, itemId: string) {
  const sb = getDb();
  const { data: item, error } = await sb
    .from("plaid_items")
    .select("id, access_token")
    .eq("id", itemId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!item) throw new Error("Linked item not found.");

  const { data: accounts, error: accErr } = await sb
    .from("linked_accounts")
    .select("id, plaid_account_id")
    .eq("user_id", userId)
    .eq("plaid_item_id", itemId);
  if (accErr) throw accErr;
  const linkedAccountIds = (accounts ?? []).map((a) => a.id as string);
  const accountIds = (accounts ?? []).map((a) => a.plaid_account_id as string);

  if (linkedAccountIds.length > 0) {
    const { error: txErr } = await sb
      .from("transactions")
      .delete()
      .eq("user_id", userId)
      .in("linked_account_id", linkedAccountIds);
    if (txErr) throw txErr;

    if (accountIds.length > 0) {
      const { error: refundErr } = await sb
        .from("refund_events")
        .delete()
        .eq("user_id", userId)
        .in("plaid_account_id", accountIds);
      const refundMsg = String((refundErr as { message?: string } | null)?.message ?? "");
      if (refundErr && !refundMsg.includes("Could not find the table")) throw refundErr;

      const { error: rewardsErr } = await sb
        .from("credit_card_rewards_profiles")
        .delete()
        .eq("user_id", userId)
        .in("plaid_account_id", accountIds);
      const rewardsMsg = String((rewardsErr as { message?: string } | null)?.message ?? "");
      if (rewardsErr && !rewardsMsg.includes("Could not find the table")) throw rewardsErr;
    }

    const { error: subsErr } = await sb.from("subscriptions").delete().eq("user_id", userId);
    if (subsErr) throw subsErr;
  }

  const { error: delErr } = await sb.from("plaid_items").delete().eq("id", itemId).eq("user_id", userId);
  if (delErr) throw delErr;

  return { ok: true, deletedHistory: true };
}
