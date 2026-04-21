create table if not exists finpulse.refund_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid references finpulse.transactions (id) on delete set null,
  plaid_transaction_id text not null,
  plaid_account_id text,
  merchant_name text,
  amount numeric not null,
  trans_date date not null,
  status text not null default 'posted' check (status in ('pending', 'posted', 'expired', 'manual')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plaid_transaction_id)
);

create index if not exists refund_events_user_date_idx
  on finpulse.refund_events (user_id, trans_date desc);

alter table finpulse.refund_events enable row level security;

create policy "refund_events_own" on finpulse.refund_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on finpulse.refund_events to authenticated, service_role;
