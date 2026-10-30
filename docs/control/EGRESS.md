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
- **Provider policy: five separate facts per provider** (`ai.ts providerPolicy`, status `ai.policy`):
  1. credentials present (the key secret exists);
  2. terms reviewed (`TERMS_VERIFIED` in code, currently Gemini only, or the owner's `AI_TERMS_VERIFIED`);
  3. data use accepted **per feature** (news, committee, chat), only by the owner's `AI_DATA_USE_ACCEPTED`, e.g. `gemini:news`;
  4. reachable: unknown ("not tested") until a call succeeds; from the day's usage counters;
  5. feature enabled (NEWS_AI/NEWS_MODE, AGENT_AI + DESK_WORKFLOW, chat key).

  A provider serves a feature only when 1, 2, 3 and 5 hold. Gemini's terms entry is a review record: it accepts nothing and enables nothing. The tower names the first missing fact.
- The chat reply carries `accountData: "withheld"`, and the UI shows "account data withheld (equity, $ P&L, sizes)".

## What this does not guarantee
Removing account keys does not make a payload anonymous. Prices, levels, timestamps and strategy names together can still describe the bot's trading. Free tiers may log prompts or use them for training: Gemini's free tier uses them to improve products. The owner decides whether that is acceptable for the payloads above.

## Tests
`tests/egress.test.ts` drives each path with the real screenshot-trade values (equity 342.60, risk $6.85, qty 0.00294) and captures the serialized HTTP request bodies. It asserts that there are no account keys and that none of those values appear.
