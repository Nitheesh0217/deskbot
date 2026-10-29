-- Forward tracking of scanner setups (track.ts). One row per (market, strategy, signal bar), written when the rules fire and before
-- any outcome; the scan job later fills the outcome (first of TP1 / stop / max hold). Only open rows are ever updated (the edge
-- function patches with status=eq.open) and the trigger below forbids changing a row's identity or a resolved outcome.
create table if not exists public.dbv5_scan_signals (
  id bigserial primary key,
  sym text not null, strategy text not null, dir text not null check (dir in ('long', 'short')),
  bar_t bigint not null, entry double precision not null, stop double precision not null, tp1 double precision not null,
  r_dist double precision not null, cost_r double precision not null, max_hold_h double precision not null, score double precision, why jsonb,
  status text not null default 'open' check (status in ('open', 'tp1', 'stop', 'time')),
  checked_t bigint, exit_t bigint, exit_px double precision, r_gross double precision, r_net double precision,
  created_at timestamptz not null default now(), resolved_at timestamptz,
  unique (sym, strategy, bar_t)
);
create index if not exists dbv5_scan_signals_open on public.dbv5_scan_signals (status) where status = 'open';
create or replace function public.dbv5_scan_signals_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'dbv5 scan signals are append-only (%)', tg_op; end if;
  if old.status <> 'open' then raise exception 'resolved scan signal % cannot change', old.id; end if;
  if (new.sym, new.strategy, new.dir, new.bar_t, new.entry, new.stop, new.tp1, new.r_dist, new.cost_r, new.created_at)
     is distinct from (old.sym, old.strategy, old.dir, old.bar_t, old.entry, old.stop, old.tp1, old.r_dist, old.cost_r, old.created_at)
  then raise exception 'scan signal % identity cannot change', old.id; end if;
  return new;
end $$;
create or replace trigger dbv5_scan_signals_guard before update or delete on public.dbv5_scan_signals for each row execute function public.dbv5_scan_signals_guard();
create or replace trigger dbv5_scan_signals_no_truncate before truncate on public.dbv5_scan_signals for each statement execute function public.dbv5_scan_signals_guard();
alter table public.dbv5_scan_signals enable row level security;
revoke all on public.dbv5_scan_signals from public, anon, authenticated;
grant select, insert, update on public.dbv5_scan_signals to service_role;
grant usage on sequence public.dbv5_scan_signals_id_seq to service_role;
