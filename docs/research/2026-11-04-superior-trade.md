# Superior Trade repositories: what DeskBot takes and what it doesn't (2026-11-04)

The repositories were read from source, never run, and their contents were treated as untrusted. Sources: github.com/Superior-Trade: `trading-terminal` (Apache-2.0, ~1k★), `superior-skills` (MIT), `trading-architecture-benchmark` (MIT).

## What they are
- **trading-terminal** is a self-hosted Next.js "AI trading terminal" for Hyperliquid.
  - Flow: chart or screenshot → an LLM fills a plan schema → an LLM writes Freqtrade code → a deterministic regex validator → backtest and deploy.
  - **Backtests, deployments and the code smoke-run all happen on Superior's hosted API**, and every deploy path is **live**: `dry_run` is deleted before submit. There is no paper mode.
- **superior-skills** is a set of agent skills (prompt documents) for that API: strategy templates and a backtesting guide. Live deployment uses a platform-managed wallet that can also withdraw.
- **trading-architecture-benchmark** is Superior's own method for scoring AI trading stacks: capability coverage judged by 3 LLMs, and intent-to-live-fill latency on mainnet. No results are published.

## Not taken
- **Superior's API, managed wallet and live deploy paths.** They conflict with DeskBot's paper-only rule, need a paid key, and one ClawHub listing of their skill was flagged suspicious.
- **The "validated" strategies `donchian-strong-regime` and `bollinger-reverter-4h`.**
  - Donchian had 6 trades and Bollinger 18 on BTC, all on one 162-day window.
  - Costs were not stated, there was no out-of-sample test, and the regime gate was chosen on the test window after about 21 backtests.
  - That falls short of their own 30-trade minimum. At most they are candidate SHADOW research, under a frozen spec.
- **DCA and grid.** They add size, which DeskBot never does.
- **Two-leg basis.** It needs a spot leg.

## Taken (observe-only unless a later, approved, shadow-first decision says otherwise)
| Item | Source | DeskBot |
|---|---|---|
| Hyperliquid metadata from the same `metaAndAssetCtxs` call (szDecimals, maxLeverage, delisted, oracle, premium, funding APR) | trading-terminal `hl-universe.ts` | `data.ts hlContext` → `lastRun.market.hl` |
| Position checks: implied leverage, liquidation buffer ≥3× stop distance, $10 minimum order, size representable at szDecimals, degenerate stop | trading-terminal `plan-sizing.ts`, `sizing-ceiling.ts` (Apache-2.0, adapted) | `lastRun.positionChecks`, shown on the dashboard |
| Range diagnostic: Kaufman efficiency plus quartile touches over 120×1h | trading-terminal `market-context.ts` | `lastRun.market.rangeDiag` |
| A pure validator that names the rule and rejects instead of rewriting | trading-terminal `freqtrade-guard.ts` | `cfg_guard.ts` → `lastRun.cfgGuard` |
| Intent fidelity (the fill matches the decision plan) and phase timings | trading-architecture-benchmark | `lastRun.intentCheck`, `lastRun.timing` |
| Funding, premium and OI history (prerequisite for any funding/basis research) | superior-skills funding templates | `dbv5_market_ctx` (migration file only, not applied) |
| Backtesting checklist items | superior-skills `skills/backtesting` (MIT) | `docs/control/RESEARCH_PROTOCOL.md` |
| Dashboard: R:R badge computed from levels, privacy mode, stale-plan warnings, the "first rule (+N more)" format | trading-terminal components | `web/riskchecks.js` |

Attribution is in `NOTICE`, and each file with adapted code carries a header.

## Research candidates (not built; each needs a frozen spec, and shadow is the best possible outcome)
- **FUND_CARRY / FUND_SQUEEZE:** a forward-only shadow lane, once `dbv5_market_ctx` has history.
- **BB_REVERT_4H** (Bollinger 20/2σ + RSI + ADX<25): a shadow lane against the VWAP_REVERT baseline. It needs ADX and Bollinger series.
- **EXIT-D:** a ratchet trail on HTF_TREND, aimed at the measured 1.45-2.0R giveback.
- **Triple regime gate** (EMA50/200 separation + ADX + 30-bar return) on HTF_TREND, reported as development-only.
