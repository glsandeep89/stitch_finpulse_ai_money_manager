# Render deployment (FinPulse API)

## Web service

- **Root directory:** repository root (or set **Dockerfile path** to `./Dockerfile`).
- **Build:** `docker build` (Render detects Dockerfile) or leave default.
- **Start:** `node dist/index.js` is already the image `CMD`; for non-Docker Node build, use `cd backend && npm install && npm run build && npm start`.

## Health check

- **Path:** `/health`
- **Port:** same as `PORT` (default `3001` in Dockerfile).

## Environment variables

Set these on the Render service:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET` (optional; not required for API auth if using `auth.getUser`)
- (Optional) `SIMPLEFIN_BRIDGE_SIGNUP_URL` — override URL shown to users for creating SimpleFIN setup tokens (defaults to the public Bridge page).
- `GEMINI_API_KEY`
- `FRONTEND_URL` — your static site origin for CORS (e.g. `https://finpulse.onrender.com`).
- `PORT` — Render sets automatically; do not override unless needed.
- `CRON_SECRET` — optional; required in production for `POST /jobs/sync-transactions` (send header `x-cron-secret`).

## Cron (optional)

Add a **Cron Job** service or scheduled job that `POST`s to `https://<your-api>/jobs/sync-transactions` with header `x-cron-secret: <CRON_SECRET>`.

## Frontend

Build the Vite app locally or in CI (`cd frontend && npm run build`) and deploy the `frontend/dist` folder to **Render Static Site** or any static host. Set `VITE_API_URL` at build time to your API URL.
