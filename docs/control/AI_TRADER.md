# AI trader (paper book `ai_btc`, spec AI-TRADER-1)

An AI agent that **places orders in its own paper book**: simulated $350 on BTC, separate from the BTC, GOLD and ETH rule books.

## How it decides
1. On every closed 5m bar, code builds the **menu**: every signal that is valid on that bar from the non-opt-in strategies. This includes the ones switched off in the rule book, so the agent can be measured against the rules.
2. When the menu is not empty and the book is flat, the model is asked **once**. It sees allowlisted facts:
   - trend on 15m, 1h and 4h; daily close vs EMA50; regime; RSI; ATR; VWAP deviation; funding; Fear & Greed;
   - for each option: strategy, direction, score, stop distance, reasons, and the strategy's **3-year research expectancy after costs**.
   It answers `{pick, confidence, reason}`: a menu index, or `-1` to stand aside.
3. Code places the order through the **same gates, sizing, costs and executor** as the rule books (daily loss limit, cooldown, spacing, minimum score). The model cannot set a price, stop, target or size.
4. **Exits are code only**: stops, targets, partials, trader management and max hold. The model is never asked while a position is open.
5. A missing provider, a timeout or an invalid answer is recorded as **NO_DECISION**. There is never a fallback trade.

## Privacy
The facts pass the egress guard (`egress.ts`): no equity, balances, sizes, dollar P&L or identifiers. It is the only AI call site of the trader (`aiDecider`), covered by the call-site test.

## Turning it on (owner)
The book runs from the first BTC run after deploy, and stays at NO_DECISION until a provider is usable for feature `trader`. In Supabase → Edge Functions → Secrets, set:
- a free key, e.g. `GROQ_API_KEY` (console.groq.com) or `GEMINI_API_KEY` (aistudio.google.com)
- `AI_TERMS_VERIFIED=groq` (Gemini's terms are already recorded in code)
- `AI_DATA_USE_ACCEPTED=groq:trader` (or `gemini:trader`); add `,groq:committee` etc. to use it elsewhere

The free tiers' terms allow prompts to be used to improve the provider's products. The payload carries no account data.
`AI_TRADER=off` stops the book.

## Status and record
- `status.aiTrader`: equity, open position, stats, and the last 20 decisions with menu, pick, confidence, reason and provider.
- Trades go to `dbv5_trades` with symbol `AI_BTC`; events use symbol `AI_BTC`.
- Dashboard: System → "AI trader · paper book".

## Honest expectations
Published LLM trading agents have not shown an edge (one MIT project's three agents all lost money over 30 days). The value here is a clean, like-for-like comparison: same signals, same costs, same exits; only the **selection** differs. Judge it after at least 30 AI trades against the rule books over the same period.

**Not built:** funded orders. A real-money order path needs a broker adapter with broker-resident stops and reconciliation, owner-held trade-only keys, and separate approval.
