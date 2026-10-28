# Independent shadow lanes

Goal: measure every strategy fairly. In the combined portfolio a strategy competes for one position slot, can be displaced by a higher-scored setup, is stopped by the circuit breaker and the daily caps, and is **switched off for good after 20 trades below -0.15R**. Its zero (or 20-trade) record then says little about the strategy. A lane measures one strategy on one instrument on its own. Research and paper only: no order code, and the live book is never read or written.

## Design (`supabase/functions/deskbot-v5/lanes.ts`)
- **One lane = (instrument, strategy)**: `BTC:SWEEP_REV`, `GOLD:EMA_CROSS`, ... 22 lanes for 11 strategies x 2 books. Each lane has its own `State`: equity, one position, counters, circuit breaker, daily limits.
- **Same inputs and executor as the portfolio**: the lane steps on the same snapshot (`snapshot`, `buildSeries`) and uses the same `evaluate`, `entryGates`, `openPosition`, `managePosition`, `traderManage`, costs, sizing and fill assumptions. Test `a lane uses the same executor as engine.backtest` asserts identical trades to `engine.backtest(only: strategy)` for SWEEP_REV and EMA_CROSS.
- **Cadence**: each lane evaluates on every new closed 5m bar and its strategy fires on its own timeframe close (5m, 15m, 1H, 4H, daily), exactly as in the portfolio.
- **Strategy of the lane only**: `evaluate` is called with only that strategy enabled, so another strategy can never take its turn. Inside the lane the one-position rule, circuit breaker (3 losses, 4 h), daily trade cap and daily loss limit still apply (risk rules stay).
- **Intentional differences, recorded in the lane config hash**: auto-disable and probation sizing are **observe-only** (a lane keeps measuring and records `wouldHaveDisabled` when the rule would have fired); the strategy's scale is the book's scale for it (for example EMA_CROSS 0.25 on PAXG) or 1 for a candidate the book does not run.
- **Disabled research candidates**: a strategy that is off in the portfolio (HTF_SWEEP, SSR, EMA_PB on both books, EMA_CROSS on BTC) runs in its lane without being enabled anywhere else (test `a portfolio-disabled research candidate runs in its lane…`: global `CFG` unchanged, same bars through the portfolio config produce zero EMA_CROSS trades).
- **Decision before outcome**: each entry appends a `decision` event (snapshot bar close, fill time, plan with original stop and risk, lane config hash, spec version) before any `outcome` event; sequence numbers are monotonic and an outcome must follow its decision (enforced in code, in tests, and in the draft database trigger).

## Three views that must never be mixed
| view | meaning | source |
|---|---|---|
| **A. Independent strategy performance** | the lane alone, uncensored by the portfolio | lane trades |
| **B. Combined portfolio** | the same strategy as the portfolio actually executed it, with selection, auto-disable and one position | `engine.backtest` with the live config (live: the book's own trades) |
| **C. Hypothetical candidate outcomes** | lane trades that opened while the portfolio held another position: not executable in the portfolio at that time; a **subset of A**, not extra profit | lane trades overlapping a portfolio trade interval |

## Working end-to-end lane (historical replay, research window 2025-10-22 to 2026-10-22; `scripts/lane_replay.ts`)
Evidence: `docs/evidence/lanes/*_summary.json` (events log sample beside it). Replay uses 5m management and next-bar-open fills like `engine.backtest`; live manages on 1m and fills at the current price; candles are Binance spot. Descriptive, in-sample, no profitability claim.
| lane | A: independent lane | B: inside the portfolio | C: not executable in portfolio |
|---|---|---|---|
| BTC:SWEEP_REV (on in the book) | 606 trades, -0.24R mean, -146R, 15% exposure; auto-off would have fired at trade 57 | 30 trades, -0.17R mean, -5.2R | 297 of the 606 (49%), -0.20R mean |
| BTC:EMA_CROSS (off in the book) | 391 trades, -0.16R mean, -61R, 51% exposure; auto-off would have fired at trade 22 | 0 trades (off) | 162 of 391 |
Reading: the portfolio traded SWEEP_REV 30 times where the strategy produced 606 independent opportunities; the other 576 were displaced, blocked or came after auto-off. On this history the strategy's independent expectancy is negative after costs; that is a measurement the portfolio view could not give. Both lanes passed the decision-before-outcome invariant (606 and 391 decisions, one outcome each).

## Persistence plan (database draft **not applied**)
`supabase/migrations/20261029_shadow_lanes.sql`: `dbv5_lane_state` (mutable lane state) and `dbv5_lane_events` (append-only; trigger enforces outcome-after-decision and no duplicate decision; service_role may select and insert only; RLS on, no anon access). Tested on PostgreSQL 16 in an isolated database (`scripts/sql_test/run_lanes.sh`, log in `docs/evidence/lanes/sql_test_run.log`), not on the Supabase project.
Live step (next increment, behind its own approval): after the book's run, for each lane call `stepLane` with the same closed-bar snapshot and the 1m path already fetched; write events and state in one RPC. Cost: one `evaluate` of one strategy per lane per 5m bar on data already in memory, and one write per entry/exit (events only on activity).

## Rollout and limits
1. This PR: module, tests, replay tool, draft migration (nothing deployed).
2. After the coverage counters have run for a week and PR #3's gate is cleared: approve the lane migration, then enable lanes for one instrument and two strategies as a pilot (the edge function must stay within its time limit; measure).
3. Only then widen to 22 lanes. No lane result changes the portfolio automatically; any promotion needs a frozen protocol, costs, and the earlier rules (no loosening to create trades).
Limits: a lane is not a portfolio: summing lanes is meaningless because their positions overlap. The lane's circuit breaker, daily caps and cooldown still censor some setups. Lane equity compounds on its own, so maxDD of a long losing lane (for example 95%) is a statement about that lane, not the account.
