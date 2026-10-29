# Release v20: agentic committee, multi-market scanner, options/futures context

## Backend (edge function `deskbot-v5`)
- Desk review rebuilt on the TradingAgents structure: deterministic analyst team + trade memory, then optional free-LLM bull/bear debate (`DEBATE_ROUNDS`), research manager, trader, aggressive/conservative/neutral risk debate (`RISK_ROUNDS`) and portfolio manager. Advisory only; runs after state and ledger are saved.
- FILTER-1 AI arm now scores the PM's 5-tier rating mapped onto the trade direction (spec amendment 1, made with 0 verdicts recorded).
- New `{"action":"scan"}`: the bot's own rules run read-only on all ten Hyperliquid perps, plus Deribit options (DVOL, put/call OI, max pain, put−call IV) and futures basis. Stored in `dbv5_scans`; latest scan in public status as `scan`.
- Status returns up to 200 agent rows (was 60) so whole committees are visible.

## Database
- `20261029_market_scans.sql`: table `dbv5_scans` (RLS on; service_role select/insert). Applied live 29 Oct 2026 via SQL.
- pg_cron `deskbot-v5-scan` (7-59/15) and `deskbot-v5-prune-scans` (daily, 14 days): scheduled only after the v20 function is live.

## Dashboard
- Grouped navigation (Live / Analysis / Records), new Scanner and Committee views, trading-state pill (ACTIVE / REDUCING / HALTED, a view of existing controls), seven committee seats in the tower.

## Unchanged
Strategies, configs, sizing, risk limits, balances, positions and trade history. A_COSTR50 and B_BE_TP1 stay rejected. Paper only.

## Verification
Local: typecheck, 203 unit tests, browser smokes (scanner, tower, markets) on desktop and mobile with mocked network. Live checks after deploy are recorded below.
