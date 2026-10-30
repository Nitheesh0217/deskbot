#!/usr/bin/env bash
# Real PostgreSQL check of 20261029_scan_signals.sql + 20261030_shadow_lane.sql: existing rows default to lane 'book', only
# 'book'/'shadow' are accepted, the lane cannot change after insert, outcome updates of open rows still work, and re-applying is a no-op.
set -euo pipefail
BIN=/usr/lib/postgresql/16/bin; ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
D="$(mktemp -d /tmp/deskbot_pg.XXXXXX)"; mkdir -p "$D/pg"; cp "$ROOT/supabase/migrations/20261029_scan_signals.sql" "$D/a.sql"; cp "$ROOT/supabase/migrations/20261030_shadow_lane.sql" "$D/b.sql"; chown -R postgres "$D" 2>/dev/null || true; chmod a+r "$D"/*.sql
run() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run "$BIN/initdb -D $D/pg/data -A trust -U postgres >/dev/null"
run "$BIN/pg_ctl -D $D/pg/data -o '-k $D/pg -p 54330 -c listen_addresses=' -l $D/pg/log -w start >/dev/null"
trap 'run "$BIN/pg_ctl -D $D/pg/data -m fast stop >/dev/null"; rm -rf "$D"' EXIT
P="psql -h $D/pg -p 54330 -U postgres -qAt"
$P -c "create role service_role; create role anon; create role authenticated; create table public.dbv5_scans (id bigserial primary key, ts timestamptz default now(), markets jsonb not null, deriv jsonb, note text, ms int)" >/dev/null; $P -v ON_ERROR_STOP=1 -f "$D/a.sql" >/dev/null
$P -c "insert into dbv5_scan_signals (sym,strategy,dir,bar_t,entry,stop,tp1,r_dist,cost_r,max_hold_h) values ('BTC','SWEEP_REV','long',1,100,99,101,1,0.1,1)"
$P -v ON_ERROR_STOP=1 -f "$D/b.sql" >/dev/null; $P -v ON_ERROR_STOP=1 -f "$D/b.sql" >/dev/null
echo "pre-existing row lane: $($P -c "select lane from dbv5_scan_signals where bar_t=1")"
echo "old 3-column key dropped: $($P -c "select count(*) from pg_constraint where conname='dbv5_scan_signals_sym_strategy_bar_t_key'") (0 = dropped)"
INS="insert into dbv5_scan_signals (lane,cfg_id,sym,strategy,dir,bar_t,entry,stop,tp1,r_dist,cost_r,max_hold_h) values"
$P -c "$INS ('book','book:aaaa0000','BTC','SSR','long',7,100,99,101,1,0.1,8) on conflict (sym,strategy,bar_t,lane) do nothing"
$P -c "$INS ('shadow','SHADOW-1:bbbb0000','BTC','SSR','long',7,100,99,101,1,0.1,8) on conflict (sym,strategy,bar_t,lane) do nothing"
$P -c "$INS ('shadow','SHADOW-1:bbbb0000','BTC','SSR','long',7,100,99,101,1,0.1,8) on conflict (sym,strategy,bar_t,lane) do nothing"
echo "same strategy+bar in both lanes: $($P -c "select string_agg(lane, ',' order by lane) from dbv5_scan_signals where bar_t=7") (expect book,shadow)"
echo "bad lane rejected: $($P -c "$INS ('live',null,'BTC','X','long',3,1,0.9,1.1,0.1,0.1,1)" 2>&1 | grep -c 'check constraint' || true)"
echo "lane change blocked: $($P -c "update dbv5_scan_signals set lane='book', cfg_id='book:aaaa0000' where bar_t=7 and lane='shadow'" 2>&1 | grep -c 'identity cannot change' || true)"
echo "cfg_id change blocked: $($P -c "update dbv5_scan_signals set cfg_id='SHADOW-2:x' where bar_t=7 and lane='shadow'" 2>&1 | grep -c 'identity cannot change' || true)"
$P -c "update dbv5_scan_signals set status='tp1', r_net=0.9 where bar_t=7 and lane='shadow'"; echo "outcome update on an open shadow row: $($P -c "select status from dbv5_scan_signals where bar_t=7 and lane='shadow'")"
