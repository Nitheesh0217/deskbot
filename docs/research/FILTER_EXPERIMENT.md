# FILTER-1: does a review layer add information beyond the rules?

Pre-registered 29 Oct 2026, before any verdict was recorded. Changing anything below after the first verdict starts a new experiment (FILTER-2) and leaves FILTER-1's rows untouched.

## Question
For entries the unchanged deterministic engine takes, does a bounded review filter separate the trades that lose from the trades that win, after costs, on information available at entry?

## Arms (same observations, costs and risk rules; filters never change a trade)
| Arm | What decides | Effect on execution |
|---|---|---|
| Baseline | the engine as deployed (11 strategies, current config) | every entry is taken and managed as today |
| Rules filter | `preTradeChecks`: keep unless any check is `warn`: no stop distance, round-trip costs > 0.25R, stop under 0.5×ATR15, TP1 under 1R, funding over the max hold > 0.1R, high news risk, opposing level closer than 1R (thin session, wide stop and medium news are info only) | none: shadow verdict only |
| AI filter | Portfolio Manager (`desk-pm`) at the end of the agentic flow (analysts → bull/bear debate → research manager → trader → aggressive/conservative/neutral risk debate → PM). Its 5-tier rating is mapped onto the trade's direction: long Buy/Overweight = keep, Underweight/Sell = skip; short reversed; Hold, no provider, error or deadline = abstain | none: shadow verdict only |

The rules arm is the control for "is it the AI or just the checklist". Agreement between AI roles is not counted as evidence; only the PM's recorded rating is scored.

## Amendment 1 (29 Oct 2026, before the first verdict)
The AI arm originally scored a single `desk-judge` verdict. It was replaced by the TradingAgents-structured flow's final rating before any row existed in `dbv5_filter_verdicts` (count 0 at amendment time), so this is still FILTER-1, not a new experiment. Everything else is unchanged.

## Recording
- One row per (entry, arm) in `dbv5_filter_verdicts`, written in the same run that opens the paper position, after state is saved. `recorded_at` is the database clock. The table is append-only (triggers block UPDATE/DELETE/TRUNCATE; service_role may only SELECT/INSERT).
- A verdict counts only if `recorded_at < dbv5_trades.close_t` of the trade with the same id. Later or missing verdicts are counted separately (`lateOrMissing`), never scored.
- Rejected trades are retained: a skipped entry is still executed in the baseline, so its realised outcome is known.
- AI operating cost: provider calls and total latency per entry are recorded. Configured providers are free tiers (Groq/Gemini); billed cost is $0 and is reported as such, not estimated.

## Metric and decision rule (mechanical)
For each decided trade i in an arm, `d_i = −R_i` if the filter would have skipped it, `0` if kept. `mean(d)` is the change in R per entry from applying the filter: positive means the skipped trades lost on average.

- Fewer than 30 decided trades: show counts only.
- 30–99: show `mean(d)` and a 95% percentile bootstrap interval (2,000 resamples, seed 20261029); result stays `INSUFFICIENT_DATA`.
- 100 or more: `FILTER_HELPED` if the interval's lower bound > 0, `FILTER_HURT` if its upper bound < 0, otherwise `NO_EVIDENCE_OF_DIFFERENCE`.

Known weakness: trades are resampled individually; clustered or overlapping trades make the interval too narrow. A block bootstrap by day is the planned correction once there are enough days.

## What a result does and does not mean
- `FILTER_HELPED` means the filter's skips were, on this sample, worse than its keeps. It is not a profitability claim for the system and does not authorise turning the filter into a gate. Promotion to a gate is a separate, reviewed change with its own pre-registration.
- No difference is treated as trading skill until decision provenance is live and the venue/candle replay discrepancy (T007: Hyperliquid PAXG vs Binance PAXGUSDT) is resolved.
- The AI arm only runs when the owner configures a provider key. Until then every AI verdict is `no_provider` (abstain), and only the rules arm accumulates evidence.

## Where to see it
Public status `GET …/deskbot-v5` → `experiment`; dashboard → Tower → Operations & review → Experiment board. Code: `supabase/functions/deskbot-v5/experiment.ts`, tests `tests/experiment.test.ts`, SQL checks `scripts/sql_test/filter_experiment.sh`.
