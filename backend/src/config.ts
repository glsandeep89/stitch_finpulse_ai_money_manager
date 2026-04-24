import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });
dotenv.config({ path: path.resolve(process.cwd(), "../.env.local"), override: true });

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

/** Strip trailing slashes so CORS matches browser Origin (no trailing slash). */
export function normalizeSiteOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || "development",
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  /** Optional override for where users create SimpleFIN setup tokens (defaults to public Bridge URL). */
  simplefinBridgeSignupUrl: process.env.SIMPLEFIN_BRIDGE_SIGNUP_URL,
  geminiApiKey: process.env.GEMINI_API_KEY,
  /** Google AI Studio model id (e.g. gemini-2.0-flash). */
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  cronSecret: process.env.CRON_SECRET,
  finpulseApiKey: process.env.FINPULSE_API_KEY,
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  frontendUrls: String(
    process.env.FRONTEND_URLS ||
      process.env.FRONTEND_URL ||
      "http://localhost:5173,http://127.0.0.1:5173"
  )
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map(normalizeSiteOrigin),
  /** When true, uses local reward catalog fallback for card enrichment. Keep false for live-only behavior. */
  enableRewardsCatalogFallback: String(process.env.ENABLE_REWARDS_CATALOG_FALLBACK || "false").toLowerCase() === "true",
};
