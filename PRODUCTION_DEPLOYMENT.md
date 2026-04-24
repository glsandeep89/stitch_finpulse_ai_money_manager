# Production Deployment Guide

This guide makes FinPulse production-ready for web and Android wrapper usage.

## Phase B Status (completed, cron deferred)

- Completed:
  - Applied production migrations for `refund_events` and `credit_card_rewards_profiles`.
  - Verified both tables exist in schema `finpulse`, have RLS enabled, and required policies/indexes are present.
  - Migrated account aggregation from **Plaid** to **SimpleFIN Bridge** (legacy `/plaid/*` API routes remain as stable aliases).
  - Removed backend-only secrets from the static web service environment; only `VITE_*` variables remain on `finpulse-web`.
  - Redeployed API and web services and verified health/auth-protected routes are reachable.
- Deferred by design:
  - `finpulse-sync-cron` deployment and cron validation.
  - All key rotation tasks (to be done in final phase).

## 1) Deploy API + Web on Render

Use the provided `render.yaml` blueprint from repo root.

### API service (`finpulse-api`)

- Runtime: Node
- Root dir: `backend`
- Health check: `/health`
- Keep these env vars secret:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `GEMINI_API_KEY`
- Set these explicitly:
  - `NODE_ENV=production`
  - `SUPABASE_DB_SCHEMA=finpulse`
  - `ENABLE_REWARDS_CATALOG_FALLBACK=false`
  - `FRONTEND_URLS=https://<your-frontend-domain>`
- Optional:
  - `SIMPLEFIN_BRIDGE_SIGNUP_URL` — override the URL FinPulse shows for creating SimpleFIN setup tokens (defaults to the public Bridge page).

### Web service (`finpulse-web`)

- Runtime: Static
- Root dir: `frontend`
- Set:
  - `VITE_API_URL=https://<your-api-domain>`
  - `VITE_SUPABASE_URL=https://<your-supabase-project>.supabase.co`
  - `VITE_SUPABASE_ANON_KEY=<anon-key>`

### Scheduled sync (`finpulse-sync-cron`)

- Runs every 30 minutes.
- Set:
  - `API_URL=https://<your-api-domain>`
  - `CRON_SECRET=<same value as API service>`

## 2) Supabase Security Baseline

## Required

- Keep RLS enabled on all `finpulse.*` tables.
- Ensure policies always scope by user (or household when intended).
- Keep `service_role` key server-side only (never in frontend).
- Keep frontend on `anon` key only.
- Expose only required schemas in Supabase API (`finpulse`, optionally `public` if needed).

## About IP restrictions

- Primary protection for Data API is JWT + RLS.
- IP allowlisting is optional and depends on your Supabase plan/networking features.
- If you use allowlisting, still keep strict RLS and least privilege.

## 3) SimpleFIN Bridge

- Users create a **setup token** in SimpleFIN Bridge and paste it once into FinPulse.
- The API exchanges it for a private **access URL** stored in `plaid_items.access_token` (column name is legacy; value is SimpleFIN).
- Respect SimpleFIN rate limits (see Bridge documentation).

## 4) Pre-launch Checklist

- [x] API `/health` reachable on Render
- [ ] Login works on hosted frontend (manual validation)
- [ ] SimpleFIN setup token exchange + sync succeeds (manual validation)
- [x] No secrets in frontend build/output (static service env contains only `VITE_*`)
- [ ] Scheduled sync succeeds (check Render logs)
- [x] `ENABLE_REWARDS_CATALOG_FALLBACK=false` in production
