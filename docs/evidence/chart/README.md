# Chart plan screenshots: SYNTHETIC candles
Taken by `scripts/web_smoke/chart_plan.cjs` against build `b6aa004` (mocked network, Chromium, 1360×900 desktop and 390×844 phone).
- The position levels are the **stored plan** of BTC HTF_TREND short V5-1793318461202 (record D-V5-1793318461202).
- The candles and the open time are **synthetic**, so the time-exit date shown differs from the real one (real: 2026-11-20 00:01 UTC).
- Every image carries a red banner with the build SHA.

| File | State |
|---|---|
| `chart_price_*.png` | Price-action view (default): entry, current price, stop; reference levels off |
| `chart_plan_*.png` | Full-plan view: all targets in range, plan table |
| `chart_error_*.png` | Candle source blocked: error message on the chart; the plan table still renders from the stored position, without the current price |

Smoke result for this build: loading placeholder present in the static page; 0 console/page errors; no horizontal page scroll on either viewport; 6 plan rows (5 in the error state, no current price).
Exit sizes follow the executor (`engine.ts fill`): each target closes up to a cumulative share of the ORIGINAL quantity (50% → 75% → 100%); the table shows "25% of original → 75% closed". An earlier partial close makes the actual fill smaller.
