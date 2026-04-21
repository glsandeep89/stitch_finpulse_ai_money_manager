# Production Deployment Guide

This guide makes FinPulse production-ready for web and Android wrapper usage.

## 1) Deploy API + Web on Render

Use the provided `render.yaml` blueprint from repo root.

### API service (`finpulse-api`)

- Runtime: Node
- Root dir: `backend`
- Health check: `/health`
- Keep these env vars secret:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `PLAID_CLIENT_ID`
  - `PLAID_SECRET`
  - `GEMINI_API_KEY`
- Set these explicitly:
  - `NODE_ENV=production`
  - `PLAID_ENV=production`
  - `SUPABASE_DB_SCHEMA=finpulse`
  - `ENABLE_REWARDS_CATALOG_FALLBACK=false`
  - `FRONTEND_URLS=https://<your-frontend-domain>`

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

## 3) Plaid Production Cutover

- Use production app credentials and set `PLAID_ENV=production`.
- Keep sandbox credentials only in non-production envs.
- Validate required product access before launch.

## 4) Pre-launch Checklist

- [ ] API `/health` reachable on Render
- [ ] Login works on hosted frontend
- [ ] Plaid link + sync succeeds with production credentials
- [ ] No secrets in frontend build/output
- [ ] Scheduled sync succeeds (check Render logs)
- [ ] `ENABLE_REWARDS_CATALOG_FALLBACK=false` in production
