# DeskBot profit-improvement research brief — 2026-10-28
> **Read CORRECTIONS.md** (appended 2026-10-28 after review): bootstrap fractions are resampling results, the "holdout" is contaminated for the baseline, live groupings are descriptive, equity gaps and dollars-vs-R are reconciled there.


Paper/research only. Nothing here changes the live bot, risk, credentials or balances. Passing or failing a backtest here does not establish future profitability.

**Verdicts (pre-registered rules in `SPEC_FROZEN.md`, applied mechanically by `analysis/compare.py`):**
| challenger | change | verdict |
|---|---|---|
| A_COSTR50 (entry/filter) | `MAX_COST_R` 1 -> 0.5 | **REJECT** (R1: holdout dNetR -0.19R <= 0; R3: BTC holdout max drawdown 25.3% vs 19.6%). Practically a null result: dev +16.2R but the interval [-0.022, +0.073] R/day includes 0; holdout interval [-0.062, +0.058]. |
| B_BE_TP1 (exit) | `EXIT_MODE` HOLD -> BE_AT_TP1 | **REJECT** (R1, R3 both books, R6). Holdout -23.2R vs baseline, P(dNetR<=0)=0.95; worse in 1.5x and 0.5x cost cases too. |
Recommendation: promote neither; keep the live config unchanged by this work. Freeze and tests passing say nothing about profit.

## 1. Where the live deterioration comes from (29 closed live paper trades, 22-28 Oct 2026)
Source: `dbv5_trades` export (`data/live_trades_2026-10-28.csv`, reconciled to the ledger), analysis in `scripts/live_attribution.py`, `analysis/provenance.py`, outputs `out/live_attribution.json`, `out/provenance.csv`, `out/deterioration_groups.json`. Net -$39.70 (-9.10R, mean -0.314R/trade; 9 wins of 29). The groups below **overlap and are not additive**.
| # | source | trades | net $ | net R | cost attribution | uncertainty |
|---|---|---|---|---|---|---|
| 1 | **GOLD book** (SWEEP_REV 5 trades -$16.25, EMA_CROSS 5 trades 0 wins -$6.83, SESSION_BO, TREND_MTF) | 12 (1 win) | -27.73 | -7.19 | frictionless P&L already -$11.64; costs $16.09 on top: a signal problem, not only a cost problem | mean -0.60R/trade, 95% block-bootstrap [-0.80, -0.40]. 12 trades, one week: very wide in terms of regime |
| 2 | **Plain stop-outs** (path = STOP) | 17 (0 wins; 9 within 30 min) | -75.35 | -14.39 | costs $29.68; frictionless -$45.67. Offset by 12 non-stop trades worth +$35.65 | descriptive; entry quality vs stop placement cannot be separated at n=17 |
| 3 | **Round-trip costs vs thin stops** (stops 0.15-0.25% of entry) | 15 | -33.44 | -7.18 | costs of these 15 trades $24.60; total live costs $44.30 (fees $31.56, slippage $13.08, funding -$0.34 i.e. received) exceed the total net loss; frictionless total was +$4.60 | whole-book mean -0.31R, 95% block interval [-0.52, -0.13]; BTC alone [-0.40, +0.17] (includes 0) |
Trade IDs: group lists in `out/deterioration_groups.json` (e.g. group 1: GOLD-1792760461854 ... GOLD-1793199662978).
Code/config versions: `dbv5_trades` stores no engine version or config fingerprint, so the epoch is **inferred** from the deploy/config timeline (`out/provenance.csv`): 3 trades ran on v5.7.0-or-earlier code, 26 on v5.8.0 (agents off in decisions); gold config changes of 23 Oct (EMA_CROSS 25%, TREND_MTF minStop 0.4%) and v5.7.0 trade-manager rules (BTC `be`, GOLD `stall`) apply to the large majority. Config approval fingerprints are unset (see EVIDENCE_LOG), so exact-config attribution per trade is impossible; closing that governance gap would make future attribution exact.
Other records: 27 of 29 trades are shorts, so one week is one market direction.

## 2. Backtest of the unchanged baseline (frozen data, identical engine)
Year A (2023-10 -> 2024-10): pooled -35.9R (-0.23R/trade, PF 0.69). Year B: -29.9R (-0.15R/trade, PF 0.69). Holdout C (2025-10 -> 2026-10): -3.6R (-0.02R/trade, PF 1.09), +$44 pooled but BTC -$11.8, PAXG +$56. **On two of three years the deployed configuration loses**; the live config was selected on data including C, which flatters it. Dollars and R diverge in C because position size compounds with equity (PAXG: -1.19R but +$56.19). The verdict rules use R, as frozen.

## 3. Challenger comparison (same data, timing, fees, slippage, funding, sizing, risk controls; per-book runs; start equity 352.56 / 350)
Full tables: `RESULTS.md`, `out/results.json`. Pooled BTC+PAXG:
| period | variant | trades | net R | R/trade | net $ | PF | worst R | CVaR5 R | exposure | max DD BTC / PAXG |
|---|---|---|---|---|---|---|---|---|---|---|
| A dev | BASE | 158 | -35.91 | -0.227 | -121.6 | 0.69 | -1.09 | -1.05 | 43.6% | 25.9 / 29.5% |
| A dev | A_COSTR50 | 155 | -24.27 | -0.157 | -73.3 | 0.82 | -1.09 | -1.06 | 45.2% | 23.1 / 25.0% |
| A dev | B_BE_TP1 | 166 | -30.95 | -0.186 | -111.4 | 0.72 | -1.09 | -1.05 | 36.9% | 27.6 / 30.9% |
| B dev | BASE | 201 | -29.89 | -0.149 | -151.1 | 0.69 | -1.08 | -1.04 | 35.7% | 31.2 / 26.0% |
| B dev | A_COSTR50 | 197 | -25.32 | -0.129 | -133.2 | 0.73 | -1.08 | -1.05 | 38.8% | 31.4 / 23.9% |
| B dev | B_BE_TP1 | 211 | -29.14 | -0.138 | -95.3 | 0.80 | -1.08 | -1.05 | 30.1% | 29.0 / 20.5% |
| C holdout | BASE | 206 | -3.56 | -0.017 | +44.4 | 1.09 | -1.10 | -1.04 | 44.6% | 19.6 / 15.9% |
| C holdout | A_COSTR50 | 186 | -3.76 | -0.020 | +61.8 | 1.12 | -1.10 | -1.04 | 41.7% | 25.3 / 16.7% |
| C holdout | B_BE_TP1 | 253 | -26.76 | -0.106 | -82.0 | 0.85 | -1.10 | -1.05 | 39.0% | 27.9 / 17.9% |
Paired daily delta-R vs BASE (circular block bootstrap, L=10 days, B=10,000, seed 20261028, 97.5% interval; L=5/20 within +-0.01 of it; lag-1 ACF 0.15/-0.12 dev, effective n 538-628 of 730 days, 311-335 of 365 holdout):
- A_COSTR50: dev +16.2R, mean +0.022 R/day [-0.022, +0.073], P(<=0)=0.14; holdout -0.19R, +-0.06 R/day; per book holdout BTC -1.16R [-0.034, +0.029], PAXG +0.97R [-0.053, +0.054]. Cost sensitivity (holdout dNetR): 0.5x +1.83R, 1.5x +1.48R.
- B_BE_TP1: dev +5.7R [-0.032, +0.045], P(<=0)=0.33; holdout -23.2R, mean -0.064 R/day [-0.159, +0.024], P(<=0)=0.95 (BTC -12.3R, PAXG -10.9R). Holdout cost sensitivity: 1.5x -12.4R, 0.5x -24.1R.
Reading: the cost filter changes the trade count by only 2-10% and its effect is within noise in every period; no evidence it improves the net edge. BE-at-TP1 reduces drawdown/exposure in dev (hit rate up to 38-45%) but loses edge in the holdout year and adds 47 trades there; it fails by the frozen rule. A_COSTR50 does not raise tail loss (CVaR5 -1.04 vs -1.04) and neither raises risk per trade.

## 4. Record of attempts (nothing hidden)
`out/RUN_LOG.jsonl` has all 35 invocations, 0 refusals: 5 pre-freeze BASE runs (BTC year A x3 determinism check, BTC and PAXG live-week fidelity), 12 dev runs, 18 holdout runs (each book x variant x cost 1.0/0.5/1.5, once each; `out/holdout_ledger.json`). Variants ever tried: BASE, A_COSTR50, B_BE_TP1. No parameter sweeps, no other variants, no reruns. The freeze commit (5e84193, before any challenger or holdout run) is on branch `research/profit-improvement-2026-10-28`.

## 5. Limits and weaknesses (read before relying on any number)
- Backtest uses 5-minute bars; live manages on 1-minute bars. Fidelity check on the live week (24-28 Oct, `analysis/fidelity.py`, `out/fidelity_summary.json`): BTC 12/14 replay trades matched live entries within 15 min with identical win/loss sign (replay -1.13R vs live -2.20R on 16 live trades); **PAXG only 3/10 matched** (replay -7.99R vs live -6.36R). Binance PAXGUSDT spot is not the Hyperliquid gold feed, so gold results are weaker evidence than BTC.
- Constant backtest funding, no historical news / Fear&Greed / probation state; costs from the engine config, not exchange fills.
- Baseline was tuned on 2023-26 data including the holdout year; no earlier data exists in the dataset, so there is no sealed fresh reserve. Truly unseen data is only the forward paper period.
- Two challengers, one pass each: low power; rejecting means "no evidence of improvement", not proof of harm (A) — B has a clear adverse holdout signal.
- Live week is 29 trades in one direction regime: attribution is descriptive.

## 6. Next evidence-based step
Not a new variant. (1) Record engine version and config hash on every trade and approve the per-book fingerprints so attribution and drift are exact. (2) Investigate why the deployed baseline is negative in years A and B (regime gating, PAXG signal quality) with a new, dated freeze; use only forward paper data as the next unseen test. (3) Keep both challengers disabled; they are preserved as config overlays in `variants.json`.

## Reproduce
`git checkout research/profit-improvement-2026-10-28`; `gunzip -k research/2026-10-28-profit-improvement/data/kline5_*.csv.gz` is not needed (the harness reads the .gz and verifies sha256 in `data/SHA256SUMS`). Run `npx tsx research/2026-10-28-profit-improvement/harness/run.ts --sym BTC --period A --variant BASE --tag eval` (repeat for all combinations; holdout needs `HOLDOUT_ONCE=1` and refuses repeats without `--repeat-reason`), then `python3 -I research/2026-10-28-profit-improvement/analysis/compare.py`. Live exports come from `dbv5_trades` (columns: id, strategy, dir, entry, exit_avg, net, r, fees, funding, open_t, close_t, reason, data jsonb, symbol).
