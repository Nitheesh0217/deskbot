# Frozen spec: real funding in research, and a funding-crowding filter (written 2026-11-15, before any result was seen)

Source of the idea: LumiBot (Lumiwealth/lumibot, GPL-3.0) charges historical perpetual funding at each real settlement and reports missing funding as missing, not zero. Ideas only; no code is copied.

## Data
Binance USD-M `BTCUSDT` funding settlements, 2023-09 to 2026-10, from the public archive `data.binance.vision`. All 38 monthly files were checked against their published SHA-256 (`research_data/funding_BTCUSDT_binance.SHA256SUMS`).
**Limit:** the live book trades Hyperliquid, which settles funding hourly. Binance's 8-hour rate is a proxy, used as rate ÷ interval hours per hour.

## Part 1: real funding (measurement, not a challenger)
`--funding <csv>`: each 5m bar is charged the hourly rate from the last settlement at or before the bar, through the engine's existing `fundingPerHour` parameter (positive = longs pay). The flat assumption `BT_FUNDING_PER_HOUR` = 0.00125%/h is used only when no settlement is known. The run states how many bars fell back to it.
The BASE identity check still runs on the flat assumption. Report BASE flat vs BASE real-funding for each strategy still enabled (HTF_TREND, VWAP_REVERT, D_THRUST, D_BEARTRAP) on BTC.

## Part 2: variant FUND_CROWD (entries only, all with real funding)
Skip a **long** signal when the latest settled funding rate is at or above the 90th percentile of the previous 90 settlements (about 30 days). Skip a **short** signal when it is at or below the 10th percentile. Only settlements at or before the signal bar's close are used. Fewer than 90 prior settlements: no filter. These thresholds are fixed and will not be tuned.

Decision rules as in `docs/research/2026-11-10-layer-agreement/SPEC_FROZEN.md`, evaluated with real funding at 1× and 1.5× other costs:
- ADOPT-CANDIDATE (shadow lane first) needs all of: ≥ 30 trades; R per trade > 0 at 1.5×; net R improves at 1× and 1.5×; the 90% block-bootstrap interval of ΔR is above 0; max drawdown not worse.
- REJECT otherwise.
