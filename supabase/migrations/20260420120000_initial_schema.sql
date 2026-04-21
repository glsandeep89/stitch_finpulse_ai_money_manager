-- FinPulse initial schema: all app tables live in `finpulse`, not `public`.
-- After running: Supabase Dashboard → Settings → API → Exposed schemas → add `finpulse`

create schema if not exists finpulse;

grant usage on schema finpulse to postgres, anon, authenticated, service_role;

-- Profiles (1:1 with auth.users)
create table if not exists finpulse.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table finpulse.profiles enable row level security;

create policy "profiles_select_own" on finpulse.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on finpulse.profiles
  for update using (auth.uid() = id);

create policy "profiles_insert_own" on finpulse.profiles
  for insert with check (auth.uid() = id);

-- Plaid items (institution connection)
create table if not exists finpulse.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null,
  access_token text not null,
  institution_id text,
  institution_name text,
  transactions_cursor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, item_id)
);

create index if not exists plaid_items_user_id_idx on finpulse.plaid_items (user_id);

alter table finpulse.plaid_items enable row level security;

create policy "plaid_items_own" on finpulse.plaid_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Linked bank accounts (Plaid accounts)
create table if not exists finpulse.linked_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plaid_item_id uuid not null references finpulse.plaid_items (id) on delete cascade,
  plaid_account_id text not null,
  name text,
  mask text,
  type text,
  subtype text,
  balance_current numeric,
  balance_available numeric,
  iso_currency_code text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plaid_account_id)
);

create index if not exists linked_accounts_user_id_idx on finpulse.linked_accounts (user_id);

alter table finpulse.linked_accounts enable row level security;

create policy "linked_accounts_own" on finpulse.linked_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Transactions
create table if not exists finpulse.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  linked_account_id uuid references finpulse.linked_accounts (id) on delete set null,
  plaid_transaction_id text not null,
  plaid_account_id text,
  amount numeric not null,
  trans_date date not null,
  authorized_date date,
  merchant_name text,
  merchant_entity_id text,
  category text[],
  pending boolean not null default false,
  payment_channel text,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, plaid_transaction_id)
);

create index if not exists transactions_user_date_idx on finpulse.transactions (user_id, trans_date desc);

alter table finpulse.transactions enable row level security;

create policy "transactions_own" on finpulse.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Subscriptions (recurring)
create table if not exists finpulse.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  merchant_name text,
  amount numeric,
  frequency text,
  next_payment_date date,
  plaid_stream_id text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on finpulse.subscriptions (user_id);

alter table finpulse.subscriptions enable row level security;

create policy "subscriptions_own" on finpulse.subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Budgets (category envelopes)
create table if not exists finpulse.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null,
  amount_limit numeric not null,
  period_start date not null,
  period_end date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists budgets_user_id_idx on finpulse.budgets (user_id);

alter table finpulse.budgets enable row level security;

create policy "budgets_own" on finpulse.budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Project budgets (e.g. trip)
create table if not exists finpulse.budget_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  target_amount numeric not null,
  spent_amount numeric not null default 0,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists budget_projects_user_id_idx on finpulse.budget_projects (user_id);

alter table finpulse.budget_projects enable row level security;

create policy "budget_projects_own" on finpulse.budget_projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- AI insights
create table if not exists finpulse.insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  insight_type text not null,
  title text,
  body text,
  metadata jsonb,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists insights_user_id_idx on finpulse.insights (user_id, created_at desc);

alter table finpulse.insights enable row level security;

create policy "insights_own" on finpulse.insights
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Net worth snapshots
create table if not exists finpulse.networth_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  as_of timestamptz not null default now(),
  total_net_worth numeric,
  liquid_assets numeric,
  investments numeric,
  breakdown jsonb,
  created_at timestamptz not null default now()
);

create index if not exists networth_snapshots_user_idx on finpulse.networth_snapshots (user_id, as_of desc);

alter table finpulse.networth_snapshots enable row level security;

create policy "networth_snapshots_own" on finpulse.networth_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Auto-create profile on signup
create or replace function finpulse.handle_new_user ()
returns trigger
language plpgsql
security definer
set search_path = finpulse, public
as $$
begin
  insert into finpulse.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function finpulse.handle_new_user ();

-- Grants for PostgREST / Supabase clients (RLS still applies)
grant select, insert, update, delete on all tables in schema finpulse to authenticated;
grant all on all tables in schema finpulse to service_role;

alter default privileges in schema finpulse grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema finpulse grant all on tables to service_role;
