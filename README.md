# FinPulse

AI-powered financial tracker: **Vite + React** frontend, **Node (Express) + TypeScript** API, **Supabase** (Auth + Postgres), **Plaid** (Sandbox), **Gemini** (insights), deploy API with **Docker** on **Render**.

## Prerequisites

- Node.js 20+
- Supabase project (run SQL in `supabase/migrations/` in the SQL editor)
- Plaid Sandbox keys (`PLAID_ENV=sandbox`)
- Gemini API key

## Environment

Copy `.env.example` to `.env` at the repo root. Required for the API:

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB (keep secret) |
| `SUPABASE_JWT_SECRET` | Optional (API verifies sessions via `auth.getUser`, not this secret) |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | Plaid |
| `GEMINI_API_KEY` | Gemini |

Frontend (Vite) — prefix `VITE_`:

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Same as `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Anon public key |
| `VITE_API_URL` | API base, e.g. `http://localhost:3001` |

Optional: `CRON_SECRET` (header `x-cron-secret` for `POST /jobs/sync-transactions`), `FINPULSE_API_KEY`, `FRONTEND_URL` (CORS).

### Local-only convenience overrides

You can create `.env.local` (gitignored) to override values locally without changing `.env`.
For example, copy `.env.local.example` and set local convenience flags there.

## Database

App tables live in the **`finpulse`** schema (not `public`).

1. Open Supabase → SQL → New query.
2. Paste `supabase/migrations/20260420120000_initial_schema.sql` and run.
3. **Settings → API → Exposed schemas:** add **`finpulse`** so PostgREST can see the tables.
4. Optional env: `SUPABASE_DB_SCHEMA=finpulse` (default) on the API.
5. If the auth trigger fails on your Postgres version, adjust `execute function` / `execute procedure` per your Supabase Postgres docs.

If you previously ran an older version of this migration in **`public`**, drop those tables/functions there or use a clean project before applying the `finpulse` migration.

## Local development

```bash
npm install
cd backend && npm install
cd ../frontend && npm install
cd ..
```

Terminal 1 — API (from repo root):

```bash
cd backend
npm run dev
```

If port **3001** is already in use, stop the old process and start the API in one step (Windows):

```bash
npm run backend:restart
```

**Auto-reload:** `npm run dev` in `backend/` uses `tsx watch`, so **saving a `.ts` file** reloads the API automatically. **Editing root `.env`** does not trigger a reload—run `npm run backend:restart` after env changes. In VS Code / Cursor, **Tasks → Run Task → “FinPulse: restart backend”** runs the same script.

Terminal 2 — SPA:

```bash
cd frontend
npm run dev
```

- API: `http://localhost:3001/health`
- App: `http://localhost:5173`

Sign up / sign in with Supabase Auth, then use **Link bank account** (Plaid Sandbox). In Link, choose a sandbox institution (e.g. First Platypus Bank) and use Plaid’s sandbox credentials (commonly `user_good` / `pass_good` where prompted). After linking, the app calls `POST /jobs/sync-my-data` to pull transactions and refresh net worth.

## Plaid Sandbox demo

- Keep `PLAID_ENV=sandbox`.
- Use only test institutions shown inside Plaid Link.
- After sync, Overview and Activity should show **live Plaid sandbox transactions**, not the old static Stitch HTML placeholders.

## Docker (API)

From repo root:

```bash
docker build -t finpulse-api .
docker run --env-file .env -p 3001:3001 finpulse-api
```

## Render

See [RENDER.md](RENDER.md) for suggested service settings and environment variables.
For production-ready setup (web + API + scheduled sync + security baseline), see [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md).

## GitHub

```bash
git init
git add .
git commit -m "Initial FinPulse implementation"
git branch -M main
git remote add origin https://github.com/<you>/finpulse.git
git push -u origin main
```

Use a personal access token for HTTPS if needed.

## Project layout

- `backend/` — REST API (Plaid, data, AI, jobs)
- `frontend/` — Vite React UI
- `supabase/migrations/` — schema + RLS
- `reference/stitch-html/` — original Stitch HTML exports (reference)
