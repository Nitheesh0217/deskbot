#!/usr/bin/env bash
# Real PostgreSQL check of supabase/migrations/20261030_scan_work.sql: concurrent writers inserting the same work_key with
# ON CONFLICT (work_key) DO NOTHING produce exactly one row; NULL keys never conflict; applying the migration twice is a no-op.
# Uses a throwaway local cluster (PostgreSQL 16 binaries) in a private mktemp directory owned by the postgres user, removed on exit.
# Usage: scripts/sql_test/work_key.sh
set -euo pipefail
BIN=/usr/lib/postgresql/16/bin; MIG="$(cd "$(dirname "$0")/../.." && pwd)/supabase/migrations/20261030_scan_work.sql"
D="$(mktemp -d /tmp/deskbot_pg.XXXXXX)"; mkdir -p "$D/pg"; chown -R postgres "$D" 2>/dev/null || true; cp "$MIG" "$D/mig.sql"; MIG="$D/mig.sql"; chmod a+r "$MIG"
run() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run "$BIN/initdb -D $D/pg/data -A trust -U postgres >/dev/null"
run "$BIN/pg_ctl -D $D/pg/data -o '-k $D/pg -p 54329 -c listen_addresses=' -l $D/pg/log -w start >/dev/null"
trap 'run "$BIN/pg_ctl -D $D/pg/data -m fast stop >/dev/null"; rm -rf "$D"' EXIT
P="psql -h $D/pg -p 54329 -U postgres -v ON_ERROR_STOP=1 -qAt"
$P -c "create table public.dbv5_agent_log (id bigserial primary key, ts timestamptz default now(), symbol text, agent text, input_summary text, output jsonb, provider text, ms int, error text);
       create table public.dbv5_scans (id bigserial primary key, ts timestamptz default now(), markets jsonb not null, deriv jsonb, note text, ms int);"
$P -f "$MIG"; $P -f "$MIG"    # idempotent
for i in $(seq 1 16); do $P -c "insert into dbv5_agent_log (agent, output, work_key) values ('manager', '{\"key\":\"V5-1:close:final\"}', 'V5-1:close:final') on conflict (work_key) do nothing" & done; wait
for i in 1 2 3; do $P -c "insert into dbv5_agent_log (agent, output) values ('chart', '{}')"; done
$P -c "insert into dbv5_scans (markets, work) values ('[]', '{\"errors\":[]}')"
echo "same-key rows: $($P -c "select count(*) from dbv5_agent_log where work_key = 'V5-1:close:final'")"
echo "null-key rows: $($P -c "select count(*) from dbv5_agent_log where work_key is null")"
echo "scan work column: $($P -c "select count(*) from dbv5_scans where work is not null")"
