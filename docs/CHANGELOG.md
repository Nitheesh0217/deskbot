# Changelog

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
