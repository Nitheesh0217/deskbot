# Results: EXIT-D ratchet trail on HTF_TREND (2026-11-10)

Development evidence only; spec committed first (`e84eb0e`). Identity check passed on all runs.

| Book | Cost | Base n / R per trade / net R / maxDD | EXIT_D n / R per trade / net R / maxDD | ΔR [90% CI] |
|---|---|---|---|---|
| BTC | 1× | 86 / +0.076 / +6.5 / 18.3% | 104 / +0.077 / +8.0 / 23.9% | +1.5 [−15.3, 15.8] |
| BTC | 1.5× | 87 / +0.032 / +2.8 / 20.0% | 104 / +0.038 / +4.0 / 25.3% | +1.2 [−18.1, 12.5] |
| GOLD | 1× | 52 / +0.447 / +23.2 / 12.5% | 77 / +0.325 / +25.0 / 11.2% | +1.8 [−13.0, 17.3] |
| GOLD | 1.5× | 52 / +0.328 / +17.1 / 12.7% | 76 / +0.249 / +18.9 / 11.7% | +1.9 [−11.7, 15.8] |

**Verdict: REJECT.** No interval is above 0, and BTC max drawdown is worse (20.0% → 25.3%). The trail exits winners earlier, so the book re-enters more often (+18 to +25 trades), and the gain from locked profit is about cancelled by the extra entries' costs and losses. HTF_TREND stays as it is.

By year (EXIT_D, 1×): BTC 2025 −0.14R per trade, the same decay as the base. The trail does not fix BTC HTF_TREND's loss of edge since 2025.
