# DeskBot v5

DeskBot v5 is a BTC paper-trading bot that runs 24/7 in the cloud, independent of any laptop or browser tab. It is **paper only**: no file in this project places real orders or holds exchange keys.

v5 replaces both earlier bots:

| Bot | Where it ran | Status |
|---|---|---|
| v3 | TradingView tab + Vercel `deskbot-v3` + an hourly Claude task + Google Sheet + Supabase `bot_state` | **Retired.** Its equity ($352.56) carried into v5. Tables kept read-only for history. |
| v4.3 | TradingView browser console (6 injected parts, localStorage) | **Retired.** All its logic lives in the v5 engine; nothing runs in the browser any more. |
| **v5** | Supabase Edge Function `deskbot-v5`, triggered by `pg_cron` every 5 minutes | **Live (paper).** |

## How it runs

```
pg_cron (every 5 min, minute 1,6,11…)          Supabase project xevymbzgpcsdhygswxlk
   └─ public.dbv5_invoke()  ── HTTPS + vault key ──►  Edge Function deskbot-v5
                                                        ├─ Hyperliquid candles (5m/15m/1h/4h/1m), funding, OI, mark
                                                        │    └─ Binance spot fallback if Hyperliquid fails
                                                        ├─ Fear & Greed (cached 3h)
                                                        ├─ engine.ts: manage open position on 1m path → evaluate 7 strategies
                                                        └─ writes dbv5_state / dbv5_trades / dbv5_events / dbv5_equity
Dashboard artifact ── viewer's Supabase connector (read-only SQL) ──► same tables
Claude scheduled task "DeskBot v5 — daily review" (20:43 ET) ── health + performance push
```

## Files

| Path | What it is |
|---|---|
| `supabase/functions/deskbot-v5/engine.ts` | Pure engine: indicators, 7 strategies, risk gates, accounting, backtester. Same code for live and backtest. |
| `supabase/functions/deskbot-v5/data.ts` | Market data: Hyperliquid (primary), Binance (fallback + long history), Fear & Greed. |
| `supabase/functions/deskbot-v5/index.ts` | HTTP handler: `run`, `backtest`, public `GET` status bundle. |
| `supabase/migrations/*.sql` | Tables (RLS on, service-role only), vault key RPC, cron schedule, pruning. |
| `tests/engine.test.ts` | 14 tests: indicators, SuperTrend persistence, VWAP reset, sizing fixture, partial exits, stop-first, circuit breaker, leverage cap, backtest reconciliation, daily bars, bear-trap fixture. |
| `docs/STRATEGIES.md` | Every strategy's rules and the evidence behind it. |
| `docs/RISK.md` | Risk rules and cost model. |
| `docs/OPERATIONS.md` | How to change settings, run backtests, pause, read logs. |
| `docs/CHANGELOG.md` | v3 → v4.3 → v5. |

## Run tests

```bash
npm i -D tsx@4 typescript@5
npx tsx --test tests/engine.test.ts
```
