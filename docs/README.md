# DeskBot documentation index

Start here. Each topic has one authoritative document; the others listed as *superseded* are kept for history only.

| Topic | Authoritative | Superseded / history |
|---|---|---|
| What is deployed now, how to release and roll back | `control/RELEASE_PAPER_INTEGRATED.md` (release of 2026-10-30, merge `8ca91a2`) | `control/RELEASE_W2_W3.md`, `control/RELEASE_v20.md`, `control/RELEASE_v19.md`, `control/DEPLOYMENT_HANDOFF.md`, `control/HANDOFF.md` |
| Evidence of every release and research run | `control/EVIDENCE_LOG.md` | — |
| Architecture and module map | `control/ARCHITECTURE.md` | `control/PROJECT_BRIEF.md` |
| Database schema | `../supabase/migrations/` (complete since `20261031_reconcile_production.sql`) | `control/SCHEMA_SNAPSHOT.md` (snapshot of 2026-10-28) |
| Operations runbook | `ONLINE_RUNBOOK.md` | `OPERATIONS.md` |
| Strategies, risk, zones | `STRATEGIES.md`, `RISK.md`, `ZONES.md`, `STRATEGY_COVERAGE.md`, `SHADOW_LANES.md` | — |
| Strategy eligibility per book | `control/STRATEGY_ELIGIBILITY.md` (research branch) | — |
| Workers / tower | `TOWER.md`, `AGENTS.md`, `AGENT_WORKFLOWS.md`, `control/WORKER_CONTRACTS.md` | — |
| AI providers and outbound data | `control/EGRESS.md` | `AI_PROVIDERS.md` (provider list only) |
| Real-account preparation | `control/BROKER_READINESS.md` | — |
| Decisions, provenance, catch-up, research protocol | `control/DECISIONS.md`, `control/PROVENANCE.md`, `control/CATCHUP.md`, `control/RESEARCH_PROTOCOL.md` | — |
| Plans | `control/ROADMAP.md`, `control/TASKS.md` | — |
| Research reports | `research/`, `../research/` | — |

Local checks: `npm run check` (typecheck, tests, generated web files, build identity). SQL tests: `scripts/sql_test/*.sh` (need PostgreSQL 16; PostgREST for `postgrest.sh`). Browser smokes: `scripts/web_smoke/*.cjs` (need Playwright).
