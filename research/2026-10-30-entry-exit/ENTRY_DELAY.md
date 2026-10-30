# Part D: entry-delay diagnosis (SPEC_FROZEN 6)

Read-only. Source: production `dbv5_decisions` / `dbv5_decision_inputs` for D-V5-1793318461202 (record_sha256 fd1f9b7c…, Hyperliquid m5/m15/h1/h4 closed bars). No price after the fill is used.

## 1. Live decision D-V5-1793318461202 (HTF_TREND short, BTC, engine 5.8.0)

ATR4h at the signal = 1,059.465. Donchian-55 trigger (prior 55 4H lows) = 79,184.

| Stage | Time (UTC) | Price | Move from previous stage | Source |
|---|---|---|---|---|
| Last 4H close before the setup (bar 16:00-20:00) | 2026-10-29 20:00 | 80,821 (open of next bar) | — | h4 input |
| Condition first observable intrabar: first 5m close below 79,184 | 2026-10-29 20:45 | 78,843 | −0.32 ATR beyond trigger | m5 input |
| Price back above the trigger (not sustained) | 21:30-22:00 | 79,227-79,520 closes | +0.36 to +0.64 ATR | m5 input |
| First eligible signal: 4H close below trigger with SuperTrend4h −1 and close < EMA50 4H | 2026-10-30 00:00:00 | 77,947 | −896 (−0.85 ATR) from the first 5m cross | record.candidates.signals |
| Scheduled evaluation (cron minute 1) | 00:01:01.202 | — | lag 61.2 s | record.timing.evaluationLagMs |
| Selection | 00:01:01.9 | — | only signal; 10 other strategies rejected for their own conditions; no portfolio block; news filter shadow-only (would have paused, not enforced) | record.candidates |
| Fill (paper, mark × (1 − slippage)) | 00:01:01 | ref 77,838 → entry 77,822.43 | −109 (−0.10 ATR) after the close | plan |

Opposing structure: the broken trigger 79,184 sits 1,362 above the entry (0.61R; R = 2,243.50). The stop is 2×ATR4h above the signal close.
Expiry of the signal: a single 4H bar (`lastSig` blocks re-entry on the same bar). Max hold 504 h.
Maximum acceptable deviation: **none is defined in the engine**. The only bound is MAX_COST_R. The frozen ENTRY-1 challenger (≤ 1.0 ATR beyond the trigger) is the candidate rule for one; this entry was 1.17 ATR beyond and would have been rejected by it.

### Decomposition

| Category | Amount | Verdict |
|---|---|---|
| Intentional confirmation (waiting for the 4H close) | 3 h 15 m, −0.85 ATR | By design: the strategy only exists on closed 4H bars; the intrabar cross reversed above the trigger within 45 min, so acting on it would have been a different (unvalidated) strategy |
| Scheduling lag | 61 s, −0.10 ATR | Normal cron cadence (1-59/5) |
| Catch-up | 0 | Regular run, not a catch-up |
| Portfolio / risk blocking | 0 | Flat book, gates passed |
| Score / strategy filters | 0 | Score 81 is heuristic, not a gate; news filter shadow-only |
| Missing telemetry | 0 for this decision | Earlier live trades (before 2026-10-29 17:26) have no provenance and cannot be decomposed |

## 2. Is "far beyond the trigger" a late entry historically? (M1, development data)
`beyondTriggerATR` at the closed signal bar vs realized net R, isolated HTF_TREND lanes, 3 years:

| Book | low tercile | mid | high |
|---|---|---|---|
| BTC (cuts 0.37 / 0.86 ATR) | n=29, −0.41R | n=28, +0.18R | n=28, **+0.49R** |
| GOLD/PAXG (cuts 0.27 / 0.75) | n=18, +0.00R | n=17, +0.63R | n=17, **+0.73R** |

On this data the deepest closes beyond the trigger did *better*, not worse. Tercile groups of 17-29 trades are below the 30-trade reliability floor, and all years are development data. The run of the frozen ENTRY-1 filter is reported in `out/CHALLENGERS.md`.

## 3. Not used
The low the price reached after the entry is not used to judge this entry. No earlier-entry challenger is proposed: the only causal earlier trigger (the 20:45 intrabar cross) reversed within the same 4H bar, and an intrabar variant would be a new strategy needing its own frozen spec.
