# Trading Tower (dashboard view)

The first tab draws DeskBot as a systematic trading firm: eight departments, 23 staff, a nine-step decision workflow, an experiment board and the portfolio's own equity. The departments are logical roles modelled on how systematic firms publicly describe their process (data, research, portfolio construction, risk, execution, operations). They are not a claim about any firm's floors.

| Floor | Department | Staff (software agents) | Real data behind each line |
|---|---|---|---|
| 8 | Operations & review | Auditor, Post-trade reviewer, Config auditor, Experiment officer | decision-record errors, `desk-postmortem` rows, config fingerprint, FILTER-1 report |
| 7 | Execution | Paper execution trader, Position manager | entry fill, cost model from config, open position plan |
| 6 | Risk management | Risk controller, Risk planner, Independent checker | breaker/limits, `risk` and `validator` rows |
| 5 | Portfolio management | Allocator, Evaluation service, committee (analyst, skeptic, supporter, judge — AI, advisory) | latest candidates and action, live-config backtest, `desk-*` rows |
| 4 | Strategy desks | Setup scout + Trend / Breakout / Reversal / Mean-reversion desks (11 strategies) | per-strategy operational state and current candidates |
| 3 | Quantitative research | Offline researcher + five research desks | proposed hypotheses (order flow, volatility, catalyst, relative value) are labelled **PROPOSED · NOT AN EDGE**; signal quality runs FILTER-1 |
| 2 | Market intelligence | Market structure, Zone mapper, Catalyst analyst | `last_run.desk.chart`, zones, news |
| 1 | Data infrastructure | Evidence steward, Price feed, Derivatives data | run age, feed name, price, fingerprint, provenance status (steward turns amber when a check fails) |

**Workflow strip**: evidence steward → specialist desks → catalyst analyst → skeptical reviewer → evaluation service → portfolio allocator → risk controller → paper execution & auditor → offline researcher. The replay animation lights each step as its packet moves. Numbers, sizing, permissions and state transitions stay in code; language models only summarise and criticise, and only the judge's verdict is scored (FILTER-1). Agreement between AI roles is not counted as evidence.

**What is not shown**: no predicted prices, no win probabilities, no profitability claims. "Not reported" means the runner returned nothing. The account is paper; no funded orders.

Files: `web/tower-model.js` (pure model; `tests/tower_model.test.ts`), `web/tower.js`, `web/tower.css`. Browser smoke with mocked network (fixture agent rows and experiment numbers are test data): `node scripts/web_smoke/tower.cjs fixture.json outDir`.
