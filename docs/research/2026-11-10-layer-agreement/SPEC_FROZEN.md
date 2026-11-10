# Frozen spec: layer-agreement entry filter (written 2026-11-10, before any result was seen)

## Question
Does requiring the system's existing direction layers to agree with a signal improve expectancy after costs?

## Variant AGREE (one hook, entries only)
Skip a signal unless all three agree with its direction, on closed bars only:
- 1h SuperTrend direction (`snap.st1h`)
- 4h SuperTrend direction (`snap.st4h`)
- Daily regime: the last closed daily close is above (long) or below (short) the daily EMA50 (`S.ema50D[i1d]`)

Stops, targets, sizing and management are unchanged. No parameter is tuned; the thresholds are the system's existing ones.

## Data and method (as in research/2026-10-30-entry-exit)
- Frozen 5m data `kline5_BTC.csv.gz`, `kline5_PAXG.csv.gz`; config `live_cfg.json` (captured 2026-10-28); last 3 years.
- One isolated lane per (book, strategy) via `scripts/challenger_study.ts`; the BASE run must reproduce `stepLane` exactly.
- Costs at 1× and 1.5×.
- Strategies: those that traded in production (SWEEP_REV, SESSION_BO, TREND_MTF, HTF_TREND, and EMA_CROSS on GOLD).

## Decision rules (fixed in advance)
- **ADOPT-CANDIDATE** (shadow lane only, never straight to the live book) needs all of: ≥ 30 challenger trades; expectancy R per trade > 0 at **1.5×** costs; net R improves at both 1× and 1.5×; the 90% block-bootstrap interval of the daily R difference (block = 10 days) is above 0; max drawdown not worse.
- **REJECT** otherwise.
- A strategy whose BASE expectancy is negative at 1× costs over the 3 years is reported as "negative expectancy". Disabling it is a risk-reducing config change that still needs the owner's approval.

## Limits
Development evidence only, on one window, with no separate out-of-sample hold-out beyond chronological reporting. A pass means "worth a shadow lane", not "profitable".
