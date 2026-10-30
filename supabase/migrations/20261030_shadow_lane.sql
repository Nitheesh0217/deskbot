-- W3 shadow research lane (additive except for replacing one uniqueness key; no row is changed or removed).
-- Scanner setups carry a lane: 'book' (the book's own config and switches) or 'shadow' (evaluators the book does not evaluate,
-- run under the versioned SHADOW-1 config; never traded, never in a book's state, never counted for promotion), and the id
-- of the config that produced them (cfg_id: 'book:<fingerprint>' or 'SHADOW-1:<fingerprint>').
alter table public.dbv5_scan_signals add column if not exists lane text not null default 'book' check (lane in ('book', 'shadow'));
alter table public.dbv5_scan_signals add column if not exists cfg_id text;
-- Identity is (sym, strategy, bar_t, lane): the same strategy and bar may exist once in each lane, so a configuration
-- transition (a strategy switched on or off between scans) can never let one lane's row suppress the other's.
-- The new key is created first; the old 3-column key is then dropped (it would make the two lanes collide).
create unique index if not exists dbv5_scan_signals_lane_key on public.dbv5_scan_signals (sym, strategy, bar_t, lane);
alter table public.dbv5_scan_signals drop constraint if exists dbv5_scan_signals_sym_strategy_bar_t_key;
-- lane telemetry on the scan row (same column as 20261030_scan_work.sql; idempotent)
alter table public.dbv5_scans add column if not exists work jsonb;
-- lane and config id are part of a setup's identity: they cannot change after insert
create or replace function public.dbv5_scan_signals_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'dbv5 scan signals are append-only (%)', tg_op; end if;
  if old.status <> 'open' then raise exception 'resolved scan signal % cannot change', old.id; end if;
  if (new.sym, new.strategy, new.dir, new.bar_t, new.entry, new.stop, new.tp1, new.r_dist, new.cost_r, new.created_at, new.lane, new.cfg_id)
     is distinct from (old.sym, old.strategy, old.dir, old.bar_t, old.entry, old.stop, old.tp1, old.r_dist, old.cost_r, old.created_at, old.lane, old.cfg_id)
  then raise exception 'scan signal % identity cannot change', old.id; end if;
  return new;
end $$;
