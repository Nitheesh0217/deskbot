# Learning loop: how DeskBot learns from its losses

```
closed trade ─► cause tags (learning.ts) ─► lesson ledger ─► frozen-spec test on 3y data ─► verdict
                                                     ▲                                       │
                                                     └──── REJECTED / NARROW_REJECT (kept) ◄─┤
                                     owner approval ◄──────────── PASS ◄────────────────────┘
                                            │
                                            ▼
                                   shadow/paper first ─► live paper books
```

1. **Every run:** closed trades are already stored with their exit path, regime and costs.
2. **Learning desk (status `learning`, System → "Learning desk"):**
   - the losses of active strategies in the last 90 days, tagged by cause;
   - each cause mapped to its lesson in the ledger (`learning.ts LEDGER`);
   - the focus: the costliest cause that still has a test to run.
3. **Weekly research (scheduled session, Mondays):**
   1. Take the focus lesson: the first `QUEUED` entry of `LEDGER`, or a `NARROW_REJECT` whose note names a next test.
   2. Write `docs/research/<date>-<test>/SPEC_FROZEN.md`: hypothesis, one exact rule with fixed parameters, data, and PASS/REJECT criteria. **Commit it before running anything.**
   3. Download data with `scripts/fetch_archive.sh` (SHA-256 verified). Run the test with `scripts/challenger_study.ts` (add a variant hook if needed; the BASE identity check must pass) on BTC's live config (`research_data/live_cfg.json`), real funding, at 1× and 1.5× costs.
   4. Write `RESULTS.md` with the verdict, as written in the spec.
   5. Update the lesson's status and note in `LEDGER` (and its test).
   6. Open a PR. **Never merge, deploy, change production config or touch funded execution.**
4. **Owner:** reviews the PR. A PASS is adopted by a separate change, shadow or paper first.

## Rules that keep the loop honest
- Never change a spec's criteria after seeing its result. A new idea needs a new spec.
- Never re-test a rejected idea as if it were new; the ledger records every verdict.
- One lesson per week, one rule per test.
- A monthly profit target never sets risk. Sizing changes only from measured edge (see the sizing step).
- Paper only. Real money needs a broker path that does not exist, and the owner's separate approval.
