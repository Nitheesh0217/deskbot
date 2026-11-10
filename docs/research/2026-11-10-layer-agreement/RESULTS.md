# Results: layer-agreement filter, and why the BTC book sits below 350 (2026-11-10)

Development evidence only. Paper only. Nothing here was changed in production.

## 1. Production, read-only (2026-11-10)
| Book | Start | Now | Trades | W/L | Sum R | Net $ |
|---|---|---|---|---|---|---|
| BTC | 352.56 | 346.56 (peak 358.60) | 28 | 14/14 | −0.08 | −6.00 |
| GOLD | 350.00 | 305.66 | 25 | 4/21 | −11.30 | −44.34 |

BTC by strategy: SWEEP_REV 19 trades, +0.39R but −$0.82 after $19.64 fees; SESSION_BO 7 trades, −0.64R, −$5.97 ($7.49 fees); HTF_TREND 1 trade, −0.95R; TREND_MTF 1 trade, +1.12R.
GOLD by strategy: EMA_CROSS 14 trades −5.94R; SWEEP_REV 8 trades −3.73R; others 3 trades −1.63R.

**Why BTC cannot get past 350:** the book is breakeven in R, and about $27 of fees on frequent short-horizon trades (SWEEP_REV, SESSION_BO) is the whole drawdown. That matches 3-year development results where both strategies lose 0.18-0.25R per trade after costs. More signals from the same strategies would make it worse, not better.

## 2. Variant AGREE (spec: `SPEC_FROZEN.md`)
Three-year isolated lanes, `scripts/challenger_study.ts --variant AGREE`, identity check passed on every run. ΔR = challenger minus base over the window; CI = 90% block bootstrap (10-day blocks).

| Book | Strategy | Cost | Base n / R per trade | AGREE n / R per trade | ΔR [90% CI] |
|---|---|---|---|---|---|
| BTC | SWEEP_REV | 1× | 1793 / −0.252 | 673 / −0.263 | +274 [228, 321] |
| BTC | SWEEP_REV | 1.5× | 1518 / −0.344 | 561 / −0.363 | +318 [274, 368] |
| BTC | SESSION_BO | 1× | 489 / −0.176 | 220 / −0.172 | +48 [23, 79] |
| BTC | SESSION_BO | 1.5× | 470 / −0.251 | 208 / −0.242 | +68 [42, 97] |
| BTC | TREND_MTF | 1× / 1.5× | 105 / −0.026, −0.068 | unchanged (already gated) | 0 |
| BTC | HTF_TREND | 1× | 86 / +0.076 | 87 / +0.019 | −4.8 [−12.2, 1.0] |
| BTC | HTF_TREND | 1.5× | 87 / +0.032 | 88 / −0.023 | −4.8 [−12.0, 1.0] |
| GOLD | EMA_CROSS | 1× | 1056 / −0.390 | 264 / −0.378 | +312 [252, 376] |
| GOLD | EMA_CROSS | 1.5× | 968 / −0.462 | 235 / −0.462 | +339 [283, 399] |
| GOLD | SWEEP_REV | 1× | 1179 / −0.295 | 483 / −0.315 | +195 [153, 231] |
| GOLD | SWEEP_REV | 1.5× | 804 / −0.399 | 333 / −0.432 | +177 [141, 209] |
| GOLD | SESSION_BO | 1× | 250 / −0.285 | 119 / −0.235 | +43 [26, 62] |
| GOLD | SESSION_BO | 1.5× | 213 / −0.365 | 98 / −0.300 | +48 [32, 66] |
| GOLD | TREND_MTF | 1× / 1.5× | 79-80 / −0.116, −0.204 | unchanged | 0 |
| GOLD | HTF_TREND | 1× / 1.5× | 52 / +0.447, +0.328 | unchanged | 0 |

**Verdict: REJECT** on every strategy. The rule needs a positive R per trade at 1.5× costs, and no losing strategy turns positive. The large positive ΔR comes only from **taking fewer losing trades**. The losers keep losing about the same per trade, so the higher-timeframe direction layers carry no edge for these entries. On BTC HTF_TREND, the one strategy that was positive, AGREE makes it worse.

## 3. The one survivor, by year (base, no filter)
| Book | Cost | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|
| BTC HTF_TREND | 1× | 7 / +0.24 | 29 / +0.23 | 31 / −0.09 | 19 / +0.06 |
| BTC HTF_TREND | 1.5× | 7 / +0.20 | 29 / +0.20 | 31 / −0.12 | 20 / −0.02 |
| GOLD HTF_TREND | 1× | 3 / −0.34 | 10 / +0.46 | 22 / +0.40 | 17 / +0.64 |
| GOLD HTF_TREND | 1.5× | 3 / −0.41 | 10 / +0.23 | 22 / +0.30 | 17 / +0.56 |

(trades / R per trade, by close year.) BTC HTF_TREND has decayed to about zero since 2025. GOLD HTF_TREND is positive in each of the last three years, but on only 52 trades in three years, which is too few to call it proven.

## 4. What this supports
- **Stop the bleeding (proposal, needs owner approval):** set `RISK_SCALE` to 0 for strategies with negative 3-year expectancy at 1× costs. On BTC that is SWEEP_REV, SESSION_BO and TREND_MTF; on GOLD it is SWEEP_REV, SESSION_BO, TREND_MTF and EMA_CROSS. See `docs/control/PROPOSED_CFG_2026-11-10.md`. This reduces risk; it does not create edge. VWAP_REVERT, D_THRUST and D_BEARTRAP are not covered by this study and stay as they are.
- **Expect few trades.** A book that keeps only HTF_TREND trades roughly once or twice a month. A flat book is the honest outcome when no tested edge is present.
- **Next research** (each needs its own frozen spec, then a shadow lane): EXIT-D, a ratchet trail on HTF_TREND aimed at the measured 1.45-2.0R giveback; and funding/OI context once `dbv5_market_ctx` has history.

## Reproduce
```
npx tsx scripts/challenger_study.ts --data kline5_BTC.csv.gz --book BTC --cfg live_cfg.json --strategy SWEEP_REV --variant AGREE --costx 1.5 --out out
```
The frozen data files are those of `research/entry-exit-2026-10-30` (hashes recorded there).
