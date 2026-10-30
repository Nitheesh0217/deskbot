# Integrated PAPER release: W2+W3 + chart + payload minimisation + account registry + cross-book scheduling

**Scope:** a paper-system upgrade.
- Unchanged: strategies, risk limits, sizing and open-position plans.
- Paper execution only.
- No AI provider is activated.
- No broker is connected; funded orders are disabled.

**Status:** not merged and not deployed. Each step needs owner approval.

## Identity
| Item | Value |
|---|---|
| Candidate (deployable code) | branch `release/paper-integrated`; the exact SHA is recorded in `docs/control/EVIDENCE_LOG.md` ("integrated paper release") and in the PR. Later commits may change `docs/` only |
| Contents | release #21 (`1bf53aa`, deployable code = `5662f80`) + chart #22 (`ebe903f`) + payload minimisation #23 (`1187395`) + registry #24 (`951891e`) + cross-book scheduling + provider policy + broker-state line |
| Migrations | `20261030_scan_work.sql`, then `20261030_shadow_lane.sql` (unchanged from #21) |
| Rollback artifact (after the lane migration) | `afdf44a069c314689649c59ee4407f052295c654` (`rollback/v24-lane-compat`) |
| Frontend rollback | Vercel instant rollback to `dpl_2V5vuDPQndNEG94J3mKmCDEYk2U7` |

## What changes at runtime (vs edge v24 / main `3e25392`)
1. **W2/W3:**
   - durable work log with compare-and-set state saves
   - scoped acknowledgements and the outbox guard trigger
   - bounded flush
   - truthful worker states
   - strategy coverage
   - shadow lane

   See `RELEASE_W2_W3.md` for the full list and the exact work-log guarantees: one row per key while it exists, recoverable pending records, a 14-day suppression window, and no permanent exactly-once.
2. **Two-phase run.**
   - **Phase 1, per book (BTC, then GOLD):** data, position management, entries, decision record, state save, equity and events.
   - **Phase 2, after all books finish phase 1:** each book's work-log flush, desk/LLM review, agent rows and provider-counter save. Each phase-2 job re-applies its own book's configuration.
   - A phase-1 failure in one book does not stop the next book.
   - Push notifications are bounded to 3 s each.
3. **Chart plan view:** original vs active stop, targets with %, original R and exact exit fraction, max hold as a limit, loading and error states, phone layout.
4. **Outbound data:**
   - Allowlisted payloads with no equity, risk dollars, quantities or $ P&L.
   - The egress guard refuses any request that still carries account fields.
   - A provider serves a feature only with all of: credentials, reviewed terms, the owner's per-feature data-use acceptance (`AI_DATA_USE_ACCEPTED`), and the feature on.
   - Production has no provider secret set today, so no AI call happens. Status `ai.policy` shows the separate facts.
5. **Account registry and read-only adapter contract** (`accounts.ts`): not imported by the run loop. Status reports `brokers.connected = []` and `fundedOrders = "disabled"`.

## Correction: what a delayed run does to stops and targets
An earlier note said a delay "cannot skip a stop or target". That holds only for **paper candle reconstruction**, and only within limits:
- **Paper (this system).** Each run replays the 1m path since the last processed bar and fills stops and targets at their levels.
  - Resolution is 1m live, 5m in history. A bar that touches both a stop and a target counts as stop first.
  - The replay fetches at most **1,000 minutes** (`mins = Math.min(1000, …)` in `runOnce`). After an outage longer than about 16.7 h, bars before that window are **not replayed**, so a stop or target touched in the gap is missed and management continues from later bars.
  - A candle-source failure stops that book's run. The next run retries from the same `lastBarT`.
- **Real account (not built).** A delayed software manager cannot fill retroactively.
  - Only orders resting at the broker execute while the manager is late.
  - Software-managed actions (stop moves, partials, time exits) happen late and at the then-current price.
  - Gaps fill beyond stop prices.
  - Funded execution would need broker-resident protective orders and reconciliation. Neither exists.

**Remaining delays to GOLD's management after this change** (all in BTC's phase 1):
- BTC's data fetches
- BTC's news read: RSS plus optional AI classification, with a 20 s deadline; AI is used only if a provider is usable for `news`, and none is today
- the decision-record RPC
- push notifications (≤ 3 s each)

**Phase-2 worst case:** about 44 s of flush per book plus 75 s of desk review per book with an entry. This can exceed the 120 s run lease; compare-and-set saves and the outbox guard keep an overlapping run safe. This is reported, not hidden.

## Checklist (each step: run it, record the output in EVIDENCE_LOG, stop on any unexpected result)
0. **Baseline, read-only:** the same queries as `RELEASE_W2_W3.md` step 0. Also record `select id, state->'pos'->>'id', state->'pos'->>'stop', state->'cfg' from dbv5_state` for both books, to show plans and configs are unchanged afterwards.
1. **Deploy the backend from the candidate SHA** (approval required). Use the edge entry `import "https://raw.githubusercontent.com/Nitheesh0217/deskbot/<candidate>/supabase/functions/deskbot-v5/index.ts";` with `verify_jwt=false`. Confirm `get_edge_function` shows exactly this import.
2. **First run and scan on the old schema.** Pass criteria are as in `RELEASE_W2_W3.md` steps 2-3, plus:
   - `last_run.ai.policy` is present;
   - `ai.providers = []`;
   - both books ran;
   - GOLD's `updated_at` is not later than BTC's phase-2 rows.
3. **Apply `20261030_scan_work.sql`, then `20261030_shadow_lane.sql`** (approval each). Verify as in `RELEASE_W2_W3.md` steps 4-5.
4. **Post-migration run and scan.** Pass criteria are as in `RELEASE_W2_W3.md` step 6. Do not expect unchanged equity: compare each transition against that run's inputs. Do not force an entry.
5. **Merge** (approval required): `release/paper-integrated` → `main` with a merge commit.
   - `git diff --stat <candidate> <merge> -- supabase/ web/ tests/ scripts/` must be empty.
   - Vercel deploys `main`. Confirm `githubCommitSha` equals the merge SHA and the build is READY.
6. **Frontend check:**
   - Tower: AI seats BLOCKED with the exact missing fact.
   - Evidence line: "No broker account connected … funded orders disabled".
   - Chart plan view on desktop and phone.
   - Strategies view.

## Rollback (by component)
| Component | Before the lane migration | After the lane migration |
|---|---|---|
| Frontend | Vercel instant rollback to `dpl_2V5vuDPQndNEG94J3mKmCDEYk2U7` | same |
| Trading loop + scanner (one edge artifact) | re-pin to v24 `3e253929…` | re-pin to `afdf44a…`. Plain v24 fails on the lane key (42P10, reproduced) |
| Schema | leave in place (additive) | leave in place; never re-add the 3-column key or drop shadow rows |
| State | v24 ignores `_rev` and `_workOutbox`; pending records wait for roll-forward | same; the outbox guard removes only already-logged records |
| Provider policy / egress | rollback restores the old provider list. No provider secret is set, so no AI call follows either way | same |
