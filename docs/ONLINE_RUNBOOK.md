# DeskBot v5.2 — running online without Claude

_Verified 22 Oct 2026. Paper trading only: there is no order-placement code in this project._

## 1. Audit: what needs what

| Piece | Where it runs | Needs Claude? | Needs your laptop? |
|---|---|---|---|
| Trading engine (signals, risk, exits, state) | Supabase Edge Function `deskbot-v5`, deterministic TypeScript | **No** | **No** |
| Scheduler | Supabase `pg_cron` `deskbot-v5-run`, every 5 min | No | No |
| Watchdog (re-kicks a stalled bot) | Supabase `pg_cron` `deskbot-v5-watchdog`, every 15 min | No | No |
| Market data | Hyperliquid public API, with Binance as fallback | No | No |
| News | Free RSS feeds: CoinDesk, Cointelegraph, Decrypt, Federal Reserve | No | No |
| AI news-risk labels (optional) | Groq (primary) → Gemini (fallback) free tiers | No | No |
| Heartbeat alert | GitHub Actions `heartbeat.yml`, every 2 h | No | No |
| Daily review / morning brief / 4-h watchdog | Claude scheduled tasks | **Yes** (optional extras) | No |
| Old v3 bot | Browser console on TradingView (retired) | — | Was yes |

**If your Claude credits run out:** the bot keeps trading on paper, managing positions, reading news and writing to the dashboard data. Only the optional written reports from the Claude scheduled tasks stop.
**If your laptop is off:** nothing changes. None of the pieces above run on it.

## 2. Architecture

```
pg_cron (5 min) ──► Edge Function deskbot-v5 ──► lease (single leader) ──► state in Postgres
                         │
                         ├─ 1. manage open position on 1m bars (stops/targets) ← never waits on news/AI
                         ├─ 2. news read every 30 min: RSS → rules → [Groq → Gemini] (validated JSON)
                         │       └─ any failure ⇒ rules-only label, logged; trading core unaffected
                         ├─ 3. evaluate strategies (v5.1 regime gate) → risk gates → paper entry
                         │       └─ NEWS_MODE=gate & fresh HIGH risk ⇒ skip NEW entries only
                         └─ 4. save state / equity / events / news ─► dashboard + GitHub heartbeat
pg_cron (15 min) ──► dbv5_watchdog(): state older than 20 min ⇒ kick one run
```

## 3. AI providers chosen (free tiers, no card)

| | Groq (primary) | Google Gemini (fallback) |
|---|---|---|
| Endpoint | `api.groq.com/openai/v1/chat/completions` | `generativelanguage.googleapis.com/v1beta/openai/chat/completions` |
| Default model (env-configurable) | `llama-3.3-70b-versatile` | `gemini-2.5-flash` |
| Free limits (reported mid-2026) | ~30 RPM, ~1,000 req/day | ~5–15 RPM, ~20–1,500 req/day depending on model |
| Trains on your prompts? | Not reported | Yes on the free tier, outside the EU/UK/EEA |
| Our use | ≤ 48 calls/day (one news read every 30 min) | Only when Groq fails |

The prompts contain only public headlines: no keys, no account data, no strategy code.
Free limits change often. Check the provider consoles before relying on them. We cap ourselves (`*_DAILY_CAP`) far below them.

**Rejected:** LiteLLM proxy (an extra always-on service for only 2 providers; a ~90-line adapter does the job). "Free Claude" and similar gateways (unverified provenance and terms). The Jev tools (no verified free official API, and not needed for a 4-field JSON label). Self-hosted models (no always-on GPU available).

## 4. Safety rules built in

- AI output is validated against fixed enums (`risk`, `btc_bias`, `event_type`). Anything else is discarded.
- The AI can never open, size, reverse or close a trade. It can only label risk.
- Headlines are treated as untrusted data. The model can't lower a rule-flagged HIGH all the way to LOW, which guards against prompt injection.
- Timeouts of 8 s per call and 20 s total. At most one retry, and only on 429/5xx. Retry-After is honoured. 401/403/404 disable that provider for 30 minutes. A daily cap applies per provider.
- If every provider fails, the bot runs rules-only and logs the reason. Exits and stops are never affected.
- Single-leader lease (`dbv5_lease`): a second concurrent run is refused, which prevents duplicate paper entries. The lease is verified live.
- `NEWS_MODE` defaults to `shadow`: it records what the news filter would have done without changing behaviour. Switch to `gate` only after the shadow log shows it helps.

## 5. Turning on the AI (optional, about 5 minutes)

1. Create free keys at https://console.groq.com/keys and https://aistudio.google.com/apikey (you create the accounts, not Claude).
2. In Supabase, go to Project `xevymbzgpcsdhygswxlk` → Edge Functions → Secrets, and add `GROQ_API_KEY` and, optionally, `GEMINI_API_KEY`.
3. Within 30 minutes, `dbv5_news.by` should read `ai:groq/...`. If it says `rules`, check `dbv5_news.errors`.

## 6. Runbook

| Situation | What happens | What you do |
|---|---|---|
| AI provider down / 429 | Falls back to the next provider, then to rules | Nothing. Check `dbv5_news.errors` if it persists |
| Quota exhausted | Provider skipped until the next UTC day | Nothing, or lower `NEWS_EVERY_MIN` |
| Bad/expired key | Provider skipped for 30 min, retried, logged | Rotate the key in Supabase secrets |
| Bot stalled | `pg_cron` watchdog kicks a run after 20 min; GitHub heartbeat emails you after 30 min | If it repeats: `select * from dbv5_events where kind='ERROR' order by id desc limit 20;` |
| Two runs at once | Second returns `skipped: another run holds the lease` | Nothing |
| Emergency pause (no new entries) | — | `update dbv5_state set state = jsonb_set(state,'{cfg,MIN_SCORE}','999') where id='main';` (exits keep working) |
| Resume | — | `update dbv5_state set state = state #- '{cfg,MIN_SCORE}' where id='main';` |
| Stop everything | — | `select cron.unschedule('deskbot-v5-run');` (state is kept; re-schedule to resume) |
| Rollback code | — | Redeploy the previous `supabase/functions/deskbot-v5` from git |

## 7. Tests (22 Oct 2026)

**Passed, run locally (30/30):** primary success · timeout → fallback · 429 → cooldown + fallback · 5xx retried once · 401 not retried · 404 model removed · malformed JSON · disallowed enum values · daily cap · all providers down · no providers · RSS parse · rule HIGH detection · news gate modes/staleness · AI cannot downgrade HIGH → LOW · feeds down → rules-only · plus 15 engine tests.

**Passed live:** two concurrent runs → one refused by the lease · 4 RSS feeds fetched from Supabase with no errors · rules-only news read stored.

**Not executed:** real Groq/Gemini calls (blocked: no keys yet) · DB-outage and network-loss drills · multi-day soak.

**Soak plan:** run 7 days in `shadow` mode. Pass if there are no ERROR bursts (fewer than 10/day), the state is never older than 20 min, no duplicate trade ids, and AI calls stay under the caps. Before switching to `gate`, compare the R of trades taken during would-block windows against the rest.

## 8. Honest limits

- Free tiers can change or vanish. The bot is built to keep running rules-only if they do.
- Supabase free projects can pause after long inactivity with no API traffic. The 5-minute cron counts as activity, but check the Supabase dashboard occasionally.
- No free host guarantees 100% uptime. The watchdog and heartbeat make outages visible and short; they can't make them impossible.
- News labels are not a proven edge. They start in shadow mode for exactly that reason.

## 9. Chart + TradingView (added 22 Oct 2026)

- **Dashboard → Chart tab:** this is TradingView's open-source Lightweight Charts library (Apache-2.0). It draws only levels the bot actually uses: the daily EMA50 regime line, the ±3% gate lines, the 4H 55-bar breakout triggers, the Asian range, EMA20/50, the open position's entry/stop/TP1–3, and markers for every closed trade. Candles come straight from Hyperliquid in the browser, with Binance as the fallback, and refresh every 60 s.
- **Chart → TradingView toggle:** this is the free TradingView Advanced Chart widget. You can draw on it yourself; the bot can't draw on it, because the free widget doesn't allow programmatic drawings.
- **`pine/deskbot_v51_levels.pine`:** paste this into TradingView's Pine Editor and add it to a BTCUSDT chart. It draws the same regime gate, the 4H breakout levels and the Asian range, and marks HTF long/short signals. It also has alert conditions, so TradingView's own servers can send you alerts 24/7. I haven't compiled it here; if the Pine Editor shows an error, send it to me.
- **TradingView MCP server (community, e.g. `tradesdontlie/tradingview-mcp`):** this drives the *TradingView Desktop app on your PC* through a debug port, and an AI client (Claude) has to operate it. So it can't run 24/7 from GitHub or the cloud. It's optional for hands-on sessions on your laptop and is deliberately not vendored into this repo.
- **AI "predictions":** in walk-forward tests (docs/ML_REPORT.md), direction models trained on candles alone were coin-flip accurate out-of-sample. The chart therefore shows rule-based levels and the news-risk label, not an AI price forecast.

## 10. AI chat assistant (v5.4)

The dashboard has an **Ask the bot** button. It talks to the cloud bot, which answers with a free LLM (Groq first, then Gemini). It reads the live state, recent trades, backtests and news.

Setup: in Supabase → Edge Functions → Secrets, add
- `DESKBOT_CHAT_KEY`: any password you choose. The dashboard asks for it once and keeps it in your browser.
- `GROQ_API_KEY` (free at console.groq.com/keys) and/or `GEMINI_API_KEY` (free at aistudio.google.com/apikey).

Guardrails:
- The AI can only **propose** changes, and only to whitelisted keys inside hard bounds (`chat.ts` → `EDITABLE`).
- You press **Backtest** to compare current vs proposed on 180 days of candles, and **Apply** to use it. **Undo** restores the previous config; the last 10 configs are kept.
- It can never change leverage, the daily loss limit, risk per trade or paper mode, and it can never place orders.
- There is a cap of 150 chats a day (`CHAT_DAILY_CAP`).
