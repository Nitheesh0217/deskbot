# Current state

## Audit 30 Oct 2026, 00:00 UTC (W1)
Deployed identity, VERIFIED: edge function `deskbot-v5` version 24 imports `supabase/functions/deskbot-v5/index.ts` pinned at `3e25392` (main after PR #18). Vercel production `dpl_2V5vuDPQndNEG94J3mKmCDEYk2U7` was built from the same commit. The repo main HEAD is `3e25392`.

### Counts (each counted separately)
| What | Count | Basis |
|---|---|---|
| Displayed tower seats (before this slice) | 26 on 8 floors | `web/tower-model.js` ROSTER: 19 RULES/RULES+AI, 6 AI, 1 OFFLINE |
| Displayed seats after W2 | 31 | +scanner, call maker, setup tracker, options reader, assistant |
| Seats with a dedicated backend implementation that writes its own output | 14 | chart, signals (Sage), validator, risk (Quinn), decision (entry record), manager (Theo), desk-checks, desk-analysts, desk-postmortem, 8 LLM stages counted as one workflow, news, scan job (scanner + calls + tracker + options) |
| Seats that are labels over shared engine/runner code (no separate worker) | Morgan (pickEntry), Reese (entryGates), Xavi (openPosition), Eve (backtest row), Iris (configIntegrity), Rex (provenance capture), Elle (experiment.ts), Felix (data.ts), Dara (hlContext), Zed (zones.ts) | Real code paths, but not independent agents |
| Seat with no backend at all | Stella (evidence steward) | Her checks are computed in the browser from `last_run`; the backend has no steward |
| Distinct LLM call sites | 3 live + 1 dead | desk workflow (2×DEBATE_ROUNDS + 1 + 1 + 3×RISK_ROUNDS + 1 = 8 calls per new entry by default), news (≤1 per 30-min news read), chat (1 per owner message). `agents.ts aiReview()` is never called |
| Scheduled jobs | 5 | run (1-59/5), watchdog (*/15), scan (7-59/15), prune agent log (03:11), prune scans (03:17) |
| Strategy evaluators | 11 registered | BTC: 7 eligible for paper (EMA_CROSS, HTF_SWEEP, SSR, EMA_PB at scale 0 or opt-in off). GOLD: 8 (EMA_CROSS at 0.25) |

### Runtime observations (24 h to 29 Oct 23:34 UTC unless noted)
- Book runs: 288/288 equity rows per book, max gap 5 min. pg_cron: 0 failed of 408 job runs. Scans: 25 since the first scan at 17:46, all scheduled slots present. pg_net: 0 non-200 responses (history only retained since 17:36).
- ERROR events: 0 in 7 days. Limit: some failures are only kept in the run's `notes`/`provenanceError` (not events), and before W2 the scan job's tracking errors were returned to the caller and never stored. "0 errors" therefore means 0 recorded errors, not proven health.
- AI: providers = [] on both books. Every AI seat, AI news and chat are blocked by missing credentials. Not quota, not provider errors. AGENT_AI / DESK_WORKFLOW flags were not reported before W2.
- `dbv5_decisions` = 0. The last entry (16:16) predates the provenance release (~17:26), so this is consistent, but provenance capture is still UNVERIFIED in production. Correction: the earlier report credited "32 records" to Rex. Those were `decision` agent-log rows (34 OPEN events in 7 days), not provenance records.
- Theo: 7 days held 1 `manager` agent row against 53 exit events and 3 MANAGE events. Target fills, rule stop moves and closes were never in the work log (fixed in W2).
- Committee (desk-checks, desk-analysts, 8 LLM stages), FILTER-1 verdicts (0) and the post-v20 analyst report: never exercised in production, because there has been no entry since 17:46.
- News: 44 reads in 24 h, all `by: rules`. Chat: 0 messages ever. Calls: 5 open, 0 scored. Setup tracker: 2 setups, both resolved at TP1.

### Capability matrix
| Capability | Status |
|---|---|
| Scheduled paper loop for both books, missed-bar catch-up | VERIFIED (runs and gaps above) |
| Deployed source identity (edge + web) | VERIFIED (pinned commit and Vercel metadata) |
| Market scanner, options/futures context, CALL-1 recording | VERIFIED running; call scoring UNVERIFIED (first scores due ~02:18 UTC) |
| Setup tracker resolution | PARTIAL (2 resolutions observed) |
| Theo work log | MISSING before W2; implemented in W2 (not deployed) |
| Decision provenance in production | UNVERIFIED (no entry since release) |
| Agentic committee, AI news, assistant | BLOCKED (no provider secret) |
| FILTER-1 experiment | UNVERIFIED (0 verdicts; needs an entry) |
| Evidence steward as a backend worker | MISSING (browser-side checks only) |
| Per-worker attempt/failure telemetry | PARTIAL (scan job only, from W2) |
| GitHub Actions CI | BLOCKED (T005, owner action) |

## Earlier audit (28 Oct 2026)
Source base at that time: `cd81d6f45eac9fe72bf6862cdcdd2f84cff1bf1c` on `claude/multi-agent-v5.8`; main remains `5bb02718208d7c3ae16d5c7f12ca96e0730a0f11`. These are distinct branches, not evidence that the deployed artifact matches either SHA.

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

9. Decision provenance (T006) is implemented in a PR but not deployed; production has no decision tables until the owner approves the migration. See PROVENANCE.md.
