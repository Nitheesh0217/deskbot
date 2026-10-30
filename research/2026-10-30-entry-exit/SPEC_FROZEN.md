# SPEC_FROZEN: entry timing and target fit (frozen 2026-10-30, before any measurement or challenger run)

Paper/research only. No change to the live bot, its positions or their plans. No funded orders, no risk increase.

## 0. Question
Do the existing entries come late relative to the move they trade, and do the fixed R-multiple targets fit each strategy's holding horizon?
Answered first by **measurement (M1)**. Challengers (Section 4) are defined now so that M1 cannot shape them.

## 1. Data
- Frozen dataset of 2026-10-28 (hashes in `research/2026-10-28-profit-improvement/data/SHA256SUMS`, re-verified 2026-10-30): Binance spot 5m BTCUSDT and PAXGUSDT, 2023-06-15 → 2026-10-22. 15m/1h/4h aggregated from 5m.
- Configuration: `live_cfg_2026-10-28.json` (sha256 `cc51a955…`). It equals the BTC config in the first production decision record D-V5-1793318461202.
- **All three years (A 2023-10-23→2024-10-21, B →2025-10-22, C →2026-10-22) are development data.** The baseline config was selected on data that includes them (CORRECTIONS C-003), and the 2026-10-28 study ran challengers on them. Nothing here is a holdout. The only unseen evidence is forward paper/shadow trading after 2026-10-22.

## 2. Known fidelity gaps (quantified where possible, never assumed away)
- **5m history vs 1m live management.** Replay manages exits on 5m bars; live manages them on the 1m path. A 5m bar that touches both the stop and a target is counted stop-first; M1 reports the number of such ambiguous bars per strategy.
- **Venue.** Binance spot vs Hyperliquid perp. The prior live-week replay matched 12/14 BTC trades (same sign 12/12) but only 3/10 PAXG trades (CORRECTIONS C-008: thin early PAXG data). PAXG results are weak evidence.
- **Funding.** Constant 0.00125%/h in replay.
- **Fills.** Next 5m open + slippage in replay; live uses the mark price about 60 s after the bar close (production decision: snapshot close 77,947, fill reference 77,838).

## 3. Measurement M1 (descriptive; `scripts/excursion_study.ts`)
Per (book, enabled strategy), each strategy runs as an **isolated lane**: the shared executor and costs, no portfolio blocking, learning rules observe-only (avoids the ~20-trade portfolio censoring, CORRECTIONS C-009).

Per trade:
- MFE / MAE in price %, in ATR of the strategy's own timeframe at the signal bar (daily strategies use 4H ATR), and in original R.
- First-touch time of TP1/TP2/TP3 and of the original stop; whether each target came before the stop and before max hold; ambiguous 5m bars.
- Realized net R, costs (fees + funding), giveback (MFE R − realized net R).
- Holding time vs max hold.
- Causal entry-timing measures:
  - the signal bar's own move in ATR (how much the confirming bar already moved)
  - for HTF_TREND, the close's distance beyond its Donchian trigger in ATR
  - the fill gap in R
- ATR% tercile and regime label.

Trades forced closed at the data end before their own max hold are **censored**: excluded from outcome rates and counted separately. Every trade is included: winners, losers, stops and time exits. Sample sizes are reported. No result is called a probability, and no rate from fewer than 30 trades is called reliable.

## 4. Challengers (defined now; run only by a later, logged invocation; never combined)
Entry rules stay identical for the exit comparison, and exit rules identical for the entry comparison.
- **A. BASE**: the engine and config unchanged.
- **EXIT-B (volatility-aware partial)**: for strategies whose TP1 is more than 1R (HTF_TREND, EMA_CROSS, HTF_SWEEP, D_THRUST, D_BEARTRAP), TP1 is placed at `min(TP1 distance, 1.25 × ATR of the strategy's timeframe at the signal)` from entry, with the same 50% partial. TP2/TP3, the stop, sizing and exit mode are unchanged. The stop is never tightened.
- **EXIT-C (time exit)**: run **only if** M1 on BTC shows, for a strategy, at least 25% of non-censored trades closing by max hold, **or** a median time to TP1 (among trades reaching it) below 20% of max hold while at least 40% of trades not reaching TP1 are still open past 50% of max hold. Definition: if TP1 has not been reached by 50% of max hold, close at the next 5m open. If neither condition holds, EXIT-C is recorded as NOT RUN (not justified).
- **ENTRY-1 (late-breakout filter; separate from all exit changes)**: for HTF_TREND, reject an entry whose signal close is more than 1.0 × ATR4h beyond its Donchian trigger. Causal (uses only the closed signal bar).

## 5. Metrics and decision rules for challengers
Reported per book and pooled, all-period:
- trades, net R, expectancy, net $, win rate, profit factor
- max drawdown (lane equity path), worst trade, 5% CVaR of trade R
- exposure, fees, funding
- giveback, target-hit rate. Hit rate alone is never a criterion.

Uncertainty: paired daily ΔR, circular block bootstrap (block 10 days, 5/20 sensitivity), 10,000 resamples, seed 20261030, 97.5% two-sided interval (Bonferroni for up to three challengers).

REJECT if any:
- pooled ΔnetR ≤ 0
- the interval is entirely below 0
- a book's max drawdown is more than 2 pp worse
- CVaR5 is worse by more than 0.05R, or the worst trade by more than 0.25R
- ΔnetR ≤ 0 at 1.5× costs

Otherwise the best possible outcome is **FORWARD-SHADOW**: worth running in the isolated shadow lane on live data. Never promotion to a book. Development-only evidence cannot promote anything to execution. Every run, including failures and refusals, is appended to `out/RUN_LOG.jsonl`.

## 6. Entry-delay diagnosis (Part D)
For production decisions with provenance, decompose the time from the first observable condition to the paper fill into:
- intentional confirmation (waiting for the strategy's bar close)
- scheduling lag (evaluation lag)
- catch-up
- portfolio or risk blocking
- score or strategy filters
- missing telemetry

Trades before 2026-10-29 17:26 have no provenance and are reported as missing telemetry, not inferred. The eventual high or low after entry is never used to judge what was knowable.
