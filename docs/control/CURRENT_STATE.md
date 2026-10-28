# Current state

Audit date: October 28, 2026. Source base: `cd81d6f45eac9fe72bf6862cdcdd2f84cff1bf1c` on `claude/multi-agent-v5.8`; main remains `5bb02718208d7c3ae16d5c7f12ca96e0730a0f11`. These are distinct branches, not evidence that the deployed artifact matches either SHA.

| Capability | Classification | Evidence / limit |
|---|---|---|
| Deno/TypeScript engine, 11 strategy IDs, BTC/PAXG mapping | Verified source exists | engine.ts, data.ts; runnable synthetic software tests |
| Shared backtest/paper logic | Partially implemented | Shared functions exist, but 5m historical/1m runtime manager inputs differ |
| v5.8 agents and flags | Verified source exists | agents.ts, docs/AGENTS.md; deterministic chart/validator/risk/re-entry; optional LLM review is shadow |
| Agent profitability | Claimed research only | docs/AGENTS.md reports poor A/B results; no market backtest rerun in this increment |
| Static dashboard, charts, agent log and owner chat | Partially verified | web/index.html inspected; no authenticated browser smoke test performed |
| Continuous 24/7 operation | Verified (paper) | pg_cron 1915 runs, 0 failures since Oct 22; no equity gap since Oct 23; see EVIDENCE_LOG |
| Full current DB schema and RLS | Verified, partly uncovered by migrations | SCHEMA_SNAPSHOT.md; repo migrations incomplete; `bot_state` RLS off |
| Exact deployed artifact identity | Verified for v18 | 8 files byte-identical to a build of branch commit 1ec864d; v17 differed from source only in a chat prompt escape |
| Numeric approval gate | Misleading documentation | index.ts defaults enforcement off; RUNTIME_INTEGRITY.md describes a stricter policy |
| Cross-worker consistency | Partially implemented | Isolate serialization and lease calls exist; no committed fencing/atomic state+ledger transaction |
| News evidence | Partially implemented | RSS/rules and optional providers exist; no complete point-in-time archive or universal instrument coverage |
| External signal ingestion | Missing as explicit independent feed | Internal strategy signals exist; no verified external provider baseline contract |
| Approved universe scanner | Missing | BTC/GOLD books are not a general eligibility scanner |
| Experiment manifest registry / isolated final data | Missing as enforced infrastructure | Research scripts/reports exist; controls are not enforced merely by documentation |
| Funded execution | Absent in inspected source | Paper-only code; no authorization to add it |
| Dependency install and existing software checks | Verified locally | Pinned existing npm packages installed with scripts disabled; 54 baseline tests and typecheck passed |
| Read-only evidence observer | Implemented in this branch | scripts/audit_status.mjs; 15 focused tests before final regression run |

## Priority risks

1. Treating a current paper configuration as validated by an older, differently configured backtest.
2. Confusing PAXG/spot/perpetual/XAUUSD instrument results or a heuristic score with probability.
3. Inferring an edge from small samples, agent agreement or software-test success.
4. Required context requests can fail before open-position management runs; persistence is multi-request.
5. GitHub Actions jobs for this repo never reach a runner (all CI and heartbeat runs fail in ~2 s with no steps): the GitHub heartbeat has never executed and CI is not providing evidence. Cause unconfirmed (billing/policy suspected). A latent heartbeat defect (fails on missing config approval) is fixed but untested on a runner.
6. Runtime public status is bounded; count-matching is internal consistency, not complete provenance or broker verification.

See EVIDENCE_LOG.md for actual checks and remaining gaps. Historical October 26 financial observations should not be presented as current balances.

7. Active strategies (SWEEP_REV, SESSION_BO, VWAP_REVERT, gold EMA_CROSS) differ from the displayed v5.1 validation and are net negative so far on small samples (BTC -3.4%, GOLD -7.9% over ~6 days).
8. Config approval fingerprints are unset and enforcement is off; entries are not paused despite `approved=false`.
