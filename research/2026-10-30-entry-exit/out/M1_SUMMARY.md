# M1 results: excursions, time to target and entry timing (development data only)

Isolated lanes, frozen data and config (FREEZE.json). All three years are development data (SPEC_FROZEN 1).
Censored trades (forced closed at the data end before their max hold) are excluded from outcome columns.
'Hit' columns are first-touch counts on the 5m path, not probabilities.

## BTC (2023-10-23 → 2026-10-22)

| strategy | n (cens.) | net R | mean R | win | TP1 before stop | TP2 | TP3 | med MFE R | med MAE R | med giveback R | time exits | med h to TP1 / stop | max hold h | ambiguous bars |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SWEEP_REV | 1793 (0) | -451.0 | -0.252 | 32% | 45% | 30% | 21% | 0.79 | 1.07 | 1.37 | 2% | 0.67 / 0.5 | 16 | 2 |
| SESSION_BO | 488 (1) | -86.9 | -0.178 | 34% | 48% | 31% | 18% | 0.95 | 1.06 | 1.51 | 8% | 0.58 / 0.83 | 12 | 0 |
| TREND_MTF | 105 (0) | -2.8 | -0.026 | 42% | 44% | 29% | 16% | 0.81 | 1.0 | 1.34 | 28% | 5.08 / 4.38 | 24 | 0 |
| HTF_TREND | 85 (1) | +6.8 | +0.080 | 41% | 42% | 25% | 14% | 1.03 | 1.02 | 1.45 | 6% | 23.92 / 26.92 | 504 | 0 |
| D_BEARTRAP | 19 (0) | +3.7 | +0.194 | 42% | 42% | 42% | 42% | 0.67 | 1.0 | 1.03 | 0% | 19.66 / 15.42 | 720 | 0 |
| D_THRUST | 8 (0) | +3.3 | +0.407 | 50% | 38% | 38% | 38% | 1.4 | 0.41 | 0.97 | 25% | 223.25 / 445.09 | 720 | 0 |

### Entry timing (causal measures at the signal) vs outcome, by tercile

- **SWEEP_REV**, signal bar's own move (ATR), cuts -0.11 / 0.16: low n=599 mean -0.238R TP1-first 46%; mid n=604 mean -0.233R TP1-first 47%; high n=590 mean -0.284R TP1-first 43%
- **SWEEP_REV**, ATR % of price (volatility), cuts 0.24 / 0.36: low n=602 mean -0.266R TP1-first 44%; mid n=595 mean -0.263R TP1-first 47%; high n=596 mean -0.226R TP1-first 45%
- **SESSION_BO**, signal bar's own move (ATR), cuts 0.99 / 1.50: low n=164 mean -0.195R TP1-first 49%; mid n=164 mean -0.164R TP1-first 49%; high n=160 mean -0.175R TP1-first 44%
- **SESSION_BO**, ATR % of price (volatility), cuts 0.24 / 0.35: low n=165 mean -0.166R TP1-first 53%; mid n=161 mean -0.259R TP1-first 43%; high n=162 mean -0.110R TP1-first 47%
- **TREND_MTF**, signal bar's own move (ATR), cuts 0.76 / 1.30: low n=37 mean +0.148R TP1-first 46%; mid n=34 mean -0.023R TP1-first 47%; high n=34 mean -0.219R TP1-first 38%
- **TREND_MTF**, ATR % of price (volatility), cuts 0.11 / 0.18: low n=39 mean +0.253R TP1-first 54%; mid n=32 mean -0.297R TP1-first 31%; high n=34 mean -0.093R TP1-first 44%
- **HTF_TREND**, signal bar's own move (ATR), cuts 1.11 / 1.93: low n=29 mean -0.100R TP1-first 45%; mid n=28 mean +0.011R TP1-first 36%; high n=28 mean +0.337R TP1-first 46%
- **HTF_TREND**, close beyond Donchian trigger (ATR), cuts 0.37 / 0.86: low n=29 mean -0.412R TP1-first 28%; mid n=28 mean +0.181R TP1-first 50%; high n=28 mean +0.490R TP1-first 50%
- **HTF_TREND**, ATR % of price (volatility), cuts 1.22 / 1.55: low n=29 mean +0.476R TP1-first 52%; mid n=28 mean -0.152R TP1-first 29%; high n=28 mean -0.097R TP1-first 46%

## GOLD (2023-10-23 → 2026-10-22)

| strategy | n (cens.) | net R | mean R | win | TP1 before stop | TP2 | TP3 | med MFE R | med MAE R | med giveback R | time exits | med h to TP1 / stop | max hold h | ambiguous bars |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SWEEP_REV | 1178 (1) | -347.7 | -0.295 | 29% | 46% | 26% | 16% | 0.81 | 1.1 | 1.43 | 7% | 0.92 / 0.67 | 16 | 7 |
| EMA_CROSS | 1056 (0) | -412.2 | -0.390 | 23% | 32% | 17% | 10% | 0.7 | 1.06 | 1.6 | 6% | 4.25 / 2.75 | 48 | 0 |
| SESSION_BO | 250 (0) | -71.2 | -0.285 | 29% | 43% | 24% | 12% | 0.78 | 1.04 | 1.34 | 11% | 0.75 / 0.92 | 12 | 1 |
| TREND_MTF | 79 (0) | -9.2 | -0.116 | 38% | 47% | 28% | 15% | 0.84 | 0.91 | 1.34 | 14% | 4.33 / 2.67 | 24 | 0 |
| HTF_TREND | 52 (0) | +23.2 | +0.447 | 52% | 56% | 42% | 23% | 1.95 | 1.0 | 1.99 | 10% | 63.25 / 21.2 | 504 | 0 |
| D_BEARTRAP | 8 (0) | +6.5 | +0.816 | 75% | 62% | 62% | 62% | 2.03 | 0.38 | 0.78 | 0% | 142.25 / 23.0 | 720 | 0 |
| D_THRUST | 7 (0) | -1.1 | -0.161 | 29% | 43% | 43% | 43% | 0.7 | 1.02 | 1.26 | 0% | 361.5 / 78.33 | 720 | 0 |

### Entry timing (causal measures at the signal) vs outcome, by tercile

- **SWEEP_REV**, signal bar's own move (ATR), cuts -0.19 / 0.15: low n=395 mean -0.327R TP1-first 45%; mid n=397 mean -0.270R TP1-first 47%; high n=386 mean -0.288R TP1-first 45%
- **SWEEP_REV**, ATR % of price (volatility), cuts 0.15 / 0.21: low n=395 mean -0.301R TP1-first 48%; mid n=396 mean -0.332R TP1-first 44%; high n=387 mean -0.253R TP1-first 45%
- **EMA_CROSS**, signal bar's own move (ATR), cuts 0.00 / 0.59: low n=363 mean -0.383R TP1-first 33%; mid n=342 mean -0.385R TP1-first 31%; high n=351 mean -0.403R TP1-first 31%
- **EMA_CROSS**, ATR % of price (volatility), cuts 0.13 / 0.19: low n=355 mean -0.503R TP1-first 30%; mid n=351 mean -0.375R TP1-first 33%; high n=350 mean -0.292R TP1-first 33%
- **SESSION_BO**, signal bar's own move (ATR), cuts 0.97 / 1.52: low n=84 mean -0.304R TP1-first 49%; mid n=83 mean -0.246R TP1-first 41%; high n=83 mean -0.304R TP1-first 40%
- **SESSION_BO**, ATR % of price (volatility), cuts 0.14 / 0.20: low n=84 mean -0.311R TP1-first 46%; mid n=84 mean -0.319R TP1-first 43%; high n=82 mean -0.224R TP1-first 40%
- **TREND_MTF**, signal bar's own move (ATR), cuts 0.81 / 1.19: low n=27 mean -0.218R TP1-first 44%; mid n=26 mean +0.052R TP1-first 54%; high n=26 mean -0.179R TP1-first 42%
- **TREND_MTF**, ATR % of price (volatility), cuts 0.06 / 0.09: low n=27 mean -0.045R TP1-first 41%; mid n=26 mean -0.337R TP1-first 38%; high n=26 mean +0.031R TP1-first 62%
- **HTF_TREND**, signal bar's own move (ATR), cuts 0.76 / 1.32: low n=18 mean +0.458R TP1-first 56%; mid n=17 mean +0.539R TP1-first 53%; high n=17 mean +0.343R TP1-first 59%
- **HTF_TREND**, close beyond Donchian trigger (ATR), cuts 0.27 / 0.75: low n=18 mean +0.001R TP1-first 44%; mid n=17 mean +0.634R TP1-first 53%; high n=17 mean +0.732R TP1-first 71%
- **HTF_TREND**, ATR % of price (volatility), cuts 0.55 / 0.74: low n=18 mean +0.919R TP1-first 67%; mid n=17 mean -0.004R TP1-first 47%; high n=17 mean +0.397R TP1-first 53%

## EXIT-C justification check (BTC; SPEC_FROZEN 4)

| strategy | n | share closed by time | median h to TP1 | max hold h | share of non-TP1 trades open past 50% hold | justified |
|---|---|---|---|---|---|---|
| SWEEP_REV | 1793 | 0.018 | 0.67 | 16 | 0.008 | no |
| SESSION_BO | 488 | 0.084 | 0.58 | 12 | 0.059 | no |
| TREND_MTF | 105 | 0.276 | 5.08 | 24 | 0.271 | YES |
| HTF_TREND | 85 | 0.059 | 23.92 | 504 | 0.0 | no |
| D_BEARTRAP | 19 | 0.0 | 19.66 | 720 | 0.0 | no |
| D_THRUST | 8 | 0.25 | 223.25 | 720 | 1.0 | YES |
