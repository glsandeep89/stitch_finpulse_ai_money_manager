import { getDb } from "../services/db/supabase.js";
import { syncTransactionsForUser } from "../services/plaid/plaidService.js";

/** Sync transactions for all users that have linked SimpleFIN / legacy provider items (cron). */
export async function syncTransactionsAllUsers() {
  const sb = getDb();
  const { data: userIds, error } = await sb
    .from("plaid_items")
    .select("user_id")
    .order("user_id");

  if (error) throw error;
  const unique = [...new Set((userIds ?? []).map((r) => r.user_id as string))];
  const results: { user_id: string; result: unknown }[] = [];

  for (const userId of unique) {
    try {
      const result = await syncTransactionsForUser(userId);
      results.push({ user_id: userId, result });
    } catch (e) {
      results.push({ user_id: userId, result: { error: String(e) } });
    }
  }

  return { users: unique.length, results };
}
