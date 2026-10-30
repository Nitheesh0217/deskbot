# Architecture and contracts

## Existing deployment

Supabase cron → Deno function index.ts → market data + deterministic engine + optional news/AI → PostgREST state/trades/events/equity/agents → public status → static Vercel dashboard. GitHub workflows perform checks/heartbeat; the v5.8 branch additionally contains a deploy workflow. No new deployment is part of this increment.

## New observer boundary

`scripts/audit_status.mjs` is Node-only and never imports the executor. A user explicitly selects a local JSON file or one fixed public GET endpoint. Redirects are rejected, timeout is 30 seconds, input is limited to 8 MiB, and no authentication headers are accepted. Unknown/raw fields are not emitted. Reports are gitignored and local; output is not served by the existing website.

`auditStatus(status, options)` is pure and does not mutate the input. Options include an injected clock, max age, source version and checkout SHA. Output contains schemaVersion=1, capture time, mode, source identity, books, findings, readiness and executionDecision=WAIT. The CLI adds raw-input SHA256, capture method and dirty-checkout status. Source identity always refers to the checkout, not a proved deployed artifact.

| Field | Meaning |
|---|---|
| books[].coverage | count-matched / partial / excess / unknown for returned closed rows vs state stats |
| books[].ledgerMatches | Boolean only for valid count-matched rows; otherwise null |
| books[].equityMatches | start + aggregate closed net vs equity, only when explicitly flat; otherwise null |
| books[].feesInReturnedRows | Diagnostic fee sum, already included in source net; do not deduct again |
| findings[].severity | blocker / warning / unknown; missing evidence is not silently passed |
| readiness | NEEDS_CHANGES if a blocker exists, otherwise INCOMPLETE; never certifies trading readiness |
| executionDecision | Always WAIT; this is an evidence observer, not a forecast or broker command |

Clock checks independently inspect book update time, last-run time and market closed-bar time. Optional GOLD is omitted only when absent. Present but malformed GOLD is flagged. Unknown symbols are flagged, not renamed BTC. No fallback turns missing values into zero.

## Planned module boundaries

Reuse data.ts for adapters and engine.ts for strategies/features/risk/paper execution. Add instrument registry and immutable decision envelopes only after deployed-source/schema access is resolved. Research manifests and final-evaluation boundaries remain separate from production configuration. Extend the existing dashboard when those records exist. News interpretation and post-trade prose may use LLMs, but numeric vetoes and lifecycle state remain deterministic.

The future decision envelope must include decision ID, native instrument+venue, data cutoff/availability, code/config/strategy version, original candidate, UP/DOWN/WAIT, trigger/invalidation/stop/targets/expiry, risk amount and reason codes. External signals retain their original IDs and payload hashes. No numerical win probability without held-out calibration. This future envelope is a design contract, not implemented live telemetry.

## Work-log persistence and book-state concurrency (PR #19; `persist.ts`, `worklog.ts`)
The four properties are separate, and none of them alone is "exactly once":

| Property | Mechanism | Limit |
|---|---|---|
| **State concurrency protection** | Every book-state write is a compare-and-set on `state._rev`: `PATCH dbv5_state?id=eq.<book>&state->>_rev=eq.<loaded>` (`state->_rev=is.null` for a legacy row) with `return=representation`. Zero rows means `StateConflict`, and nothing is written. Applies to the run save, the outbox fallback save, the provider-counter save and chat apply/undo. | A conflicting run aborts (ERROR event) instead of merging. The lease is still one 120 s lease without fencing. CAS is what stops a stale worker overwriting a newer book. |
| **Durable retention** | Unconfirmed position-manager records live in `state._workOutbox` and are saved in the same write as the management they describe. No cap; repeats merge by key; `queuedAt` marks first entry. | State grows during a long log outage. Backlog size and oldest record are exposed in status (`work.backlog`, `books[sym].work`) and on Theo's desk (DEGRADED after 30 min). |
| **Eventual delivery** | Each run flushes the outbox in batches of 100. After a batch insert succeeds, `rpc/dbv5_ack_work` removes exactly those keys in one statement: no other field changes and `_rev` does not move. An insert failure stops the flush; the rest stays pending; an ERROR event records the failure and the pending count. Without the RPC, the trimmed outbox is saved by compare-and-set. | Delivery happens once the log path works and a run reaches the flush. A record can be sent more than once (at-least-once). |
| **Duplicate suppression** | `dbv5_agent_log.work_key` unique index; inserts use `?columns=…&on_conflict=work_key` with `Prefer: resolution=ignore-duplicates`. Re-sending a delivered record is a no-op. Without the column: check-then-insert (safe only without overlapping runs). | Keys live in the agent log, which is pruned after 14 days; a record re-sent after pruning would be accepted again. Keys are never regenerated for old actions, so this needs a >14-day-old outbox entry. |

Tests:
- `tests/outbox_durability.test.ts`: >200 pending, partial failure, the stale-ack race, legacy CAS.
- `tests/desk_handler.test.ts`: through the edge handler, including 250 pending records + outage + recovery.
- `scripts/sql_test/postgrest.sh`: the application's requests over HTTP against PostgREST 12.2.3 + PostgreSQL 16 with the migration.
- `scripts/sql_test/work_key.sh`: direct SQL concurrency.
