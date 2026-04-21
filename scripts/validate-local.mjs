/**
 * Quick local checks: API /health and optional frontend root (default port 5173).
 * Run from repo root: node scripts/validate-local.mjs
 * Env: API_URL (default http://localhost:3001), FRONTEND_URL (default http://localhost:5173)
 */
const apiUrl = (process.env.API_URL || "http://localhost:3001").replace(/\/$/, "");
const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");

async function checkHealth() {
  const r = await fetch(`${apiUrl}/health`);
  const text = await r.text();
  if (!r.ok) throw new Error(`GET ${apiUrl}/health -> ${r.status}: ${text}`);
  const j = JSON.parse(text);
  if (!j.ok) throw new Error(`Unexpected health body: ${text}`);
  console.log(`[ok] ${apiUrl}/health`, j);
}

async function checkFrontend() {
  const r = await fetch(frontendUrl, { redirect: "manual" });
  if (r.status !== 200) {
    console.warn(`[warn] GET ${frontendUrl} -> ${r.status} (start Vite with npm run dev -w frontend)`);
    return;
  }
  console.log(`[ok] ${frontendUrl} -> ${r.status}`);
}

async function main() {
  await checkHealth();
  await checkFrontend();
  console.log("validate-local: done");
}

main().catch((e) => {
  console.error("validate-local:", e.message);
  process.exit(1);
});
