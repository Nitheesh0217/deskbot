# Evidence log

## October 28, 2026 — T001

Source base: `cd81d6f45eac9fe72bf6862cdcdd2f84cff1bf1c`, recovered from existing `claude/multi-agent-v5.8`. Main: `5bb02718208d7c3ae16d5c7f12ca96e0730a0f11`. Branch discovery and public file reads used the connected GitHub tools; local clone independently confirmed ancestry and a clean initial worktree. No project AGENTS.md existed on main; docs/AGENTS.md on v5.8 is a description of runtime roles and was read.

| Check | Actual result |
|---|---|
| npm ci --ignore-scripts | PASS; 6 existing packages installed; no new dependency |
| Baseline npm test on v5.8 | PASS, 54 tests, 0 failures |
| Baseline npm run typecheck | PASS, exit 0 |
| Observer focused tests | PASS, 15 tests, 0 failures |
| Final full regression / typecheck | PASS: 69 tests, 0 failures; typecheck exit 0; git diff --check exit 0 |
| Public status observer | PASS capture at 2026-10-28T05:00:57.288Z; PAPER v5.8.0, 2 books; expected exit 2 / NEEDS_CHANGES; both lack config approval; BTC flat ledger/equity reconcile; GOLD has an open position so flat-equity comparison is intentionally unknown |
| Supabase connected project inventory | Empty list; actual schema/deployment unavailable |
| Five upstream skill repos | Source instructions and root licenses reviewed; no upstream script run or plugin installed |
| Browser visual QA | Not performed; HTML escaping/CSP/content checks are automated, not visual verification |
| GitHub publication | BLOCKED: create_branch returned HTTP 403 Resource not accessible by integration. No remote branch/PR is claimed; local commit/transfer package can be used after access is restored |

Evidence classifications: source inspected, software test, public runtime observation, repository-reported research and independently verified trading results are different. No financial backtest, broker fill validation, production failure drill or profit improvement is claimed.

No changes to edge-function modules, migrations, workflows, risk settings, credentials or existing strategy code are included in T001. Generated audit output is local and ignored. Git commit/PR identifies the published version; avoid self-referential commit hashes inside this file.

Verification status: T001 local implementation VERIFIED; GitHub publication BLOCKED by access. T002 BLOCKED by missing authorized project/deployment read access. Neither blocker is a financial-performance finding. No full six-workspace dashboard or profitable predictor is marked complete.

## October 28, 2026 — T003 website truthfulness and optional-AI budget patch

User authorized deployment, but renewed GitHub write and Supabase project checks still fail with the same 403/permission errors. Vercel tools became available and listed three DeskBot projects; target-team project/deployment details require team consent. An authorization link was generated; that does not itself authorize the team.

Changes prepared: website System evidence panel (per-book timestamps, PAXG identity, optional provider presence, historical-validation warning); missing approval no longer asserts entries are paused; failed public refresh clears LIVE and exposes disconnected data. Historical v5.1 text is labeled historical. AI per-attempt cap prevents a retry overrun; invalid caps disable calls. No direction/strategy/risk change, model install, new provider or key change.

Checks before the final refresh-failure regression: npm test PASS 78/78; npm run typecheck PASS; git diff --check PASS. Final run after that regression is recorded below. Tests cover browser helper logic, inline JS parsing, quotas and mocked failure states. Real browser visual QA was attempted but Chromium is unavailable and the download did not complete; no visual pass is claimed.

Free-AI sources were checked against provider documentation; no paid inference performed. See ../research/FREE_AI_OPTIONS.md and DEPLOYMENT_HANDOFF.md. Actual release remains BLOCKED until access/team consent and exact target verification succeed.

Final T003 verification: npm test PASS 79/79, zero failures; npm run typecheck PASS exit 0; git diff --check PASS. Includes failed-refresh clearing LIVE. Public read-only capture at 2026-10-28T05:22:30.379Z returned PAPER v5.8.0 and recent per-book runs; bounded closed rows reconcile, both approval flags are false, and GOLD has an open position. No real deployment or financial improvement is claimed.

## October 28, 2026 — T002/T003 reconciliation and release (Claude, with Supabase/Vercel/GitHub access)

Access this time worked: Supabase project inventory, SQL, logs and edge-function source; Vercel project/deployment/alias reads and preview fetch; GitHub branch push and Actions metadata. Earlier "blocked" statements in this log describe the previous session only.

**Patch intake.** ZIP applied with `git am` onto `cd81d6f` (new SHAs `1022543`, `01a0ba3`). All 22 files hash-match MANIFEST.json. `npm ci --ignore-scripts` (2 moderate advisories: esbuild dev-server via the pinned dev-only tsx; not in the edge function; fix is a forced major bump, left alone), `npm test` 79/79, typecheck exit 0, `git diff --check` exit 0. After the heartbeat fix: 80/80.

**Deployed source vs GitHub.** Before this release the function was v17. A byte comparison of the deployed files against a rebuild of `cd81d6f` showed 7 of 8 files identical; `chat.ts` differed because the v17 deploy payload (made by Claude) escaped three newlines in the owner-chat prompt as literal `\n` text. Impact: prompt formatting of the optional chat only; no trading path. Corrected in v18.

**Backend release v18** (`ezbr_sha256 37adb6e8…6ff2e6`): all 8 files byte-identical to a build of branch commit `1ec864d`. Changes vs v17: AI per-attempt cap check, malformed cap disables calls, chat.ts newline fix. Smoke: HTTP 200, both books ok, version 5.8.0, balances unchanged (BTC 340.5961, GOLD 322.2651), 29 trades, 0 ERROR events in 15 min.

**Operations.**
- Cron: 1915 `deskbot-v5-run` and 585 watchdog executions, 0 failures. All 72 retained HTTP responses are 200.
- Staleness: BTC equity series has 4 gaps > 12 min, all on Oct 22–23 (before the watchdog existed / Binance HTTP 500 on Oct 22 / 3 watchdog kicks on Oct 23). GOLD none. No gap since Oct 23 06:46 UTC.
- Ledger vs state: BTC 17 trades, GOLD 12; ledger net = state stats net = equity change exactly (BTC -11.9639, GOLD -27.7349); wins and sumR match; OPEN events = closes = ledger rows; no duplicate ids. For all 29 trades exit quantities sum to original size and gross, net, R, exit average recompute exactly. Fees: BTC 20.25, GOLD 11.30 (BTC gross before fees is positive, net is negative).
- Equity: BTC 352.56 → 340.60 (-3.4%), GOLD 350 → 322.27 (-7.9%). Both books were in circuit-breaker cooldown at inspection.
- Active strategies vs the displayed v5.1 validation: live configs have SWEEP_REV, SESSION_BO, VWAP_REVERT at scale 1 (and EMA_CROSS 0.25 on gold). Live results so far: BTC SWEEP_REV n=12 -0.12R, SESSION_BO n=5 -0.10R; GOLD SWEEP_REV n=5 -0.48R, EMA_CROSS n=5 0/5 wins -0.82R. The v5.1 validation text says these were disabled because they lose to fees. Small samples, but the displayed validation does not describe what trades.
- Missing fingerprints: `DESKBOT_BTC_CONFIG_HASH`/`DESKBOT_GOLD_CONFIG_HASH` are unset; `integrity.approved=false` on both books; enforcement is off (`DESKBOT_ENFORCE_APPROVAL` default), so entries are NOT paused. Per RUNTIME_INTEGRITY.md the hash must come from a reviewed backtest, not be copied from runtime; not done here.
- **Heartbeat and CI (corrected).** All 34 heartbeat runs (first: 22 Oct 23:26 UTC, commit `781420b`) and every CI run listed (22) concluded `failure` within 2–4 s. Job metadata for a heartbeat job (`123060652904`) and a CI job (`123113234686`): `runner_id: 0`, empty runner name, **no steps recorded**, started→completed in about 2 s. A job that never reaches a runner never executes a script, so the failures are an account/runner-level refusal (typical causes: Actions billing or spending limit, or Actions policy for the account). The exact reason is not exposed by the API (check-run output and annotations are empty; raw logs return 404), so it is **unconfirmed** and needs the owner to open the run page or Settings → Billing → Actions. Consequence: the GitHub heartbeat has **never executed**; the only working liveness mechanism is the Supabase `dbv5_watchdog`. An earlier version of this entry attributed the red runs to the missing config approval; that was wrong for the observed failures (the approval check did not exist when runs #1–#3 failed). It is, however, a real latent defect: with Actions working, `checkHealth()` on the live status returns "no approved fingerprint" for both books and the script would exit 1 while the bot is healthy. That is fixed in commit `1ec864d` (staleness fails; missing approval warns) with a regression test. Not verified end-to-end on a real runner.
- **Historical 5m vs runtime 1m.** Backtests call `managePosition` on 5m bars and pass the 5m SuperTrend as the "1m" trend input to the trade manager (`engine.ts` backtestInner); live uses real 1m bars and a real 1m SuperTrend/BOS. Not quantified: the research pipeline holds 5m history only. Treat every backtested trade-manager result as an approximation.
- Schema/leases/persistence: see SCHEMA_SNAPSHOT.md. Lease is one atomic UPDATE, correct per statement; no fencing; persistence is several non-transactional REST calls; repo migrations are incomplete.
- Security: `bot_state` RLS off with anon write (open). `dbv5_agent_log` RLS enabled earlier (24 Oct). A DROP of two duplicate indexes on `dbv5_agent_log` is awaiting the owner's approval (the Supabase tool asked for confirmation and got none).

**Website.** Preview `dpl_DZCdCjmhhKPz6anRCfipdh2wn3SN` (commit `1ec864d`) built by Vercel's git integration: `evidence.js` and `index.html` both HTTP 200; served `index.html` equals the repo file plus Vercel's preview-only feedback script; no "Entries paused: approval required" text. Browser smoke (Playwright/Chromium against the same files served locally with a synthetic status): evidence panel renders per-book rows, PAXG labelled "not XAUUSD", missing approval shown as "Not approved; entry enforcement not reported", BTC/GOLD switch works, chart tab opens, no page errors, and a failed refresh shows the disconnected banner and "SAVED SNAPSHOT". The browser run was not on the SSO-gated preview URL itself.

**Production release (28 Oct 2026, 21:3x UTC).** PR #1 merged to `main` as `a12bcaf` (merge commit; fast-forwardable, no conflicts; local `npm test` 80/80, typecheck 0, `git diff --check` 0 on head `0f4c63d`; GitHub CI red for the runner reason above, not for code). Vercel built `dpl_B4xgsKeXFHyRQoLr4Xs1A76Nnncg` (target production, READY) and the alias `deskbot-azure.vercel.app` was reassigned to it (alias API read-back). Fetched through the authorized Vercel tool: production `index.html` is byte-identical to `web/index.html` (79544 bytes), references `./evidence.js`, contains the evidence panel, and no longer contains "Entries paused: approval required"; `evidence.js` returns 200 with the same ETag as the tested preview. Rollback target remains `dpl_48ewRjcToSuEnL4LPRWLPoX2rV8C`.

## 29 Oct 2026 - decision provenance slice (sandbox evidence, not production)
- `npm test`: 91 tests, 91 pass, 0 fail (80 prior + 8 provenance unit + 3 handler). `npm run typecheck`: pass. `git diff --check`: clean.
- End-to-end through the real edge handler against a mocked database and synthetic market: decision RPC called before state PATCH; an RPC failure leaves no position/OPEN event; the stored rows replay with 0 disagreements; a later run closes the trade and `reconcileOutcome` reports 0 disagreements. Bundle: docs/evidence/provenance_sandbox_bundle.json (SYNTHETIC market, labeled). Production has NOT been migrated or deployed; no live decision has been recorded yet.
- Research corrections C-001..C-007 live on branch research/profit-improvement-2026-10-28 (equity gaps reconciled: exactly four BTC gaps, all before 2026-10-23 06:46:03 UTC).

## 29 Oct 2026 - PR #3 corrective revision (review of aeac165)
Findings reproduced by the reviewer and fixed: (1) a failed replacement-entry evidence write discarded an already completed closure (fixed with a pre-entry state boundary; regression test fails when the entry is made to throw again); (2) replay could pass against different source (now binding: exit 3, never verified); (3) outcome reconciliation trusted stored pnl (now rebuilt independently; tampering tests); (4) SQL writer did not enforce input identity (now validated, locked, atomic; tested on real PostgreSQL 16 incl. concurrency and injected failure); (5) timing mislabeled run start as data receipt (now separate fields; unknown = null); (6) docs corrected, manager-close event now carries decisionId, committed .pyc removed and bytecode ignored. See the PR for exact test counts. No production migration or deployment was performed.

## 30 Oct 2026 - W1 audit and W2 truthful-visibility slice (sandbox evidence; NOT deployed)
- Identity: edge v24 pinned to 3e25392; Vercel production dpl_2V5vuDPQndNEG94J3mKmCDEYk2U7 from 3e25392 (tool read-back).
- Runtime queries (Supabase SQL, read-only): 288/288 equity rows per book in 24 h; cron 0/408 failed; 25 scans since 17:46; ERROR events 0/7d; providers [] on both books; dbv5_decisions 0 (no entry since the provenance release); manager agent rows 1 vs 53 exit events in 7 d.
- Tests run locally on the W2 branch: `npm run typecheck` pass; `npm test` 223/223 pass (new: tests/worklog.test.ts 5, tests/tower_workers.test.ts 5, desk_handler retry test 1). Browser smokes (Playwright, mocked network, SYNTHETIC status): tower, markets, scanner, workers: 0 page/console errors on desktop 1360×900 and mobile 390×844.
- Pre-flight: the W2 bundle against the 29 Oct live book snapshots gives the same positions and equity as the v19 bundle on the same input (BTC 339.2622633013888, GOLD 319.00746503674634). The scan action writes only dbv5_scans.

## 30 Oct 2026 - PR #19 revision after review of 33af114 (sandbox evidence; NOT deployed)
- Reproduction before the fix:
  - tests/tower_workers_rev.test.ts: 5/5 failed on 33af114, 5/5 pass now.
  - worklog_identity scenarios: 3/5 failed against the 33af114 worklog (destination-keyed); both retry tests passed there too.
  - Persistence handler test: failed on a 33af114 worktree (the outage lost the records); passes now.
- Suite: `npm run typecheck` pass; `npm test` 235/235; `git diff --check` clean. Browser smokes tower/markets/scanner/workers: 0 errors at 1360x900 and 390x844.
- Real PostgreSQL 16 (scripts/sql_test/work_key.sh): migration applied twice (idempotent). 16 concurrent `insert ... on conflict (work_key) do nothing` with the same key gave 1 row; 3 NULL-key rows coexist.
- Not verified here: PostgREST's handling of `?columns=...&on_conflict=work_key` against the production schema (no PostgREST locally). It must be checked by a post-migration smoke before release is called verified.
## 30 Oct 2026 - production observations (read-only SQL), 00:11 UTC
- First entry since the provenance and committee releases: BTC HTF_TREND SHORT opened 00:00 UTC (V5-1793318461202) @ 77822.4, stop 80065.9, risk $6.85.
  - dbv5_decisions 1 and dbv5_decision_inputs 4: decision provenance VERIFIED in production.
  - desk-checks and desk-analysts rows written: deterministic committee stages VERIFIED.
  - FILTER-1 first verdicts: rules arm skip (warning present), AI arm no_provider (abstain).
- Coverage counters since 29 Oct 17:31: 81 bars per book, 0 missed bars, 0 missing due bars.
  - BTC: HTF_TREND entered 1/2 due; SWEEP_REV 1 setup vetoed (score 60 < 72); TREND_MTF 81/81 no flip; VWAP_REVERT 27/27 regime-vetoed; SESSION_BO 27/27 outside window; 4 evaluators off.
  - Gold: TREND_MTF 4 gate vetoes; VWAP_REVERT 27/27 regime-vetoed; EMA_CROSS 27/27 no cross; 3 evaluators off.
- Closed paper trades by strategy (all history; no config identity before 29 Oct 17:26):
  - BTC SWEEP_REV 15 (8 W, −0.84R); BTC SESSION_BO 5 (2 W, −0.48R)
  - GOLD EMA_CROSS 7 (0 W, −6.12R); GOLD SWEEP_REV 5 (1 W, −2.38R); GOLD SESSION_BO 1 (−0.63R); GOLD TREND_MTF 1 (−0.05R)

## 30 Oct 2026 - W3 branch evidence (sandbox; NOT deployed)
- `npm run typecheck` pass; `npm test` 220/220; `git diff --check` clean.
- Strategies smoke (SYNTHETIC counters, banner on screenshots): 11 matrix rows, no "(full)" label, risk shown as "2.00% of equity at risk per trade", 0 page errors, no horizontal scroll at 1360×900 and 390×844.
- scripts/sql_test/shadow_lane.sh (real PostgreSQL 16):
  - Existing row defaults to lane 'book'; an invalid lane is rejected; the lane cannot change.
  - An outcome update on an open shadow row works; re-applying the migration is a no-op.
- Pre-flight against the live book snapshots: same positions and equity as the v19 bundle; a scan writes only dbv5_scans.

## 30 Oct 2026 - release corrections for PR #19 / #20 and integration candidate 0326916 (sandbox; NOT deployed)
- PR #19 head 85a5f1b:
  - The outbox cap reproduced as a failing test (260 records → 200 kept); fixed: unbounded, merged by key.
  - Stale-ack race test: A saves its outbox, B advances the book, A acks. B's equity, stop and newer pending record survive, `_rev` is unchanged by the ack, and A's later save is rejected with StateConflict.
  - Handler test: 250 pending records + outage + recovery deliver each distinct key once.
  - All state writes are compare-and-set.
- PR #20 head cb7c553:
  - Reproduced on bc2ff1e: shadow discovery ignored the enabled flag; the conflict target omitted the lane. (The book lane could not receive book flags at all — structural, shown by code.)
  - Fixed: offReason (flag / scale / opt-in); withConfig restores the config after a throw (tested); SHADOW-1 and book config ids; lane-aware key; outcome labels.
- Integration candidate 032691665a56b9ec62d2923bee0f7eca6c22f956 (merge of both heads):
  - typecheck pass; npm test 254/254; git diff --check clean; build:web:check and build-info:check current.
  - Browser smokes tower/markets/scanner/workers/strategies: 0 errors.
  - scripts/sql_test/postgrest.sh (the application's own requests over HTTP; PostgREST 12.2.3 + PostgreSQL 16.15, both migrations): 11/11 PASS — conflict-safe insert, 12 concurrent same-key → 1 row, legacy CAS, stale CAS rejected, 10 concurrent CAS → 1 winner, ack RPC scoped, 230-record batched flush, lane-aware setup insert.
  - work_key.sh: 16 concurrent → 1 row. shadow_lane.sh: both lanes kept, old key dropped, lane/cfg_id immutable.
  - Pre-flight against the live book snapshots: same positions and equity as the v19 bundle; a scan writes only dbv5_scans.
  - Vercel preview dpl_xcmgiZ9oco2GAsB1siziLgo4Wwou READY from 0326916.
- Not verified: Supabase's hosted gateway / PostgREST version and the production RLS configuration (local PostgREST is stock 12.2.3, schema reconstructed). Step 2–6 production checks in RELEASE_W2_W3.md cover this after approval.

## 30 Oct 2026 - release readiness round 2 (candidate 5662f80dee237c6e30513ce0e3e681c5382b7473; sandbox, NOT deployed)
- Reconciled first: main 3e25392, PR #19 85a5f1b, PR #20 cb7c553, release head 45d37d9 (source = 0326916), edge v24 → 3e25392. Nothing changed since the previous report except market data (gold EMA_CROSS TP1 filled 01:24 UTC).
- Ack versus a stale writer, real PostgREST 12.2.3 + PostgreSQL 16.15, unmodified 0326916 code:
  - B read revision N with pending X, A inserted and acknowledged X, B saved its copy with guard N. Result: stored outbox `[X,Y]`, so X reappeared.
  - Fix: trigger `dbv5_state_outbox_guard` removes already-logged keys in the same write. After: `[Y]`; B's equity, stop and Y kept; X logged once.
  - Retried insert/ack changes nothing; an older revision still gets StateConflict; 30 concurrent interleavings: resurrected=0, lost=0 (`RACE=1 scripts/sql_test/postgrest.sh`, 6/6).
- Bounded recovery: 1,200 pending records with 1.5 s writes drained over 4 runs (≤3 batches / ≤4 s each); fast writes stop at 5 batches (500); failing writes resume next run; nothing lost (`tests/outbox_durability.test.ts`).
- Rollback compatibility (`ROLLBACK=1 scripts/sql_test/postgrest.sh`, 4/4):
  - Plain v24's setup insert fails after the lane migration (42P10).
  - Artifact afdf44a writes a book row beside an existing shadow row, reads book rows only, and discards no shadow record.
  - Artifact trading pre-flight against the live snapshots equals v19/v24 (BTC 339.26977461902817, GOLD 319.01317097612525 at that time).
- Candidate 5662f80, all run here:
  - typecheck pass; npm test 256/256; diff check clean; build:web:check and build-info:check current
  - postgrest.sh 11/11; race 6/6; rollback 4/4; work_key.sh and shadow_lane.sh pass
  - smokes tower/markets/scanner/workers/strategies: 0 errors (strategies: 11 matrix rows, no horizontal scroll on mobile).

## 2026-10-30 · Integrated paper release: acceptance on the exact candidate
Candidate `4262f7f50618f61ab412858d496e35f2cc5d16e3` (tree `7a8e2edf61db105dd0b4fd7738aba57eb0511a56`). Run in a clean detached worktree at that SHA by `accept.sh`. Later commits are `docs/` only.

**Local checks**
- build_info current (`2b76b76b…`); web build current.
- Typecheck OK.
- `npm test`: **277/277**. This includes the cross-book scheduling regression (3 tests), egress (8), provider policy, account registry (6) and chart plan.
- Diff check OK.

**Database checks**
- PostgREST 12.2.3 + PostgreSQL 16: application requests: all checks passed.
- `RACE=1`: retried insert/ack, stale revision and 30 interleavings all pass (resurrected=0, lostY=0).
- `ROLLBACK=1` with `afdf44a`: book row beside the shadow row; book-only reads; no shadow record discarded.
- `outbox_guard.sh`:
  - scale: 100 → 3.2 ms, 1k → 13.7 ms, 10k → 90.5 ms, 50k → 436 ms
  - preservation ok
  - retention: suppression ends with the 14-day log row; re-delivery after pruning is accepted as a new row
- `work_key.sh`: pass.
- `shadow_lane.sh`: pass.

**Browser smokes** (SYNTHETIC / MOCK fixture, mocked network, desktop and phone)
- tower, markets, scanner, workers, strategies: 0 problems.
- chart_plan: loading placeholder present; no horizontal scroll; 6 plan rows (5 in the candle-error state).

**Negative control**
The cross-book regression fails on the previous scheduler: GOLD is saved after BTC's 8 LLM calls.

**Not verified against hosted services**
- The deployed edge function, migrations and Vercel build of this candidate: not deployed.
- Live provider reachability: no provider is configured.
- Broker connectivity: none exists.
- Hyperliquid instrument metadata: the host is not reachable from this session.
