# Release W2 + W3: truthful workers, durable work log, strategy coverage, shadow lane

Status: **candidate prepared, NOT released.** Every step below that changes production needs owner approval.

## Identity
| Item | Value |
|---|---|
| Backend candidate (immutable) | **`5662f80dee237c6e30513ce0e3e681c5382b7473`** (tree `a0f7eb989d031b895efe1bb43b8698c82549f965`), branch `release/w2-w3`: merge of PR #19 `85a5f1b` + PR #20 `cb7c553` (= earlier candidate `0326916`), plus release-readiness commits `78a945f` (outbox guard trigger, flush budget) and `5662f80` (rollback test) |
| Rollback artifact (after the lane migration only) | **`afdf44a069c314689649c59ee4407f052295c654`** on `rollback/v24-lane-compat`: v24 `3e25392` with two request strings made lane-aware |
| Frontend preview of the candidate | Vercel preview of `5662f80` (look it up with `list_deployments sha=5662f80…`; the `0326916` preview was `dpl_xcmgiZ9oco2GAsB1siziLgo4Wwou`) |
| Current production backend | edge function `deskbot-v5` v24 → `3e253929b282b903f6842ed9ab0716f7123e9647` |
| Current production frontend | Vercel `dpl_2V5vuDPQndNEG94J3mKmCDEYk2U7` (from `3e25392`) |
| Migrations | `20261030_scan_work.sql` (agent_log.work_key + unique index, scans.work, `dbv5_ack_work` RPC, `dbv5_state_outbox_guard` trigger), then `20261030_shadow_lane.sql` (scan_signals lane + cfg_id, key `(sym,strategy,bar_t,lane)` replaces `(sym,strategy,bar_t)`, guard) |

Later commits on `release/w2-w3` may only change `docs/`. Source equivalence is proven at merge time by step 7.

## Temporary compatibility mode (between step 1 and step 5)
The candidate runs on the old schema with these tested fallbacks. Keep this window short (one or two runs and one scan):

| Missing piece | Fallback | Risk in the window |
|---|---|---|
| `work_key` column / index | check-then-insert of manager records | duplicates possible only if two runs overlap |
| `dbv5_ack_work` RPC | the trimmed outbox is saved by compare-and-set | an extra state write per flush |
| `dbv5_state_outbox_guard` trigger | none | a stale writer can put a delivered record back in the outbox; it is re-sent and de-duplicated by the check |
| `scans.work` | scan row written without telemetry | the tower shows UNKNOWN for the scan sub-workers |
| lane key | book setups use the old key; the shadow lane is skipped and reported in `tracked.errors` | no shadow evidence in the window |

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
   `import "https://raw.githubusercontent.com/Nitheesh0217/deskbot/5662f80dee237c6e30513ce0e3e681c5382b7473/supabase/functions/deskbot-v5/index.ts";`, `verify_jwt=false`. Record the new edge version and confirm `get_edge_function` shows exactly this import.
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
   - Work-log health: `work.lastFlush` shows a WORKLOG result per book; `work.backlog.*.pending` is 0 or falling; any backlog drains at most 500 records per run.
7. **Merge** (approval required) the release PR `release/w2-w3` → `main` with a merge commit, then prove equivalence:
   `git diff --stat 5662f80dee237c6e30513ce0e3e681c5382b7473 <merge-sha> -- supabase/ web/ scripts/ tests/` must be empty (only `docs/` may differ).
   If it is not empty, stop: redeploy the backend from the merge SHA after re-running the checks.
8. **Frontend** (Vercel auto-deploys the merge). Confirm the production deployment's `githubCommitSha` is the merge SHA and the build is READY. Then load `#tower`, `#strategies` and `#scanner` and check the states against the status JSON.

Provenance and entries: do **not** force an entry to exercise decision records. They are verified when the next natural entry happens.

## Rollback (by component; pick the row for the current migration state)
| Component | Before `20261030_shadow_lane.sql` | After `20261030_shadow_lane.sql` |
|---|---|---|
| **Frontend** | Vercel instant rollback to `dpl_2V5vuDPQndNEG94J3mKmCDEYk2U7` | same. The old UI ignores the new status fields |
| **Trading loop** (runs, management, entries) | Re-pin the edge entry to `3e253929b282b903f6842ed9ab0716f7123e9647` (v24) | Re-pin to the artifact `afdf44a069c314689649c59ee4407f052295c654`. Its trading code is byte-identical to v24 (pre-flight against the live snapshots equals v19/v24) |
| **Scanner / setup tracker** | Plain v24 works | Plain v24 **fails**: its `on_conflict=sym,strategy,bar_t` has no arbiter (PostgreSQL 42P10, reproduced). The artifact writes book rows with the lane-aware key, reads only `lane=eq.book`, and keeps every shadow record (`ROLLBACK=1 scripts/sql_test/postgrest.sh`, 4/4) |
| **Schema** | Leave the migrations in place (additive) | Leave in place. Do not re-add the 3-column key or drop shadow rows: one bar can legitimately hold a book and a shadow row |
| **State** | v24 ignores `_rev` and `_workOutbox` and writes them back unchanged; pending records wait for roll-forward | same. The outbox guard trigger only removes already-logged records |

The edge function serves one artifact, so trading-loop and scanner rollbacks are the same deploy. They are listed separately because they fail differently.
