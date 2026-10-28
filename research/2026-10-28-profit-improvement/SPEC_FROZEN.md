# SPEC_FROZEN — profit-improvement challengers (frozen 2026-10-28, before any challenger or holdout run)

Paper/research only. No funded orders, no credential changes, no risk increase. The live bot is not modified by anything here.

## 1. Baseline
Unchanged live engine (`supabase/functions/deskbot-v5/engine.ts`, sha256 in FREEZE.json) with each book's exact live cfg of 2026-10-28
(`data/live_cfg_2026-10-28.json`): BTC book on Binance BTCUSDT 5m, GOLD book on PAXGUSDT 5m, start equity 352.56 / 350.
Same dynamic risk tiers, MAX_LEVERAGE 5, circuit breaker, probation, daily limits, TAKER 0.045%, MAKER 0.015%, slippage 0.02%, backtest funding 0.00125%/h.

## 2. Challengers (config-only overlays on the baseline; engine source untouched; max two)
| id | kind | overlay | rationale from live records (see brief) |
|---|---|---|---|
| A_COSTR50 | entry/filter | `MAX_COST_R: 0.5` — skip an entry when round-trip taker fee + slippage > 0.5R of the stop distance (baseline: 1 = effectively off) | live trades with 0.15-0.25% stops had the worst net R/trade (-0.48R, 15 trades) and fees+slippage ($44.30) exceeded the total net loss ($39.70); the filter can only remove trades |
| B_BE_TP1 | exit | `EXIT_MODE: "BE_AT_TP1"` — move the stop to entry after TP1 (baseline: HOLD keeps the original stop until TP2) | live losses were dominated by plain stops (17 of 29 trades, -0.85R each) that BE_AT_TP1 cannot affect; it is tested because the repo's earlier BTC research favoured a break-even rule and it only alters trades that reach TP1 (live: 11 such trades, 3 gave back). Low prior; n is small |
Both change nothing about sizing rules, leverage, or loss limits. Each is compared separately against BASE; they are never combined.
Any other variant that is tried is recorded in `out/RUN_LOG.jsonl` and listed in the brief, including failures. No new variants after this freeze without a new, dated freeze.

## 3. Data and periods (identical for every variant)
Frozen dataset `data/SHA256SUMS`: Binance spot 5m BTCUSDT and PAXGUSDT, 2023-06-15 -> 2026-10-22 (352,800 bars each); 15m/1h/4h aggregated from 5m. Warm-up 130 days before each period.
| period | UTC window | role |
|---|---|---|
| A | 2023-10-23 -> 2024-10-21 | development |
| B | 2024-10-22 -> 2025-10-22 | development |
| C | 2025-10-22 -> 2026-10-22 | holdout: no challenger run touches C before the freeze; each (book, variant, cost multiplier) is run once, enforced by `out/holdout_ledger.json` |
| live week | 2026-10-22 -> 2026-10-28 | descriptive fidelity check only; never used in any verdict |
Disclosed limitation: the baseline (live) configuration was itself selected in earlier research on 2023-2026 data that includes C, so C is untouched by these challengers but not unseen by the baseline; it favours the baseline. No data earlier than 2023-06 is available, so there is no further sealed reserve.
Known model gaps: 5m bars (live manages exits on 1m); Binance spot instead of Hyperliquid perps; constant funding; no news/F&G/probation-history inputs identical to live. Pre-freeze fidelity replay of the live week: BTC 12 of 14 replay trades matched live trades (same win/loss sign 12/12, net R -1.13 replay vs -2.20 live for 16 live trades); PAXG only 3 of 10 matched (net R -7.99 vs -6.36). PAXG results are therefore weaker evidence than BTC.

## 4. Metrics (reported for BASE and each challenger, per book and pooled, per period)
trade count, net R and net expectancy (R/trade), net $, win rate, profit factor, max drawdown (per book, from the engine's equity path), worst trade R, 5% CVaR of trade R, exposure (sum of position hold time / elapsed time), fees, funding.
Cost sensitivity on C (run once each): all costs (fee, maker, slippage) x0.5 and x1.5 for BASE and challengers alike.

## 5. Uncertainty
Paired daily delta-R (challenger minus BASE, per day by trade close day, books summed for the pooled series). Circular moving-block bootstrap, block 10 days (5 and 20 reported as sensitivity), 10,000 resamples, seed 20261028 (+L), two-sided 97.5% interval (percentiles 1.25/98.75: Bonferroni for two challengers). Also reported: lag 1-3 autocorrelation and effective n. A passing test or interval is not evidence of future profit.

## 6. Decision rules (applied mechanically by `analysis/compare.py`)
REJECT if any: R1 holdout pooled dNetR <= 0; R2 development (A+B) interval entirely below 0; R3 any book's max drawdown more than 2 pp worse than BASE in dev or holdout; R4 holdout CVaR5 worse by > 0.05R or worst trade worse by > 0.25R; R5 holdout exposure > 10% above BASE; R6 holdout dNetR at 1.5x costs <= 0.
Otherwise PROMOTE (to an extended isolated paper/shadow run only, never to the live book) requires all of: P1 dev interval lower bound > 0; P2 holdout interval lower bound > 0; P3 >= 30 challenger trades in holdout; P4 dNetR > 0 in both A and B; P5 dNetR > 0 at 0.5x and 1.5x costs on holdout; G1 books agree in sign when each has >= 20 challenger trades.
Anything else is INCONCLUSIVE. Single-year, single-sample outcomes cannot establish profitability; PROMOTE means "worth forward paper evidence", nothing more.

## 7. Governance
- `harness/run.ts` refuses any challenger or holdout run unless FREEZE.json exists and every listed file hash and the engine hash still match.
- Every invocation (including refusals) is appended to `out/RUN_LOG.jsonl`; repeats need `--repeat-reason` and are logged.
- Pre-freeze runs (all BASE, tag `pre-freeze-validation`): BTC period A x3 (determinism check), BTC+PAXG fidelity week. No challenger and no period B/C run has been made.
