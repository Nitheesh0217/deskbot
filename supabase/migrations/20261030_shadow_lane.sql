-- W3 shadow research lane (additive). Scanner setups now carry a lane: 'book' (the book's own config) or 'shadow'
-- (evaluators switched off in a book, evaluated with an isolated all-on test config; never traded, never in a book's state).
alter table public.dbv5_scan_signals add column if not exists lane text not null default 'book' check (lane in ('book', 'shadow'));
-- the lane is part of a setup's identity: it cannot change after insert (same guard as before, plus lane)
create or replace function public.dbv5_scan_signals_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then raise exception 'dbv5 scan signals are append-only (%)', tg_op; end if;
  if old.status <> 'open' then raise exception 'resolved scan signal % cannot change', old.id; end if;
  if (new.sym, new.strategy, new.dir, new.bar_t, new.entry, new.stop, new.tp1, new.r_dist, new.cost_r, new.created_at, new.lane)
     is distinct from (old.sym, old.strategy, old.dir, old.bar_t, old.entry, old.stop, old.tp1, old.r_dist, old.cost_r, old.created_at, old.lane)
  then raise exception 'scan signal % identity cannot change', old.id; end if;
  return new;
end $$;
