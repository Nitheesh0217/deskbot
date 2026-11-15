# Frozen spec: out-of-sample test of HTF_TREND on 10 coins never used before (written 2026-11-15, before any result was seen)

## Hypothesis
HTF_TREND, **unchanged** (BTC's live config), earns a positive R per trade after costs across liquid crypto perpetuals. ETH was chosen from five coins on the same window (`2026-11-15-diversify`), so those six coins cannot test this. Only coins never used before can.

## Universe rule (mechanical)
1. Hyperliquid perps ranked by open interest on 2026-11-15 (`hl_open_interest_snapshot.txt`).
2. Skip coins already used: BTC, ETH, SOL, XRP, DOGE, BNB, PAXG.
3. Map each to Binance USD-M `<COIN>USDT` (kPEPE → 1000PEPEUSDT).
4. Keep a coin only if its monthly 5m files exist from 2023-06 through 2026-10.
5. Take the **first 10** that qualify, in ranking order.

## Method
As in the earlier studies: `scripts/challenger_study.ts --variant BASE`, real funding (`--funding`), costs at 1× and 1.5×, isolated lanes, identity check, the same 3-year window (2023-06-15 → 2026-10-22, 130 days of warm-up).

## Decision (at 1.5× costs)
**PASS** needs all of:
- pooled R per trade > 0 across the 10 coins;
- the 90% block bootstrap (10-day blocks) of the pooled daily R sum is above 0;
- at least 6 of 10 coins have R per trade > 0.

On PASS: a multi-coin HTF_TREND paper book (or books) on the coins Hyperliquid lists, sized so total risk stays bounded, and shadow first for coins with thin Hyperliquid liquidity.

**FAIL** otherwise. The "works on all coins" reading of the earlier study is then treated as luck or correlation, and ETH stays the only addition.
