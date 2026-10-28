-- v5.8 desk agents: one row per agent decision, written by the edge function (service role). Idempotent.
create table if not exists public.dbv5_agent_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  symbol text not null default 'BTC',
  agent text not null,
  input_summary text,
  output jsonb,
  provider text,
  ms integer,
  error text
);
create index if not exists dbv5_agent_log_ts on public.dbv5_agent_log (ts desc);
create index if not exists dbv5_agent_log_sym on public.dbv5_agent_log (symbol, ts desc);
-- same posture as the other dbv5_* tables: no anon/authenticated access; the edge function uses the service role (bypasses RLS)
alter table public.dbv5_agent_log enable row level security;
-- keep 14 days of agent rows
select cron.schedule('deskbot-v5-prune-agents', '11 3 * * *', $$delete from public.dbv5_agent_log where ts < now() - interval '14 days'$$);
