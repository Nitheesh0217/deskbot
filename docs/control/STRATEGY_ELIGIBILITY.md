# Strategy eligibility (paper books), as of 2026-10-30 04:41 UTC

Source: production `dbv5_state` rows `main` (BTC) and `gold` (GOLD). The read was read-only and nothing was changed.

## How "on" and "off" are decided
A strategy is switched off when any of these holds (`engine.ts offReason`):
- `enabled[id] === false` (the auto-off rule or a manual switch)
- `RISK_SCALE[id] === 0`
- it is opt-in (HTF_SWEEP, EMA_CROSS, SSR, EMA_PB) without a positive scale

The book's `cfg.RISK_SCALE` is merged over the engine defaults. In those defaults the opt-in strategies are 0 and the rest are 1. All `enabled` flags are currently `true` in both books, so the scale is what decides.

## 1. Current eligibility
| Strategy | BTC book | GOLD book |
|---|---|---|
| HTF_TREND | **active** (1); open paper position V5-1793318461202 | **active** (1) |
| D_BEARTRAP | **active** (1) | **active** (1) |
| D_THRUST | **active** (1) | **active** (1) |
| TREND_MTF | **active** (1) | **active** (1) |
| SWEEP_REV | **active** (1) | **active** (1) |
| SESSION_BO | **active** (1) | **active** (1) |
| VWAP_REVERT | **active** (1) | **active** (1) |
| EMA_CROSS | off (opt-in, scale 0) | **active (0.25)**; open paper position GOLD-1793241062679 |
| HTF_SWEEP | off (opt-in, scale 0) | off (opt-in, scale 0) |
| SSR | off (opt-in, scale 0) | off (opt-in, scale 0) |
| EMA_PB | off (opt-in, scale 0) | off (opt-in, scale 0) |

## 2. Active strategies with negative historical results (not disabled; no setting is changed here)
| Strategy (book) | Live paper record in this book | Development evidence (isolated lane, Binance 5m, 2023-10 → 2026-10) |
|---|---|---|
| SWEEP_REV (BTC) | 15 trades, −0.84R, −$5.01 | 1,793 trades, −0.252R/trade |
| SESSION_BO (BTC) | 5 trades, −0.48R, −$4.96 | 488, −0.178R/trade |
| TREND_MTF (BTC) | 0 trades | 105, −0.026R/trade (≈ flat) |
| SWEEP_REV (GOLD) | 5 trades, −2.38R, −$16.25 | 1,178, −0.295R/trade |
| EMA_CROSS (GOLD, 0.25) | 7 trades, −6.12R, −$10.04 (0 wins) | 1,056, −0.390R/trade |
| SESSION_BO (GOLD) | 1 trade, −0.63R | 250, −0.285R/trade |
| TREND_MTF (GOLD) | 1 trade, −0.05R | 79, −0.116R/trade |
| D_THRUST (GOLD) | 0 trades | 7, −0.161R/trade (too few to judge) |

Live samples of 1-15 trades are far too small to judge. The development figures come from isolated lanes rather than the shared portfolio, and they are development evidence only (see the caveats below).

## 3. Rejected challenger variants (research only, never deployed)
- **2026-10-28:** A_COSTR50 and B_BE_TP1.
- **2026-10-30:**
  - EXIT-B on HTF_TREND and D_BEARTRAP
  - EXIT-C on TREND_MTF
  - ENTRY-1 on HTF_TREND
- **Mechanically FORWARD-SHADOW but not acted on:** EXIT-B and EXIT-C on D_THRUST (15-16 trades) and EXIT-B on EMA_CROSS.

## 4. Shadow-only / advisory (no effect on paper orders)
- The scanner's shadow lane (`lane='shadow'`, SHADOW-1), which evaluates book-disabled strategies.
- FILTER-1 verdicts.
- The news filter (shadow).
- Order-flow notes.
- The AI review and committee (advisory).
- Isolated research lanes.

## Caveats that apply to every figure above
- All research years are development data; nothing above is out-of-sample.
- **5m vs 1m:** history manages exits on 5m bars, while live uses 1m. Same-bar stop/target ambiguity was 0-7 bars per strategy.
- **Venue:**
  - Binance spot vs the Hyperliquid perp.
  - BTC replay matched 12/14 live trades; PAXG matched only 3/10.
  - GOLD research is weak evidence.
- No result here authorizes funded trading.
