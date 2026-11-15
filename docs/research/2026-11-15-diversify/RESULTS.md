# Results: positive strategies on five more coins (2026-11-15)

Spec committed first (`147bfea`, universe fixed by liquidity). Data: Binance USD-M 5m klines (352,800 bars per coin, 0 gaps) and funding, all from `data.binance.vision`, SHA-256 checked per file. BTC's live config is unchanged. Real funding is used. Lanes are isolated and every identity check passed.

## HTF_TREND, at 1.5× costs
| Coin | Trades | R per trade | Net R | Max DD | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|
| BTC (reference) | 87 | +0.064 | +5.6 | 18.4% | | | | |
| **ETH** | 83 | **+0.106** | +8.8 | 20.8% | +0.38 | −0.17 | +0.39 | +0.07 |
| SOL | 88 | +0.152 | +13.4 | 17.3% | +1.08 | +0.22 | +0.06 | −0.08 |
| BNB | 87 | +0.030 | +2.6 | 26.3% | +0.46 | −0.06 | +0.16 | −0.13 |
| XRP | 89 | +0.007 | +0.6 | 21.8% | −0.06 | +0.33 | −0.17 | −0.05 |
| DOGE | 89 | +0.147 | +13.1 | 21.3% | +0.26 | +0.29 | +0.21 | −0.17 |

- HTF_TREND is positive on **all six coins** at 1.5× costs.
- No single coin's 90% interval is above 0; for example, ETH's is [−12.6, 28.2] R.
- Only **ETH** meets the pre-set candidate rule (≥ 30 trades, positive at 1.5×, positive in both 2025 and 2026).
- D_BEARTRAP and D_THRUST have 5-17 trades per coin, which is too few to qualify anywhere. They are mixed, with BNB best, and SOL, XRP and DOGE negative for D_BEARTRAP.

## Portfolio check (equal risk per trade, daily R summed)
| Portfolio | Trades | Net R | Max DD (R) | Net R / DD | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|
| BTC alone | 87 | +5.6 | 8.3 | 0.68 | +1.4 | +6.2 | −2.7 | +0.7 |
| **BTC + ETH (pre-registered)** | 170 | +14.4 | 14.5 | **0.99** | +3.3 | +1.0 | +8.3 | +1.9 |
| All six (exploratory) | 523 | +44.1 | 35.2 | 1.25 | +14.9 | +21.3 | +15.4 | −7.6 |

The pre-registered portfolio rule passes: BTC + ETH beats BTC alone on net R per unit of drawdown. The all-six line is **exploratory**, not a decision. Crypto trends are correlated, so six coins are far fewer than six independent bets; 2026 so far is negative across the group.

## Decision
- **ETH becomes a paper book running HTF_TREND only** (`ETH-PAPER-1`, `books.ts`): BTC's live settings, simulated $350, its own state row, no effect on BTC or GOLD.
- **SOL stays a shadow book** (records would-be entries, no positions).
- **SOL and DOGE** are the next candidates if ETH's forward record holds. They need their own pre-registered decision; this window has already been used to choose them.
