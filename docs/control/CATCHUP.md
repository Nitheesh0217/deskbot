# Missed-bar catch-up (owner decision, 29 Oct 2026)

**Problem (coverage audit D5).** The live loop evaluates only the newest closed 5m bar. When a cron run is late or fails, a 15m/1H/4H/daily close can be skipped and a setup on it is never seen. In the 7 days to 29 Oct the BTC book had 4 gaps over 10 minutes (worst ≈ 2 h 58 m); the gold book had none.

**Policy.** On every run, when the book is flat and the newest bar produced no signal, boundary bars skipped since the last evaluation (at most one hour back) are re-evaluated with the same `snapshot()`/`evaluate()` the live loop and backtest use. `snapshot(S, j)` only sees bars closed at or before bar j, so there is no look-ahead (tested by removing the future from the series). A setup found there is entered now, at the current price, only if all hold:

- the stop was not touched after the signal bar,
- the first target was not already reached,
- price is within ±0.25R of the signal's reference price,
- the stop distance is 0.75–1.25× the original (size follows the stop distance, so risk per trade is unchanged).

Otherwise a `MISSED` event records the setup and the reason. Catch-up entries pass every normal gate (circuit breaker, daily limits, approval, news), carry `CATCH-UP: …` in their reasons, and their decision record stores `dataAvailability.catchUpFromT` so `replay_decision` reproduces them exactly (tested end to end through the handler).

**Switch.** `CATCHUP=on` (default) | `shadow` (record valid catch-ups as MISSED events, never enter) | `off`.

**What it does and does not do.** It brings live trading closer to what the backtest already does (the backtest evaluates every bar). It does not add a strategy, change a rule or raise risk, and it cannot make a losing strategy profitable. The macro scan used live funding/OI for the skipped bars (they are not stored per bar); this only matters to filters that read them.
