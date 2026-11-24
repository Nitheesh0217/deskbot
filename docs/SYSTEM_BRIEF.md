# DeskBot: complete system brief (for an outside review, 2026-11-24)

I run a personal **paper-trading** system called DeskBot. All money below is **simulated**; no broker is connected and no real order can be placed. Please review it and tell me where to work next to get **better trades** (higher expectancy after costs, more independent trades, lower drawdown). Be specific and critical. Every number here comes from the system's own records or its research scripts.

---

## 1. Goals and hard rules
- **Owner goal:** $10,000 profit a month ($1,000 a night). The system tracks this goal but **never uses it to set position size**. At the current measured edge and size, the projection is about $16 a month, so the goal is about 630× what the edge supports today. I want to close that gap honestly: better edge, more independent markets, more capital, and size that grows only as live results earn it.
- **Paper only.** Real money would need a broker adapter with exchange-held stops, trade-only keys and separate approval. None of that exists yet.
- **Research discipline:**
  - Every strategy change is first written as a **frozen spec** (hypothesis, one exact rule, fixed parameters, PASS/REJECT criteria) and committed **before** any result is seen.
  - It is then tested on 3 years of 5-minute data at 1× and 1.5× costs with real funding, using block-bootstrap confidence intervals.
  - Rules are never changed after seeing results. Rejected ideas are kept on record so they are not re-tested as new.
- **AI is advisory or paper-only.** AI never sets stops or size. Outbound AI requests carry no account data (an egress guard enforces this).

## 2. Architecture
- **Runtime:** one Supabase Edge Function (Deno/TypeScript). It is deployed from a pinned, immutable GitHub commit, so every deploy is reproducible and can be rolled back.
- **Schedule (Postgres cron):**
  - a run every 5 minutes;
  - a market scan every 15 minutes;
  - a watchdog every 15 minutes;
  - a nightly report at 00:05 UTC;
  - prunes.
- **Storage:** Postgres.
  - `dbv5_state`: one row per book; compare-and-set on a revision number, so overlapping runs cannot overwrite each other.
  - `dbv5_trades`, `dbv5_events` and `dbv5_equity`.
  - A decision ledger with input bars per entry.
  - A work-log outbox, so no record is lost when a write fails.
  - `dbv5_market_ctx`: Hyperliquid funding, open interest, premium and oracle price every run.
- **Two-phase run:**
  - Phase 1, for every book: data, position management, entries, state save.
  - Phase 2: advisory work (work-log flush, LLM desk review, AI trader).
  - A slow or failing AI can therefore never delay position management.
- **Dashboard:** a static web app on Vercel. It has these views:
  - Overview, chart with trade plan, strategies, journal, activity;
  - System view: freshness, decision receipts, learning desk, all books, AI trader;
  - a "Trading tower" with 8 floors of workers and the goal board.
- **Tests:** 349 automated tests, plus browser smoke tests with a synthetic fixture.

## 3. Data
- **Live:** Hyperliquid perpetuals (public API). Candles at 1m, 5m, 15m, 1h and 4h, plus metadata: funding, open interest, mark/oracle price, lot size and max leverage. Binance spot is the fallback feed; a run with mixed feeds blocks new entries.
- **Research:** Binance USD-M 5m klines and funding from the public archive (`data.binance.vision`). Every monthly file is checked against its published SHA-256.
- **Window:** 2023-06-15 → 2026-10-22, i.e. 352,800 bars per coin, plus 130 days of warm-up.
- **Not available:** long stock, bond, commodity or FX history. The free source (stooq) refuses this cloud machine. Hyperliquid's stock, index and commodity perps (`xyz` dex) have only 8-13 months of history.

## 4. Execution model (paper)
- **Entry:** fills at the next 5m open; taker fee 0.045% plus 0.02% slippage.
- **Exits:**
  - Stops fill at the stop, or at the open if price gapped past it.
  - If one bar touches both stop and target, the stop counts as hit first.
  - The entry bar cannot stop out.
  - Targets TP1, TP2 and TP3 close in parts; a trade manager can move the stop to breakeven after TP1.
  - Each strategy has a maximum hold time.
- **Funding:** the live run charges the real hourly Hyperliquid funding. Backtests charge historical Binance funding (or a conservative flat rate).
- **Sizing:** risk per trade is 2% of book equity under $500 (1.5% under $1k, 1.2% under $3k, 1% above), times the strategy's `RISK_SCALE`. The quantity is rounded down to the instrument's lot.
- **Gates:** daily loss limit, circuit-breaker cooldown, minimum score, spacing, news pause (BTC), stale-data and mixed-feed blocks.

## 5. Strategies (11 implemented)
| Strategy | Idea | Status |
|---|---|---|
| **HTF_TREND** | 4h close beyond a 55-bar Donchian channel, with a daily EMA50 regime gate (price at least 3% beyond it); targets in R, trail after TP1 | **Main edge. ON in all books** |
| D_THRUST | Daily thrust > 2× daily ATR in a bull regime, then the first 1h pullback to EMA20 | ON (BTC/GOLD), very small sample |
| D_BEARTRAP | Daily bearish-engulfing trap above the daily EMA50 | ON (BTC/GOLD), small sample |
| VWAP_REVERT | 15m deviation from VWAP | ON, but **0 trades in 3 years** on BTC (dormant) |
| TREND_MTF | Multi-timeframe SuperTrend alignment | OFF (−0.03 to −0.07R per trade after costs) |
| SWEEP_REV | Liquidity sweep and reclaim (5m/15m) | OFF (−0.25 to −0.34R per trade) |
| SESSION_BO | Session-range breakout | OFF (−0.18 to −0.25R per trade) |
| EMA_CROSS | 15m EMA cross (gold) | OFF (−0.39 to −0.46R per trade) |
| HTF_SWEEP, SSR, EMA_PB | Opt-in experiments | OFF |

Short-horizon strategies lost to fees and slippage. Turning them off on 2026-11-10 stopped the bleed.

## 6. Research results (3 years, isolated lanes, BTC's live config)
### HTF_TREND, 1.5× costs, real funding
| Coin | R per trade | Coin | R per trade |
|---|---|---|---|
| BTC | +0.064 | ETH | +0.106 |
| SOL | +0.152 | DOGE | +0.147 |
| BNB | +0.030 | XRP | +0.007 |
| ADA | +0.388 | PEPE | +0.189 |
| UNI | +0.173 | AVAX | +0.167 |
| NEAR | +0.152 | LIT | +0.135 |
| ZEC | +0.122 | LINK | 0.000 |
| AAVE | −0.079 | XMR | −0.236 |

- Each coin has about 80-97 trades in 3 years (about 2.4 a month).
- **Out-of-sample test** (10 coins never used before, chosen by a mechanical rule): pooled +0.094R per trade at 1.5× costs, 90% interval [−5.3, +181] R. That **narrowly failed** the pre-set significance bar; at 1× costs it passes (+0.110R per trade, interval [+6.8, +195.8]).
- BTC's HTF_TREND edge has decayed since 2025 (about 0 to −0.1R per trade). GOLD (PAXG) HTF_TREND was +0.3 to +0.6R per trade in 2024-2026, but on only 52 trades.

### Rejected filters and exits (all with frozen specs)
| Idea | Result |
|---|---|
| Layer agreement: trade only when 1h/4h SuperTrend and daily EMA50 agree | Fewer trades, no better R per trade; hurt BTC HTF_TREND. REJECT |
| EXIT-D: ratchet trail on HTF_TREND (stop at MFE−1R once MFE ≥ 1.5R) | ΔR ≈ +1-2R in 3 years, interval spans 0; BTC drawdown worse. REJECT |
| EXIT-B (closer TP1), EXIT-C (exit at half max hold without TP1), ENTRY-1 (skip late breakouts) | REJECT |
| FUND_CROWD: skip entries on the crowded side of funding (Binance 8h rate ≥ 90th / ≤ 10th percentile of 30 days) | No gain; significantly hurt D_THRUST. REJECT |
| **CLUSTER_CAP:** same-direction risk budget across crypto books, each new trade's risk × min(1, 3/n) | Max DD 53.6R → 22.6R; net R per DD 2.37 → 4.19; worst week −15.1 → −8.8R; interval moved above 0. But net R fell 25.3% vs a 25% limit, so **narrow REJECT**. Input for the sizing step |

### Measurement finding
A flat funding assumption overstated HTF_TREND funding cost by 2-3×. Real funding raises BTC HTF_TREND from +0.032 to +0.064R per trade at 1.5× costs.

## 7. Live paper books (2026-11-24)
| Book | Config | Equity (start) | Record |
|---|---|---|---|
| BTC | HTF_TREND, D_THRUST, D_BEARTRAP, VWAP_REVERT | $371.85 ($352.56) | 30 trades, +3.52R in total; the last 2 HTF_TREND trades made +3.61R |
| GOLD (PAXG) | same | $314.38 ($350) | 25 trades, −11.3R, mostly from strategies now off |
| ETH | HTF_TREND only | $350 | 0 trades yet |
| Basket (13 coins) | HTF_TREND only, half size, 4h cadence, 3 staggered slots | about $350 each | 4 trades, −3R: three were the same-day short cluster on 2026-11-20 |
| Stocks, indices, commodities (7) | Record-only (shadow), HTF_TREND | — | Recording signals only |
| AI trader | LLM picks one valid signal or stands aside; code sets stop, size and exits | $350 | Waiting for a free LLM key |

- The basket coins are SOL, DOGE, BNB, XRP, ZEC, NEAR, XMR, AAVE, UNI, LINK, PEPE, AVAX and ADA.
- The record-only markets are the S&P 500, Nasdaq-100, NVDA, gold, silver, Brent and WTI.
- The basket experiment is judged after ≥ 30 basket trades or 6 months (pre-registered).
- Total paper capital is about $5,576 across the trading books.

## 8. Learning loop and goal board (built 2026-11-24)
- **Every closed loss is tagged by cause** from recorded facts: cluster loss, stopped within 30 min, gave back after TP1, time-exit loss, range-regime loss, costs ate the profit, or ordinary trend stop.
- **A lesson ledger** maps each cause to a test and its verdict.
  - Queued: ENTRY_CONFIRM (enter only after one more closed 5m bar holds beyond the trigger) and CHOP_SKIP (no entry when 15m choppiness ≥ 61.8).
  - Current focus: the cluster loss.
- **Goal board:** 8 "floors" (data, intelligence, research, strategy desks, portfolio, risk, execution, operations), each with a target, actual status and needs. A nightly report is saved at 00:05 UTC.
- **Current needs:**
  - a free LLM key for news and the AI trader;
  - a weekly research run;
  - long stock/commodity history;
  - more independent signals (10 of 16 books had no trade in 30 days).

## 9. Known weaknesses (please challenge these)
1. **One real edge.** Everything rests on a 4h Donchian trend breakout. About +0.1R per trade after costs, and about 2.4 trades per coin per month.
2. **Correlation.** Crypto trends move together: at one moment all 16 coins held the same direction. The effective number of independent bets is small.
3. **Small live sample.** Weeks of forward data and a handful of trades; nothing is statistically proven forward yet.
4. **BTC decay.** BTC's own HTF_TREND edge is about 0 since 2025.
5. **Sizing is static.** Fixed % risk, no volatility targeting, no portfolio-level risk budget, no sizing from the live record (planned next).
6. **No mean-reversion or carry edge that survived costs.** Every short-horizon strategy lost to fees.
7. **No long history for non-crypto markets.**
8. **Research uses Binance data; live trades Hyperliquid.** Prices and funding differ slightly; LIT is even a different token.

## 10. Planned next steps
1. **Performance-based sizing:** each book's risk grows as its live record proves the edge, drops after drawdowns, and is shared across same-direction crypto entries. Frozen spec first.
2. **Weekly automated research:** one queued lesson a week, frozen spec, test, PR. Never auto-deploy.
3. Test ENTRY_CONFIRM and CHOP_SKIP.
4. Funding and open-interest research on Hyperliquid's own recorded history once a few weeks exist.

## 11. Questions for you
1. Given one trend edge of about +0.1R per trade on correlated crypto, what is the most reliable way to raise **risk-adjusted** return? Options include volatility targeting, a portfolio risk budget, fractional Kelly on the live record, trend-strength filters, or pyramiding. Which first, and how would you test it without overfitting?
2. Which **uncorrelated** strategy families have the best evidence of surviving realistic costs on crypto perps and Hyperliquid's stock and commodity perps? For example: time-series momentum on daily bars, cross-sectional momentum, carry/funding, or volatility risk premium.
3. How should a 4h Donchian breakout be improved on exits or entries without curve-fitting, given that ratchet trails, nearer targets, time exits and trend-agreement filters were all rejected?
4. With only about 2.4 trades per coin per month, how should I decide when the forward record is enough to raise size?
5. What am I likely missing (biases, execution realities, risks) before any real-money pilot?
