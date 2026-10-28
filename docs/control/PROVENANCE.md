# Decision provenance (M2, increment 1)

Goal: any **new** paper entry can be reconstructed from stored evidence without guessing. Paper only; no broker code; no change to signals, sizing, risk or exits.

## What is recorded, and where
Existing storage was inspected first (SCHEMA_SNAPSHOT.md). `dbv5_trades` is written only at close and stores no version/config; `dbv5_events` is a mutable-style log; `dbv5_state` is overwritten each run. None can hold pre-trade evidence, so two additive tables were added (migration `20261029_decision_provenance.sql`; **not applied to production yet**):

| table | content |
|---|---|
| `dbv5_decisions` | one row per entry: `id = "D-" + position id`, `record` jsonb, `record_sha256` |
| `dbv5_decision_inputs` | per decision and timeframe (m5, m15, h1, h4): source, the exact closed bars the engine saw, `bars_sha256` |
Both are append-only (UPDATE/DELETE/TRUNCATE blocked by trigger for every role), RLS on, no anon/authenticated grants, written only through `dbv5_record_decision()` (one transaction, service_role). Size is about 0.1-0.2 MB per entry; no pruning.

Record fields (`schema deskbot.decision/1`): decision id and position id; decision time and data availability (snapshot bar close, lag); mode PAPER, portfolio `deskbot-v5/<book>`, experiment id (`DESKBOT_EXPERIMENT_ID`, default `baseline-paper`); instrument (book, venue, native symbol, fallback venue; instrument kind and contract spec are explicitly **unverified / modeled**: lot, tick and minimum notional are not applied by the engine); build (engine version + sha256 of every source file, `build_info.ts`); canonical resolved config + its sha256 + the existing versioned fingerprint; input hashes per timeframe and the external context (funding, OI, mark price used, Fear and Greed, order-flow shadow); the account state used by the entry rules (equity, probation stats, circuit breaker, daily counters, last signals) with hash; every candidate signal, engine rejects, gate notes and news block; the chosen signal; the immutable plan (entry, original stop `stop0`, TP1-3, expiry, quantity, original dollar risk, sizing derivation, modeled fee/slippage and round-trip cost in R).

Linking: `Trade.data.decisionId`, and `decisionId` inside OPEN, TP, MANAGE and WIN/LOSS event data. Fills, partial exits, fees and funding stay in the trade's `exits` (as before). `reconcileOutcome()` compares the closed trade with the plan and reports every disagreement; **R always uses the original dollar risk and `stop0`**, never a tightened stop.

## Four separate statuses (never one flag)
`governance` in each record: **configIdentity** (hash of version+book+resolved config; an identity only), **experimentApproval** (does the runtime fingerprint secret match; says nothing about merit; reports whether enforcement was on), **financialValidation** (`none` unless a reviewed, frozen-protocol result exists; a deployed or observed losing baseline stays `none`), **fundedExecution** (`not_authorized`; no code path exists). Do not copy a runtime hash into `DESKBOT_<BOOK>_CONFIG_HASH` to silence the warning: approve a fingerprint only for a stated paper experiment, and record that decision in DECISIONS.md.

## Failure behavior (revised after review of aeac165)
Management of an open position runs first and its results (closed trade, quantities, fees, equity, events) are applied to the run state. The entry decision is then tried on a **copy** of that state (the pre-entry boundary). Only when the decision evidence has been durably recorded is the copy adopted. If the evidence write fails:
- the replacement entry is rejected: no position, no OPEN event, no entry fee, no trade-count increment, no equity change from the entry;
- the run still saves everything that already happened (closed trade, state, equity, WIN/LOSS and management events), so a completed exit is never lost;
- the failure is visible: an ERROR event (`data.provenance = true`), `lastRun.provenanceError`, and `provenanceError` in the run result;
- the evaluated bar is consumed, so the rejected entry is not retried on the same bar and a retry cannot double-realize the closure (tests: `provenance_handler.test.ts`, which also fails if the entry is made to throw instead).
Residual limits: a decision row can exist without a persisted position if a later write (state save) fails after the evidence commit (an orphan; never edited or deleted). State, trades and equity are still separate REST writes, so a crash between them can leave partial persistence: closing that gap (atomic or recoverable transitions) is the next increment and is **not** claimed here.

## Replay and verification
`npx tsx scripts/replay_decision.ts bundle.json` recomputes hashes, rebuilds indicators from the stored bars with the stored config, re-runs `evaluate` and the entry gates, and reports every disagreement. With a trade it **rebuilds exit economics independently** (per exit: quantity rule, planned TP level, pnl from direction/entry/quantity/price, fee from the recorded fee model; then gross, fees, net, original-risk R, exit average) instead of trusting stored pnl. It reports what it cannot rebuild: **funding** (hourly rates are not stored) and stop/market exit prices (the management path is not stored) are listed as unverified.
Overall status and exit code: `LIFECYCLE_VERIFIED_FUNDING_UNVERIFIED` (0), `ENTRY_VERIFIED_POSITION_OPEN` (0), `ENTRY_DISAGREEMENT` / `OUTCOME_DISAGREEMENT` (1), `SOURCE_MISMATCH_NOT_VERIFIED` and `DIAGNOSTIC_CROSS_VERSION_ONLY` (3, never verified), `ENTRY_VERIFIED_OUTCOME_MISSING` (4). A result is verified only when the recorded `build.sourceSha256` equals this checkout; `--allow-source-mismatch` runs a labeled diagnostic and still exits 3. Export for a live decision (read-only): `record`, `record_sha256` from `dbv5_decisions`, rows of `dbv5_decision_inputs`, and `data` from `dbv5_trades`. `npm run build-info:check` fails when `build_info.ts` is stale.

## Timing fields (`record.timing`)
`runStartMs` and `evaluationTimeMs` are the engine's run-start `now` (used for entry gates and the modeled fill, `plan.openT`); they are **not** data-receipt times. `inputReceivedAtMs` has the local time each input response was read (m5, m15, h1, h4, ctx, fng, flow; a cached Fear and Greed value reports the cache time and `fngCached: true`; unknown is `null`). `decisionCompletedMs` is when the record was built. Persistence acknowledgement is `dbv5_decisions.created_at` (database clock), outside the hashed record. Provider candle responses carry no server timestamp, so receipt is the local read time.

## Database function (`dbv5_record_decision`)
Validates before writing: exactly one input row per m5/m15/h1/h4, input decision ids, source/hash/count consistent with the record's references, schema, `decisionId`, `sym`, `decidedAt` = `ts`. A transaction-scoped advisory lock serialises writers of the same id; identical retries return false and change nothing; same id with different record or inputs raises; any failure rolls back the decision and its inputs. It cannot recompute the SHA-256 of the canonical JSON (that is verified in TypeScript by the replay). SECURITY DEFINER is used on purpose: service_role has SELECT only, so it cannot insert directly and skip validation; execute is granted to service_role only; `search_path` is pinned. Tested on PostgreSQL 16 in an isolated database (`scripts/sql_test/run.sh`; log in `docs/evidence/sql_test_run.log`), not against the production project.

## Limits
- Only entries made after deployment have evidence; earlier trades remain unattributable (research CORRECTIONS C-006).
- This increment reconstructs the **entry decision** and rebuilds exit economics. It does **not** reproduce the one-minute management path (stop moves, trade-manager actions): the 1m bars are not stored yet, so stop/market exit prices and funding are reported unverified.
- Secrets: records are built from whitelisted fields and scanned; the scan fails closed (entry aborted) on a secret-like key or value.
- Matching the engine's signal on stored bars proves determinism of the code, not market truth or profitability.
