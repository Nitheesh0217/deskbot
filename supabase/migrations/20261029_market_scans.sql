-- Multi-market scanner results (additive, idempotent). One row per 15-minute scan: the bot's own rules run read-only on every
-- Hyperliquid market in data.ts SYMBOLS, plus Deribit options/futures context. Nothing here is read by the executor.
create table if not exists public.dbv5_scans (
  id bigserial primary key,
  ts timestamptz not null default now(),
  markets jsonb not null,
  deriv jsonb,
  note text,
  ms integer
);
create index if not exists dbv5_scans_ts on public.dbv5_scans (ts);
alter table public.dbv5_scans enable row level security;
revoke all on public.dbv5_scans from public, anon, authenticated;
grant select, insert on public.dbv5_scans to service_role;
grant usage on sequence public.dbv5_scans_id_seq to service_role;
-- Schedules (apply AFTER the edge function that understands {"action":"scan"} is deployed; an older build treats it as a run):
--   select cron.schedule('deskbot-v5-scan', '7-59/15 * * * *', $$select public.dbv5_invoke('{"action":"scan"}'::jsonb)$$);
--   select cron.schedule('deskbot-v5-prune-scans', '17 3 * * *', $$delete from public.dbv5_scans where ts < now() - interval '14 days'$$);
