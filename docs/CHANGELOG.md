# Changelog

## Unreleased — strategy coverage (evidence only; entries, sizing, exits and risk unchanged)
- Per-strategy evaluation trace and reason codes (`coverage.ts`), counters in `state.cov`, `lastRun.coverage`; zero closed trades no longer looks like "not evaluated". Silent code paths now give reasons; a throwing strategy is isolated; VWAP sigma undefined until 4 bars of the UTC day. Audit: [STRATEGY_COVERAGE.md](STRATEGY_COVERAGE.md). Independent shadow lanes: [SHADOW_LANES.md](SHADOW_LANES.md).
- Dashboard Strategies tab: all 11 strategies with an operational state (RUNNING, WAITING FOR FIRST BAR, DISABLED, DATA BLOCKED, ERROR) separate from sizing, counters, latest rejection reason, positions and closed trades separately, PAPER label, dated research references with a note when they disagree with the effective configuration.

## Unreleased — setup view and chart zones (no change to trading logic)
- Dashboard: trade setup card (red stop block, green TP blocks, structure checks), chart layers for FVG, IFVG, order blocks, value area, premium/discount, BOS/CHoCH and liquidity, focus-on-trade view. See [ZONES.md](ZONES.md).
- Chart agent now also logs per-timeframe zones (`lastRun.desk.chart.zones`). Zone reads never affect entries, stops, targets, sizing or risk, and a failure in them cannot break a run.
- Selective skill install: `post-trade-review` and `execution-plan-check` (marian2js, pinned, text-only) under `.claude/skills/`.
## Unreleased — third-party skill evaluation (no change to the bot)
- Installed five audited, pinned skills (backtest-expert, backtest-review, data-scrub, strategy-critique, risk-report); added `scripts/data_scrub.py` and `scripts/backtest_expert_gate.py`; evaluation and findings in [research/SKILL_EVALUATION.md](research/SKILL_EVALUATION.md). Finding: the PAXG research dataset has stale bars concentrated in 2023-2024.
## Unreleased — desk review layer (advisory; entries, sizing, exits and risk unchanged)
- After a trade is opened: deterministic pre-trade checks and optional analyst, bear, bull, judge roles (free providers, shadow); after a trade closes: deterministic post-trade review. All rows go to `dbv5_agent_log`, joined to the trade by position id. Runs after state is saved; the old pre-save single-call ai-review is replaced. See [AGENT_WORKFLOWS.md](AGENT_WORKFLOWS.md).

## v5.8.0 — desk agents (2026-10-24)
- New `agents.ts` + engine functions: chart agent (levels across 1m–4H), signal validator, risk agent (candle-body stop), re-entry agent, optional shadow-only AI review. All logged to `dbv5_agent_log`; dashboard gets an **Agent desk** card and `agent:` level lines on the Chart tab. See [AGENTS.md](AGENTS.md).
- Chart agent is on. **Body-stop, re-entry and validator ship OFF**: in 1-year backtests (BTC two years, gold one year) every combination was worse than the live config. Numbers in AGENTS.md.
- `dbv5_agent_log`: RLS enabled (it was open to the anon key), indexes, 14-day prune job.
- Edge function now deploys from git via `.github/workflows/deploy.yml` (needs the `SUPABASE_ACCESS_TOKEN` repo secret). Live-only tweaks that were never committed (chat research brief, SKIP message, run-result fields) are now in git.
- Config groups `BODY_SL`, `REENTRY`, `VALIDATOR` merge key-by-key. 54 tests.

## 5.6.1 — runtime integrity (pending deployment)
- Per-book configuration fingerprints pause new paper entries on missing approval or drift; ongoing positions remain managed.
- Isolate-local request serialization, read-only status configuration, explicit ML asset identity, bounded database requests.
- Conservative moved-stop ambiguity, entry-bar timing policy, sampled marked drawdown, latched daily loss gate, final replay-bar management.
- Independent BTC/GOLD heartbeat, pinned dependencies, full test/typecheck CI. See [deployment and limitations](RUNTIME_INTEGRITY.md).

## 5.1.0 — 2026-10-22
- ML research (ml/mine.ts, ml/meta_label.py, ml/direction.py, ml/variants.ts) → docs/ML_REPORT.md.
- Engine: per-strategy daily regime gate (`REGIME_GATE`), per-strategy minimum stop (`MIN_STOP_BY`), `MIN_STOP_PCT`/`MAX_COST_R` guards.
- Live config switched to v5.1: gate 3% on trend strategies, HOLD exits, sweep/session/VWAP off. Backtests: 2023–26 PF 1.21 vs 1.02; past year +0.03R vs −0.08R/trade.
- Backtest results now include `unseenSep2026`; live market snapshot includes `ema50D`.
- Scheduled tasks: v3 browser re-inject replaced by a 4-hourly v5 watchdog; daily review adds regime + Sunday re-validation; research brief reads live bot state instead of stale Oct-5 levels.

## v5.0.0 (2026-10-22)

Runs server-side 24/7 (Supabase Edge Function + pg_cron). No browser tab, laptop, Vercel function or hourly Claude run is needed.

**Kept from v3:** 5m SuperTrend flip with 15m/1h alignment, choppiness gate, swing stop, POC and EMA scoring, 3-loss circuit breaker, per-strategy learning counters, v3 cloud equity ($352.56) carried forward.

**Kept from v4.3:** 4H bias filter, the real SuperTrend state machine, closed-bars-only signals, VWAP / RSI / ROC / funding / Fear & Greed scoring, dynamic risk tiers, 50/25/25 partial exits on original quantity, explicit schema and strategy versions.

**New:**
- 7 strategies, including the two best leads from the desk's own research (P5 bear-trap, P1 thrust).
- Hyperliquid perp data first (the venue being considered), Binance fallback.
- Exits checked on 1-minute bars between runs; stop-first when a bar is ambiguous (v4 checked one price every 5 minutes).
- Sizing includes fees and slippage; maker/taker fees, slippage and hourly funding all charged.
- Daily-anchored VWAP (v4 used a rolling 100-hour proxy).
- Circuit breaker cools down after 4 hours instead of needing a manual reset.
- Daily loss limit, daily trade cap, 5× leverage cap.
- Probation: half size after 10 losing trades; auto-off after 20 trades below −0.15R.
- Built-in backtester using the same engine code, with in-sample / out-of-sample split and up to a year of history.
- Settings change through the database, without a redeploy.

**Fixed vs v4.3 audit items still open:** closed-bar logic, slippage simulation, session filter now in UTC with explicit windows, VWAP reset, no reliance on a browser tab.

## v4.3 (2026-10-19), retired
Browser-console bot. Fixed sizing and partial-exit bugs; 53/53 tests. Never ran outside a TradingView tab.

## v3 (2026-10-17), retired
TradingView injection + Vercel `deskbot-v3` + Google Sheet / Supabase `bot_state`, driven by an hourly Claude task. 3 paper trades, $300 → $352.56.

## 2026-10-23 (owner request, config only, gold book)
- TREND_MTF minimum stop 1.2% → 0.4% on GOLD. Gold moves about a third as much as BTC, so the 1.2% floor put targets out of reach.
- EMA_CROSS (15m EMA20/50) switched on for GOLD at 25% size as a paper experiment. It is near break-even on BTC research and untested on gold.
- 1m Asian-range scalping not added: tight stops lose 0.3–0.5R/trade to fees in every test (ML_REPORT §1).

## v5.7.0 — trade manager + 1m view (2026-10-23)
- Bot now pulls 1m candles every 5-minute check (1m SuperTrend + structure shown on the dashboard).
- New `traderManage` layer re-plans open positions each check. Four rules, each switchable via `TRADER_PARTS`:
  `stop` (tighten to 1H structure), `targets` (pull TPs to nearest liquidity), `be` (1m reversal → breakeven), `stall` (close if no follow-through by half the max hold).
  Never widens a stop, never changes size.
- 1-year Binance backtest, each rule alone (start $1000, live config):
  | rule | BTC end | Gold end |
  |---|---|---|
  | none | 922 | 1064 |
  | stop | 900 | 943 |
  | targets | 922 | 1057 |
  | be | **994** (DD 17%→13%) | 985 |
  | stall | 896 | **1068** |
  | all four | 852 | 846 |
- Live: BTC `be`, Gold `stall`. Backtest used the 5m trend as the reversal signal (no 1m history); live uses real 1m, so it may fire more often.
- Dashboard: 1M chip, "Trade manager" log on the open-position card.
