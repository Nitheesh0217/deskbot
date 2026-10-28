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

## Failure behavior
The decision is written **before** state is saved. If the write fails the run aborts for that book: no position, OPEN event or equity row from that run (test: `provenance_handler.test.ts`). Existing-position management runs earlier in the same iteration and is not affected. Known limit: after a successful decision write a later failure (state save) leaves a decision with no position (an orphan); it is never edited or deleted, and the verifier lists it (`decision without position or trade`). Fully atomic state/ledger transitions are the next increment (see below), not claimed here.

## Replay and verification
`npx tsx scripts/replay_decision.ts bundle.json` recomputes hashes, rebuilds indicators from the stored bars with the stored config, re-runs `evaluate` and the entry gates, and prints every disagreement with the recorded candidates and plan; with a trade it reconciles the outcome. Export for a live decision (read-only): select `record`, `record_sha256` from `dbv5_decisions`, rows of `dbv5_decision_inputs`, and `data` from `dbv5_trades`. `npm run build-info:check` fails when `build_info.ts` is stale (CI/tests also check it). The replay uses the **current** engine code; if `sameSourceAsRecorded` is false, check out the recorded source hash first.

## Limits
- Only entries made after deployment have evidence; earlier trades remain unattributable (research CORRECTIONS C-006).
- The 1m path used for management is not stored per decision yet (management replay is increment 2).
- Secrets: records are built from whitelisted fields and scanned; the scan fails closed (entry aborted) on a secret-like key or value.
- Matching the engine's signal on stored bars proves determinism of the code, not market truth or profitability.
