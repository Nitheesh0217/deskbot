# DeskBot v5 strategies and the evidence behind them

Backtests use the same `engine.ts` as the live bot: entries at the next 5m open, every cost in `RISK.md` included, stop-first on ambiguous bars, start equity $1,000. "1y" = Binance BTCUSDT 2025-10-27 → 2026-10-22 (103,979 five-minute bars). "IS/OOS" = first two-thirds / last third of the window. Desk research = `trading-desk/research/RESULTS.md` (2017–2026, 1H).

**Nothing below meets the desk's own promotion gate** (PF ≥ 1.2 after costs, ≥ 30 out-of-sample trades, survives 2× costs). Live sizes reflect that.

| Strategy | Origin | Rules (short) | Evidence | Live size |
|---|---|---|---|---|
| **D_BEARTRAP** | Desk research P5 | Daily bearish engulfing while the prior day closed above the daily EMA50. If within 3 days a day trades below the engulfing low and closes back above it, go long at the next open. Stop at the lowest low − 0.1%. Single 2R target. | Research 2017–2026: 48 trades, +0.13R, PF 1.20, OOS +0.19R (19 trades). v5 1y: 10 trades, 5W/5L, **+0.21R avg**. Best-supported rule the desk has. | Full |
| **D_THRUST** | Desk research P1 | Daily candle body > 2× daily ATR, close above daily EMA50. Within the next 72h, take the first 1H bar that dips to the 1H EMA20 and closes above it; long at the next open. Stop at the thrust body's midpoint − 1 daily ATR. Single 2R target. | Research: 27 trades, +1.05R, PF 4.5, but only 5 OOS. v5 1y: 2 trades. Rare; too few to judge. | Full |
| **HTF_TREND** | Desk foundation ("daily/4H trend-following") | 4H close beyond the 55-bar Donchian high/low, with 4H SuperTrend and 4H EMA50 agreeing. Stop 2× 4H ATR. Targets 1.5R / 3R / 6R. | 1y grid: Donchian 55 = 34 trades, ≈0R, PF 1.0, max DD 5%; Donchian 20 = −0.06R; stop 3×ATR = −0.23R. Flat, not an edge yet. Research H3 (4H Donchian-20) agrees: PF 1.06. | Full (captures large trends; costs it nothing over a year) |
| **TREND_MTF** | v3 core + v4 gates | 5m SuperTrend flip with 15m and 1h aligned, 4H bias not against, chop < 50, EMA20/50 aligned, no Asian session. Swing stop. 1R / 2R / 3.5R. | 90d: −0.57R in-sample (14 trades). 1y combined: 20 trades, −0.15R. | 25% |
| **SESSION_BO** | New in v5 | London open breaks the Asian range, or NY open breaks the London range, on a 15m close with volume ≥ 1.3× average and 4H not against. | 90d: −0.07R IS, −0.24R OOS (42 trades). 1y combined: 27 trades, −0.16R. | 25% |
| **VWAP_REVERT** | New in v5 | Range regime only (15m chop ≥ 61.8). Price ≥ 2σ from the daily VWAP with RSI15 at an extreme and a reversal candle. | 90d: 0 signals. Rarely fires. | 25% |
| **SWEEP_REV** | Signal-journal finding (indicator ≈ sweep + rejection) | 15m wick through a 20-bar or Asian high/low closing back inside, wick ≥ 50% of range. | 90d: 175 trades, **−0.37R IS, −0.39R OOS**. Clearly negative after costs. | **Off** |

## Combined live configuration

1y backtest of the live mix (before the two daily strategies were added): 80 trades, −0.09R average, $1,000 → $978, max drawdown 7.5%. The latest run including D_BEARTRAP and D_THRUST is stored in `dbv5_backtests` (label `LIVE_CONFIG_v5_final`) and shown on the dashboard.

## What was tried and rejected

- Exit variants: holding the original stop until TP2 (journal Strategy v0.4) vs breakeven at TP1. HOLD helped HTF_TREND slightly in-sample (−0.01R vs 0.00R) and hurt it out-of-sample; no change adopted.
- Requiring 4H agreement on sweeps: produced the same trades over 90 days.
- 1m prediction bot, desk short layer, breakout-add: retired by the desk's own postmortem.

## Rules for changing anything

1. A strategy moves to full size only after **30+ live paper trades** with PF ≥ 1.2 after costs, and the backtest agrees.
2. One change at a time; re-run the 1y backtest after each.
3. The auto-disable rule (20 trades, < −0.15R) runs on its own; do not override it to "give it another chance".
