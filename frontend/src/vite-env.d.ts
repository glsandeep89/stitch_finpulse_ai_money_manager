/// <reference types="vite/client" />

/** Set in production `index.html` at build time (see vite.config.ts). */
interface Window {
  __FINPULSE_API_BASE__?: string;
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
