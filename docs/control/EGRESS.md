# Outbound data policy (AI providers and push relay)

Account data stays in deterministic local code. Third parties get allowlisted payloads only (`supabase/functions/deskbot-v5/egress.ts`).

## Outbound paths (all of them, as of this change)
| Path | Destination | What is sent now | Removed by this change |
|---|---|---|---|
| Committee, 8 stages (`desk.ts runDeskWorkflow`) | verified AI providers | `committeeFacts`: instrument, strategy, direction, regime, rule reasons, plan as entry/stop/targets with % of price and R, analyst reports (public market data, funding rate, OI, F&G, headlines), deterministic checks, R-only lessons, `account_data: withheld` | `riskAmt` (risk dollars, which reveal account size) |
| Shadow AI review (`agents.ts aiReview`) | verified AI providers | `reviewFacts`: strategy, direction, entry, stop, re-entry flag, rule reasons, chart levels | nothing sensitive was sent; now built from an allowlist |
| News classification (`news.ts readNews`) | verified AI providers | public RSS headlines with age and source | unchanged (no account data) |
| Owner chat (`chat.ts` + `index.ts chatContext`) | verified AI providers | `chatFacts`: R and counts per strategy, drawdown %, open position levels (no size), config, public market data, news, trades in R, backtests in R, other books' levels and R, `account_data: withheld` | equity, start equity, `$` P&L per trade and strategy, gross win/loss, backtest end equity, other books' equity |
| Push notifications (`index.ts push`, ntfy.sh, a public relay) | ntfy topic | entry/stop/targets and score; close reason and R | `risk $`, `net $`, `Eq $` |
| Provider errors / fallbacks | dbv5 agent rows | provider name, HTTP status, "timeout", "invalid output" | the prompt never appears in error text (tested) |
| Market data, feeds | Hyperliquid, Binance, Deribit, alternative.me, RSS | requests for public data only | — |

## Enforcement
- `decideJSON` refuses any request whose system or user text carries an account key (`ACCOUNT_KEYS`: equity, balances, riskAmt, quantities, net/pnl/fees, account/wallet/user identifiers, keys and tokens). It returns `egress blocked`, and no provider is called.
- **Provider availability.** A provider is used only when both of these hold:
  - it has a key, **and**
  - its data-use terms are recorded, either in code (`TERMS_VERIFIED`: currently Gemini) or in the owner's `AI_TERMS_VERIFIED` secret.
  
  A key alone does not enable an unverified provider (Groq, NVIDIA, Cerebras, Mistral, GitHub Models, OpenRouter). Status `ai.availability` lists every provider with `configured` / `termsVerified`.
- The chat reply carries `accountData: "withheld"`, and the UI shows "account data withheld (equity, $ P&L, sizes)".

## What this does not guarantee
Removing account keys does not make a payload anonymous. Prices, levels, timestamps and strategy names together can still describe the bot's trading. Free tiers may log prompts or use them for training: Gemini's free tier uses them to improve products. The owner decides whether that is acceptable for the payloads above.

## Tests
`tests/egress.test.ts` drives each path with the real screenshot-trade values (equity 342.60, risk $6.85, qty 0.00294) and captures the serialized HTTP request bodies. It asserts that there are no account keys and that none of those values appear.
