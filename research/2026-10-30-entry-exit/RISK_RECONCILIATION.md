# Risk and quantity reconciliation: V5-1793318461202 (BTC HTF_TREND short)

All inputs are from the stored decision record D-V5-1793318461202 (`plan`, `plan.sizing`, `plan.modeledCosts`). Formulas are from `engine.ts openPosition` / `fill`.

## Inputs (unrounded)
| Item | Value | Source |
|---|---|---|
| Equity before entry | 342.59566503742155 | `plan.sizing.equityBefore` |
| Risk fraction | 0.02 × risk multiplier 1 × risk scale 1 | `sizing.dynamicRisk`, `riskMultiplier`, `riskScale` |
| Fill reference (mark) | 77,838 | `plan.fillRef` |
| Entry = fillRef × (1 − slippage 0.0002) | 77,822.4324 | `plan.entry` |
| Original stop | 80,065.92995554466 | `plan.stop0` |
| Stop distance | 2,243.497555544658 (2.8828%) | `sizing.stopDist` |
| Taker fee / maker fee / slippage | 0.00045 / 0.00015 / 0.0002 | `modeledCosts` |

## Sizing
- riskAmt = 342.5956650 × 0.02 = **$6.851913**.
- Cost per unit at the stop = entry × taker + stop × (taker + slippage):
  - 77,822.4324 × 0.00045 = 35.0201
  - 80,065.9300 × 0.00065 = 52.0429
  - total **87.0629**
- qty = riskAmt / (stopDist + costPerUnit) = 6.851913 / 2,330.5605 = **0.002940028069314983**.
- The leverage cap (0.0220) is not binding.

## Modeled loss if the original stop fills
| Component | $ |
|---|---|
| Price move entry → stop: qty × 2,243.4976 | 6.595946 |
| Exit slippage: the stop fills at 80,065.93 × 1.0002 = 80,081.943 (qty × 16.013) | 0.047079 |
| Entry fee: qty × 77,822.43 × 0.00045 (`modeledCosts.entryFee` 0.102960) | 0.102960 |
| Exit fee: qty × 80,081.94 × 0.00045 | 0.105949 |
| **Total modeled loss at the stop** | **6.851934** |
| Share of equity before entry | **2.0000%** |

**Why $6.60 vs $6.85.** The $6.60 is quantity × stop distance: the price risk only. The $6.85 is the account-risk budget, which the sizing formula spends on price risk *plus* entry fee, exit slippage and exit fee ($0.256). The two agree to within $0.00002. That residual is because the formula prices exit costs at the stop price rather than the slipped fill price. It is not an accounting error.

Not included in the $6.85:
- **Funding.** The backtest assumes 0.00125%/h on the $228.80 notional, about $0.0029/h, or about $1.44 if held the full 504 h. Live paper uses Hyperliquid's actual signed rate, which a short may pay or receive.
- **Entry slippage versus the 77,838 mark** (qty × 15.57 = $0.046). It is already inside the entry price, so it is part of the R distance, not an extra cost.
- **A gap through the stop.** Paper fills assume the stop price plus slippage; a real gap could fill worse.

## Target quantities (executor semantics)
`fill()` closes `originalQty × CUM[k] − closedQty`, with CUM = 0.5 / 0.75 / 1.0. This is a **cumulative** target on the original size.

| Target | Incremental exit (planned) | Cumulative closed after | % of the remaining position at that time |
|---|---|---|---|
| TP1 | 0.0014700140 (50% of original) | 50% | 50% |
| TP2 | 0.0007350070 (25% of original) | 75% | 50% |
| TP3 | 0.0007350070 (25% of original) | 100% | 100% |

TP fills are maker (0.00015), with no slippage. If another partial close happened first (for example a trade-manager close), the next target closes less, so that the cumulative share still holds.

The previously reported quantities "0.00147 / 0.000735 / 0.000735" were incremental amounts. The chart (PR #22) now labels them "50% of original → 50% closed", "25% of original → 75% closed" and "25% of original → 100% closed", with 6 significant digits.
