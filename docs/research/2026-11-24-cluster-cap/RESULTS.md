# Results: CLUSTER_CAP, a same-direction risk budget (2026-11-24)

Spec committed first (`c93ede5`). HTF_TREND lanes on **16** coins (the spec text says 15 but lists 16; all 16 listed were run): BTC, ETH, SOL, BNB, XRP, DOGE, ZEC, NEAR, LIT, XMR, AAVE, UNI, LINK, PEPE, AVAX, ADA.
- Binance USD-M 5m data, SHA-256 verified (`scripts/fetch_archive.sh`).
- BTC's live config (`research_data/live_cfg.json`), real funding, 1.5× costs.
- 1,380 trades. The weights are exact scalings of the same trades.

| | No budget | K = 3 |
|---|---|---|
| Net R | +126.7 | +94.7 (**−25.3%**) |
| Max drawdown | 53.6 R | **22.6 R** |
| Net R / max DD | 2.37 | **4.19** |
| Worst 7 days | −15.1 R | **−8.8 R** |
| 90% interval of net R (10-day blocks) | [−13.1, +283.2] | **[+19.2, +175.9]** |
| By year | 2023 +26.1 · 2024 +10.5 · 2025 +69.5 · 2026 +20.6 | 2023 +9.5 · 2024 +22.9 · 2025 +56.2 · 2026 +6.2 |

- 1,083 of 1,380 entries were scaled down.
- At one entry, all 16 books held positions in the same direction. Crypto trends are highly correlated.

## Verdict: **REJECT, narrowly**
Three of four conditions pass: drawdown, net R per drawdown and the worst week all improve a lot. The fourth fails: net R fell 25.3% against a limit of 25%. The rule is applied as written and is not changed after seeing the result.

## What it still tells us
- Same-direction crypto entries are the dominant risk of the basket: max drawdown falls 58% under a budget.
- The uncapped basket's 90% interval includes 0; the capped one does not, because the variance drops far more than the mean.
- This is input for the sizing step (performance-based risk), not an adopted rule. A new hypothesis that combines a budget with sizing needs its own frozen spec, written before it is run.
- Live: recorded as an **observation only**. The learning desk shows what weight each entry would have had; trades are unchanged.
