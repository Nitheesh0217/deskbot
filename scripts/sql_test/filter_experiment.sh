#!/usr/bin/env bash
# FILTER-1 verdict table checks against a REAL PostgreSQL in a throwaway database. Never point this at a real project. Uses PG* env vars.
set -uo pipefail; cd "$(dirname "$0")/../.."; DB="fx_$$"; trap 'psql -qX -d postgres -c "drop database if exists $DB" >/dev/null 2>&1' EXIT
psql -qX -d postgres -c "create database $DB" && psql -X -q -d "$DB" <<'SQL' 2>&1 | grep -v "^$"
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
\i supabase/migrations/20261029_filter_experiment.sql
\i supabase/migrations/20261029_filter_experiment.sql
grant usage on schema public to service_role, anon;
set role service_role;
insert into dbv5_filter_verdicts(ref,arm,sym,strategy,take,verdict) values ('p1','rules','BTC','S',true,'keep'),('p1','ai','BTC','S',null,'no_provider');
select ref, arm, take, verdict, recorded_at is not null as ts from dbv5_filter_verdicts order by arm;
insert into dbv5_filter_verdicts(ref,arm,sym,strategy,take,verdict) values ('p1','rules','BTC','S',false,'skip');   -- expect duplicate key
update dbv5_filter_verdicts set take=false where ref='p1';                                                           -- expect permission denied
delete from dbv5_filter_verdicts;                                                                                    -- expect permission denied
insert into dbv5_filter_verdicts(ref,arm,sym,strategy,take,verdict) values ('p2','vibes','BTC','S',true,'x');       -- expect check violation
reset role;
update dbv5_filter_verdicts set take=false where ref='p1';                                                           -- owner: expect append-only trigger
truncate dbv5_filter_verdicts;                                                                                       -- owner: expect append-only trigger
set role anon; select count(*) from dbv5_filter_verdicts;                                                            -- expect permission denied
reset role; select count(*) as rows_still_there from dbv5_filter_verdicts;
SQL
