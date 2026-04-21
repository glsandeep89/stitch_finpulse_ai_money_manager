import { getDb } from "../services/db/supabase.js";

export async function computeAndStoreNetWorth(userId: string) {
  const sb = getDb();
  const { data: accounts, error } = await sb
    .from("linked_accounts")
    .select("type, subtype, balance_current, balance_available")
    .eq("user_id", userId);

  if (error) throw error;

  let liquid = 0;
  let investments = 0;
  let other = 0;

  for (const a of accounts ?? []) {
    const bal = Number(a.balance_current ?? a.balance_available ?? 0);
    const t = (a.type as string)?.toLowerCase() ?? "";
    if (t === "depository") liquid += bal;
    else if (t === "investment" || t === "brokerage") investments += bal;
    else other += bal;
  }

  const total_net_worth = liquid + investments + other;

  const { data, error: insErr } = await sb
    .from("networth_snapshots")
    .insert({
      user_id: userId,
      as_of: new Date().toISOString(),
      total_net_worth,
      liquid_assets: liquid,
      investments,
      breakdown: { other, account_count: accounts?.length ?? 0 },
    })
    .select()
    .single();

  if (insErr) throw insErr;
  return data;
}
