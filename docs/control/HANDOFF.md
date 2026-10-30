> **Superseded** — see `docs/README.md` for the current authoritative document.

# DeskBot handoff

Start here, then read CURRENT_STATE.md, TASKS.md and EVIDENCE_LOG.md. Product scope: PROJECT_BRIEF.md. Boundaries: ARCHITECTURE.md and DECISIONS.md. Existing operational/strategy details remain in ../OPERATIONS.md, ../ONLINE_RUNBOOK.md, ../RISK.md, ../STRATEGIES.md, ../AGENTS.md and ../ML_REPORT.md.

Recovered source: main `5bb0271` (5.7.0); active `claude/multi-agent-v5.8` at `cd81d6f` (5.8.0). This work branches from the latter. A deployed status version is not an artifact hash. Supabase connected inventory returned no projects during this audit. Do not assume access will work in the next session; recheck narrowly when needed.

T001 adds a Node read-only evidence CLI, offline static console, source/capability review, research protocol and audited skill shortlist. It does not add a prediction model, new live strategy, broker integration, full research lab or deployed UI. No upstream skills installed or scripts executed.

Run npm ci --ignore-scripts, npm test, npm run typecheck. To observe: npm run audit:status -- --fetch --output reports/current, or --input snapshot.json instead of --fetch. Exit 2 means generated but incomplete; exit 1 means command failure. Open reports/current/status-audit.html locally. Report files are ignored; do not commit raw snapshots or secrets.

Next critical task: T002 exact artifact/config/schema reconciliation with authorized read access. Only then implement one immutable instrument/decision/outcome trace (M2). Do not replace the engine with a collection of Python frameworks. Skill-review findings and candidates live in ../research/TRADING_SKILLS_REVIEW.md.

Publication means source pushed to a review branch; it does not mean deployed, profitable, or approved for funded trading. Current task verification and unresolved checks are recorded in EVIDENCE_LOG.md. This handoff is durable repo context, not a promise that chat memory persists.

Latest local increment T003 adds the existing website's evidence panel and a quota-retry fix in ai.ts. Source is prepared, not deployed. Read DEPLOYMENT_HANDOFF.md before release. Vercel can list projects but needs team grant; GitHub writes and Supabase project reads still fail. Do not present missing approval as an enforced entry pause. A new LLM or profitable model is not part of this patch.

**Update 28 Oct 2026 (Claude):** source = `main` at `a12bcaf` (PR #1; the research branch is merged). Backend v18 deployed and verified byte-identical to its source; website verified on a Vercel preview; heartbeat false-alarm fixed. See EVIDENCE_LOG.md (reconciliation), SCHEMA_SNAPSHOT.md, DEPLOYMENT_HANDOFF.md (release record). Next: T004.
