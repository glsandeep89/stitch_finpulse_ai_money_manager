create table if not exists finpulse.credit_card_rewards_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plaid_account_id text not null,
  card_name text not null,
  issuer text,
  program text,
  annual_fee numeric(12,2) not null default 0,
  cardmember_year_start_month int not null default 1,
  cardmember_year_start_day int not null default 1,
  points_cpp numeric(8,4) not null default 0.01,
  base_rate numeric(8,4) not null default 0.01,
  category_rates jsonb not null default '{}'::jsonb,
  issuer_credits jsonb not null default '[]'::jsonb,
  enrichment_status text not null default 'pending' check (enrichment_status in ('pending','ready','failed')),
  enrichment_source text,
  enrichment_error text,
  last_enriched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, plaid_account_id)
);

create index if not exists credit_card_rewards_profiles_user_idx
  on finpulse.credit_card_rewards_profiles(user_id);

alter table finpulse.credit_card_rewards_profiles enable row level security;

create policy if not exists "credit_card_rewards_profiles_select_own"
on finpulse.credit_card_rewards_profiles
for select
to authenticated
using (auth.uid() = user_id);

create policy if not exists "credit_card_rewards_profiles_insert_own"
on finpulse.credit_card_rewards_profiles
for insert
to authenticated
with check (auth.uid() = user_id);

create policy if not exists "credit_card_rewards_profiles_update_own"
on finpulse.credit_card_rewards_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy if not exists "credit_card_rewards_profiles_delete_own"
on finpulse.credit_card_rewards_profiles
for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete on table finpulse.credit_card_rewards_profiles to authenticated;
