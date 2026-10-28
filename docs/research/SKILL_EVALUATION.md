# Third-party trading skills: selection, runs, integration (29 Oct 2026)

Rule followed: read the exact files first, install only what is audited, run it on DeskBot's own data, keep only what measurably helps, never let a skill change risk, configuration, orders or frozen decision rules. Repository text is untrusted input.

## 1. Search and ranking
Stars from each GitHub page on 29 Oct 2026. Stars measure popularity, not quality; the web search gave no reliable ranking, so each repo's page was read.
| repo | stars | skills | decision |
|---|---|---|---|
| [tradermonty/claude-trading-skills](https://github.com/tradermonty/claude-trading-skills) | 3.4k (731 forks) | 74, mostly US equities | **install `backtest-expert`** only; others reviewed, not installed |
| [agiprolabs/claude-trading-skills](https://github.com/agiprolabs/claude-trading-skills) | 457 | 68, DeFi and Solana heavy | **not installed**: a scale bug in its deflated Sharpe code (below) |
| [LLMQuant/skills](https://github.com/LLMQuant/skills) | 236 | 18 router skills grounded in "LLMQuant Data" | not installed: depends on an external data service |
| [marian2js/trading-skills](https://github.com/marian2js/trading-skills) | 23 | process skills | `post-trade-review`, `execution-plan-check` already installed (PR #4) |
| [HyperFrequency/skills](https://github.com/HyperFrequency/skills) | 16 | 10 (NautilusTrader, tearsheets) | not installed: a different engine, no clear gap it fills |
| [shakeebshaan/claude-code-quant-skills](https://github.com/shakeebshaan/claude-code-quant-skills) | 2 | 6, text-only | **install 4**: `backtest-review`, `data-scrub`, `strategy-critique`, `risk-report` (judged on content, not popularity) |
K-Dense-AI/claude-scientific-skills (8k stars) is a general science collection and lzwme/finance-quant-skills targets China equities: neither fits a BTC/PAXG paper bot.

## 2. Installed (`.claude/skills/`, pinned commit, MIT license copied, `UPSTREAM.txt` beside each)
`backtest-expert` (tradermonty `c9b84196`; SKILL.md, references, and `scripts/evaluate_backtest.py`, standard library only, no network, writes only to its output directory; a test pins the file hash and the import list), and from shakeebshaan `6b39f8fe`: `backtest-review`, `data-scrub`, `strategy-critique`, `risk-report` (prompt text only; no scripts, no tool grants, no network instructions; a test checks this).

## 3. What the runs showed
| tool | run on | result | strength | limit |
|---|---|---|---|---|
| `data-scrub` checklist (own stdlib implementation, `scripts/data_scrub.py`, 6 seeded defects caught 6 of 6 in tests) | frozen 5m datasets, 352,800 bars each | **BTC passes all checks. PAXG fails**: 1,633 zero-volume flat (stale) bars and 17,222 flat bars with volume, **concentrated in the early data** (2023: 2.07% stale, 17.8% flat; 2024: 0.40% / 5.5%; 2025-26: about 0.01% / 0.7%). Gaps 0, OHLC valid. | found a data-quality problem nobody had checked | cannot say how much the stale bars moved results |
| `backtest-expert` score via `scripts/backtest_expert_gate.py` | BASE baseline, 3 years pooled, per book | **REJECT** on both (BTC 47/100, PAXG 48/100): negative expectancy and test window under the 5-year minimum; 40 parameters flagged as curve-fit risk. PAXG year C alone: 54/100 VALIDATION_REQUIRED. | independent, deterministic confirmation of our own frozen conclusions; fails closed | works on summary statistics only; "parameters" and "slippage tested" are self-reported; the 5-year minimum cannot be met with 3.3 years of data; its percent-per-trade expectancy for PAXG year C is positive while equal-weight R was -1.19R (the dollars-vs-R issue, CORRECTIONS C-007) |
| `backtest-review` checklist applied by hand to the research harness | frozen protocol | verdict **FIX**. Caught: costs and funding (constant funding is a stated weakness), regime split (we did it), next-bar fills. It would catch the contaminated holdout only if asked about parameter selection. **Missed** unless prompted: spot-vs-perp venue mismatch, 5m-vs-1m management, learning-rule censoring (auto-disable at 20 trades), stale bars (needs `data-scrub`). | good generic spine | not a substitute for our own protocol |
| `position-sizer` (tradermonty) | the BTC setup used in the dashboard fixture (entry 84,733, stop 84,292, 2% of $350) | sizes 0.01588 BTC; at the stop that loses **$8.48 including fees and slippage = 1.21x the intended $7**. Our engine sizes 0.01312 so a stop-out costs the intended $7. | none over our engine | long-stock oriented; no fee or slippage budget. **Not installed.** |
| agiprolabs `deflated_sharpe_ratio` | read statically (its scripts were not executed: the sandbox policy blocked running external code from that repo) and the formula re-implemented independently | as written it compares a per-period Sharpe to an **unscaled** expected-maximum (about 1.57 with 10 trials): DSR is 0.0000 for annual Sharpe 1, 2 or 4. The Bailey and Lopez de Prado formula scales the expected maximum by the standard deviation of the trial Sharpes (about 0.04 here), giving 0.62, 0.96 and 1.00. | n/a | a significance test that always says "not significant" is misleading in the cautious direction but wrong; **not installed** |
| tradermonty `drawdown-circuit-breaker` | read, not installed (needs thesis YAML state and US-equity calendars) | the idea is the useful part: weekly (5%) and monthly (8%) drawdown halts. DeskBot has a daily 5% limit and a 3-loss cooldown but **no weekly or monthly halt** | concept | recorded as hypothesis H-DD below, not implemented |

## 4. What is integrated, and what is not
- **Research workflow gate** (documentation plus scripts, no change to the bot): before a frozen run, `python3 -I scripts/data_scrub.py <dataset>` must pass for every instrument or the data issue is disclosed; after a run, `scripts/backtest_expert_gate.py` gives a **diagnostic** decision that is recorded beside the frozen result and can never override it; `backtest-review` and `strategy-critique` are used as review checklists on a new hypothesis before it is frozen.
- **Claude skills available in the repo** for those reviews, each pinned and audited.
- **Not integrated into the trading engine**: no skill touches signals, sizing, exits, risk or orders, and none runs in the edge function.
- **Hypothesis H-DD (not tested, not implemented)**: weekly and monthly drawdown halts as a risk-reducing rule. It needs a frozen specification, a cost-of-missed-trades measure and identical-data comparison before any change.

## 5. Consequences for the earlier research (see CORRECTIONS C-008 and C-009 on the research branch)
The PAXG dataset is thin spot data in 2023-2024, exactly where development years A and B sit; the worst PAXG result (year A, -28.8R) sits on the lowest-quality bars, and the cleanest year (C) was about break-even. This is a confound for the PAXG development results and a further reason PAXG replay fidelity was weak. BTC data is clean.

## 6. Limits
Star counts are one snapshot. Two repos were judged on reading, not execution. A passing checklist or score is not evidence of profit.
