# DeskBot

A 24/7 **paper-trading** bot for Bitcoin and gold (PAXG). It runs as a Supabase Edge Function on a 5-minute cron, with a live dashboard on Vercel. It never places real orders.

```
supabase/functions/deskbot-v5/  engine.ts (strategies, risk, AI filter) · research.ts (mining + walk-forward ML)
                                data.ts (Hyperliquid/Binance) · news.ts · ai.ts (Groq/Gemini) · chat.ts · index.ts
web/            live dashboard (Vercel)     ml/   research scripts     pine/   TradingView indicator
docs/           ML_REPORT.md · ONLINE_RUNBOOK.md · STRATEGIES.md · RISK.md     tests/  node --test
```

**Books:** BTC and Gold, each its own paper account. **Strategies:** 11 (7 core on; HTF_SWEEP, EMA_CROSS, SSR and EMA_PB are opt-in).
Research results, all walk-forward and after fees, are in [docs/ML_REPORT.md](docs/ML_REPORT.md).

Run the tests with `npx tsx --test tests/*.test.ts`. Run research locally with `npx tsx ml/wf_local.ts <5m.csv> BTC`.
