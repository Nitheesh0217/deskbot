# Tasks

## T001 — Establish a read-only evidence desk

Objective: recover current source context and make bounded status observations auditable without changing the trading engine.

Why next: main/v5.8 differ, current configuration differs from saved validation, and production DB access is absent.

Prerequisites: readable repository; existing Node dependencies. Public fetch is optional; offline input works.

Scope: branch audit, capability/control docs, pinned skill review, observer CLI, redacted static HTML/JSON and behavior tests.

Out of scope: changing numerical signals, funded orders, new agent runtimes, deployment, migrations, settings, model calls or a full dashboard rewrite.

Files: scripts/audit_status.mjs, tests/status_audit.test.ts, README.md, package.json, .gitignore, docs/control/*, docs/research/TRADING_SKILLS_REVIEW.md. Existing docs/AGENTS.md remains the v5.8 role description.

Contracts: ARCHITECTURE.md; raw status is untrusted/bounded, report schemaVersion=1, missing values remain unknown, WAIT is an evidence gate.

Acceptance:
- Existing engine behavior and production config untouched.
- Known book mappings explicit; source/version, age and approval gaps visible.
- Duplicates, invalid numeric fields and partial ledger coverage do not pass reconciliation.
- JSON/HTML exclude raw news/chat/secrets/trade IDs; HTML escapes data and has no executable JS.
- Offline and public-GET flows have exact exit semantics and tests.
- Existing tests and typecheck pass; publish and verify the review branch.

Tests: npm test; npm run typecheck; CLI offline regression, mocked GET, input-size bounds, ledger/freshness/source failures. Existing synthetic tests are software evidence only.

Manual verification: generate reports locally; inspect actual findings; inspect static HTML structure. Record explicitly whether browser visual inspection was performed.

Security/performance: fixed GET URL/no credentials; 8 MiB bound; no raw public snapshots committed; bounded observation in memory. No claim of exact per-frame source metadata.

Rollback: revert this observer/docs commit or stop invoking the CLI. No production state/schema rollback required.

Evidence: EVIDENCE_LOG.md and actual command results. Local implementation VERIFIED: 69 tests and typecheck pass. Publication BLOCKED: GitHub branch creation returned HTTP 403. No remote publication is claimed.

## T002 — Reconcile exact deployed source (DONE 28 Oct 2026; see EVIDENCE_LOG and SCHEMA_SNAPSHOT.md)

Objective: compare deployed artifact to recovered v5.8 source and inventory real schema/jobs/config history. Read-only. Return redacted deployment identity, config history, schema/grants/RLS, cron/lease definitions and diagnostic logs. Do not run committed migrations over production.

## T004 — Per-strategy attribution under the frozen baseline (NEXT)

Objective: decide with evidence whether SWEEP_REV, SESSION_BO, VWAP_REVERT (both books) and gold EMA_CROSS belong on the paper books. Method: for each active strategy and book, run the existing backtester with `only:<strategy>` on 365-day Binance windows (last year and prior year) using each book's exact live cfg, record n, expR, PF, OOS expR, maxDD and fees share; compare with the live per-strategy stats in `dbv5_state.stats.by`. Pre-register the rule before running: a strategy stays on only if expR > 0 after costs in both windows. Retain failures. No config change until results are reviewed; ignore the 5m-vs-1m manager difference by running with TRADER off for attribution.

## Next coding-agent prompt

Latest T003 status: local website evidence/disconnection fixes and optional-AI quota fix VERIFIED by 79 tests/typecheck. Deployment BLOCKED by service authorization. See DEPLOYMENT_HANDOFF.md for exact targets, release order, smoke checks and rollback. T002's exact-artifact dependency remains before backend release; a separately reviewed website-only preview does not change trading behavior.

```text
Resume DeskBot from docs/control/HANDOFF.md and EVIDENCE_LOG.md. Inspect the
worktree, branch and applicable instructions before editing. Keep changes
focused, preserve unrelated work and existing paper history.

Work on T002 only after T001 evidence is reviewed. Recover the exact deployed
artifact/SHA and configuration history using authorized read-only access.
Compare it with claude/multi-agent-v5.8 at cd81d6f45eac9fe72bf6862cdcdd2f84cff1bf1c.
Inventory actual tables, RLS/grants, RPCs, cron jobs and lease behavior. Resolve
the missing lease/schema definitions, approval-policy discrepancy and stale
validation attribution. Fetch runner annotations before diagnosing heartbeat
failure. Never print secrets or invoke run/backtest/config endpoints.

If access is missing, report the exact unavailable resource and continue only
with independent local checks. Do not claim complete live verification.
Return exact commands/results, source lines, sanitized metadata and a focused
diff if needed. No deployment, paid service, live orders or risk changes.
Use VERIFIED / NEEDS CHANGES / BLOCKED with evidence for each finding.
```
