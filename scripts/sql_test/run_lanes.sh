#!/usr/bin/env bash
# Tests the DRAFT shadow-lane migration on a real PostgreSQL server in a throwaway database (PG* env vars select the server). Never use a real project.
set -euo pipefail; HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."; DB="dbv5_lanetest_$$"
trap 'psql -qX -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
psql -qX -d postgres -c "create database $DB" >/dev/null; P="psql -qXAt -v ON_ERROR_STOP=1 -d $DB"
$P -f "$HERE/bootstrap.sql"; $P -f "$ROOT/supabase/migrations/20261029_shadow_lanes.sql"; echo "== applied; applying again (idempotence)"; $P -f "$ROOT/supabase/migrations/20261029_shadow_lanes.sql"
$P -f "$HERE/lanes.sql"; echo "LANE SQL CHECKS PASSED"
