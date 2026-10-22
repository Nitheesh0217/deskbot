# DeskBot v5 risk rules

All values live in `CFG` in `engine.ts`. Live overrides are stored in `dbv5_state.state.cfg` and applied at the start of every run, so settings change without a redeploy.

## Position sizing

- Risk per trade = equity × tier × strategy scale × probation multiplier.
  - Tier (kept from v4): 2% under $500, 1.5% under $1,000, 1.2% under $3,000, 1% above.
  - Strategy scale (`RISK_SCALE`): 1 = full, 0.25 = evidence-gathering size, 0 = off.
  - Probation: after 10 live trades with negative average R, the strategy trades at half size.
- Quantity = risk ÷ (stop distance + round-trip cost per BTC), so a full stop-out loses about the risk amount **including** fees and slippage (v4.3 sized before costs).
- Notional is capped at 5× equity.

## Gates (checked before every entry)

| Gate | Rule |
|---|---|
| One position | Only one position open at a time |
| Score | Setup score ≥ 72 (heuristic ranking, not a probability) |
| Circuit breaker | 3 losses in a row → 4-hour cooldown (v3/v4 needed a manual `resetCB()`) |
| Daily trades | At most 6 entries per UTC day |
| Daily loss | No new entries after −5% on the UTC day |
| No repeats | A signal bar can be acted on once |
| Auto-disable | After 20 trades, a strategy averaging worse than −0.15R is switched off |

## Exits

- Targets in R multiples per strategy. Partial exits on **original** quantity: 50% / 25% / 25% (v4.3 convention).
- After TP1 the stop moves to entry; after TP2 it moves to TP1.
- Research strategies (D_BEARTRAP, D_THRUST) use a single 2R target, as tested in `research/RESULTS.md`.
- Every strategy has a maximum hold time and is closed at market when it expires.
- Position management walks **1-minute** bars between runs. If a bar touches both the stop and a target, the stop is assumed first.

## Cost model

| Cost | Value |
|---|---|
| Taker fee (entries, stops, time exits) | 0.045% |
| Maker fee (take-profit limits) | 0.015% |
| Slippage on market fills | 0.02% |
| Funding, live | Hyperliquid hourly rate, charged or credited every hour held |
| Funding, backtest | 0.00125% per hour, always charged |
