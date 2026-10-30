# Results: target fit and late entries (development data only)

Spec frozen at cd2e9c8 before any run (`SPEC_FROZEN.md`, `FREEZE.json`). All runs are in `out/RUN_LOG.jsonl`, including NOT RUN entries.

Full tables:
- `out/M1_SUMMARY.md` (measurement)
- `out/CHALLENGERS.md` (challengers)
- `ENTRY_DELAY.md` (live decision)

**Data reuse:** all three years were already used to select the baseline configuration and in the 2026-10-28 study. Nothing here is out-of-sample; every number below is descriptive of development data.

## 1. M1: do the targets fit the holding horizon?
- **Short-horizon strategies (SWEEP_REV, SESSION_BO, EMA_CROSS)** lose on both books after costs: −0.18 to −0.39R per trade over 250-1,800 trades. Their targets are reached quickly when they are reached: median time to TP1 is 0.6-4 h against a 12-48 h max hold, and almost none close by time. The problem is not target distance or the clock. **Correction (2026-10-30):** an earlier version said these are disabled. They are not: SWEEP_REV and SESSION_BO are active in both paper books and EMA_CROSS is active in the GOLD book at risk scale 0.25 (see `docs/control/STRATEGY_ELIGIBILITY.md`). This research changes no setting.
- **HTF_TREND** has a median TP1 time of 24 h (BTC) and 63 h (GOLD) against a 504 h max hold; only 6-10% of trades close by time. The 6R TP3 is reached first by 14% (BTC) and 23% (GOLD) of trades. These first-touch counts are not probabilities. Median MFE is 1.0R (BTC) and 1.95R (GOLD), and median giveback is 1.45-2.0R. That giveback comes from the HOLD exit mode and the 50/25/25 split, not from targets that are too far: tightening TP1 (EXIT-B) made it worse.
- **TREND_MTF**: 28% of BTC trades close at the 24 h limit, which met the frozen EXIT-C trigger.
- **Ambiguous 5m bars** (stop and target in the same bar, counted stop-first): 0-7 per strategy. The 5m-vs-1m gap does not move these results.
- **Venue:** these results use Binance spot, while the bot trades the Hyperliquid perp. The prior replay matched 12/14 BTC trades but only 3/10 PAXG trades, so the GOLD results are weak evidence.

## 2. Challengers (frozen rules, mechanical verdicts)
| Challenger | Strategy | Pooled ΔnetR | at 1.5× costs | 97.5% interval | Verdict |
|---|---|---|---|---|---|
| EXIT-B (TP1 ≤ 1.25 ATR) | HTF_TREND | −13.80R | −12.01R | (−25.2, −2.6) | **REJECT** (also BTC drawdown +2.4 pp) |
| EXIT-B | D_BEARTRAP | −3.97R | −3.69R | (−10.3, 2.1) | **REJECT** |
| EXIT-B | D_THRUST | +0.23R | +0.45R | (−5.2, 5.6) | mechanically FORWARD-SHADOW; 15 trades, interval spans 0 |
| EXIT-B | EMA_CROSS (GOLD; active at risk scale 0.25) | +43.1R | +53.7R | (2.8, 82.3) | mechanically FORWARD-SHADOW, but the strategy is still a −0.36R/trade loser with the change: **no action from this research** (its eligibility is a separate owner decision) |
| EXIT-C (time exit at 50% hold) | TREND_MTF | −8.50R | −7.37R | (−19.8, 1.2) | **REJECT** (GOLD drawdown +3.9 pp) |
| EXIT-C | D_THRUST | +3.86R | +3.85R | (−1.7, 10.6) | mechanically FORWARD-SHADOW; 16 trades, BTC only, interval spans 0 |
| ENTRY-1 (reject > 1.0 ATR beyond trigger) | HTF_TREND | −0.55R | −0.03R | (−16.3, 14.9) | **REJECT** |
| EXIT-C | SWEEP_REV, SESSION_BO, HTF_TREND, D_BEARTRAP | — | — | — | NOT RUN (frozen trigger not met) |

Every run passed the identity check: the hook-free copy reproduced `lanes.stepLane` trade-for-trade.

## 3. Conclusions
- **Targets:** shortening the far HTF_TREND targets lowers return. On this data the 1.5/3/6R ladder is not the problem; no target change is recommended. Stops were not touched.
- **Late entries:** the causal late-entry filter (ENTRY-1) is rejected. Overshoot = signal close beyond the Donchian trigger, in ATR4h at the signal. Bins are terciles of the same development sample (post hoc), mean net R per trade, 95% i.i.d. bootstrap interval (10,000 resamples, seed 20261030):

  | Book | low | mid | high | high − low |
  |---|---|---|---|---|
  | BTC (n=85; cuts 0.37 / 0.86 ATR) | n=29, −0.41R (−0.80, +0.02) | n=28, +0.18R (−0.25, +0.64) | n=28, +0.49R (−0.09, +1.10) | (+0.18, +1.63) |
  | GOLD (n=52; cuts 0.27 / 0.75 ATR) | n=18, +0.00R (−0.58, +0.67) | n=17, +0.63R (−0.10, +1.37) | n=17, +0.73R (+0.06, +1.39) | (−0.21, +1.64) |

  This is an association on development data, with bins chosen from the same data and bin sizes of 17-29. It does **not** show that entering later causes better results: stronger breakouts are both further from the trigger and more likely to be in a trending move. GOLD rests on Binance PAXG spot, whose replay matched only 3/10 live trades. The live trade's 1.17 ATR overshoot is inside the high bin; that is not evidence it will work.
- **Step 6 (shadow challenger):** not warranted. The only mechanical FORWARD-SHADOW results are on 15-16 trades with intervals spanning 0, or on EMA_CROSS, which remains a losing strategy with the change. Running them would add operational surface for no decision value. Revisit D_THRUST EXIT-C only after it has ≥ 30 forward trades.

## 4. Limitations
- The development-data reuse described above.
- The venue and 5m-management gaps (Section 1).
- Funding is a constant 0.00125%/h.
- Drawdown is measured on hourly marked lane equity.
- `scripts/challenger_study.ts` and `scripts/excursion_study.ts` are run with tsx and are not in the repository typecheck (no `@types/node`).
