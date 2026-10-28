#!/usr/bin/env bash
# Two REAL concurrent sessions calling the writer. Session A holds its transaction open for ~1.5 s after writing; B starts 0.4 s later.
set -euo pipefail; DB="$1"; W="$2"
P="psql -qXAt -v ON_ERROR_STOP=0 -d $DB"
call() { # $1 decision file  $2 inputs file
  printf '\\set d `cat %s`\n\\set i `cat %s`\nset role service_role;\nselect public.dbv5_record_decision(:'"'"'d'"'"'::jsonb, :'"'"'i'"'"'::jsonb);\n' "$1" "$2"; }
fresh() { # a new decision id for each scenario so earlier scenarios do not interfere
  python3 -I - "$W" "$1" <<'PY'
import json, sys, copy
w, tag = sys.argv[1], sys.argv[2]
d = json.load(open(w + "/d.json")); i = json.load(open(w + "/inputs.json")); nid = d["id"] + "-" + tag
d["id"] = nid; d["record"]["decisionId"] = nid
for r in i: r["decision_id"] = nid
json.dump(d, open(f"{w}/c_{tag}.json", "w")); json.dump(i, open(f"{w}/ci_{tag}.json", "w"))
c = copy.deepcopy(d); c["record"]["plan"]["entry"] += 1; json.dump(c, open(f"{w}/cc_{tag}.json", "w"))
PY
}
# --- scenario 1: identical concurrent requests
fresh id
{ echo 'set role service_role;'; echo 'begin;'; echo "\\set d \`cat $W/c_id.json\`"; echo "\\set i \`cat $W/ci_id.json\`"; echo "select public.dbv5_record_decision(:'d'::jsonb, :'i'::jsonb);"; echo 'select pg_sleep(1.5);'; echo 'commit;'; } > $W/a.sql
call $W/c_id.json $W/ci_id.json > $W/b.sql
( $P -f $W/a.sql > $W/a.out 2>&1 ) & PA=$!
sleep 0.4; T0=$(date +%s.%N); $P -f $W/b.sql > $W/b.out 2>&1; T1=$(date +%s.%N); wait $PA
A=$(grep -E '^(t|f)$' $W/a.out | head -1); B=$(grep -E '^(t|f)$' $W/b.out | head -1); EL=$(python3 -c "print(round($T1-$T0,2))")
echo "identical concurrent: A=$A B=$B (B waited ${EL}s)"
[ "$A" = "t" ] && [ "$B" = "f" ] || { echo "FAIL identical concurrent requests: expected A=t B=f"; cat $W/a.out $W/b.out; exit 1; }
python3 -c "import sys; sys.exit(0 if $EL>0.8 else 1)" || { echo "FAIL: B did not wait for A's transaction"; exit 1; }
N=$($P -c "select (select count(*) from public.dbv5_decisions where id='$(python3 -c "import json;print(json.load(open('$W/c_id.json'))['id'])")')||'/'||(select count(*) from public.dbv5_decision_inputs where decision_id='$(python3 -c "import json;print(json.load(open('$W/c_id.json'))['id'])")')")
[ "$N" = "1/4" ] || { echo "FAIL: expected 1/4 rows, got $N"; exit 1; }; echo "PASS  identical concurrent writers: one insert, one no-op, rows 1/4"
# --- scenario 2: same id, conflicting content concurrently
fresh cf; { echo 'set role service_role;'; echo 'begin;'; echo "\\set d \`cat $W/c_cf.json\`"; echo "\\set i \`cat $W/ci_cf.json\`"; echo "select public.dbv5_record_decision(:'d'::jsonb, :'i'::jsonb);"; echo 'select pg_sleep(1.5);'; echo 'commit;'; } > $W/a2.sql
call $W/cc_cf.json $W/ci_cf.json > $W/b2.sql
( $P -f $W/a2.sql > $W/a2.out 2>&1 ) & PA=$!; sleep 0.4; $P -f $W/b2.sql > $W/b2.out 2>&1 || true; wait $PA
grep -qE '^t$' $W/a2.out || { echo "FAIL: first writer should succeed"; cat $W/a2.out; exit 1; }
grep -q "different content" $W/b2.out || { echo "FAIL: conflicting concurrent writer must be rejected"; cat $W/b2.out; exit 1; }
echo "PASS  conflicting concurrent writer rejected after waiting for the first commit"
# --- scenario 3: two different decisions at the same time both succeed
fresh p1; fresh p2
( { echo 'set role service_role;'; echo "\\set d \`cat $W/c_p1.json\`"; echo "\\set i \`cat $W/ci_p1.json\`"; echo "select public.dbv5_record_decision(:'d'::jsonb, :'i'::jsonb);"; } > $W/p1.sql; $P -f $W/p1.sql > $W/p1.out 2>&1 ) &
call $W/c_p2.json $W/ci_p2.json > $W/p2.sql; $P -f $W/p2.sql > $W/p2.out 2>&1; wait
grep -qE '^t$' $W/p1.out && grep -qE '^t$' $W/p2.out || { echo "FAIL: distinct concurrent decisions must both succeed"; cat $W/p1.out $W/p2.out; exit 1; }
echo "PASS  distinct concurrent decisions both recorded"
