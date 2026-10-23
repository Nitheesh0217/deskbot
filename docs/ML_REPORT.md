# DeskBot v5 — Machine-learning report (Oct 2026)

Goal: learn from the bars and from the system's own past setups so the bot adapts to how the market has moved, finds where the profit really is, and calls the right side.

All numbers are **out-of-sample**. Every model was trained only on data that finished before the quarter it was scored on (walk-forward, 9 quarters 2024Q3 → 2026Q3, purged). Costs included: 0.045% taker + 0.02% slippage per side.

Data: BTCUSDT 5m bars, Jan 2023 → Aug 2026 (local proxy file), aggregated to 15m / 1h / 4h / 1d.

## 1. Reverse-engineering every trade the system would have taken (`ml/mine.ts`)

The live engine was replayed over every 5m close with all strategies on. Each signal was simulated on its own with the live exits. 7,704 setups were recorded, each with 40 market-state features and its outcome (R, MFE, MAE).

| Strategy | Setups | Avg R after costs | What it means |
|---|---|---|---|
| SWEEP_REV | 6,090 | −0.33 | positive before costs (+0.21R), but costs eat 0.5R because stops are ~0.3% of price |
| SESSION_BO | 802 | −0.21 | same problem: +0.14R gross |
| TREND_MTF | 370 | −0.16 | same problem: +0.16R gross; ≈0 with a 2% minimum stop |
| HTF_TREND | 401 | +0.05 | longs +0.16R (PF 1.28), shorts −0.13R |
| D_THRUST | 11 | +1.01 | too few to trust |
| D_BEARTRAP | 30 | −0.30 | |

**Lesson 1: the intraday ideas aren't wrong. Their stops are too tight for the fees.** A trade that risks 0.3% of price pays about 0.13% round trip, which is 0.4R gone before the trade starts. The engine now has `MIN_STOP_PCT` and `MAX_COST_R` guards. They're built and tested but **not deployed**, because widening stops only moves these strategies to roughly break-even.

**Lesson 2: the market moved.** HTF_TREND longs earned +0.48R a trade in 2023 and +0.37R in 2024, then +0.04R in 2025 and **−0.56R in 2026**. HTF shorts lost money every year until 2026, when they turned **+0.35R**. A long-only bot built on 2023–24 bleeds now. Direction has to follow the current daily regime.

**Lesson 3: where the profit is (HTF longs).** Profitable conditions were price more than 3% above the daily EMA50, short-term volatility expanding (rv24/rv168 > 1.17), and no entries during the 12–16 UTC US open. Below 3% from the daily EMA50, the average was −0.33R.

**Lesson 4: exits.** Winners reached a median 2.1R of favourable move, while losers only reached 0.29R. Losers rarely go our way first, so moving the stop to breakeven early mostly cuts winners. That matches the old bot post-mortem.

## 2. Meta-labeling: which of the system's setups to take (`ml/meta_label.py`)

Three models were trained to predict whether a setup wins, using only the market state at entry: logistic regression, LightGBM, and a neural net (MLP 32-16). The take-threshold was chosen on training data only.

| Setups file | Model | OOS trades | Avg R |
|---|---|---|---|
| min stop 1.2% | take everything | 4,497 | −0.118 |
| | LightGBM | 2,402 | −0.090 |
| | neural net | 731 | −0.075 |
| | logistic | 8 | +0.76 (too few to count) |
| original | take everything | 4,499 | −0.286 |
| | LightGBM | 252 | −0.119 |

The models do learn something: they cut losses by 25–60% compared with taking every setup. They don't turn a losing setup pool into a winning one.

## 3. Predicting the right side directly (`ml/direction.py`)

At every 1h close, 45 features are built from the bars: returns over 1h–7d, volatility, RSI, EMA distances, range position, candle body and wicks, volume, and 4h/1d context. The label asks whether price hits +k×ATR before −k×ATR. The model trades only when it is confident (|p − 0.5| ≥ 0.06), with one position at a time.

| Barrier / horizon | Model | OOS accuracy | Trades | Avg R after costs |
|---|---|---|---|---|
| 1.5 ATR / 12h | logistic | 50.9% (base 50.5%) | 851 | −0.085 |
| | LightGBM | 50.8% | 1,056 | −0.141 |
| | neural net | 51.2% | 1,469 | −0.098 |
| 2.5 ATR / 24h | logistic | 51.2% (base 51.3%) | 566 | −0.046 |
| | LightGBM | 50.1% | 617 | −0.064 |
| | neural net | 50.3% | 735 | −0.068 |
| 3 ATR / 48h | logistic | 49.9% (base 51.5%) | 322 | −0.060 |
| | LightGBM | 49.5% | 345 | −0.051 |
| | neural net | **52.3%** | 389 | −0.067 |

**Bottom line: from price bars alone, none of the models can call the next move better than a coin flip.** The best result, the 48h neural net, gets 52.3% right against a 51.5% base rate. That's within noise, and after fees every variant loses. This is what you'd expect from a heavily traded market. If an edge exists, it lives in information that isn't in the candles, such as funding, open interest, liquidation clusters and positioning, or in regime selection rather than bar-by-bar prediction.

## 4. Regime gate check (done)

HTF_TREND kept only when the trade direction agrees with price vs the daily EMA50 (direction-signed distance > threshold):

| Threshold | Trades | Avg R | PF | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|
| none | 384 | +0.017 | 1.03 | +5.8R | +27.8R | −16.5R | −10.5R |
| >0% | 339 | +0.077 | 1.13 | +8.1R | +29.4R | −9.0R | −2.3R |
| >2% | 303 | +0.138 | 1.25 | +13.8R | +30.1R | −6.8R | +4.8R |
| **>3%** | 279 | +0.155 | 1.28 | +12.4R | +31.8R | −8.6R | +7.5R |
| >5% | 235 | +0.159 | 1.29 | +12.5R | +25.7R | −9.1R | +8.2R |

The same gate also helps TREND_MTF (−0.22R → +0.06R with a 1.2% minimum stop) and D_BEARTRAP. It doesn't rescue SWEEP_REV, SESSION_BO or VWAP_REVERT.

## 5. v5.1: what changed in the bot (deployed 22 Oct 2026, paper)

Config (state.cfg): `REGIME_GATE` 3% on HTF_TREND / TREND_MTF / D_BEARTRAP · `MIN_STOP_BY` TREND_MTF 1.2% · `EXIT_MODE` HOLD (original stop until TP2) · HTF Donchian 55 · SWEEP_REV, SESSION_BO and VWAP_REVERT off · TREND_MTF at half size.

Full-engine backtests (same code as live, all costs included, $1,000 start):

| Test | Config | Trades | Avg R | PF | End | Max DD |
|---|---|---|---|---|---|---|
| 2023 → Aug 2026 (local 5m) | v5.0 live | 336 | −0.065 | 1.02 | $1,030 | 14.7% |
| | **v5.1** | 138 | **+0.117** | **1.21** | **$1,175** | **10.2%** |
| Past 12 months (fresh Binance, cloud) | v5.0 live | 82 | −0.082 | 0.88 | $963 | 9.4% |
| | **v5.1** | 35 | **+0.028** | 0.99 | $998 | 9.1% |
| Unseen Sep–Oct 2026 | v5.0 / v5.1 | 5 / 6 | −0.13R / −0.62R total | | | |

Per year, v5.1 made +9.4R in 2023, +3.6R in 2024, −0.8R in 2025 and +4.0R in 2026. A sensitivity sweep (gate 0–5%, min stop 0.8–2%, Donchian 20–55, MTF size 0.25–1) stays positive in every variant (PF 1.06–1.22), so the result doesn't hang on one lucky number. The parameters were still chosen with this data in view, so treat the improvement as real direction, not a promise. The last 12 months were roughly flat for every config tested.

No ML model was shipped: none was profitable out-of-sample with a meaningful trade count.

## 6. Next things worth testing (not done yet)

- Add Hyperliquid funding, open interest and liquidation-map features to the direction model. That's information the candles don't contain.
- Collect live paper trades from the cloud bot. Each one is labelled automatically and feeds the meta-label model.
- Re-run this report each quarter. The script outputs are reproducible: `npx tsx ml/mine.ts <csv>`, `python3 ml/meta_label.py <setups.csv>`, `python3 ml/direction.py <csv> K H`.

## 7. "Enter earlier: sell where the drop starts" (tested 22 Oct 2026)

Prompted by a late SESSION_BO short (entered at $81.5k after the drop from the 4H 55-bar high at $84.85k).
New strategy `HTF_SWEEP` (opt-in, OFF by default): a bar trades through the prior 55-bar 4H high/low, closes back inside with a rejection wick, and the bot fades it with the stop just beyond the wick. Full engine, all costs, 2023 → Aug 2026, auto-disable switched off for research:

| Variant | Trades | Avg R | PF | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|
| 4H trigger (wick ≥ 40%) | 249 | −0.075 | 0.88 | +1.3 | −3.3 | −7.3 | −9.4 |
| **1H trigger (earlier)** | 272 | **−0.164** | 0.74 | −4.1 | −20.0 | −5.6 | −15.1 |
| 4H, wick ≥ 30% / ≥ 50% | 303 / 168 | −0.064 / −0.116 | 0.90 / 0.82 | | | | |
| 4H, 20-bar levels | 367 | −0.063 | 0.90 | −6.0 | +12.6 | −12.9 | −16.8 |
| 4H, only with daily regime | 40 | −0.213 | 0.64 | | | | |
| v5.1 + 4H sweep | 158 | +0.071 | 1.08 | | | | |
| **v5.1 alone (live)** | 138 | **+0.117** | **1.21** | +9.4 | +3.6 | −0.8 | +4.0 |

**Result:** every "catch the top" variant lost money, and the *earlier* 1H trigger lost the most. It sees more of the turns, but it also gets stopped by many more fake ones. Charts look obvious in hindsight because the failed breakouts that kept going up are no longer on screen. HTF_SWEEP stays in the code switched off, and nothing changed in the live bot.

## 8. Positioning and order flow (tested 22 Oct 2026)

Data, built inside Supabase: Binance BTCUSDT hourly bars with **taker-buy volume** (order flow), Jan 2023 → Oct 2026 (33,380 h). Hyperliquid BTC **funding and premium**, hourly, May 2023 → Oct 2026 (29,667 h). 2023–24 is in-sample and 2025–26 out-of-sample.

**Single signals vs next-24h BTC return** (quintile 1 = lowest):
- 24h taker imbalance (heaviest selling quintile): −13 bp in-sample, **−12 bp out-of-sample**, against roughly flat or positive in the other quintiles. This is order-flow momentum and the only signal whose sign held in both periods. Its size is about one round-trip of fees.
- 4h imbalance, 24h-average funding and premium all **flip sign** between the periods, so they're noise.

**Order flow at 4H-level sweeps:** the first result looked strong. A high sweep with aggressive selling was followed by +1.2–1.6% over 24h, about 67% of the time. Once each sweep was counted only once (no overlapping hours), just 3–5 independent events a year remained and their signs were mixed. **The effect was an artifact.**

**As a filter on v5.1's own 138 trades:**

| Filter | 2023–24 pass / fail (avg R) | 2025–26 pass / fail (avg R) |
|---|---|---|
| 24h order flow on the trade's side | +0.29 (n58) / −0.26 (n15) | +0.06 (n60) / −0.02 (n5) |
| 4h order flow on the trade's side | +0.19 / +0.15 | −0.11 / **+0.47** (reversed) |
| Funding: crowd on our side | +0.25 / −0.22 | +0.03 / +0.08 (reversed) |

**Decision:** 24h order flow points the right way consistently, but it would remove only about 10% of trades and changes almost nothing out-of-sample. From v5.3 the bot **measures it live on every decision** ("Order flow 24h with/against trade", shadow) and the dashboard shows it, so a live sample builds up. It doesn't gate trades yet. Revisit after about 50 live trades.

Not tested (no free multi-year history): liquidation clusters, open-interest changes, top-trader positioning. Coinversa holds these, but only 30 days of history, on a $199/month plan.

## 9. EMA20 / EMA50 cross (user's chart idea, tested 22 Oct 2026)

Idea: on the 15m chart, the drop accelerated after EMA20 crossed under EMA50, so sell the cross (and buy the opposite cross). Strategy `EMA_CROSS` (opt-in, OFF), full engine, all costs, 2023 → Aug 2026, auto-disable switched off for research:

| Variant | Trades | Avg R after costs | Avg R before costs | PF | 2023 / 24 / 25 / 26 (R) |
|---|---|---|---|---|---|
| 15m, both sides | 1,462 | −0.150 | −0.013 | 0.71 | −81 / −26 / −72 / −41 |
| 15m, shorts only | 1,034 | −0.188 | −0.047 | 0.60 | −80 / −33 / −62 / −20 |
| 15m + 4H SuperTrend agrees | 982 | −0.189 | −0.045 | 0.68 | |
| 15m + daily regime gate | 693 | −0.201 | −0.065 | 0.70 | |
| 15m, wider stop (4×ATR) | 848 | −0.076 | +0.015 | 0.87 | +2 / −17 / −56 / +7 |
| 1h, stop 6×ATR15 | 419 | −0.086 | −0.020 | 0.80 | |
| 1h + 4H agree + daily gate | 96 | +0.015 | +0.079 | 1.06 | +4 / −1 / −4 / +3 |

**Result:** no edge. Even *before* fees the 15m cross averages about 0R, so the crossover has no predictive value on its own and fees turn it negative. The cross lags by design. It happens after the move has started, which is why it looks perfect on a chart that already shows the drop, and BTC whipsaws through it many times for every clean trend. The one break-even variant (1h, with the 4H trend and daily regime agreeing) is basically a slower copy of HTF_TREND, which the bot already trades. EMA_CROSS stays off.
