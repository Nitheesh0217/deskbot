# Chart zones and the trade-setup view

What you see on the dashboard **Chart** tab and in the open-trade card:

- **Trade setup**: when a trade is open, a drawing of the bot's recorded plan: entry line, a **red block** from entry to the original stop loss, and **green blocks** for TP1, TP2 and TP3 (with the R multiple of each). The same red/green boxes are drawn on the chart from the bar where the trade opened. If the manager moves the stop, the red block still shows the original risk and a dashed line shows the moved stop.
- **Structure checks at entry** (n of m): a checklist of rule items on 15m candles as of the entry time (bullish/bearish FVG or IFVG at the entry, order block at the entry, discount for longs or premium for shorts, value area, swept equal highs/lows, last structure break, TP1 at least 1R away). It counts rules; it is **not** a win probability.
- **Layers** (toggle, remembered in your browser): focus on trade, trade box, FVG, IFVG, order blocks, value (POC/VAH/VAL), premium/discount midpoint, BOS/CHoCH markers, liquidity (equal highs/lows).

## Definitions (all from CLOSED candles, fixed rules, in `supabase/functions/deskbot-v5/zones.ts`)
| term | rule |
|---|---|
| FVG | three-candle gap: candle 3 low above candle 1 high (bull) or high below low (bear), at least 0.25 ATR tall; kept until a candle closes through it; shows how much of it price has traded into |
| IFVG | an FVG that a candle closed through; it stays as a zone with flipped polarity until a candle closes back through the other side (this is how "inverse FVG" is read here; if you meant a different SFVG, tell me the definition) |
| Order block | last opposite-colour candle within 6 bars before a displacement candle (body at least 1.2 ATR) that closed beyond the last swing; removed when a candle closes through it |
| BOS / CHoCH | close through the last confirmed swing high/low: continuation = BOS, against the prevailing direction = CHoCH |
| Premium / discount | position of price versus the midpoint of the latest completed swing range |
| Value | 24-bin volume profile over the last 240 candles; POC = heaviest bin; value area = 70% of volume grown outward from the POC |
| Liquidity | equal highs/lows (within 0.1 ATR) among recent swings; "swept" when a later wick pierced and the close came back |

## What this is not
It does not predict the exact movement of the market and draws no forecast path. Zones are places where these rules say price may react; price can ignore, cut through or reverse before any of them, and the bot's entries still come only from its strategy rules. Drawing a zone does not change entries, stops, targets, sizing or risk. Zone quality has not been tested for profit; if you want that, it needs a frozen-protocol experiment like the earlier challengers.

## Where the code lives
`zones.ts` (one implementation) is used by the edge function (desk agent log: `lastRun.desk.chart.zones`, per 15m/1H/4H) and compiled to `web/zones.js` for the dashboard (`npm run build:web`; a test fails if it is stale). Drawing helpers: `web/setup.js`. Browser smoke test with mocked network and real historical candles: `scripts/web_smoke/`.
