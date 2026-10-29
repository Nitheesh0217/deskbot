# CALL-1: one directional call per market, scored 4 hours later

Frozen 29 Oct 2026, before any call was scored. A change to the rule below starts CALL-2, and CALL-1's rows stay as they are.

## The call (code: `scan.ts marketCall`, every 15-minute scan, all 10 markets)
- votes = SuperTrend direction on 15m + 1h + 4h (each +1 up / −1 down) + VWAP side (+1 above +0.5σ, −1 below −0.5σ, else 0), range −4..+4.
- If one of the bot's strategies fired on that market, the call is that setup's direction (source "rules setup").
- Otherwise LONG at votes ≥ +3, SHORT at ≤ −3, else NO CALL (not recorded).
- Cautions are shown and never change the call: RSI15 stretched in the call's direction (≥75 / ≤25), funding crowded in its direction (≥0.01%/h).
- At most one open call per market. The next call is recorded only after the previous one is scored.

## Scoring (code: `track.ts scoreCall`, table `dbv5_calls`)
- Price at the call = the signal bar's close. Outcome = the close of the first 5m bar at or after call time + 4 h.
- Right = price moved in the called direction (no move counts as wrong). The move is also recorded in % and in ATR15 units.
- Before costs. It measures direction, not a tradeable P&L. Trade P&L for setups is in the separate forward record (`dbv5_scan_signals`).
- Rows are written before the outcome exists. A trigger forbids deleting a row or changing a scored one.

## Reading the record
- Under 30 scored calls for a market: "collecting". With 30 or more: "CALLS AHEAD OF MARKET" if the 95% bootstrap lower bound of the mean ATR move is above 0, else "NO EDGE YET".
- 50% right is a coin flip. Calls on one market overlap in time and correlate with each other and with other crypto markets, so the interval is optimistic. Treat it as a screen, not proof.
- Nothing here trades. A market whose calls stay ahead after costs is a candidate for further work; the owner decides.
