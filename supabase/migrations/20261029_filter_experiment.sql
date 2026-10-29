-- FILTER-1 forward paper experiment (additive, idempotent). One row per (entry, filter arm), written when the entry opens and
-- before its outcome exists. recorded_at is the database clock, so "decided before the trade closed" is checkable against dbv5_trades.close_t.
-- Rows can never be changed or deleted. Nothing here touches existing tables or the executor: filters are SHADOW decisions only.
create table if not exists public.dbv5_filter_verdicts (
  ref text not null,                                   -- position id = dbv5_trades.id once the trade closes
  arm text not null check (arm in ('rules', 'ai')),    -- rules: deterministic pre-trade checks; ai: optional LLM committee judge
  sym text not null,
  strategy text not null,
  take boolean,                                        -- true = keep, false = would have skipped, null = abstained (no provider, unsure, error)
  verdict text not null,
  detail jsonb not null default '{}'::jsonb,
  provider text,
  ms integer,
  experiment text not null default 'FILTER-1',
  recorded_at timestamptz not null default now(),
  primary key (ref, arm)
);
create index if not exists dbv5_filter_verdicts_ts on public.dbv5_filter_verdicts (recorded_at);
create or replace function public.dbv5_filter_verdicts_immutable() returns trigger language plpgsql as $$
begin raise exception 'dbv5 filter verdicts are append-only (% on %)', tg_op, tg_table_name; end $$;
drop trigger if exists dbv5_filter_verdicts_no_change on public.dbv5_filter_verdicts;
create trigger dbv5_filter_verdicts_no_change before update or delete on public.dbv5_filter_verdicts for each row execute function public.dbv5_filter_verdicts_immutable();
drop trigger if exists dbv5_filter_verdicts_no_truncate on public.dbv5_filter_verdicts;
create trigger dbv5_filter_verdicts_no_truncate before truncate on public.dbv5_filter_verdicts for each statement execute function public.dbv5_filter_verdicts_immutable();
alter table public.dbv5_filter_verdicts enable row level security;
revoke all on public.dbv5_filter_verdicts from public, anon, authenticated, service_role;
grant select, insert on public.dbv5_filter_verdicts to service_role;
