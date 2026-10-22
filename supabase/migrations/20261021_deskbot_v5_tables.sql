-- DeskBot v5 storage. RLS ON with no policies: only the service role (edge function) can read/write.
create table if not exists public.dbv5_state (
  id text primary key,
  state jsonb not null,
  last_run jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.dbv5_trades (
  id text primary key,
  strategy text not null,
  dir text not null,
  entry numeric, exit_avg numeric, net numeric, r numeric, fees numeric, funding numeric,
  open_t timestamptz, close_t timestamptz, reason text,
  data jsonb
);
create index if not exists dbv5_trades_close_idx on public.dbv5_trades (close_t desc);
create table if not exists public.dbv5_events (
  id bigserial primary key,
  ts timestamptz not null default now(),
  kind text not null,
  strategy text,
  msg text,
  data jsonb
);
create index if not exists dbv5_events_ts_idx on public.dbv5_events (ts desc);
create table if not exists public.dbv5_equity (
  ts timestamptz primary key,
  equity numeric not null,
  upnl numeric,
  price numeric
);
create table if not exists public.dbv5_backtests (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  days int,
  results jsonb
);
alter table public.dbv5_state enable row level security;
alter table public.dbv5_trades enable row level security;
alter table public.dbv5_events enable row level security;
alter table public.dbv5_equity enable row level security;
alter table public.dbv5_backtests enable row level security;
