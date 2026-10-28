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
