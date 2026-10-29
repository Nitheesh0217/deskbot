# Release v19 (29 Oct 2026): backend brought up to main

Owner approval: "make the bot updated with all the new features, go ahead, full permission granted" and "Okay go" (29 Oct 2026). Paper trading only; no funded orders, no risk, config or credential change.

## Database (project xevymbzgpcsdhygswxlk)
The Supabase `apply_migration` confirmation card never reached the owner's client (four timeouts), so the two additive migrations were applied with `execute_sql` after explicit owner approval in chat. The SQL is the repository migrations with `drop trigger if exists … create trigger` replaced by `create or replace trigger` (same result, no DROP). They do not appear in `supabase_migrations` history; the files below are the source of truth.

| Migration | Objects | Verified after apply |
|---|---|---|
| `20261029_decision_provenance.sql` | `dbv5_decisions`, `dbv5_decision_inputs`, `dbv5_record_decision(jsonb, jsonb)` (security definer) | RLS on; append-only triggers present; service_role cannot insert/update directly; service_role can execute the RPC; anon cannot |
| `20261029_filter_experiment.sql` | `dbv5_filter_verdicts` | RLS on; append-only triggers; service_role insert yes, update no; anon no access |

The shadow-lane draft (`20261029_shadow_lanes.sql`) was not applied; the edge function does not use it.

## Edge function `deskbot-v5`
- Before: v18, `ezbr 37adb6e8…6ff2e6`, built from `a12bcaf`. Compiled copy kept for rollback (session scratchpad); source = git `a12bcaf`.
- After: **v19**, `ezbr 979794fd…5a1e136c`, `verify_jwt=false` (unchanged; the function checks its own cron key).
- Entry file imports `supabase/functions/deskbot-v5/index.ts` from **raw.githubusercontent.com at commit `f95d85967ad1800ade7f1c1f0ca68f1b061efde2`** (public repo, immutable commit). This avoids hand-transcribing ~230 KB of source through the deploy tool. The deployed code is exactly the repository at that commit.
- Pre-flight before deploy: an esbuild bundle of that commit passed the handler tests (desk, provenance, coverage, edge: 11/11) and a run against copies of the two live book states (both open positions carried unchanged, equity unchanged, coverage counters created).

## What changes at runtime
Decision records before every new entry (fail-closed); missed-bar catch-up (`CATCHUP=on`); coverage counters; advisory desk review after state save (no AI provider configured, so rule checks only); FILTER-1 shadow verdicts; `experiment` and `config` in the public status. Strategy rules, risk, sizing and config are unchanged.

## Rollback
Redeploy `deskbot-v5` with the same entry file pointing at commit `a12bcaf` (v18 source), or the saved compiled v18. The new tables are additive and can stay.
