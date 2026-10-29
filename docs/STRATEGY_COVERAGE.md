# Strategy coverage audit (29 Oct 2026)

Question: five strategies show "FULL SIZE" and zero trades while session breakout and sweep reversal trade. Is each strategy being evaluated, and why is it silent? Method: read the engine, instrument it, run fixtures, scan three years of real candles (BTCUSDT and PAXGUSDT 5m, research dataset sha256 `95d7ea21…` / `723bc6c3…`), read the live state. Base commit `66028ac`; line numbers below are for that commit.

## 1. What "zero trades" meant before this change
Nothing recorded whether a strategy was due, evaluated, rejected or displaced. `lastRun.decision.rejects` held only the **latest** bar (mostly "Waits for 15m close"), `stats.by[id].n` counts closed trades only, and the dashboard's "Full size" came from `RISK_SCALE ?? 1` (`web/index.html:503`), which says nothing about whether the strategy runs. This PR adds the missing evidence (counters in `state.cov`, per-bar `lastRun.coverage`); counters start at deployment, so history before it cannot be reconstructed.

## 2. Coverage matrix (state read from the database 28 Oct 23:11 UTC; code facts from the source)
All 11 strategies are registered in `STRATEGIES` and reachable from `evaluate()` (engine.ts `for (const id of STRATEGIES)`); every one produced valid setups on real data except VWAP_REVERT (see below). Evaluation happens on every new closed 5m bar, whether or not a position is open; an open position only blocks **entries** (`entryGates`, engine.ts:873), it does not stop evaluation (index.ts:169-171).

| strategy | cadence | BTC effective | PAXG effective | history it needs (live windows: 5m x400, 15m x400, 1H x300, 4H x700) |
|---|---|---|---|---|
| D_BEARTRAP | daily close (00:00 UTC) | on, scale 1, regime gate 3% | on, scale 1, gate 3% | 52 daily bars (EMA50D) = 312 4H bars; long only |
| D_THRUST | 1H close | on, scale 1 | on, scale 1 | 50 daily bars + daily ATR + 1H EMA20; long only |
| HTF_TREND | 4H close | on, scale 1, gate 3%, Donchian 55 | same | 56 4H bars, EMA50 4H, ATR 4H, daily EMA50D for the gate |
| TREND_MTF | every 5m bar | on, scale 1, gate 3%, min stop 1.2% | on, gate 3%, min stop 0.4% | 5m/15m/1H/4H SuperTrend, chop, EMA; blocked 00:00-06:59 UTC |
| SWEEP_REV | 15m close | on, scale 1 | on, scale 1 | 20 prior 15m bars, ATR14, Asian range after 07:00 UTC |
| VWAP_REVERT | 15m close | on, scale 1 | on, scale 1 | 4 bars of the UTC day for sigma (after fix), RSI14, chop |
| SESSION_BO | 15m close | on, scale 1 | on, scale 1 | Asian range (07:00+) or London range (13:30+), 20-bar volume average |
| HTF_SWEEP | 4H close (`HSW_TF`) | **off** (opt-in, no scale) | **off** | same 4H history as HTF_TREND |
| EMA_CROSS | 15m close (`XC_TF`) | **off** (opt-in) | on at **scale 0.25** | 51 15m bars |
| SSR | 15m close | **off** (opt-in) | **off** | 4H EMA50 + BOS, 80 15m bars, ET windows 03-05 and 08-11 |
| EMA_PB | every 5m bar | **off** (opt-in) | **off** | 205 15m bars (EMA200 and slope); ET 08:00-11:30 weekdays |
Probation (half size after 10 trades with negative expectancy) and auto-disable (`enabled=false` after 20 trades below -0.15R, engine.ts:864) are also **not** reflected in "Full size". At inspection no strategy was probationary or flag-disabled (`state.enabled` all true on both books; the 4 off strategies are off through the opt-in rule in `off()`, engine.ts:755).
Live closed trades 22-28 Oct (database): BTC SWEEP_REV 12, SESSION_BO 5; PAXG EMA_CROSS 5, SWEEP_REV 5, TREND_MTF 1, SESSION_BO 1. Zero: BTC D_BEARTRAP, D_THRUST, HTF_TREND, TREND_MTF, VWAP_REVERT; PAXG D_BEARTRAP, D_THRUST, HTF_TREND, VWAP_REVERT.

### Expected activity from three years of real candles (`scripts/coverage_scan.ts`, evidence in `docs/evidence/coverage/`)
"Setups" = valid after the strategy rules and shared gates, before portfolio selection. P(0) = probability of no setup in 7 days if setups arrived at the 3-year average rate (a crude Poisson view; setups cluster).
| strategy | BTC setups/30d | BTC P(0 in 7d) | PAXG setups/30d | PAXG P(0 in 7d) | first real setup |
|---|---|---|---|---|---|
| D_BEARTRAP | 0.55 | 88% | 0.25 | 94% | 2023-11-22 / 2023-12-09 |
| D_THRUST | 0.30 | 93% | 0.25 | 94% | 2023-10-24 / 2024-04-14 |
| HTF_TREND | 7.0 | 19% | 6.9 | 20% | 2023-10-23 / 2023-10-27 |
| TREND_MTF | 4.3 | 36% | 3.5 | 44% | 2023-10-30 / 2023-10-28 |
| SWEEP_REV | 134.6 | 0% | 130.1 | 0% | 2023-10-23 |
| VWAP_REVERT | **0** | 100% | **0** | 100% | none in 3 years |
| SESSION_BO | 18.6 | 1% | 11.5 | 7% | 2023-10-25 |
| EMA_CROSS (if on) | 56.6 | | 62.9 | | 2023-10-23 / 2023-10-24 |
| HTF_SWEEP, SSR, EMA_PB (if on) | 6.3, 0.7, 53.4 | | 6.6, 0.2, 44.1 | | all fire on real data when enabled (permissive scan) |

## 3. Why each zero-trade strategy is silent (cause class)
| strategy | verdict | evidence |
|---|---|---|
| D_BEARTRAP (both) | **Naturally rare, plus regime gate** | 0.25-0.55 setups per 30 days; the 3% daily-EMA50 gate is open for longs 45% of the time on BTC, 35% on PAXG (3-year hourly samples, `scripts/regime_availability.ts`). 6 BTC / 4 PAXG backtest entries in 3 years. |
| D_THRUST (both) | **Naturally rare** | 0.25-0.30 setups per 30 days; 3 BTC / 4 PAXG entries in 3 years; P(0 in a week) about 93%. |
| HTF_TREND (both) | **Current regime does not qualify** (gate) | Open BTC price 81,286 vs EMA50D 80,708 = +0.7%; PAXG 4,056 vs 4,177 = -2.9%: both inside the +/-3% band, so every 4H breakout is rejected by the daily regime gate until price leaves the band. Gate closed in **both** directions 28% of the time on BTC, **57%** on PAXG. |
| TREND_MTF (BTC) | Rare + gate + session block | 4.3 setups/30d with the gate, 8.1 without; Asian block 00:00-06:59 UTC; zero in a week is 36% likely even without the gate state. PAXG made 1 trade. |
| VWAP_REVERT (both) | **Excessively restrictive / near-contradictory rule**, not a code path defect | Zero setups in 3 years on both books. RANGE regime (chop15 >= 61.8) is 8% of 15m bars, |dev| >= 2 sigma is 10%, RSI15 extreme is 11%; all three together happened **6 times in 104,267 BTC 15m bars before the reversal-candle condition, 0 after**. High choppiness (little net movement) and an RSI extreme (strong net movement) are close to mutually exclusive. One of the 6 was a small-sample sigma artifact (fixed below). |
No strategy was found unreachable by a software defect. No strategy was starved by `MIN_SCORE` (72): fixed scores 88-90 for the daily strategies, 78-82 for the opt-in ones.

## 4. Defects and risks found (with regression tests)
| # | finding | source (base 66028ac) | status |
|---|---|---|---|
| D1 | Four silent `return null` paths gave neither signal nor reason (zero-range 15m bar, VWAP sigma undefined, session range missing, zero-range 4H trigger), so a strategy could be blind with nothing recorded. | engine.ts:403, 428, 446, 532 | **Fixed** (explicit INSUFFICIENT_DATA reasons); test `silent returns now say why` |
| D2 | The shared warm-up exit reported only `TREND_MTF` ("Indicators warming up") and nothing for the other 10. | engine.ts:754 | **Fixed** in the trace (all 11 accounted for) |
| D3 | A throwing strategy aborted the whole evaluation for every strategy. | engine.ts evaluate loop | **Fixed**: isolated, reported as ERROR; test `one failing strategy cannot blind the others` |
| D4 | VWAP sigma from 1-3 bars is a small-sample artifact: deviations of 20 to 350,000 sigma on 131 15m bars in 3 years (second and third bar of the UTC day). It could create false VWAP setups and false "extended from VWAP" score changes. | engine.ts:184-195 (`vwapDaySeries`) | **Fixed**: sigma undefined until 4 bars of the day. Live-config 3-year backtests are **identical** before and after on both books (trade hash `2325d544…` BTC 148 trades, `b74dae54…` PAXG 134 trades). Test `VWAP sigma is undefined…` |
| D5 | The live loop evaluates only the newest closed 5m bar. If a run is late or a feed bar lags, the boundary bar (15m/1H/4H/daily close) is never evaluated and nothing records it. | index.ts `if (snap.T > st.lastEvalT)` | **Instrumented** (`covMeta.missedBars` / `missedDue`, `missingDue`), behavior unchanged. Historic misses are unknown (not recorded before now). The feed itself had no gaps in the last 5 days (BTC 5m and 4H; PAXG 5m, 15m, 1H and 4H: 0 gaps). **Owner decision 29 Oct 2026 ("without missing any trade"): catch-up implemented** in `catchup.ts` (env `CATCHUP`, default `on`; `shadow` records only; `off`). See docs/control/CATCHUP.md. |
| P1 | **Auto-disable censors observation.** `updateProbation` switches a strategy off permanently after 20 trades below -0.15R (engine.ts:864, never re-enabled). The 3-year live-config backtests show it: SWEEP_REV, SESSION_BO, TREND_MTF (BTC) and SWEEP_REV, EMA_CROSS, SESSION_BO (PAXG) all stop at exactly 20 trades. Per-strategy results from the combined portfolio are therefore truncated, and earlier research baselines include this rule. | engine.ts:864-868 | **Not changed**. Independent lanes (section 6) do not auto-disable and record when the rule would have fired. |
| P2 | One position at a time with exposure of 36-52% in research runs means a given strategy's setup arrives while the portfolio is occupied roughly 4 times in 10; first-match-by-score decides the rest. | engine.ts:873, index.ts selection loop | **Now visible** (PORTFOLIO_BLOCKED / NOT_SELECTED counters). |
| P3 | Dashboard: lists 7 of 11 strategies (omits HTF_SWEEP, EMA_CROSS (active on PAXG), SSR, EMA_PB); descriptions say "Off in v5.1" for SESSION_BO, VWAP_REVERT and SWEEP_REV while they are on at scale 1; "Full size" is the only status. | web/index.html:374-382, 500-510 | **Fixed** by the dashboard PR (Strategies tab now lists all 11, operational state vs sizing, dated references with mismatch notes) |
Not defects, checked: daily/1H/4H close detection (`ct === T` equality, UTC `dailyFrom4h`, ET DST via `nthSundayUTC`) is correct when every bar is evaluated; the repeated-signal suppression `lastSig` is per strategy and per book; `stats` count only finalized trades; regime-gate and risk-scale keys replace shallowly (`RISK_SCALE` override with 7 keys leaves the 4 opt-ins off, as intended but not obvious).

## 5. Reason codes
NOT_DUE (waiting for its bar or session window), DISABLED, INSUFFICIENT_DATA (warm-up, undefined indicator, missing bar), NO_SETUP (pattern absent), GATE_REJECTED (pattern present, filtered by strategy or shared rule: regime gate, bias, stop bounds, MIN_SCORE, repeat suppression), PORTFOLIO_BLOCKED (position open, cooldown, daily cap, daily loss limit, news or approval pause), NOT_SELECTED (valid but a higher-scored setup entered), ERROR, ENTERED. Each evaluation of each strategy gets exactly one code (`coverage.ts`); a test fails if a new reason text in the engine has no code.

## 6. Rollout order (dependency-ordered)
1. Review and merge this PR (coverage counters, trace, fixes D1-D4). Behavior-preserving for entries, sizing, exits and risk (tests, plus identical 3-year backtests).
2. Deploy the edge function **after PR #3's release gate** (both edit `index.ts`; merge PR #3 first, then rebase this one). Counters start recording; nothing else changes.
3. Publish the dashboard (it reads `state.cov`; before deployment it shows "no coverage data yet" rather than guessing).
4. After 7 days of counters: classify each strategy with real due/completed/rejected numbers; compare `missedBars` with zero.
5. Shadow lanes (`docs/SHADOW_LANES.md`) in isolation, after the table migration is separately approved.
6. Any rule change (VWAP_REVERT conditions, regime gate width, instrument-specific floors) is a new versioned, frozen research hypothesis, one at a time, after costs. **Nothing was loosened here.** A_COSTR50 and B_BE_TP1 stay rejected and disabled.

## 7. Limits
Fixtures prove a code path is reachable with live-sized windows, not that it is profitable. Scan counts are descriptive and in-sample history. P(0) is a crude rate argument. Live counters begin only after deployment. PAXG history is Binance PAXGUSDT spot, not the Hyperliquid PAXG feed the bot trades (open fidelity question from the earlier replay work).
