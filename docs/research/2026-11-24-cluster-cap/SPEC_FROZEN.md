# Frozen spec: same-direction risk budget across crypto books (written 2026-11-24, before any result was seen)

## Origin (learning loop, first lesson)
Live record, 2026-11-20/21: four basket books (DOGE, ZEC, XMR, ADA) opened HTF_TREND shorts on the same 4h breakdown. Three were stopped out together (−3R); the fourth exited at breakeven. One market move was taken as four bets. Cause tag: `cluster_loss`.

## Hypothesis
Sharing a fixed risk budget across same-direction crypto entries reduces drawdown more than it reduces return, so net R per unit of max drawdown improves.

## Rule CLUSTER_CAP (fixed: K = 3)
When a crypto book enters, count the crypto positions open in the **same direction** across all books, including this one: n.
- The new trade's risk is multiplied by `min(1, K / n)`. Its stop, targets and exits are unchanged.
- Opposite-direction positions do not count.
- An open position is never resized.

## Method
- HTF_TREND lanes from the two earlier studies: the 15 coins with frozen data (BTC + ETH, SOL, BNB, XRP, DOGE + ZEC, NEAR, LIT, XMR, AAVE, UNI, LINK, PEPE, AVAX, ADA).
- Same window, BTC's live config, real funding, 1.5× costs.
- Each trade's open time, close time and direction are recorded. Weights are applied in open-time order from the positions open at that moment.
- The scaling is exact for R: the same trades are kept, only their size changes.
- Portfolio: equal base risk per book; daily R summed.

## Decision (1.5× costs)
**PASS** needs all of:
- net R / max drawdown (R) improves vs. no cap;
- max drawdown is lower;
- the worst 7-day loss is lower;
- net R falls by no more than 25%.

**REJECT** otherwise.

On PASS: implement in the live run loop for the crypto paper books, shadow-logged first.

## Limits
- One window of history.
- Scaling at entry ignores what the size cap would have done to intrabar fills (none: same prices).
- Base risk is the same per book; the live basket is at half size vs BTC/ETH.
