# Actual database schema (read from project xevymbzgpcsdhygswxlk, 28 Oct 2026)

Read-only inspection. The repo's `supabase/migrations/` holds 2 DeskBot files; the project has 7 DeskBot migrations. The rest of this schema (lease, watchdog, news, per-symbol columns, vault key RPC) exists only in the database, so **do not run the repo migrations against production** and treat this file as the reference until a replayable migration is written and tested against a scratch project.

Applied DeskBot migrations: `20261021235145 deskbot_v5_tables`, `20261022014652 deskbot_v5_cron_key_rpc`, `20261022015044 deskbot_v5_invoke_fn`, `20261022190738 dbv5_news_lease_watchdog`, `20261023065030 deskbot_v55_multi_book_symbol`, `20261024010437 add_agent_log`, `20261024023456 agent_log_rls_index_prune`.

## Tables (RLS enabled on all `dbv5_*`; no policies; anon/authenticated have table grants that RLS blocks; the edge function uses the service role)

| Table | Columns |
|---|---|
| dbv5_state | id text PK ('main' = BTC, 'gold'), state jsonb, last_run jsonb, updated_at timestamptz, **lease_until timestamptz, lease_owner text** |
| dbv5_trades | id text PK, symbol, strategy, dir, entry, exit_avg, net, r, fees, funding, open_t, close_t, reason, data jsonb (full trade incl. exits) |
| dbv5_equity | PK (symbol, ts); equity, upnl, price |
| dbv5_events | id bigserial PK, ts, kind, strategy, msg, data jsonb, symbol |
| dbv5_news | id, ts, risk, bias, event, reason, by, rule_risk, rule_hits, headlines, errors, mode |
| dbv5_backtests | id, ran_at, days, results jsonb |
| dbv5_agent_log | id identity PK, ts, symbol, agent, input_summary, output jsonb, provider, ms, error |
| rs_req / rs_kline / rs_funding / rs_feat | research data (not read by the runtime) |
| bot_state | retired v3 state, **RLS OFF, anon can read and write** (open finding) |

## Functions (all SECURITY DEFINER)

- `dbv5_lease(owner text, seconds int) → boolean`: one atomic `UPDATE dbv5_state SET lease_until, lease_owner WHERE id='main' AND (lease_until IS NULL OR lease_until < now() OR lease_owner = owner)`. One lease for both books. No fencing token.
- `dbv5_release(owner text)`: clears the lease only for the owner.
- `dbv5_watchdog()`: if `main` state is older than 20 min, calls `dbv5_invoke` and logs a WATCHDOG event.
- `dbv5_invoke(body jsonb) → bigint`: reads the cron secret from Vault and POSTs to the edge function via pg_net (60 s timeout).
- `dbv5_cron_key()`: reads `deskbot_cron_secret` from Vault.

## Cron (pg_cron)

`deskbot-v5-run` `1-59/5 * * * *` · `deskbot-v5-watchdog` `*/15 * * * *` · `deskbot-v5-prune-agents` `11 3 * * *`. The repo's migration also schedules a weekly backtest and a daily prune that are **not** present in the database.

## Known gaps

1. `bot_state` is world-readable and writable by the anon key.
2. Two duplicate indexes on `dbv5_agent_log` (`_ts_idx`, `_symbol_ts_idx` duplicate `_ts`, `_sym`). A DROP was attempted and needs the owner's approval.
3. Persistence per run is several separate REST writes (trades upsert → state patch → equity upsert → events insert → agent log). A crash between them leaves partial writes. Trades are idempotent (deterministic id + upsert) and state replays from `lastBarT`, so the practical risk is duplicate or missing event rows, not a wrong balance. There is no transaction and no fencing token; a run longer than the 120 s lease could overlap the next one.
