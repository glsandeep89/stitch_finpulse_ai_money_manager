import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  console.warn("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — auth disabled until configured.");
}

export const supabase = createClient(url || "http://localhost", anon || "x");
