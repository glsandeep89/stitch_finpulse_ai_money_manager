-- Category mapping: Plaid category substrings → user's budget category names
create table if not exists finpulse.category_budget_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plaid_category_pattern text not null,
  budget_category text not null,
  created_at timestamptz not null default now(),
  unique (user_id, plaid_category_pattern)
);

create index if not exists category_budget_mappings_user_idx on finpulse.category_budget_mappings (user_id);

alter table finpulse.category_budget_mappings enable row level security;

create policy "category_budget_mappings_own" on finpulse.category_budget_mappings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on finpulse.category_budget_mappings to authenticated, service_role;

-- Optional shared transaction labels (household-visible when shared)
create table if not exists finpulse.transaction_labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  household_id uuid references finpulse.households (id) on delete cascade,
  plaid_transaction_id text not null,
  label text not null,
  shared boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists transaction_labels_user_tx_uidx on finpulse.transaction_labels (user_id, plaid_transaction_id);
create index if not exists transaction_labels_household_tx_idx on finpulse.transaction_labels (household_id, plaid_transaction_id);

alter table finpulse.transaction_labels enable row level security;

create policy "transaction_labels_own" on finpulse.transaction_labels
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on finpulse.transaction_labels to authenticated, service_role;
