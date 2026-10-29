# TradingAgents and NautilusTrader: what was taken, what was not

Reviewed 29 Oct 2026. Clones were read as untrusted text; nothing from either repository runs inside DeskBot.

## TradingAgents (Apache-2.0, commit c454491)
| Their component | DeskBot version | Why this way |
|---|---|---|
| Market / social / news / fundamentals analysts (LLM + tool calls) | `analystReports()` in `desk.ts`: **deterministic** market, sentiment, positioning (perps have no fundamentals; funding and OI take that seat) and news reports built from data the runner already fetched | Costs nothing, cannot hallucinate a number, and runs even with no AI provider |
| Bull / bear researchers, `max_debate_rounds` | `desk-bull`, `desk-bear`; `DEBATE_ROUNDS` (1–3, default 1) | Same structure; each speaker answers the previous one |
| Research manager (5-tier rating) | `desk-research` | Rating validated against Buy / Overweight / Hold / Underweight / Sell |
| Trader | `desk-trader`: take or pass on the rules' exact plan | It cannot change entry, stop, targets or size |
| Aggressive / conservative / neutral risk debate | `desk-risk-*`; `RISK_ROUNDS` (1–2) | Same three seats |
| Portfolio manager + reflection memory | `desk-pm` rating, stored with its direction-mapped stance; memory = `lessonsFrom()` facts from the last closed trades of the same strategy | Memory is factual (R, exit reason), not an LLM's self-reflection |
| Executes the PM's decision | **Not taken.** The PM rating is a shadow verdict in FILTER-1 only | The executor stays deterministic; promotion to a gate needs its own pre-registered test |

Every stage: strict JSON schema, rejects text that states a probability, a price target or a URL, ~8 calls per entry against free-tier daily caps, 75 s total deadline, and runs only after state and ledger are saved. With no `GROQ_API_KEY` / `GEMINI_API_KEY` secret, only the deterministic stages run.

## NautilusTrader (LGPL-3.0, commit a77f0b5): ideas only
| Idea | Status |
|---|---|
| `TradingState` ACTIVE / REDUCING / HALTED | **Used as a view**: `web/scanner.js tradingState()` labels the controls DeskBot already has (circuit breaker, daily loss limit, trade cap, auto-disabled strategies → REDUCING: open positions still managed; no recent run or failed integrity → HALTED). Adds no new control. |
| Adaptive high/low ordering inside a bar for backtests | Not needed for live management (DeskBot manages positions on the 1m path); worth a backtest-accuracy experiment: compare the 5m backtest's same-bar stop/target resolution with the 1m truth. Proposed, not run. |
| Fill models (`prob_fill_on_limit`, `prob_slippage`) | DeskBot's paper fills are market orders with a fixed slippage; a probabilistic fill model only matters once limit orders exist. Recorded as a later option. |
| Rust/Cython engine, venues, adapters | Out of scope: DeskBot is a paper bot on a Supabase edge function. |

## Scanner, futures and options
- `scan.ts` runs the bot's own deterministic strategies on all ten Hyperliquid perps in `data.ts SYMBOLS` every 15 minutes, with a fresh state and the live book configs. The rules were tuned on BTC and gold, so setups on other markets are labelled **untested market**. Only the BTC and gold paper books trade.
- Deribit public data (no key): DVOL, put/call open interest, max pain of the next expiry, near-the-money put-minus-call IV, futures basis annualised by days to expiry. Context only; nothing feeds the executor.
- Nothing in the scanner, the committee or the options panel is a prediction or a probability. The rule score is the engine's uncalibrated heuristic.
