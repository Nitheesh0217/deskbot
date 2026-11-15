# Frozen spec: do the positive strategies hold on more coins? (written 2026-11-15, before any result was seen)

## Why
HTF_TREND's edge on BTC is thin (+0.06-0.09R per trade with real funding). A thin but real edge improves most reliably through **more independent trades**, not through tuning. The question is whether the same rules, unchanged, are positive on other liquid perps.

## Universe (fixed now, by liquidity, not by any result)
ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT: the five most liquid Binance USD-M perps after BTC. No coin is added or removed after results.

## Data
Binance USD-M 5m klines from the public archive (`data.binance.vision`, SHA-256 checked per file), same window as the frozen BTC file (3 years plus 130 days of warm-up), and real funding per coin (`--funding`).

## Method
- `scripts/challenger_study.ts`, BASE variant, isolated lanes, **BTC's live config unchanged** (`live_cfg.json` BTC book), costs at 1× and 1.5×, real funding.
- Strategies: HTF_TREND, D_BEARTRAP, D_THRUST (the strategies still enabled that traded on BTC).

## Decision rules
- A (coin, strategy) is a **shadow-book candidate** if, at 1.5× costs: ≥ 30 trades; R per trade > 0; the 90% block-bootstrap interval of its daily R sum (10-day blocks) is above 0, **or** R per trade > 0 in each of the last two calendar years.
- Portfolio check: the equal-risk sum across all candidates must beat BTC alone on net R per unit of max drawdown.
- Anything else is reported and not used.
- A candidate goes to a **shadow** book first (paper, separate equity), never straight into a live book.

## Limits
- Same window for selection and evaluation; the universe was fixed in advance to limit selection bias.
- Five coins × three strategies = 15 tests, so about one false positive is expected at 90%.
