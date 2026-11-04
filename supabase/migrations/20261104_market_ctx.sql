-- Market context history (additive only; nothing existing is changed or removed). NOT applied automatically.
-- One row per book per run from the edge function (Hyperliquid metaAndAssetCtxs: mark, oracle, premium, hourly funding, open
-- interest), kept for later funding / basis shadow research. Observe-only: no trading logic reads this table. Until this migration
-- is applied the edge function skips the insert (42P01 / PGRST205) and notes it once.
create table if not exists public.dbv5_market_ctx (
  id bigserial primary key,
  ts timestamptz not null default now(),
  symbol text,
  mark numeric,
  oracle numeric,
  premium numeric,
  funding numeric,
  oi numeric
);
create index if not exists dbv5_market_ctx_ts on public.dbv5_market_ctx (ts);
alter table public.dbv5_market_ctx enable row level security;
-- RLS on with no policies: only the service role (edge function) reads or writes.
