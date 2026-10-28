# CORRECTIONS (append-only audit trail)

The frozen specification, run logs, run outputs, RESULTS.md and the original BRIEF.md text are **not altered**. Each entry below clarifies a statement in BRIEF.md (a93c462) or in the closing chat summary. Verdicts are unchanged: A_COSTR50 REJECT, B_BE_TP1 REJECT. Both stay disabled; neither is to be combined, retuned or renamed.

## C-001 — "P(dNetR<=0)" is a resampling fraction, not a probability (2026-10-28)
`P(<=0)` in RESULTS.md/BRIEF.md is the share of 10,000 circular block-bootstrap resamples of the paired daily delta-R whose mean was <= 0. It is not a posterior probability that a strategy is worse. The chat summary's "95% chance it is worse" was wrong wording. For B_BE_TP1 on the holdout the 97.5% interval for mean daily dR is [-0.159, +0.024] and **crosses zero**; the rejection stands only because the frozen rules R1 (point dNetR <= 0), R3 (drawdown +>2 pp in both books) and R6 (1.5x costs) fired, not because the interval excluded zero.

## C-002 — Confidence labels (2026-10-28)
Two different procedures were reported. (a) Challenger comparisons (compare.py): paired daily dR, circular block bootstrap, L=10 days, **97.5% two-sided interval** (percentiles 1.25/98.75, Bonferroni for two challengers). (b) Live-ledger descriptive intervals in BRIEF section 1 (`scripts/live_attribution.py`): bootstrap of mean R per trade, **unadjusted 95%**, block length 3 trades, 20,000 resamples, no multiplicity correction. They are not interchangeable and (b) is descriptive only.

## C-003 — Holdout contamination (restated prominently)
Year C (2025-10-22 -> 2026-10-22) was **not a clean holdout for the baseline**: the live configuration was selected in earlier research on 2023-2026 data that includes it. It was untouched by these two challengers only. The only genuinely unseen data is forward paper trading after 2026-10-22. Treat all of A, B and C as development evidence for any new hypothesis.

## C-004 — Live sample and causal language
The 29 live trades span 7 days, 27 are shorts, 12 are gold. They are descriptive. Grouping by the eventual outcome ("plain stop-outs", 17 trades) selects on the result and cannot show whether entries, stop placement, execution or market conditions caused the losses; the thin-stop and gold groups are conditioning on observable attributes and show association only. The three groups overlap and are non-additive (for example 9 gold trades are also in the stop-out group).

## C-005 — Equity-series gaps: precise reconciliation
Measurement (2026-10-28 22:21 UTC, `dbv5_equity`, consecutive row timestamps per symbol; a row is written by each successful run, so a gap means no persisted run, not proof about data seen). Threshold: >7 minutes (cron is every 5; no gaps between 7 and 12 min exist). BTC series 2026-10-22 01:50:49 -> 2026-10-28 22:21:00, 1935 rows; GOLD series starts 2026-10-23 07:09:00, 1630 rows.
| symbol | from (UTC) | to (UTC) | gap |
|---|---|---|---|
| BTC | 10-22 01:50:49 | 10-22 02:33:39 | 43 min |
| BTC | 10-22 02:34:40 | 10-22 05:32:50 | 178 min |
| BTC | 10-22 05:32:50 | 10-22 05:46:03 | 13 min |
| BTC | 10-23 05:51:00 | 10-23 06:46:03 | 55 min |
There are exactly four BTC gaps, all before 2026-10-23 06:46:03; none after (the largest later gap is <=7 min). "GOLD none" only means none **since the GOLD series began** on 10-23 07:09, so it is not evidence about 10-22..10-23 06:46. The causes written in EVIDENCE_LOG (watchdog not yet installed, Binance HTTP 500 on Oct 22, three watchdog kicks on Oct 23) are explanations from the earlier session, not re-derived here. CURRENT_STATE's "no equity gap since Oct 23" is correct only as "since 06:46 UTC on Oct 23" for BTC and "since inception" for GOLD.

## C-006 — Inferred code/config attribution
`dbv5_trades` stores no engine build, strategy version or configuration hash. Every version/config label in `out/provenance.csv` is inferred from dates in docs and is not evidence. The decision-provenance work (docs/control/PROVENANCE.md) is the remedy for future trades only; past trades remain unattributable.

## C-007 — Dollars versus R (PAXG holdout), reported without choosing
Per trade, `net$ = r x riskAmt` exactly (checked: baseline PAXG year C, sum 56.186 both ways). Equal-weight sum R is -1.19, but net $ is +56.19 because trade risk varies (mean $5.61; strategy scales, risk tiers, equity) and larger-risk trades did better: sum(r) x mean(risk) = -6.7 and n x cov(r, risk) = +62.9 dollars. That is a sizing/outcome covariance in one year, not shown to be skill. Both metrics for the challengers: A_COSTR50 holdout PAXG -0.22R / +$79.8 vs baseline -1.19R / +$56.2; pooled holdout -3.76R / +$61.8 vs -3.56R / +$44.4; B_BE_TP1 -26.8R / -$82.0. The frozen verdict rule used R; by dollars A_COSTR50 would have looked better on holdout (+$17.4) and development, but dollars are path-dependent (sizing compounds with equity, drawdown halts, probation) and unpaired, and no uncertainty was computed for them. Neither metric is significant for A_COSTR50, so the REJECT is not overturned.
