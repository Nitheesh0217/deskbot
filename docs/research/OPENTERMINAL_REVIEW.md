# OpenTerminal review and integration (29 Oct 2026)

Source: [ErTasselli/OpenTerminal](https://github.com/ErTasselli/OpenTerminal) at `aed097c680cd8ec1c391ae06966babe7d6d91fc6`, MIT License, about 2.1k stars. A Next.js + Express "terminal" dashboard built on free public market data. It was cloned into an isolated scratch directory and read; none of its code was executed or installed.

| OpenTerminal feature | Decision for DeskBot | Where |
|---|---|---|
| `lib/indicators.ts` (SMA, EMA, VWAP, RSI, MACD, Bollinger) | **Ported** (MIT, attributed) to plain JS; Bollinger rewritten with rolling sums and tested equal to the original formula | `web/indicators.js`, chart workspace toggles and panes |
| Hover legend (OHLC, volume, every active indicator under the cursor) | **Adopted** | chart workspace (`#hoverLegend`) |
| ⌘K command palette | **Adopted, re-scoped**: DeskBot commands (views, books, timeframes, indicators, layers, every tower employee, replay, motion) instead of symbol search; Alt+1…9 view shortcuts | `web/palette.js` |
| Top bar clocks, market-open state, per-feed latency | **Adopted**, plus trading sessions (Asia, London, New York) because session strategies depend on them | Markets tab |
| Crypto board (CoinGecko markets + 7-day sparkline, BTC/ETH dominance, Binance fallback) | **Adopted**, with the bot's books (BTC, PAXG) highlighted | Markets tab, `/api/feeds?k=crypto` |
| Macro (FRED public CSV: Treasury yields, VIX) | **Adopted**, plus the broad dollar index, the Fed funds upper bound and the 10Y−2Y curve | `/api/feeds?k=macro` |
| Economic calendar (Forex Factory weekly JSON) | **Adopted** (schedule, impact, forecast, previous). The FRED "actual" backfill was left out for now | `/api/feeds?k=calendar`; tower catalyst analyst shows the next high-impact event |
| News (RSS, de-duplicated by normalised title) | **Adopted** for BTC, gold and macro queries; links kept only if https | `/api/feeds?k=news` |
| Flash on change | **Adopted** (green/red flash on price ticks) | Markets tab |
| Stale-while-revalidate cache | **Adopted** as Vercel CDN `s-maxage` + `stale-while-revalidate` per feed | `web/api/feeds.js` |
| Equity quotes, screener, heatmap, options, insider (Nasdaq, TradingView scanner, Yahoo, SEC) | **Not adopted**: US equities are outside DeskBot's two books; several endpoints are unofficial/reverse-engineered | — |
| Portfolio tracker (SQLite) | **Not adopted**: DeskBot's paper ledger is the source of truth | — |
| AI assistant (Anthropic key) | **Not adopted**: DeskBot keeps its own optional free-provider assistant | — |
| react-grid-layout drag-and-drop widgets | **Not adopted**: the site is dependency-free static HTML; a fixed responsive grid was used | — |

## Safety of the proxy
`web/api/feeds.js` is a Vercel serverless function. The browser can only choose a feed **name** from a fixed list (`calendar`, `news`, `macro`, `crypto`). No URL, host or free text from the request reaches an upstream fetch, so it cannot be used as an open proxy or for SSRF. Responses are parsed into JSON with length limits, never relayed raw; RSS markup is stripped and non-https links are dropped. Tests: `tests/feeds_api.test.ts` (allowlist, ignored URL parameters, parsing, fallbacks, 502 on upstream failure).

## What this does not change
Nothing on the Markets tab, nor any indicator, reaches the trading engine. They are context for the reader. The data is public, delayed or indicative, and not execution-grade.
