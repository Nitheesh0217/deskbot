# Trading Tower (dashboard view)

The first tab of the website draws the desk as a building: eight floors, nineteen staff, one desk per strategy, a lift and message packets that replay how the latest 5-minute check moved from desk to desk.

**What is real.** Every line a staff member shows is copied from the public status the runner returns (`last_run`, the agent log, state, integrity, the equity series). A missing field reads "not reported". Status dots mean: green = reported activity in the last 30 minutes, grey = idle, hollow = off or no provider, amber = alert. The growth panel is the paper account's own equity, losses included. The live BTC price in the header is a direct public price read for display only.

**What is not.** The staff are software agents (fixed rules in the cloud runner, plus optional free-AI roles that are advisory only and cannot place, size or block a trade). Names and faces are labels for roles. Nothing on this page predicts price, estimates a win probability or certifies profitability. The account is paper; no funded orders.

Files: `web/tower-model.js` (pure model, tested in `tests/tower_model.test.ts`), `web/tower.js` (DOM + motion, respects `prefers-reduced-motion` and has a Motion off button), `web/tower.css`. Smoke test with mocked network: `node scripts/web_smoke/tower.cjs fixture.json outDir`; its agent rows are test data.

Also merged here: the spatial-glass skin (previously deployed by direct upload), the trade setup view and chart zones (PR #4), strategy coverage and the Strategies tab (PRs #5, #6).
