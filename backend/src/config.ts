import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || "development",
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  plaidClientId: process.env.PLAID_CLIENT_ID,
  plaidSecret: process.env.PLAID_SECRET,
  plaidEnv: (process.env.PLAID_ENV || "sandbox") as "sandbox" | "development" | "production",
  geminiApiKey: process.env.GEMINI_API_KEY,
  /** Google AI Studio model id (e.g. gemini-2.0-flash). */
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  cronSecret: process.env.CRON_SECRET,
  finpulseApiKey: process.env.FINPULSE_API_KEY,
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
};
