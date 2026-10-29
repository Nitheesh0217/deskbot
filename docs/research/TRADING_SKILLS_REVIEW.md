# Trading-skill repository review

Reviewed October 28, 2026 against actual upstream files through GitHub. These are source-level, selected-skill reviews, not complete security audits of every script or independent performance tests. No plugin, skill or upstream script was installed or executed. Instructions in upstream documents were treated as data. No implementation was copied from these projects.

## Recommendation

Keep DeskBot's engine as the evaluator. First adopt the *method* of reconstructing original plans and separating outcome from execution quality. Add input/accounting evidence before introducing a new agent SDK or strategy framework. Review exact auxiliary scripts and referenced resources before executing any selected skill. Markdown guidance cannot enforce risk or replace a deterministic veto.

| Project | Pinned revision | Root license inspected | Selected files read | DeskBot decision |
|---|---|---|---|---|
| [Jakeschincariol/trader-skill](https://github.com/Jakeschincariol/trader-skill/tree/5189e79b9a480755a3733ac9713f5353981dbe18) | 5189e79b9a480755a3733ac9713f5353981dbe18 | MIT | README.md, trader-risk/SKILL.md, trader-broker/SKILL.md | Useful exact-order approval pattern; equity-oriented, not a BTC/PAXG prediction engine |
| [tradermonty/claude-trading-skills](https://github.com/tradermonty/claude-trading-skills/tree/c9b84196a44a56a553293114fdae1f30bdd08c58) | c9b84196a44a56a553293114fdae1f30bdd08c58 | MIT | skills/data-quality-checker/SKILL.md, skills/signal-postmortem/SKILL.md | Research references; do not mistake advisory document checks for candle validation |
| [marian2js/trading-skills](https://github.com/marian2js/trading-skills/tree/f1ae7d481154b49192681187cb08d39d7e2d4524) | f1ae7d481154b49192681187cb08d39d7e2d4524 | MIT | README.md, skills/review-learning/post-trade-review/SKILL.md, skills/trade-construction/execution-plan-check/SKILL.md | Best immediate process reference for plan/execution/lesson records |
| [agiprolabs/claude-trading-skills](https://github.com/agiprolabs/claude-trading-skills/tree/981e1d736cdc02bdc1c55c74ec9224e956414706) | 981e1d736cdc02bdc1c55c74ec9224e956414706 | MIT | skills/position-sizing/SKILL.md, skills/walk-forward-validation/SKILL.md | Selective reference only; quantitative examples require independent corrections |
| [anthropics/financial-services](https://github.com/anthropics/financial-services/tree/574ed3624aebd0418c7e96cd101262f30210ab26) | 574ed3624aebd0418c7e96cd101262f30210ab26 | Apache-2.0 | README.md, LICENSE | Official finance-workflow patterns; not a BTC execution engine or reason to add paid connectors |

Root license identification is not a full transitive license/compliance review. Referenced auxiliary code and nested licenses still need review before incorporation. Revisions are discovery pins, not a promise of unchanged upstream behavior.

## Findings that change the supplied resource map

### trader-skill: broker code versus agent permissions

The source contains the described 11 skill directories. Its README advertises a marketplace install and describes plugin namespaced commands. The inspected broker instructions distinguish ticket.py (no broker communication) from the agent's subsequent connector order call. Installing the skill can therefore guide an agent toward execution tools even though the Python renderer itself submits nothing. Retain a read-only tool allowlist; do not expose those tools to DeskBot research workers. Current installation commands were read, not run or independently tested against a Claude client.

Its SEC, 13F, congressional-disclosure and NYSE workflows are primarily U.S. equity research. They do not supply real-time BTC/PAXG order flow, exact XAUUSD execution or a validated intraday edge. Preserve broker approval as a future design concept rather than adding a connector now.

### TraderMonty: data-quality means documents here

The selected data-quality skill checks price scale, instrument notation, dates, allocation totals and units in market-analysis documents. It is explicitly advisory and successful runs may exit zero with findings. It does not validate candle ordering, closed bars, feed freshness or a reconciled account. The new DeskBot observer implements its own explicit incomplete/error semantics instead of adopting that advisory exit code as a readiness gate.

The selected postmortem skill uses 5-/20-day outcomes and a fixed minimum signal threshold for feedback suggestions. These are source-specific conventions, not statistical proof. DeskBot needs instrument/strategy-specific holding periods, fees, partials, missed opportunities recorded before outcomes and dependence-aware uncertainty. Never automatically update production weights from its suggested feedback.

### marian2js: strongest process fit, still needs original evidence

The post-trade instructions distinguish thesis quality, execution, adherence and outcome, and discourage hindsight reconstruction. Its execution-plan check covers order types, spread/liquidity, event timing and stop realism. These map well to DeskBot's missing immutable plan/event records. Their prose cannot reconstruct records the bot never saved. Adapt the checklist only after those inputs exist; label unknowns instead of inventing an original thesis.

### AGIPro: do not copy the numerical examples blindly

The sizing instructions present stop-based sizing without fully budgeting fees, slippage, contract multiplier or minimum order precision, and assert an exact percentage loss at the stop. That is not a valid guarantee with gaps and imperfect execution. They also illustrate quarter-Kelly at about 8.1% of capital for assumed inputs. This is not approved sizing for this account. DeskBot's current risk policy must remain unchanged; uncertain edge estimates are not grounds for Kelly-based increases.

The walk-forward guide has useful discussion of chronological splits and overlapping labels, but its CPCV description can use training groups after a held-out group. That is not the same as a strictly past-only live walk-forward experiment. Its illustrated DSR code mixes annualized-Sharpe input, observation count and a kurtosis convention requiring independent mathematical validation; no correction has been implemented or tested here. Generic embargo/window recommendations and an eight-hour funding assumption must not be applied across venues. Pin horizons, units and actual settlement schedules and validate independently before using those scripts.

### Anthropic finance reference: draft work, not trading authority

The README positions agents/skills/connectors around investment banking, equity research, private equity, wealth and finance operations, with outputs staged for review. Official authorship does not validate a BTC trading strategy. Several connectors require external accounts/entitlements. Keep this as a later orchestration reference; it is not necessary for the current deterministic observer or to keep the existing cron running while Claude quota is exhausted.

## Minimal adoption backlog

1. Capture exact pre-trade plan, inputs and config before outcome; attach actual event/fee/partial history.
2. Produce a post-trade record separating observed facts, process violations, uncertainty and one falsifiable proposed change.
3. Evaluate a bounded challenger with immutable experiments; changes remain research-only until reviewed.
4. Consider a selected skill/SDK only if it measurably reduces review effort and passes tool-permission, auxiliary-code, license and cost checks.

Not reviewed in depth in this increment: Qlib/RD-Agent, the remaining large skill catalogs, every referenced script, hosted connector behavior or the alleged professional profitability of any author. Existing engine/framework research should not be treated as a completed integration. No source inspected establishes a repeatable $300→20× outcome or an income guarantee.


## Installed 28-29 Oct 2026 (owner request), selectively
- Installed into `.claude/skills/` unmodified from marian2js/trading-skills `f1ae7d4` (MIT): `post-trade-review` and `execution-plan-check`. Each is a SKILL.md plus one text reference file; no scripts, no allowed-tools, no tool or network instructions (grep and file-type checked). Provenance and license are beside each skill (`UPSTREAM.txt`, `LICENSE`).
- Not installed: tradermonty `signal-postmortem` (ships scripts, feeds results into automatic aggregator weights and uses fixed 5/20-day conventions, which conflicts with the no-automatic-weight-update rule); Jakeschincariol trader-skill (broker execution workflow); AGIPro skills (numerical examples need independent correction); whole collections. Revisit any of them only after reviewing the exact files and a stated use.
- Skills guide reviews; they cannot change configuration, risk, orders or tool permissions.
## 29 Oct 2026 follow-up
A second, run-based evaluation of the most-starred trading-skill repositories (what was installed, what each tool found on DeskBot data, and what was rejected and why) is in [SKILL_EVALUATION.md](SKILL_EVALUATION.md).
