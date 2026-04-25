-- Merchant alias catalog (global) + per-user merchant overrides
create table if not exists finpulse.merchant_aliases (
  id uuid primary key default gen_random_uuid(),
  merchant_pattern text not null,
  match_type text not null check (match_type in ('exact', 'regex')),
  canonical_merchant text not null,
  default_category text,
  priority int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (merchant_pattern, match_type)
);

create index if not exists merchant_aliases_active_priority_idx
  on finpulse.merchant_aliases (active, priority, match_type);

alter table finpulse.merchant_aliases enable row level security;

drop policy if exists "merchant_aliases_read_authenticated" on finpulse.merchant_aliases;
create policy "merchant_aliases_read_authenticated"
  on finpulse.merchant_aliases
  for select
  using (auth.role() = 'authenticated');

grant select on finpulse.merchant_aliases to authenticated, service_role;
grant insert, update, delete on finpulse.merchant_aliases to service_role;

create table if not exists finpulse.user_merchant_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  merchant_pattern text not null,
  canonical_merchant text not null,
  category_override text,
  created_at timestamptz not null default now(),
  unique (user_id, merchant_pattern)
);

create index if not exists user_merchant_overrides_user_idx
  on finpulse.user_merchant_overrides (user_id);

alter table finpulse.user_merchant_overrides enable row level security;

drop policy if exists "user_merchant_overrides_own" on finpulse.user_merchant_overrides;
create policy "user_merchant_overrides_own"
  on finpulse.user_merchant_overrides
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on finpulse.user_merchant_overrides to authenticated, service_role;

insert into finpulse.merchant_aliases (merchant_pattern, match_type, canonical_merchant, default_category, priority)
values
  ('cursor', 'exact', 'Cursor', 'Software & SaaS', 1),
  ('doordash', 'exact', 'DoorDash', 'Restaurants', 1),
  ('real green service', 'exact', 'Real Green Service', 'Home Improvements', 2),
  ('signature pest management', 'exact', 'Signature Pest Management', 'Home Improvements', 2),
  ('pedernales electric cooperative', 'exact', 'Pedernales Electric Cooperative', 'Business Utilities & Communication', 2),
  ('zee5', 'exact', 'ZEE5', 'Entertainment & Recreation', 2),
  ('optimum', 'exact', 'Optimum', 'Internet & Cable', 2),
  ('cursor.*ai powered', 'regex', 'Cursor', 'Software & SaaS', 3),
  ('sampay\\*?\\s*doordash', 'regex', 'DoorDash', 'Restaurants', 3)
on conflict (merchant_pattern, match_type) do update
set canonical_merchant = excluded.canonical_merchant,
    default_category = excluded.default_category,
    priority = excluded.priority,
    active = true;
