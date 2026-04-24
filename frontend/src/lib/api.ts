/**
 * Prefer API URL injected into `index.html` at build time so a stale PWA cache cannot
 * keep an old `import.meta.env` bundle pointing at localhost.
 */
export function getApiBase(): string {
  if (typeof window !== "undefined") {
    const w = window.__FINPULSE_API_BASE__;
    if (typeof w === "string" && /^https?:\/\//.test(w)) return w.replace(/\/+$/, "");
  }
  const raw = import.meta.env.VITE_API_URL || "http://localhost:3001";
  return raw.replace(/\/+$/, "");
}

export type FinpulseScope = "me" | "household";

let apiScope: FinpulseScope = "me";
try {
  const s = sessionStorage.getItem("finpulse-scope");
  if (s === "household" || s === "me") apiScope = s;
} catch {
  /* ignore */
}

export function setFinpulseApiScope(s: FinpulseScope) {
  apiScope = s;
}

export function getFinpulseApiScope(): FinpulseScope {
  return apiScope;
}

export async function api<T = unknown>(
  path: string,
  opts: RequestInit & { accessToken?: string } = {}
): Promise<T> {
  const headers = new Headers(opts.headers);
  headers.set("Content-Type", "application/json");
  if (opts.accessToken) {
    headers.set("Authorization", `Bearer ${opts.accessToken}`);
  }
  if (apiScope === "household") {
    headers.set("X-Finpulse-Scope", "household");
  }
  const r = await fetch(`${getApiBase()}${path}`, { ...opts, headers });
  const text = await r.text();
  if (!r.ok) {
    let detail = text || r.statusText || "Unknown error";
    try {
      const j = JSON.parse(text) as { error?: string; message?: string };
      if (typeof j.error === "string" && j.error.trim()) detail = j.error;
      else if (typeof j.message === "string" && j.message.trim()) detail = j.message;
    } catch {
      /* keep raw */
    }
    const generic = /^Request failed with status code \d+$/i.test(detail.trim());
    if (generic) {
      detail = [
        "The server returned a generic HTTP error (no FinPulse JSON body).",
        "Confirm DevTools → Network → the failing request URL matches your API (not the static site),",
        "rebuild the web app with VITE_API_URL, and redeploy the API so it matches this repo (SimpleFIN).",
      ].join(" ");
    }
    throw new Error(`${r.status}: ${detail}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}
