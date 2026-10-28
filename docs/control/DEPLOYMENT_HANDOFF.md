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


## Release record — 28 Oct 2026 (supersedes the "blocked" sections above)

Targets confirmed with authorized access: GitHub `Nitheesh0217/deskbot`; Vercel team `team_jB1ghJBqclkgtBynRKZS5TlV`, project `deskbot` (`prj_d86L2qLplfP4U44p9mpJIYy9M8CI`, no framework, static `web/`), production alias `deskbot-azure.vercel.app` (also `deskbot-nitheesh-donepudis-projects.vercel.app`, `deskbot-git-main-…`); Supabase project `xevymbzgpcsdhygswxlk`, function `deskbot-v5`. The projects `deskbot-live` and `deskbot-v3` were not touched.

| Component | Before | After | Source revision | Verification |
|---|---|---|---|---|
| Edge function `deskbot-v5` | v17 (`ezbr badda0e6…b33703`) | **v18** (`ezbr 37adb6e8…6ff2e6`) | branch build of `1ec864d` | 8/8 files byte-identical to the build; run 200, both books ok, balances unchanged |
| Website preview | n/a | `dpl_DZCdCjmhhKPz6anRCfipdh2wn3SN` | `1ec864d` | `evidence.js` + `index.html` 200; content checks; local Chromium smoke |
| Website production | `dpl_48ewRjcToSuEnL4LPRWLPoX2rV8C` (main@`5bb0271`) | built by Vercel git integration on merge to main | merge commit (see PR #1) | recorded in the follow-up commit |
| Heartbeat | has never executed (jobs get no runner) | latent approval-failure defect fixed on merge | `1ec864d` | unit-tested only; blocked on GitHub Actions account state |

Database: no migration was applied for this release. (24 Oct: `agent_log_rls_index_prune`. A DROP of two duplicate `dbv5_agent_log` indexes was requested on 28 Oct and is pending the owner's approval.)

### Rollback targets
- **Website:** promote `dpl_48ewRjcToSuEnL4LPRWLPoX2rV8C` (marked rollback candidate) with `request_rollback`/dashboard Promote. `evidence.js` rolls back with its `index.html`.
- **Backend:** v17 was a build of `cd81d6f` plus a prompt-escape defect in `chat.ts`. To roll back, build `cd81d6f` (`for f in index engine agents data news ai chat runtime; do git show cd81d6f:supabase/functions/deskbot-v5/$f.ts | npx esbuild --loader=ts --format=esm --target=es2022 --charset=utf8 --minify-whitespace > out/$f.ts; done`) and redeploy those 8 files with `verify_jwt=false`. The quota fix is the only behavioural difference, so a rollback only re-allows a retry to exceed the per-provider daily cap by one call (providers are not configured today). Never restore an old `dbv5_state` snapshot over later fills.
- **Heartbeat:** revert `scripts/check_health.mjs`; it will go red again for the approval reason.

### Smoke tests still owed after the production website deploy
Alias serves the new `index.html`/`evidence.js` pair; System tab shows the evidence panel; the heartbeat runs at all (requires fixing GitHub Actions account state first).
