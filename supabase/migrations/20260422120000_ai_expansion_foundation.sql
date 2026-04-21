-- AI Expansion Foundation: external signals, manual inputs, outputs, feature flags, and nudge preferences

create table if not exists finpulse.ai_external_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  signal_type text not null,
  source text not null,
  metric_key text not null,
  metric_value numeric not null,
  observed_at date not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_external_signals_user_type_idx
  on finpulse.ai_external_signals (user_id, signal_type, observed_at desc);

alter table finpulse.ai_external_signals enable row level security;

create policy "ai_external_signals_own" on finpulse.ai_external_signals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on finpulse.ai_external_signals to authenticated, service_role;

create table if not exists finpulse.ai_manual_inputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  input_type text not null,
  payload jsonb not null default '{}'::jsonb,
  effective_month date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_manual_inputs_user_type_month_uidx
  on finpulse.ai_manual_inputs (user_id, input_type, effective_month);

alter table finpulse.ai_manual_inputs enable row level security;

create policy "ai_manual_inputs_own" on finpulse.ai_manual_inputs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on finpulse.ai_manual_inputs to authenticated, service_role;

create table if not exists finpulse.ai_outputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  output_family text not null,
  title text not null,
  summary text not null,
  confidence numeric,
  assumptions jsonb,
  payload jsonb,
  generated_at timestamptz not null default now(),
  metadata jsonb
);

create index if not exists ai_outputs_user_family_idx
  on finpulse.ai_outputs (user_id, output_family, generated_at desc);

alter table finpulse.ai_outputs enable row level security;

create policy "ai_outputs_own" on finpulse.ai_outputs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on finpulse.ai_outputs to authenticated, service_role;

create table if not exists finpulse.ai_feature_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  flag_key text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, flag_key)
);

alter table finpulse.ai_feature_flags enable row level security;

create policy "ai_feature_flags_own" on finpulse.ai_feature_flags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on finpulse.ai_feature_flags to authenticated, service_role;

create table if not exists finpulse.ai_nudge_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade unique,
  enabled boolean not null default true,
  quiet_start_hour smallint not null default 21,
  quiet_end_hour smallint not null default 8,
  channels jsonb not null default '["in_app"]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table finpulse.ai_nudge_preferences enable row level security;

create policy "ai_nudge_preferences_own" on finpulse.ai_nudge_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on finpulse.ai_nudge_preferences to authenticated, service_role;
