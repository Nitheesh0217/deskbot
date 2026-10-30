# Release W2 + W3: truthful workers, durable work log, strategy coverage, shadow lane

Status: **candidate prepared, NOT released.** Every step below that changes production needs owner approval.

## Identity
| Item | Value |
|---|---|
| Backend candidate (immutable) | `032691665a56b9ec62d2923bee0f7eca6c22f956` (tree `1e1539a6826ecda5310fae3f16777b4530ea82c1`), branch `release/w2-w3` = merge of PR #19 head `85a5f1b` + PR #20 head `cb7c553` |
| Frontend preview of the candidate | Vercel `dpl_xcmgiZ9oco2GAsB1siziLgo4Wwou` (READY, built from `0326916`) |
| Current production backend | edge function `deskbot-v5` v24 → `3e253929b282b903f6842ed9ab0716f7123e9647` |
| Current production frontend | Vercel `dpl_2V5vuDPQndNEG94J3mKmCDEYk2U7` (from `3e25392`) |
| Migrations | `20261030_scan_work.sql` (agent_log.work_key + unique index, scans.work, `dbv5_ack_work` RPC), then `20261030_shadow_lane.sql` (scan_signals lane + cfg_id, key `(sym,strategy,bar_t,lane)` replaces `(sym,strategy,bar_t)`, guard) |

Later commits on `release/w2-w3` may only change `docs/`. Source equivalence is proven at merge time by step 7.

## Order and why
**Backend first, then migrations, then the merge (which auto-deploys the frontend).**
- The candidate backend works on the OLD schema through tested fallbacks:
  - no `work_key`: check-then-insert
  - no ack RPC: compare-and-set save
  - no `scans.work`: insert without it
  - no lane key: book rows only, shadow skipped and reported
- The OLD backend does **not** work on the NEW schema. v24 inserts setups with `on_conflict=sym,strategy,bar_t`, and the shadow-lane migration drops that key. Migrating first would break the v24 setup tracker until the redeploy.
- The new frontend reads fields only the new backend returns. The old frontend ignores them. So the frontend goes last.
- Vercel deploys `main` to production automatically on merge. Merging IS the frontend release.

## Checklist (each step: run, record the output in EVIDENCE_LOG, stop on any unexpected result)
0. **Baseline (read-only).** Record:
   ```sql
   select id, updated_at, state->>'_rev' rev, state->'pos'->>'id' pos, state->'pos'->>'stop' stop, state->>'equity' eq, jsonb_array_length(coalesce(state->'_workOutbox','[]')) outbox from dbv5_state where id in ('main','gold');
   select max(id) from dbv5_events; select max(id) from dbv5_agent_log; select max(id) from dbv5_scans; select count(*) from dbv5_scan_signals;
   ```
   Note the time against the cron schedule (runs at :01/:06/…, scans at :07/:22/:37/:52). Deploy just after a run, not within 60 s before one.
1. **Deploy the backend** (approval required): edge entry `index.ts` =
   `import "https://raw.githubusercontent.com/Nitheesh0217/deskbot/032691665a56b9ec62d2923bee0f7eca6c22f956/supabase/functions/deskbot-v5/index.ts";`, `verify_jwt=false`. Record the new edge version and confirm `get_edge_function` shows exactly this import.
2. **First run on the old schema** (next cron run). Pass criteria:
   - Each book row was written by CAS: `_rev` is now non-null and increments by the number of saves in that run.
   - No `ERROR` events other than fallback notices.
   - Any position change is explained by that run's inputs: each exit/stop change has a TP/STOP/MANAGE event (and manager rows once the log path works), equity moved by realized P&L + funding of those events, and each new `dbv5_trades` row matches a close event.
3. **First scan on the old schema.** Pass: HTTP 200. `tracked.errors` may contain "shadow lane skipped: lane identity not migrated". Book-lane setups are written with the old key. `scans.work` is absent (column not yet added).
4. **Apply `20261030_scan_work.sql`** (approval required). Verify column, unique index `dbv5_agent_log_work_key` and function `dbv5_ack_work` exist (`\d`, `pg_proc`).
5. **Apply `20261030_shadow_lane.sql`** (approval required). Verify `lane`/`cfg_id` columns, index `dbv5_scan_signals_lane_key`, the old constraint gone, and existing rows `lane='book'`.
6. **Post-migration run + scan.** Pass criteria:
   - Run: CAS saves continue; any outbox records are delivered (`dbv5_agent_log.work_key` populated, outbox empty or shrinking); no "check-then-insert" note.
   - Scan: `work.lanes.BTC.bookCfgId` / `shadowCfgId` start with `book:` / `SHADOW-1:`; every evaluator in `shadowIds` shows `evaluated>0, noData=0` or a recorded reason; shadow rows (if any) have `lane='shadow'`.
   - Status JSON has `work.backlog`, `ai`, `registry`, `books.GOLD.config`.
   - Do not expect unchanged equity or position: compare transitions against the run's inputs as in step 2.
7. **Merge** (approval required) the release PR `release/w2-w3` → `main` with a merge commit, then prove equivalence:
   `git diff --stat 032691665a56b9ec62d2923bee0f7eca6c22f956 <merge-sha> -- supabase/ web/ scripts/ tests/` must be empty (only `docs/` may differ).
   If it is not empty, stop: redeploy the backend from the merge SHA after re-running the checks.
8. **Frontend** (Vercel auto-deploys the merge). Confirm the production deployment's `githubCommitSha` is the merge SHA and the build is READY. Then load `#tower`, `#strategies` and `#scanner` and check the states against the status JSON.

Provenance and entries: do **not** force an entry to exercise decision records. They are verified when the next natural entry happens.

## Rollback
| Situation | Action | Effect |
|---|---|---|
| Problem before step 4 | Re-pin the edge entry to `3e253929b282b903f6842ed9ab0716f7123e9647` | Full rollback. State keeps a `_rev` field, which v24 ignores |
| Problem after the migrations | Prefer roll-forward. If rolling back the backend to `3e25392`: trading and management work; the v24 setup tracker's insert fails against the new key (scan job errors; no trading impact) | Tracker paused until roll-forward. The migrations stay (additive; the old key cannot be restored while both lanes hold rows for one bar) |
| Frontend problem after merge | Vercel instant rollback to `dpl_2V5vuDPQndNEG94J3mKmCDEYk2U7` | The old UI against the new backend: extra fields ignored |
| Outbox backlog grows | No rollback needed. Records are retained; fix the log write path; they deliver on the next run | Visible on Theo's desk and in `work.backlog` |
