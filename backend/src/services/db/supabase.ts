import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config, requireEnv } from "../../config.js";

/** App tables live here (not `public`). Must match migration + Supabase “Exposed schemas”. */
export const DB_SCHEMA = process.env.SUPABASE_DB_SCHEMA || "finpulse";

let client: SupabaseClient | null = null;

export function getSupabaseService(): SupabaseClient {
  if (!client) {
    const url = config.supabaseUrl ?? requireEnv("SUPABASE_URL");
    const key = config.supabaseServiceRoleKey ?? requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** All FinPulse table queries use the `finpulse` schema (or SUPABASE_DB_SCHEMA). */
export function getDb() {
  return getSupabaseService().schema(DB_SCHEMA);
}
