# Forward paper experiment BASKET-HTF-1 (owner decision 2026-11-15)

**Why:** HTF_TREND was positive on 14 of 16 coins over 3 years (+0.1R per trade). The out-of-sample test narrowly missed its significance bar at 1.5× costs (`docs/research/2026-11-15-oos-coins`). The owner chose the only unbiased test left: forward paper trading.

## Books
| Group | Books | Mode | Config |
|---|---|---|---|
| Basket | SOL, DOGE, BNB, XRP, ZEC, NEAR, XMR, AAVE, UNI, LINK, PEPE (kPEPE), AVAX, ADA | paper, simulated $350 each | HTF_TREND only, **half size** (RISK_SCALE 0.5), BTC's live settings |
| Pre-registered | ETH | paper, simulated $350 | `ETH-PAPER-1`, HTF_TREND full size |
| Traditional markets | SPX (S&P 500), NDX (Nasdaq-100), NVDA, XAU (gold), XAG (silver), BRENT, WTI | **record-only** (shadow) | HTF_TREND; would-be entries recorded, never opened |
| Unchanged | BTC, GOLD, AI trader | as before | as before |

- Left out: LIT. Hyperliquid's LIT is a different token from the Binance LITUSDT that was tested.
- XMR and AAVE stay in, although they were negative in testing; "all coins" was the rule.
- Lot sizes (`szDecimals`) were read from Hyperliquid on 2026-11-15.

## Running cost (Hyperliquid rate limit)
- A **flat** basket book is evaluated once per 4h close, in one of three stagger slots (0, 5 or 10 minutes after the close). The catch-up scan re-checks the 4h boundary bar, so a late slot still sees the setup.
- A book **holding a position** runs every 5-minute cycle.
- One `metaAndAssetCtxs` response per dex is shared across the run. 1m bars are not fetched for flat basket books.
- The 15-minute market board keeps its original markets.

## How it will be judged (fixed now)
- **When:** after **≥ 30 closed basket trades**, or **6 months** (2027-05-15), whichever comes first.
- **Pass:** pooled R per trade > 0 after costs, and the basket's simulated equity (sum over books) above its start.
- **On pass:** the basket can be considered for a real-money pilot, which needs separate approval and a broker path that does not exist today.
- **On fail:** the basket is switched off.
- Single trades and short streaks are not evidence either way.
- The traditional-market books are judged only after they have their own ≥ 30 recorded signals, and only then for paper.

## Rollback
`DESKBOT_BOOKS=BTC,GOLD,ETH` (or any exact list) stops the other books from running. Their rows stay, unchanged.
