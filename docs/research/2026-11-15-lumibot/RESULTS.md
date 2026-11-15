# LumiBot: what DeskBot takes, and results (2026-11-15)

**Source:** github.com/Lumiwealth/lumibot (GPL-3.0, Python, ~2.2k★, read at `80692e2`) and Lumiwealth/lumibot-strategies (MIT, `d702b4d`). Both were read from source and never run. **No code was copied:** GPL code would impose its licence, and DeskBot is TypeScript anyway. Only ideas were taken.

## What LumiBot is
A Python framework for backtesting and live trading, with LLM agents that "research, reason and place orders", and many brokers. The community strategies are stock, ETF and options portfolios (60/40, SMA cross, momentum, strangle), plus a 50/50 BTC/ETH split.

## Taken
| Idea | LumiBot source | DeskBot |
|---|---|---|
| Charge **historical perpetual funding** at real settlements; say plainly when funding data is missing ("missing data, not zero funding") | `backtesting/perpetuals.py`, `docsrc/backtesting.perpetuals.rst` | `scripts/challenger_study.ts --funding`, which counts bars without a known settlement (0 in this window) |
| Use the **public Binance archive**, with every file checked against its published SHA-256 | Binance bulk-file route (`binance_bulk_data.py`) | `scripts/fetch_funding.sh`; data in `research_data/` with its `SHA256SUMS` |
| Fill rules: a stop gapped past fills at the open, stop first when a bar touches both, the entry bar cannot stop out | `docsrc/backtesting.how_orders_fill.rst` | **Already identical** in `engine.ts managePosition` (gap → `min(stop, open)`, stop-first, the straddling entry bar is reduced to its close). No change |

## Not taken
- **AI agents that place orders.** DeskBot's AI is advisory only and can never open a trade. LumiBot's agents need paid model keys, and they conflict with the paper-only rule.
- **BotSpot cloud / MCP / marketplace / broker linking.** These are hosted and paid, and they connect accounts.
- **Community strategies.** They are for stocks, options or portfolios; none fits a BTC/GOLD perp book.
- **AI replay cache and rules ledger.** Useful only once an AI decides trades, which DeskBot does not allow.

## Results (BTC, 3 years, frozen 5m data, isolated lanes; spec `SPEC_FROZEN.md` committed first in `9384072`)
### Part 1: flat funding assumption vs real Binance funding (base, no filter)
| Strategy | Cost | Trades | R per trade, flat | R per trade, real | Funding $, flat → real |
|---|---|---|---|---|---|
| HTF_TREND | 1× | 86 | +0.076 | **+0.094** | 21.2 → 9.4 |
| HTF_TREND | 1.5× | 87 | +0.032 | **+0.064** | 29.9 → 9.3 |
| D_BEARTRAP | 1× | 19 | +0.194 | +0.201 | 2.9 → 1.9 |
| D_THRUST | 1× | 8 | +0.407 | +0.411 | 5.0 → 4.7 |
| TREND_MTF (off) | 1× | 105 | −0.026 | −0.021 | 5.9 → 2.2 |
| SESSION_BO (off) | 1× | 489 | −0.176 | −0.173 | 5.3 → 1.0 |
| SWEEP_REV (off) | 1× | 1793 | −0.252 | −0.251 | 3.5 → 2.2 |
| VWAP_REVERT | both | **0** | — | — | — |

- The flat 0.00125%/h assumption charges every position, long or short. Real funding is mostly paid by longs and received by shorts.
- Over these 3 years the flat assumption **overstated** funding about 2-3× on HTF_TREND. It is conservative, so earlier research that used it was not flattering.
- The turned-off strategies stay negative with real funding, so turning them off still stands.
- Production already charges Hyperliquid's live rate, so this changes nothing live.
- **VWAP_REVERT made no trade on BTC in 3 years.** It is enabled but dormant; that is worth knowing, though it is not harmful.

### Part 2: FUND_CROWD (skip entries on the crowded side of funding), real funding
| Strategy | Cost | Base n / R per trade | FUND_CROWD n / R per trade | ΔR [90% CI] |
|---|---|---|---|---|
| HTF_TREND | 1× | 86 / +0.094 | 74 / +0.114 | +0.4 [−6.2, 10.7] |
| HTF_TREND | 1.5× | 87 / +0.064 | 75 / +0.082 | +0.6 [−8.0, 7.9] |
| D_BEARTRAP | 1× | 19 / +0.201 | 13 / +0.269 | −0.3 [−5.4, 4.4] |
| D_THRUST | 1× | 8 / +0.411 | 2 / −1.024 | −5.3 [−11.1, −0.4] |
| SWEEP_REV | 1× | 1795 / −0.251 | 1354 / −0.257 | +103 [70, 136], fewer losers only |
| SESSION_BO | 1× | 489 / −0.173 | 382 / −0.213 | +3 [−14, 23] |

**Verdict: REJECT.** The rule needs ΔR's interval above 0 on a positive strategy, and none qualifies. HTF_TREND's small improvement is within noise. D_THRUST is significantly hurt: its thrust signals often come with crowded funding, and the filter removes the winners. Funding extremes on Binance's 8h rate do not tell DeskBot's entries which side is right.

## Takeaways
1. The book's remaining strategies (HTF_TREND, D_BEARTRAP, D_THRUST) are **slightly better** than earlier research said once real funding is used. They are still thin: HTF_TREND is about +0.06-0.09R per trade on BTC, and the others have small samples.
2. A simple funding-crowding filter doesn't help. The `dbv5_market_ctx` history now recording Hyperliquid's hourly funding and OI is still the input for a Hyperliquid-specific version, but this result lowers its priority.
3. All research tooling can now use real funding: `scripts/fetch_funding.sh` plus `--funding`.
