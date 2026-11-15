# Results: out-of-sample HTF_TREND on 10 new coins (2026-11-15)

Spec committed first (`3fa7804`). The universe came from the mechanical rule: Hyperliquid open-interest rank, skip the coins already used, full Binance history required. Picked: ZEC, NEAR, LIT, XMR, AAVE, UNI, LINK, PEPE (1000PEPEUSDT), AVAX, ADA. Skipped for short history: HYPE, VVV, PUMP, ZRO, ENA, MON, WLD, XPL.

Data: Binance USD-M 5m bars and funding, SHA-256 checked, 352,800 bars per coin. LIT had one gap and a funding gap in 2025-07…11. **Caveat:** Binance LITUSDT is an older token and not necessarily Hyperliquid's LIT; the rule was applied as written.

## Per coin, 1.5× costs, real funding, BTC's live config unchanged
| Coin | Trades | R per trade | Net R | Max DD | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|
| ADA | 82 | +0.388 | +31.8 | 13.3% | +1.07 | +0.21 | +0.68 | +0.08 |
| PEPE | 88 | +0.189 | +16.6 | 16.2% | +0.49 | −0.02 | +0.31 | +0.30 |
| UNI | 82 | +0.173 | +14.2 | 17.9% | +0.40 | −0.11 | +0.30 | +0.35 |
| AVAX | 86 | +0.167 | +14.3 | 14.1% | +1.01 | +0.13 | +0.13 | −0.05 |
| NEAR | 97 | +0.152 | +14.7 | 18.5% | +0.36 | +0.18 | −0.09 | +0.38 |
| LIT | 57 | +0.135 | +7.7 | 13.2% | −0.20 | +0.31 | +0.08 | 0.00 |
| ZEC | 92 | +0.122 | +11.2 | 21.3% | −0.53 | −0.02 | +0.41 | +0.22 |
| LINK | 92 | +0.000 | +0.0 | 18.3% | −0.04 | −0.09 | +0.16 | −0.07 |
| AAVE | 89 | −0.079 | −7.0 | 33.9% | −0.80 | −0.27 | +0.17 | +0.10 |
| XMR | 96 | −0.236 | −22.7 | 39.1% | −0.81 | −0.41 | −0.05 | −0.09 |

## Pooled (equal risk per trade, daily R summed)
| Cost | Trades | R per trade | Net R | Max DD | 90% interval of net R | Coins > 0 |
|---|---|---|---|---|---|---|
| 1× | 859 | +0.110 | +94.4 | 30.5 R | **[+6.8, +195.8]** | 8/10 |
| 1.5× | 861 | +0.094 | +81.0 | 33.6 R | [−5.3, +181.0] | 7-8/10 (LINK ≈ 0) |

## Verdict under the frozen rule: **FAIL, narrowly**
At 1.5× costs, the pooled R per trade is positive (+0.094) and most coins are positive, but the 90% interval includes 0 (lower bound −5.3 R). At normal costs (1×) it is above 0.

**What this means:**
- The edge is broad and consistent with the first study. Across 16 coins, HTF_TREND is positive on 14 at 1× costs, with about +0.1R per trade.
- The pre-set bar was significance at the pessimistic cost level, and it was missed by a small margin.
- Crypto coins also move together, which widens the interval honestly.
- As the spec says, this test **does not unlock** new paper books by itself. ETH stays the only addition from it.

## Not tested: stocks, indices, commodities
- Hyperliquid now lists S&P 500, Nasdaq-100, NVDA, gold, silver, Brent and WTI perps (the `xyz` dex). They have only 243-399 days of history, about 10-25 trend trades each, which is too few to judge.
- Long daily history (stooq.com) is refused from this cloud machine (connection reset), although the host is allowed in the environment.
- These markets can only be evaluated forward, as shadow or paper records.

## Next decision (owner)
The only unbiased test left is **forward**. A pre-registered paper experiment would run HTF_TREND across the Hyperliquid-listed coins of both studies, with simulated money and a fixed total-risk cap, and be judged after a set number of trades. It needs the owner's go-ahead, because the frozen rule above did not unlock it.
