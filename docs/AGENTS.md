# The desk agents (v5.8)

Every agent is deterministic code inside the same 5-minute cron call that runs the bot (Supabase Edge Function + pg_cron), so the whole desk is online 24/7 with no laptop, browser tab or Claude session. Each leaves rows in `dbv5_agent_log`, shown on the dashboard's **Agent desk** card.

| Agent | Job | Switch | Live default |
|---|---|---|---|
| chart | Reads 1m/5m/15m/1h/4h, lists support/resistance (swing highs/lows, Asian range, prior-day H/L, 4H 55-bar extremes, VWAP/POC/EMAs). Drawn on the Chart tab as `agent:` lines | always on (read-only) | **on** |
| signals | The 11 strategies | `RISK_SCALE` / `enabled` | as before |
| validator | Second opinion on each signal: ≥ `minRoomR`×R of room to the next blocking level; no trend entry against both 1H and 4H | `VALIDATOR.on` | **off** |
| risk | Stop at the candle **body** extreme of the last `n` trigger-timeframe candles (+`buf`×ATR, never closer than `minPct`); only ever tightens | `BODY_SL.on` | **off** |
| reentry | After a losing stop-out (before TP1) re-take the same setup if price reclaims the stopped level, 5m/15m/1h agree, score ≥ `minScore`, within `windowH`, ≤ `max` in a row | `REENTRY.on` | **off** |
| manager | v5.7 trade manager on the open position | `TRADER_PARTS` | per book |
| ai-review | Optional free-LLM (Groq/Gemini) second opinion on a trade just taken. **Shadow only**: logged, never blocks, sizes, opens or closes. Needs `GROQ_API_KEY` or `GEMINI_API_KEY`; `AGENT_AI=off` disables | env | shadow |

Books are processed one after another inside a run: the engine's config is module-global, so running two books in parallel would let one book's settings leak into the other. Network fetches inside a book are already parallel.

## Why validator, body-stop and re-entry ship OFF (24 Oct 2026)

Binance 1-year backtests through the live function, each book's live config as the baseline, start $1000, same engine as live:

| window | baseline | body-stop | body-stop + re-entry | re-entry only | validator |
|---|---|---|---|---|---|
| BTC, last 12 m | $994 · −0.03R · DD 13% | $832 · −0.18R | $847 · −0.12R | $967 · −0.03R | $757 · −0.33R |
| BTC, prior 12 m | $798 · −0.14R | | $701 · −0.29R (OOS −1.0R) | | |
| Gold, last 12 m | $1070 · −0.04R | | $953 · −0.06R | | |

Tight candle-body stops get hit by ordinary noise, and every stop-out pays fees and slippage (consistent with ML_REPORT §1). Re-entering after the stop recovers part of it but not all. The validator's "room to the next level" rule removed winners as often as losers. Raw rows: `select results->>'label', results->'combined'->'all' from dbv5_backtests where results->>'label' like 'AB%';`

To try a variant yourself (no redeploy, appears in the table above's query):
```sql
select public.dbv5_invoke('{"action":"backtest","source":"binance","days":365,"combinedOnly":true,"label":"AB_my_test","cfg":{"BODY_SL":{"on":true,"n":5,"buf":0.3,"minPct":0.008},"REENTRY":{"on":true}}}'::jsonb);
```
To switch one on for a book only after you have evidence: `update dbv5_state set state = jsonb_set(state,'{cfg,BODY_SL}','{"on":true}') where id='main';` (gold row id is `gold`).
