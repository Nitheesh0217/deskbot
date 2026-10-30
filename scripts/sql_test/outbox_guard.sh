#!/usr/bin/env bash
# Outbox guard (20261030_scan_work.sql §4) on a throwaway PostgreSQL 16: cost as the backlog and the work log grow, field preservation,
# and the duplicate-suppression window under the 14-day work-log pruning job (20261024_agent_log.sql). Prints one line per check.
set -euo pipefail
BIN=/usr/lib/postgresql/16/bin; ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
D="$(mktemp -d /tmp/deskbot_pg.XXXXXX)"; mkdir -p "$D/pg"; cp "$ROOT/supabase/migrations/20261030_scan_work.sql" "$D/mig.sql"; chmod -R a+rwx "$D"
run() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run "$BIN/initdb -D $D/pg/data -A trust -U postgres >/dev/null"
run "$BIN/pg_ctl -D $D/pg/data -o '-k $D/pg -p 54332 -c listen_addresses=' -l $D/pg/log -w start >/dev/null"
trap 'run "$BIN/pg_ctl -D $D/pg/data -m fast stop >/dev/null"; rm -rf "$D"' EXIT
P="psql -h $D/pg -p 54332 -U postgres -v ON_ERROR_STOP=1 -qAt"
$P <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.dbv5_state (id text primary key, state jsonb, last_run jsonb, updated_at timestamptz default now());
create table public.dbv5_agent_log (id bigserial primary key, ts timestamptz default now(), symbol text, agent text, input_summary text, output jsonb, provider text, ms int, error text);
create table public.dbv5_scans (id bigserial primary key, ts timestamptz default now(), markets jsonb not null, deriv jsonb, note text, ms int);
SQL
$P -f "$D/mig.sql"
# 200,000 delivered work-log rows (≈ 14 days of a busy log is far smaller; this is a stress size)
$P -c "insert into dbv5_agent_log (agent, output, work_key) select 'manager', jsonb_build_object('key','K'||g), 'K'||g from generate_series(1,200000) g"
$P -c "analyze dbv5_agent_log"
box() { # $1 = entries, half already delivered (K1..), half pending (P1..)
  echo "select jsonb_build_object('equity', 342.6, 'pos', jsonb_build_object('id','V5-1','entry',77822.4324,'stop0',80065.93,'originalQty',0.00294003), '_rev', 7,
    '_workOutbox', (select jsonb_agg(jsonb_build_object('agent','manager','output', jsonb_build_object('key', case when g % 2 = 0 then 'K'||g else 'P'||g end, 'queuedAt', g)) order by g) from generate_series(1,$1) g))"
}
for N in 100 1000 10000 50000; do
  $P -c "delete from dbv5_state; insert into dbv5_state (id, state) values ('main', '{}')"
  T=$($P -c "explain (analyze, format json) update dbv5_state set state = ($(box $N)) where id='main'" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"))[0];console.log((j["Execution Time"]).toFixed(1))')
  LEFT=$($P -c "select jsonb_array_length(state->'_workOutbox') from dbv5_state")
  echo "scale: outbox $N (half delivered) -> kept $LEFT, state write ${T} ms (trigger included) against 200k log rows"
done
# preservation: every field except _workOutbox is identical; order of pending entries is kept
$P -c "delete from dbv5_state; insert into dbv5_state (id, state) values ('main', ($(box 10)))"
$P -c "select case when (state - '_workOutbox') = (($(box 10)) - '_workOutbox') and state->'_workOutbox' = (select jsonb_agg(e order by (e->'output'->>'queuedAt')::int) from jsonb_array_elements(state->'_workOutbox') e) and jsonb_array_length(state->'_workOutbox') = 5 then 'preservation: ok (position, equity, _rev unchanged; 5 pending kept in order)' else 'preservation: FAIL' end from dbv5_state"
# retention window: a key is suppressed only while its work-log row exists
$P -c "insert into dbv5_agent_log (agent, output, work_key, ts) values ('manager', '{\"key\":\"OLD\"}', 'OLD', now() - interval '15 days')"
$P -c "update dbv5_state set state = jsonb_set(state, '{_workOutbox}', '[{\"agent\":\"manager\",\"output\":{\"key\":\"OLD\"}}]')"
echo "retention: before pruning, a stale copy of delivered key OLD is $($P -c "select case when jsonb_array_length(state->'_workOutbox')=0 then 'removed' else 'kept' end from dbv5_state")"
$P -c "delete from public.dbv5_agent_log where ts < now() - interval '14 days'"   # the nightly job's exact statement
$P -c "update dbv5_state set state = jsonb_set(state, '{_workOutbox}', '[{\"agent\":\"manager\",\"output\":{\"key\":\"OLD\"}}]')"
echo "retention: after pruning, the same stale copy is $($P -c "select case when jsonb_array_length(state->'_workOutbox')=0 then 'removed' else 'kept' end from dbv5_state") (suppression ends with the log row)"
$P -c "insert into dbv5_agent_log (agent, output, work_key) values ('manager','{\"key\":\"OLD\"}','OLD') on conflict (work_key) do nothing"
echo "retention: re-delivery after pruning is accepted as a NEW row ($($P -c "select count(*) from dbv5_agent_log where work_key='OLD' and ts > now() - interval '1 minute'") new row for OLD): no exactly-once guarantee beyond the 14-day window"
