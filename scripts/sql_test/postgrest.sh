#!/usr/bin/env bash
# Real PostgREST (12.2.3) + PostgreSQL 16 check of the application's persistence requests (persist.ts) with the W2 migration.
# Needs: /usr/lib/postgresql/16/bin and a postgrest binary (POSTGREST=/path/to/postgrest). Throwaway cluster, removed on exit.
set -euo pipefail
BIN=/usr/lib/postgresql/16/bin; ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; PGRST="${POSTGREST:?set POSTGREST to the postgrest binary}"
D="$(mktemp -d /tmp/deskbot_pg.XXXXXX)"; mkdir -p "$D/pg"; cp "$ROOT/supabase/migrations/20261030_scan_work.sql" "$D/mig.sql"; chown -R postgres "$D" 2>/dev/null || true; chmod a+r "$D/mig.sql"
run() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run "$BIN/initdb -D $D/pg/data -A trust -U postgres >/dev/null"
run "$BIN/pg_ctl -D $D/pg/data -o '-k $D/pg -p 54331 -c listen_addresses=' -l $D/pg/log -w start >/dev/null"
PID=""; trap '[ -n "$PID" ] && kill $PID 2>/dev/null; run "$BIN/pg_ctl -D $D/pg/data -m fast stop >/dev/null"; rm -rf "$D"' EXIT
P="psql -h $D/pg -p 54331 -U postgres -v ON_ERROR_STOP=1 -qAt"
$P <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role authenticator login noinherit; grant anon, service_role to authenticator;
create table public.dbv5_state (id text primary key, state jsonb, last_run jsonb, updated_at timestamptz default now(), lease_until timestamptz, lease_owner text);
create table public.dbv5_agent_log (id bigserial primary key, ts timestamptz default now(), symbol text, agent text, input_summary text, output jsonb, provider text, ms int, error text);
create table public.dbv5_scans (id bigserial primary key, ts timestamptz default now(), markets jsonb not null, deriv jsonb, note text, ms int);
alter table public.dbv5_state enable row level security; alter table public.dbv5_agent_log enable row level security;
grant usage on schema public to anon, service_role;
grant select, insert, update on public.dbv5_state, public.dbv5_agent_log, public.dbv5_scans to service_role;
grant usage on all sequences in schema public to service_role;
SQL
$P -f "$D/mig.sql"
SECRET="local-test-secret-not-used-anywhere-else-0123456789"
cat > "$D/pgrst.conf" <<CONF
db-uri = "postgres://authenticator@/postgres?host=$D/pg&port=54331"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = 54399
CONF
"$PGRST" "$D/pgrst.conf" > "$D/pgrst.log" 2>&1 & PID=$!
for i in $(seq 1 50); do curl -s -o /dev/null http://127.0.0.1:54399/ && break; sleep 0.2; done
JWT=$(node -e 'const c=require("crypto"),b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");const h=b({alg:"HS256",typ:"JWT"}),p=b({role:"service_role",exp:Math.floor(Date.now()/1e3)+600});console.log(h+"."+p+"."+c.createHmac("sha256",process.argv[1]).update(h+"."+p).digest("base64url"))' "$SECRET")
echo "PostgREST: $("$PGRST" --version | head -1); PostgreSQL: $($P -c 'show server_version')"
cd "$ROOT" && node --import tsx scripts/sql_test/postgrest_check.ts http://127.0.0.1:54399 "$JWT"
