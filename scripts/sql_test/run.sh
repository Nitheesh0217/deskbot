#!/usr/bin/env bash
# Runs the provenance migration tests against a REAL PostgreSQL server in a throwaway database. Never point this at a real project.
# Needs psql and a server reachable through the standard PG* environment variables (PGHOST, PGPORT, PGUSER). Usage: scripts/sql_test/run.sh bundle.json
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."; BUNDLE="${1:-$ROOT/docs/evidence/provenance_sandbox_bundle.json}"
WORK="$(mktemp -d)"; DB="dbv5_sqltest_$$"; trap 'psql -qX -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
python3 -I - "$BUNDLE" "$WORK" <<'PY'
import json, sys, copy
b = json.load(open(sys.argv[1])); w = sys.argv[2]
d, inputs = b["decision"], b["inputs"]
json.dump(d, open(w + "/d.json", "w")); json.dump(inputs, open(w + "/inputs.json", "w"))
# a second, distinct decision (different id everywhere; record_sha256 is opaque to SQL)
d2, i2 = copy.deepcopy(d), copy.deepcopy(inputs); nid = d["id"] + "-B"
d2["id"] = nid; d2["record"]["decisionId"] = nid
for r in i2: r["decision_id"] = nid
json.dump(d2, open(w + "/d2.json", "w")); json.dump(i2, open(w + "/inputs2.json", "w"))
# same id as the first, different record content (a conflicting retry)
d3 = copy.deepcopy(d); d3["record"]["plan"]["entry"] += 1; json.dump(d3, open(w + "/d_conflict.json", "w"))
print("payload sizes:", {k: len(json.dumps(v)) for k, v in {"d": d, "inputs": inputs}.items()})
PY
psql -qX -d postgres -c "create database $DB" >/dev/null
P="psql -qXAt -v ON_ERROR_STOP=1 -d $DB"
$P -f "$HERE/bootstrap.sql"
$P -f "${MIGRATION:-$ROOT/supabase/migrations/20261029_decision_provenance.sql}"
echo "== migration applied; applying again to prove idempotence"; $P -f "${MIGRATION:-$ROOT/supabase/migrations/20261029_decision_provenance.sql}"
sed "s#@@W@@#$WORK#g" "$HERE/tests.sql" | $P -f -
echo "== concurrency (two real sessions)"
bash "$HERE/concurrency.sh" "$DB" "$WORK"
echo "ALL SQL CHECKS PASSED"
