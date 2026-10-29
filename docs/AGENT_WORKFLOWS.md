# Agent workflows in DeskBot: what runs, what each role may do, and what was borrowed

## What changed
Before: one optional single-call "ai-review" row, run **before** state was saved. Now: a desk review layer (`supabase/functions/deskbot-v5/desk.ts`) that runs **after** state, trades and equity are saved, and is **advisory only**.

| stage | kind | when | cost |
|---|---|---|---|
| `desk-checks` | deterministic code (execution-plan-check pattern): round-trip cost as R, stop vs 15m ATR noise, first target under 1R, thin session, funding drag over the max hold, news risk, room to the nearest opposing level | every new entry, no provider needed | free |
| `desk-analyst`, `desk-bear`, `desk-bull`, `desk-judge` | optional LLM roles (TradingAgents analyst, researcher debate, risk review staging), strict JSON, validated | every new entry, only if a free provider key is configured and under its daily cap | at most 4 counted calls per entry |
| `desk-postmortem` | deterministic post-trade review (post-trade-review pattern): thesis, execution and outcome kept separate, process flags (stopped within 30 min, gave back after first target, costs over half of gross, won before costs lost after) | every closed trade | free |
Everything is written to `dbv5_agent_log` with the position id as `ref`, so a review can be joined to its trade.

## Authority (nothing new can trade)
| component | may | may not |
|---|---|---|
| strategies, regime gate, `entryGates`, circuit breaker, daily limits (unchanged) | decide entries, size, exits, risk | n/a |
| desk checks, LLM roles, post-trade review | write advisory log rows | open, size, block, move or close a trade; change configuration, approvals or risk; read or write the book |
The desk module imports only `ai.ts` and a type from `agents.ts` (a test fails if it imports the engine), the run loop never reads the verdict (test), and state and ledger are saved **before** any LLM call (test). A provider outage, bad output or deadline changes nothing about the trade (test: identical position and equity with and without providers).
LLM outputs are rejected, not trimmed, when they state a probability or odds, a price target, contain a URL, or break the schema. Raw news headlines are never passed to the models (only the news risk label), which removes the easiest prompt-injection path.

## "Use the skills at run time": what that can and cannot mean
SKILL.md files are instructions for a **Claude Code session**, not a library the edge function can load; and repository text should not be fetched and trusted at run time. So the skills are used two ways: (1) the method is compiled into the runtime layer above (deterministic checks and reviews as code, role prompts as versioned constants, each citing its source); (2) the installed skills (`post-trade-review`, `execution-plan-check`, `backtest-review`, `data-scrub`, `strategy-critique`, `risk-report`, `backtest-expert`) are available to any agent session, for example a scheduled daily-review task that reads the `desk-postmortem` rows. The executor does not depend on any Claude availability, as required.

## Survey of agentic trading repositories (GitHub pages, 29 Oct 2026)
| repo | stars | license | workflow | fit for a BTC/PAXG paper perp bot | used |
|---|---|---|---|---|---|
| [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents) | about 118k | Apache-2.0 | analysts (fundamentals, sentiment, news, technical) in parallel, bull/bear debate, trader proposal, risk team, portfolio manager approval, simulated exchange | equity-oriented data tools; the paper's reported gains are disputed in the community; it is a research framework | the staging (analyst, researcher debate, risk review, decision) and the "advisory approval step" idea, as small bounded roles; not its code or data tools |
| [Jakeschincariol/day-trader-skill](https://github.com/Jakeschincariol/day-trader-skill) (the "11 skills" pack: scanner, news, entry, exit, timemachine, risk, budget, broker, alerts, analyst, pelosi) | 2.6k | MIT | scan, enter, set stop and target before entry, simulate outcomes first, risk gate PASS/BLOCK on the exact order, size to budget, alerts | built for US equities and Alpaca; Congress and SEC tools irrelevant; `trader-broker` can lead to orders | its **ideas**: stop and target before entry (we do), a risk gate before any order (we have it), "time machine" replay before risking money (our shadow lanes, `scripts/lane_replay.ts`), exact-order approval boundary (not needed: no orders). Not installed: it adds a broker path |
| [Jakeschincariol/trader-skill](https://github.com/Jakeschincariol/trader-skill) | 853 | MIT | copy investors, news, budget, rebalance, tax | portfolio and tax tools for equities | nothing |
| [virattt/ai-hedge-fund](https://github.com/virattt/ai-hedge-fund) | 64k | MIT | investor-persona agents, paper trading with an approval step, backtests, a **hash-chained ledger** per session | educational, needs a paid financial-data API | the hash-chained ledger idea is already covered more strictly by the decision-provenance PR (#3) |
Stars measure popularity. None of these repositories has shown, in anything I could verify, that LLM agents improve trading net of costs; the TradingAgents paper's claims are contested.

## Measuring whether it helps (prospective, frozen before looking)
`scripts/desk_eval.ts` joins each `desk-judge` verdict to the closed trade and reports outcome by verdict (agree, disagree, unsure) with the disagree-minus-agree difference in mean R and a bootstrap interval. At roughly 1R of trade-to-trade spread, detecting a 0.3R difference with 80% power needs about **175 closed trades in each arm**, which is months of data at the current rate: expect "insufficient evidence" for a long time and do not read anything into early numbers. Rules, fixed now: a verdict may only ever become a **risk-reducing skip** (never a size increase, never a new entry), only after a frozen paired test on data it was not tuned on and after costs; the deterministic cost check is informational and is **not** a filter (a cost-share filter was tested as A_COSTR50 and rejected; it is not reintroduced here).

## Operating it
Environment (all optional): `DESK_WORKFLOW` (default on, set `off` to remove the whole layer), `AGENT_AI` (`off` keeps the free deterministic checks and reviews but makes no model call), provider secrets `GROQ_API_KEY` / `GEMINI_API_KEY` with `GROQ_DAILY_CAP` / `GEMINI_DAILY_CAP`. Keys stay server-side and are never put in prompts or logs. No paid provider and no automatic fallback. Not deployed yet: it ships with the edge function release after PR #3's gate; PR #3, #5 and this PR all touch `index.ts`, so merge order is #3, #5, then this one.

## Limits
The LLM roles only restate and challenge facts the rules already computed; they add no new market information. They can be wrong, agree too easily, or be rate limited. Verdict agreement is not a measured edge. No profitability claim is made.
