# Additional paper books: ETH and SOL (shadow first)

This is separate from the integrated release, and it is not needed for that release. Creating scheduled production books is part of a separately approved deployment.

## Recommendation: ETH and SOL, both on Hyperliquid, as **shadow** books
These candidates were measured on 2026-10-30 from Hyperliquid native perps (read-only market data via the Coinversa Pulse connector; snapshot values):

| Market | Open interest | 24h volume | Funding (per h, snapshot) | Long history for research |
|---|---|---|---|---|
| BTC (existing) | $3.37B | $6.09B | +0.00125% | Binance BTCUSDT (frozen dataset) |
| **ETH** | **$2.36B** | **$2.99B** | −0.0021% | Binance ETHUSDT since 2017 |
| **SOL** | **$0.53B** | **$0.45B** | −0.0009% | Binance SOLUSDT since 2020 |
| XRP | $0.20B | $0.17B | +0.0009% | since 2018 |
| BNB | $0.07B | $0.31B | −0.0016% | since 2017 |
| DOGE, LINK, AVAX, SUI | $0.02-0.08B | $0.01-0.04B | — | shorter or thinner |

**Why ETH and SOL:**
- They are the two deepest Hyperliquid markets after BTC, so they have the tightest spreads and the most realistic paper costs.
- Both have long public 5m history, so a frozen research dataset can be built the same way as for BTC.
- Both use the same venue, data feed and accounting already used and tested for BTC (perpetual, multiplier 1, no expiry, 24/7).
- Both are offered by the crypto accounts considered for later read-only connection (Robinhood Crypto lists ETH and SOL). This is to be confirmed with the owner's actual account before any adapter is built.

**Rejected for the first expansion:**
- **XRP:** a third of SOL's open interest.
- **BNB:** low open interest relative to volume.
- **The rest:** too thin.
- **Equities, futures and prediction markets:** these need sessions and corporate actions, contract/roll rules, or resolution and settlement accounting. The crypto adapter must not stand in for them, so they stay **BLOCKED** on those dependencies (see `accounts.ts` instrument classes).

The scanner's forward record per market is 1-5 setups (ETH 4, SOL 1). That is far too small to judge anything, and it was not used for the choice.

## Instrument facts (books.ts)
| | ETH | SOL |
|---|---|---|
| Symbol / venue / type | `ETH`, Hyperliquid, USD perpetual (USDC margin) | `SOL`, Hyperliquid, USD perpetual |
| Data feed | Hyperliquid candleSnapshot (live); Binance ETHUSDT 5m (research only) | Hyperliquid; Binance SOLUSDT |
| Multiplier / expiry / settlement | 1 / none / none | 1 / none / none |
| Size step (`szDecimals`) | 4 → 0.0001 ETH (**verify**) | 2 → 0.01 SOL (**verify**) |
| Price tick | ≤ 5 significant figures, ≤ 2 decimals (**verify**) | ≤ 5 significant figures, ≤ 4 decimals (**verify**) |
| Minimum order value | $10 (**verify**) | $10 (**verify**) |
| Fees (paper model) | taker 0.045%, maker 0.015% (same model as BTC; the real fee tier depends on the account) | same |
| Funding | hourly, variable, paid or received | same |
| Sessions | 24/7 | 24/7 |

The **verify** items could not be read from Hyperliquid's API: `api.hyperliquid.xyz` does not resolve from this session's network. They must be confirmed from `metaAndAssetCtxs` before any paper entry is enabled. Shadow records already state when a size falls below one lot or below the minimum order value.

## What the PR implements
- **`books.ts`:** one specification per book, with mode (`paper` for BTC/GOLD, unchanged; `shadow` for ETH/SOL), research config (`ETH-SHADOW-1`, `SOL-SHADOW-1`), `financialValidation: UNVALIDATED`, **simulated** starting equity, instrument facts and limitations. Unknown books default to shadow and unvalidated.
- **Shadow behaviour in the existing run loop.** A shadow book evaluates the same rules but, instead of entering:
  - it records a `SHADOW` event once per strategy and signal bar: plan, quantity rounded down to the instrument's lot, notional, cost in R, and whether the order would have been executable;
  - it never opens a position, never changes equity and writes no decision record.
- **Independence.** Each book has its own state row (`dbv5_state` id = `eth` / `sol`), configuration, equity, positions, provenance and performance. The two-phase run keeps one book's advisory work and failures from holding up the others.
- **`init_book` admin action.** It creates a missing **shadow** book with simulated equity. It refuses BTC/GOLD and never overwrites.
- **Status and dashboard:** every book, including uninitialised ones, with mode, research config, validation status, freshness and limitations. Consolidated exposure is reported across books by underlying (`accounts.ts consolidate`).

## Evidence (tests; SYNTHETIC candles)
- **ETH beside BTC and GOLD:** one shadow record, no position, equity unchanged. BTC and GOLD are identical with or without the ETH book. A restart on the same bar does not repeat the record.
- **`init_book`:** creates a book with the "SIMULATED capital; not real money" note, refuses BTC/GOLD and never overwrites.
- **Lot rounding, minimum order value and cost-in-R** for ETH and SOL.
- Instrument specs pass the `accounts.ts` registry contract.

## Requirements before forward paper observation starts (owner approval)
1. Deploy the integrated release first.
2. Allow `api.hyperliquid.xyz` for verification, or verify in the deployed function: record `szDecimals`, tick and minimum order value for ETH and SOL; correct `books.ts` if they differ.
3. Run `init_book` for ETH and SOL; add them to `DESKBOT_BOOKS`. This is part of the approved deployment.
4. Observe shadow records for at least 30 signals per strategy per book, then build a frozen ETH/SOL research dataset and spec (same protocol as `research/2026-10-30-entry-exit`).
5. Paper entries only under a new, versioned research configuration (e.g. `ETH-PAPER-1`) after those checks, as a separate approval. Financial validation stays **UNVALIDATED** until supported by evidence.

No funded orders. No change to existing books' risk. BTC strategy settings are evaluated on these instruments, never assumed valid.
