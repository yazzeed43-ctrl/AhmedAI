create extension if not exists pgcrypto;

create table if not exists public.fahd_decision_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null default 'fahd_chat',
  request_message text,
  underlying text not null default 'SPX',
  timeframe text not null,
  decision text not null,
  bias text not null,
  market_score numeric,
  confidence numeric,
  bullish_probability numeric,
  bearish_probability numeric,
  neutral_probability numeric,
  price_at_decision numeric,
  price_source text,
  price_freshness text,
  is_proxy boolean not null default false,
  proxy_symbol text,
  proxy_factor numeric,
  trend_score numeric,
  momentum_score numeric,
  zones_score numeric,
  alignment_score numeric,
  risk_score numeric,
  trigger_required boolean,
  trigger_rule text,
  trigger_conditions jsonb not null default '{}'::jsonb,
  blocking_reasons jsonb not null default '[]'::jsonb,
  primary_snapshot jsonb not null default '{}'::jsonb,
  confirmations_snapshot jsonb not null default '{}'::jsonb,
  raw_decision jsonb not null,
  dedupe_key text not null unique
);

create index if not exists fahd_decision_logs_created_at_idx
  on public.fahd_decision_logs (created_at desc);
create index if not exists fahd_decision_logs_decision_idx
  on public.fahd_decision_logs (decision, created_at desc);
create index if not exists fahd_decision_logs_bias_idx
  on public.fahd_decision_logs (bias, created_at desc);

create table if not exists public.fahd_decision_outcomes (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.fahd_decision_logs(id) on delete cascade,
  horizon_minutes integer not null check (horizon_minutes in (15, 30, 60)),
  measured_at timestamptz not null default now(),
  start_price numeric not null,
  end_price numeric,
  high_price numeric,
  low_price numeric,
  move_points numeric,
  move_percent numeric,
  mfe_points numeric,
  mae_points numeric,
  direction_result text,
  timing_result text,
  trigger_result text,
  data_source text,
  raw_outcome jsonb not null default '{}'::jsonb,
  unique (decision_id, horizon_minutes)
);

create index if not exists fahd_decision_outcomes_decision_idx
  on public.fahd_decision_outcomes (decision_id, horizon_minutes);
create index if not exists fahd_decision_outcomes_measured_at_idx
  on public.fahd_decision_outcomes (measured_at desc);

alter table public.fahd_decision_logs enable row level security;
alter table public.fahd_decision_outcomes enable row level security;

revoke all on public.fahd_decision_logs from anon, authenticated;
revoke all on public.fahd_decision_outcomes from anon, authenticated;

drop policy if exists service_role_full_access_fahd_decision_logs on public.fahd_decision_logs;
create policy service_role_full_access_fahd_decision_logs
  on public.fahd_decision_logs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists service_role_full_access_fahd_decision_outcomes on public.fahd_decision_outcomes;
create policy service_role_full_access_fahd_decision_outcomes
  on public.fahd_decision_outcomes
  for all
  to service_role
  using (true)
  with check (true);
