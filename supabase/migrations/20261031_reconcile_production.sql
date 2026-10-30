-- Reconciliation: objects that exist in the production database but were applied directly (migrations "dbv5_news_lease_watchdog",
-- "deskbot_v55_multi_book_symbol" and manual cron changes) and had no file in this repo. Recorded from production on 2026-10-30.
-- Idempotent: on production every statement is a no-op; on a fresh database (after the earlier files) it reproduces production.
-- It changes no data.

-- 1) news layer table (news.ts readNews → index.ts insert)
create table if not exists public.dbv5_news (
  id bigserial primary key,
  ts timestamptz not null default now(),
  risk text not null, bias text not null, event text, reason text, by text,
  rule_risk text, rule_hits jsonb, headlines jsonb, errors jsonb, mode text
);
create index if not exists dbv5_news_ts on public.dbv5_news (ts desc);
alter table public.dbv5_news enable row level security;

-- 2) multi-book symbol columns (BTC = default book)
alter table public.dbv5_trades add column if not exists symbol text not null default 'BTC';
alter table public.dbv5_events add column if not exists symbol text not null default 'BTC';
alter table public.dbv5_equity add column if not exists symbol text not null default 'BTC';
create index if not exists dbv5_trades_symbol_close on public.dbv5_trades (symbol, close_t desc);
create index if not exists dbv5_events_symbol_id on public.dbv5_events (symbol, id desc);
-- equity is keyed per book: (symbol, ts) instead of ts alone
do $$ begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'dbv5_equity_pkey') = 'PRIMARY KEY (ts)' then
    alter table public.dbv5_equity drop constraint dbv5_equity_pkey;
    alter table public.dbv5_equity add constraint dbv5_equity_pkey primary key (symbol, ts);
  end if;
end $$;

-- 3) run lease (one run at a time across isolates); held on the BTC row
alter table public.dbv5_state add column if not exists lease_until timestamptz;
alter table public.dbv5_state add column if not exists lease_owner text;
create or replace function public.dbv5_lease(owner text, seconds integer default 120) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update dbv5_state set lease_until = now() + make_interval(secs => seconds), lease_owner = owner
   where id = 'main' and (lease_until is null or lease_until < now() or lease_owner = owner)
  returning true into ok;
  return coalesce(ok, false);
end $$;
create or replace function public.dbv5_release(owner text) returns void
language sql security definer set search_path = public as $$
  update dbv5_state set lease_until = null where id = 'main' and lease_owner = owner;
$$;

-- 4) watchdog: kicks a run when the BTC book has not been saved for 20 minutes
create or replace function public.dbv5_watchdog() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare age interval;
begin
  select now() - updated_at into age from dbv5_state where id = 'main';
  if age is null or age > interval '20 minutes' then
    perform public.dbv5_invoke('{"action":"run"}'::jsonb);
    insert into dbv5_events(kind, msg) values ('WATCHDOG', 'State was ' || coalesce(age::text,'missing') || ' old, kicked a run');
    return 'kicked';
  end if;
  return 'ok';
end $$;
revoke all on function public.dbv5_lease(text, integer), public.dbv5_release(text), public.dbv5_watchdog() from public, anon, authenticated;
grant execute on function public.dbv5_lease(text, integer), public.dbv5_release(text), public.dbv5_watchdog() to service_role;

-- 5) cron jobs as they run in production (20261021_deskbot_v5_cron.sql also created 'deskbot-v5-backtest' and 'deskbot-v5-prune',
--    which production no longer has; the scan jobs in 20261029_market_scans.sql were only commented there)
select cron.unschedule(jobname) from cron.job where jobname in ('deskbot-v5-backtest', 'deskbot-v5-prune');
select cron.schedule('deskbot-v5-scan', '7-59/15 * * * *', $$select public.dbv5_invoke('{"action":"scan"}'::jsonb)$$);
select cron.schedule('deskbot-v5-prune-scans', '17 3 * * *', $$delete from public.dbv5_scans where ts < now() - interval '14 days'$$);
select cron.schedule('deskbot-v5-watchdog', '*/15 * * * *', $$select public.dbv5_watchdog()$$);

-- Not applied here (production changes that need the owner's approval; listed so they are not forgotten):
--  * dbv5_agent_log has duplicate indexes: dbv5_agent_log_ts_idx = dbv5_agent_log_ts, dbv5_agent_log_symbol_ts_idx = dbv5_agent_log_sym.
--  * The `http` extension's functions (http_get, http_post, …) live in schema public with EXECUTE for anon/authenticated, so they are
--    callable through PostgREST /rpc with the public anon key (server-side request risk). Proposed:
--      revoke execute on all functions in schema public from anon, authenticated;  -- then re-grant only what the web needs (none today)
