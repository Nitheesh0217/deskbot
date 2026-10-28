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
