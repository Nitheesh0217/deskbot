# Deployment handoff — website evidence and AI quota fix

User authorized website/backend patch deployment October 28, 2026. Prepared changes have not been released merely because a source commit exists.

## Targets discovered

- GitHub: Nitheesh0217/deskbot; v5.8 base cd81d6f45eac9fe72bf6862cdcdd2f84cff1bf1c on claude/multi-agent-v5.8.
- Website URL found in source: https://deskbot-azure.vercel.app . Project listing includes deskbot (prj_d86L2qLplfP4U44p9mpJIYy9M8CI), deskbot-live and retired deskbot-v3. Do not deploy to one based on name alone.
- Owning team: team_jB1ghJBqclkgtBynRKZS5TlV, scope nitheesh-donepudis-projects. Project/deployment detail requests require a separate team grant; authorize that team and re-read details to confirm alias, project, root/output settings and rollback deployment before release.
- Backend: xevymbzgpcsdhygswxlk / deskbot-v5. Connected project access is denied; inspect exact deployed modules/schema/config before changing it.

## Current access blockers

GitHub create_branch: HTTP 403 Resource not accessible by integration, despite repository metadata reporting push permission. Supabase inventory is empty and direct get_project is denied. Vercel lists project names but returns 403 for this team's project/deployment details; team consent flow was requested. No credentials were requested in chat or read from local files.

## Release sequence once access is actually confirmed

1. Preserve any newer remote work. Compare branch heads with the known base; review the cumulative diff and record deployed source/config and existing open positions. Never overwrite account state.
2. Run npm ci --ignore-scripts, npm test, npm run typecheck and git diff --check on the exact release candidate.
3. Website-only rollout can be separate from ai.ts. Deploy the reviewed web directory to the confirmed existing project as a preview first. Include both index.html and evidence.js. Verify HTTP 200, helper load, BTC/GOLD switch, System evidence panel, failure/stale states and chart tabs. Record URL/commit/artifact. Then promote the tested production-target build within authorized scope.
4. Backend rollout must use the actual complete deployed source as its baseline; only the AI budget helper/retry change is intended here. Do not replace an unknown deployed version from an assumed branch. No DB migration, strategy change, credential change or config/risk change is required for this fix.
5. Verify public status remains PAPER, existing-position management continues, model failures degrade to rules, and no budget overrun occurs in mocked cap tests. Confirm actual cron runs, alert delivery and broker-free execution. Provider keys and billing are unchanged.
6. Record per-book state/ledger outcomes and exact deployment IDs. A smoke test proves operation, not profitable forecasts. Missing config approval and old validation remain visible rather than being suppressed.

Rollback website to the recorded prior deployment; keep evidence.js paired with its index. Backend rollback reverts only the quota fix on the actual deployed-source baseline. Never restore an old equity snapshot over later fills. No disabling risk controls or widening permission scope to force a pass.

## Claude resumption

Resume from HANDOFF.md, inspect CURRENT_STATE.md and EVIDENCE_LOG.md, then resolve access and exact artifacts before production edits. New code corrects UI truthfulness and bounded AI retries; it does not validate a new prediction model or certify profitability. Free AI assessment is in ../research/FREE_AI_OPTIONS.md.
