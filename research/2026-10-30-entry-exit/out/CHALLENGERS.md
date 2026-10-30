# Frozen challengers vs BASE (development data; SPEC_FROZEN 4-5)

Each row is an isolated lane on the identical 3-year 5m window. The hook-free copy of the lane step reproduced `lanes.stepLane` trade-for-trade in every run (identity check).
Interval: circular block bootstrap of the pooled sum of paired daily ΔR, 10,000 resamples, seed 20261030, 97.5% two-sided (1.25-98.75 pct).
Outcomes are REJECT or FORWARD-SHADOW at most. Nothing here can promote a change to a book.

## EXIT_B on D_BEARTRAP (books: BTC, GOLD)

| book | trades B→C | net R B→C | exp R B→C | win B→C | PF B→C | maxDD % B→C | worst R B→C | CVaR5 R B→C | fees+funding $ B→C | skipped / TP1 modified / time50 closes |
|---|---|---|---|---|---|---|---|---|---|---|
| BTC | 19 → 19 | 3.677 → 1.758 | 0.1935 → 0.0925 | 0.421 → 0.474 | 1.362 → 1.209 | 7.37 → 6.11 | -1.04 → -1.01 | -1.044 → -1.012 | 8.9 → 8.4 | 0 / 19 / 0 |
| GOLD | 8 → 8 | 6.527 → 4.474 | 0.8158 → 0.5592 | 0.75 → 0.75 | 4.21 → 4.84 | 4.55 → 2.35 | -1.02 → -1.01 | -1.025 → -1.009 | 7.6 → 5.4 | 0 / 8 / 0 |

Pooled ΔnetR -3.97R; at 1.5× costs -3.69R. 97.5% interval of pooled ΔR (block 10): (-10.34, 2.06); block 5: (-10.41, 2.02); block 20: (-10.5, 2.0).

**Verdict: REJECT**: pooled ΔnetR -3.97 ≤ 0; ΔnetR at 1.5× costs -3.69 ≤ 0.

Sample warning: at least one book has fewer than 30 base trades; no reliable conclusion either way.

## EXIT_B on D_THRUST (books: BTC, GOLD)

| book | trades B→C | net R B→C | exp R B→C | win B→C | PF B→C | maxDD % B→C | worst R B→C | CVaR5 R B→C | fees+funding $ B→C | skipped / TP1 modified / time50 closes |
|---|---|---|---|---|---|---|---|---|---|---|
| BTC | 8 → 8 | 3.257 → 2.365 | 0.4071 → 0.2956 | 0.5 → 0.625 | 2.395 → 3.404 | 4.87 → 3.05 | -1.1 → -0.51 | -1.102 → -0.509 | 5.8 → 3.1 | 0 / 8 / 0 |
| GOLD | 7 → 7 | -1.125 → 0.001 | -0.1607 → 0.0001 | 0.286 → 0.429 | 0.767 → 1 | 8.77 → 3.66 | -1.06 → -1.04 | -1.065 → -1.044 | 4.4 → 3.6 | 0 / 7 / 0 |

Pooled ΔnetR +0.23R; at 1.5× costs +0.45R. 97.5% interval of pooled ΔR (block 10): (-5.23, 5.62); block 5: (-5.42, 5.56); block 20: (-5.88, 6.01).

**Verdict: FORWARD-SHADOW (candidate only)**.

Sample warning: at least one book has fewer than 30 base trades; no reliable conclusion either way.

The interval includes 0: the improvement is not distinguishable from noise on this sample.

## EXIT_C on D_THRUST (books: BTC, GOLD)

| book | trades B→C | net R B→C | exp R B→C | win B→C | PF B→C | maxDD % B→C | worst R B→C | CVaR5 R B→C | fees+funding $ B→C | skipped / TP1 modified / time50 closes |
|---|---|---|---|---|---|---|---|---|---|---|
| BTC | 8 → 9 | 3.257 → 7.237 | 0.4071 → 0.8041 | 0.5 → 0.889 | 2.395 → 347.695 | 4.87 → 4.35 | -1.1 → -0.02 | -1.102 → -0.021 | 5.8 → 4.9 | 0 / 0 / 6 |
| GOLD | 7 → 7 | -1.125 → -1.241 | -0.1607 → -0.1773 | 0.286 → 0.286 | 0.767 → 0.743 | 8.77 → 8.77 | -1.06 → -1.06 | -1.065 → -1.065 | 4.4 → 4.5 | 0 / 0 / 1 |

Pooled ΔnetR +3.86R; at 1.5× costs +3.85R. 97.5% interval of pooled ΔR (block 10): (-1.65, 10.6); block 5: (-1.59, 10.05); block 20: (-0.99, 10.24).

**Verdict: FORWARD-SHADOW (candidate only)**.

Sample warning: at least one book has fewer than 30 base trades; no reliable conclusion either way.

The interval includes 0: the improvement is not distinguishable from noise on this sample.

## EXIT_B on EMA_CROSS (books: GOLD)

| book | trades B→C | net R B→C | exp R B→C | win B→C | PF B→C | maxDD % B→C | worst R B→C | CVaR5 R B→C | fees+funding $ B→C | skipped / TP1 modified / time50 closes |
|---|---|---|---|---|---|---|---|---|---|---|
| GOLD | 1056 → 1035 | -412.159 → -369.031 | -0.3903 → -0.3566 | 0.234 → 0.209 | 0.419 → 0.378 | 87.45 → 84.36 | -1.1 → -1.1 | -1.051 → -1.035 | 147.5 → 149.7 | 0 / 1035 / 0 |

Pooled ΔnetR +43.13R; at 1.5× costs +53.65R. 97.5% interval of pooled ΔR (block 10): (2.76, 82.29); block 5: (2.57, 82.93); block 20: (4.3, 83.98).

**Verdict: FORWARD-SHADOW (candidate only)**.

## ENTRY_1 on HTF_TREND (books: BTC, GOLD)

| book | trades B→C | net R B→C | exp R B→C | win B→C | PF B→C | maxDD % B→C | worst R B→C | CVaR5 R B→C | fees+funding $ B→C | skipped / TP1 modified / time50 closes |
|---|---|---|---|---|---|---|---|---|---|---|
| BTC | 86 → 78 | 6.516 → 9.013 | 0.0758 → 0.1156 | 0.407 → 0.423 | 1.14 → 1.229 | 18.28 → 19.36 | -1.1 → -1.1 | -1.068 → -1.074 | 41.0 → 38.6 | 23 / 0 / 0 |
| GOLD | 52 → 49 | 23.225 → 20.177 | 0.4466 → 0.4118 | 0.519 → 0.49 | 2.024 → 1.889 | 12.5 → 12.5 | -1.09 → -1.09 | -1.088 → -1.088 | 58.7 → 55.8 | 15 / 0 / 0 |

Pooled ΔnetR -0.55R; at 1.5× costs -0.03R. 97.5% interval of pooled ΔR (block 10): (-16.32, 14.9); block 5: (-19.09, 17.24); block 20: (-15.3, 14.24).

**Verdict: REJECT**: pooled ΔnetR -0.55 ≤ 0; ΔnetR at 1.5× costs -0.03 ≤ 0.

## EXIT_B on HTF_TREND (books: BTC, GOLD)

| book | trades B→C | net R B→C | exp R B→C | win B→C | PF B→C | maxDD % B→C | worst R B→C | CVaR5 R B→C | fees+funding $ B→C | skipped / TP1 modified / time50 closes |
|---|---|---|---|---|---|---|---|---|---|---|
| BTC | 86 → 87 | 6.516 → -3.85 | 0.0758 → -0.0443 | 0.407 → 0.264 | 1.14 → 0.909 | 18.28 → 20.68 | -1.1 → -1.04 | -1.068 → -1.044 | 41.0 → 34.2 | 0 / 87 / 0 |
| GOLD | 52 → 51 | 23.225 → 19.786 | 0.4466 → 0.388 | 0.519 → 0.49 | 2.024 → 2.121 | 12.5 → 11.18 | -1.09 → -1.09 | -1.088 → -1.081 | 58.7 → 54.0 | 0 / 51 / 0 |

Pooled ΔnetR -13.80R; at 1.5× costs -12.01R. 97.5% interval of pooled ΔR (block 10): (-25.18, -2.64); block 5: (-25.73, -2.06); block 20: (-24.3, -3.03).

**Verdict: REJECT**: BTC max drawdown +2.40 pp; pooled ΔnetR -13.80 ≤ 0; interval entirely below 0; ΔnetR at 1.5× costs -12.01 ≤ 0.

## EXIT_C on TREND_MTF (books: BTC, GOLD)

| book | trades B→C | net R B→C | exp R B→C | win B→C | PF B→C | maxDD % B→C | worst R B→C | CVaR5 R B→C | fees+funding $ B→C | skipped / TP1 modified / time50 closes |
|---|---|---|---|---|---|---|---|---|---|---|
| BTC | 105 → 109 | -2.766 → -8.611 | -0.0263 → -0.079 | 0.419 → 0.385 | 0.947 → 0.833 | 23.58 → 25.08 | -1.02 → -1.01 | -1.015 → -1.009 | 45.7 → 45.2 | 0 / 0 / 27 |
| GOLD | 79 → 80 | -9.179 → -11.832 | -0.1162 → -0.1479 | 0.38 → 0.362 | 0.754 → 0.68 | 21.71 → 25.62 | -1.02 → -1.02 | -1.024 → -1.023 | 81.6 → 80.1 | 0 / 0 / 12 |

Pooled ΔnetR -8.50R; at 1.5× costs -7.37R. 97.5% interval of pooled ΔR (block 10): (-19.81, 1.2); block 5: (-19.49, 1.49); block 20: (-19.32, 1.25).

**Verdict: REJECT**: GOLD max drawdown +3.91 pp; pooled ΔnetR -8.50 ≤ 0; ΔnetR at 1.5× costs -7.37 ≤ 0.

