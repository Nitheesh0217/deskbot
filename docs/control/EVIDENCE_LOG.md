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
