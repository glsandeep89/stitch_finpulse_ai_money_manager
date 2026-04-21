-- Households: shared view across linked user accounts (e.g. spouses). Backend authorizes; RLS mirrors other finpulse tables.

create table if not exists finpulse.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Household',
  join_code text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint households_join_code_len check (char_length(join_code) >= 6)
);

create unique index if not exists households_join_code_uidx on finpulse.households (lower(join_code));

create table if not exists finpulse.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finpulse.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists household_members_household_id_idx on finpulse.household_members (household_id);

alter table finpulse.households enable row level security;
alter table finpulse.household_members enable row level security;

create policy "households_member_read" on finpulse.households
  for select using (
    exists (
      select 1 from finpulse.household_members m
      where m.household_id = finpulse.households.id and m.user_id = auth.uid()
    )
  );

create policy "household_members_self" on finpulse.household_members
  for select using (auth.uid() = user_id);

create policy "household_members_insert_own" on finpulse.household_members
  for insert with check (auth.uid() = user_id);

grant select, insert, update, delete on finpulse.households to authenticated, service_role;
grant select, insert, update, delete on finpulse.household_members to authenticated, service_role;
