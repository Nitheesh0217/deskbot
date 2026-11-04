# Research protocol

Every experiment needs an immutable ID and a manifest containing hypothesis, code/config/strategy/model version, instrument/venue/universe, data hashes/coverage, feature availability times, parameters, development/validation/final periods, label horizon, cost/fill assumptions, baselines, rejection criteria and actual results/limitations. Record every attempted variant, including rejected ones. Revisions start a new trial; never erase losing results.

Use chronological splits and purge labels overlapping boundaries. Determine any embargo from data/label dependence rather than copying a generic number. Final evaluation data are withheld during development. Post-hoc inspected periods become development evidence, not newly unseen confirmation. Include the universe scanner's point-in-time selection process, not just its eventual winners.

Common execution and risk rules must apply to baseline/challenger. Entry cannot precede data availability, recommendation receipt or modeled latency. Match instrument, timeframe and fee/spread/slippage/funding/lot/contract/calendar rules. A 5m reversal proxy is a separate experiment from a 1m deployed reversal rule. Retrospective news and current funding values cannot be substituted into history.

Report net dollars, net R distribution, marked equity/drawdown, exposure, turnover, counts, costs, tail losses, concentration by strategy/side/regime/time and dependence-aware uncertainty. Undefined metrics stay undefined. Compare cash and simpler baselines; cash beating all candidates is a legitimate outcome. Software tests verify accounting/behavior, not profitable prediction.

No agent voting score is a win probability. Calibrate any probability on held-out outcomes before displaying it as such. LLM costs, timeouts, rejected/late recommendations and compute/data costs belong in challenger economics. Insufficient samples or missing point-in-time data mean inconclusive/blocked, not pass.

Skills can guide evidence collection, but cannot promote themselves, alter risk limits, change production configuration or see final data to optimize a prompt. Post-trade lessons must cite the pre-trade plan and event records, separate execution from outcome and propose a falsifiable change. No automatic risk increases from recent winning streaks or unmeasured Kelly inputs.

Promotion: reproducible software → frozen experiment → independent validation → prospective shadow/paper → reviewed decision. No universal trade count or profitable week proves readiness. This branch adds protocol documentation; an enforced experiment store and access boundary remain future work.

## Checklist additions (2026-11-04, adapted from Superior-Trade/superior-skills `skills/backtesting`, MIT)
- **Trade-count bands.** Under 30 trades the result is labelled *inconclusive*, never pass or fail. 30-50 is *weak*, 50-200 *usable*, 200+ *robust*, and only within the frozen rules.
- **Regime coverage.** Every evaluation window states which regimes it covers (trend up, trend down, chop). A window covering fewer than two is reported as regime-limited.
- **Sibling-instrument out-of-sample check.** A rule developed on one instrument is re-run unchanged on a sibling (BTC↔ETH, BTC↔PAXG). Degradation beyond the frozen tolerance is a finding, not a tuning target.
- **Exit-reason mix.** Every lane and challenger report includes the share of exits by recorded reason (TP1/TP2/TP3/STOP/TIME/MANUAL) as a diagnostic.
- **Zero-trade stop rule.** After two variants in a row with zero trades, stop the sweep and record it. Do not widen thresholds until trades appear.
- **Parameter-sweep shape.** Report the whole neighbourhood, not only the best value. A best value at the edge of the grid is a warning; extending the grid starts a new trial.
- **Live/replay scoring parity.** Any score input that is null in replay (live funding, Fear & Greed) is reported separately. A live score that differs from the replayed one is a known asymmetry, not evidence.
