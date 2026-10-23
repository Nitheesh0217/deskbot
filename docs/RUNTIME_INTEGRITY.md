# Runtime integrity upgrade — 5.6.1

This patch changes paper accounting/execution assumptions. Prior backtests do not validate the new version. It contains no real-order integration.

## Changes

- POST requests execute serially within an edge isolate so the shared engine configuration and ML asset flag cannot change midway through another request. GET status uses a pure configuration resolver. The existing database lease is still required across isolates; this patch does not replace its missing migration or add fencing/transactional state persistence.
- Each book hashes `{version, symbol, config}` with canonical key order and SHA-256. The complete resolved configuration is hashed, including costs, model and risk maps. New entries require an exact match with `DESKBOT_BTC_CONFIG_HASH` or `DESKBOT_GOLD_CONFIG_HASH` (other books use their symbol in the same variable name). Missing/malformed/mismatching values pause new entries. Position management remains active. GET status, run responses and last_run report the hash and approval result.
- A backtest returns its own configHash. A hash proves configuration identity, not profitability. A one-strategy (`only`) backtest is not evidence for a multi-strategy portfolio even if configuration hashes match. Review the run scope and all evaluation evidence too.
- Gold sets the ML asset flag explicitly. Approval binds the asset as well as the engine version, so BTC approval cannot authorize GOLD.
- Moved stops take precedence over later targets when OHLC cannot establish their ordering. This is a conservative ambiguity policy, not tick reconstruction. A candle starting before entry uses only its closing observation and excludes pre-entry extremes. Genuine intraminute touches in that entry candle can consequently be missed; exact replay requires post-entry ticks.
- Maximum drawdown now incorporates sampled marked equity at bar closes and live snapshots. It is not tick-level maximum drawdown. New marked daily breaches latch until the next UTC day; recovery in the same day does not clear the latch. Legacy historical intratrade drawdown cannot be reconstructed from existing state.
- Historical replay manages the final bar before end-of-test liquidation and records sampled marked equity in its curve. Cloud backtest reports use this marked maximum drawdown. The standalone summarize(trades) helper still only has completed-trade data.
- Heartbeat checks initialized BTC/GOLD books independently and flags configuration failure. Its schedule is every 10 minutes with a 20-minute freshness threshold. GitHub scheduling/delivery delays are possible, and email delivery must be verified independently.
- Package versions are pinned and lockfile committed. CI uses npm ci, runs every test file and typechecks all edge-function modules.

## Deployment sequence

1. Obtain access to the existing project; inspect actual deployed code/schema/cron/lease definitions. Do not run incomplete committed migrations over production or replace the existing state from a sample.
2. Record a state/config backup and the currently deployed revision. Resolve the known drift: the audit snapshot enabled SWEEP_REV, SESSION_BO and VWAP_REVERT at scale 1, while the displayed LIVE_CONFIG_v5.1 backtest used 0; TREND_MTF was 1 rather than 0.5. The BTC and GOLD settings must be reviewed separately. This patch does not automatically rewrite them.
3. Review the diff and tests; deploy 5.6.1 to a paper/staging environment. Leave the configuration-hash variables absent initially. New entries will be paused and existing positions still managed. Confirm the reported runtime version and per-book health.
4. Replay the reviewed intended configuration with the new code and obtain a saved full-portfolio result for each instrument. Confirm data source, costs, period, rejection/halt rules, marked drawdown and uncertainty. Re-run on independent periods; do not approve a configuration merely because one result or one live trade was profitable.
5. Only after reviewing the evidence, set each book's hash environment variable to the corresponding backtest configHash. Never blindly copy the current runtime hash: that could approve the same drift this guard is intended to detect. Confirm the runtime cfg exactly matches the tested settings and integrity.approved is true.
6. Change a setting in staging and confirm approval becomes false, new entries stop, existing positions continue to be processed, and the dashboard/heartbeat expose the problem. Restore and reapprove the reviewed state. A version or model/parameter change requires a new review/hash.
7. Check both books after several scheduled runs and verify the independent heartbeat actually runs and delivers a test failure notification. Continue prospective paper validation with code/config frozen.

Chat Apply/Undo can still update allowed settings, but cannot change approval secrets. A changed hash therefore pauses entries until the new configuration is separately reviewed and approved. Position management uses the current configured exit policy; this patch does not pin per-position execution config.

## Rollback

Keep new entries disabled while investigating a failed deployment. Record the current position, ledger and config, then redeploy the previously recorded working revision using the owner's normal deployment workflow. An older revision does not enforce fingerprint approval, so it must not be resumed with the drifting configuration. Reconcile open positions and review its entry settings before resuming. Preserve current trade history and equity; restoring an old state backup over newer fills would invalidate accounting. Keep 5.6.1's optional marked fields for audit even if an older engine ignores them.

## Validation

Run `npm ci`, `npm test` and `npm run typecheck`. Tests cover configuration identity, request serialization/recovery, read-only status, unapproved runs continuing exits, long/short and HOLD moved-stop ambiguity, pre-entry candle extremes, marked daily latching and per-book heartbeat. All network and database operations in the edge-handler regression are mocked; no real database outage drill or market-history replay is claimed.

## Still outstanding

Transactional/fenced database writes, reproducible current schema, strict feed freshness/venue identity, complete long-outage backfill, exact historical funding, liquidity-aware maker fills, and a fresh multi-period/prospective strategy evaluation remain separate work. Current Supabase project access was denied during implementation, so this patch has not been remotely deployed or tested against the live database.
