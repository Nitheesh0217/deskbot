# Decisions

| ID | Decision | Reason / tradeoff |
|---|---|---|
| D001 | Base work on existing v5.8 branch, publish a review branch | Preserves current source without silently merging its unreviewed changes into main |
| D002 | Keep existing TypeScript/Deno engine and static dashboard | Avoids a rewrite, duplicate numerical engines and infrastructure while evidence gaps dominate |
| D003 | First working increment is a separate read-only observer | Useful provenance/freshness/accounting feedback without touching positions, config or deployment |
| D004 | No trading-skill pack installed | Reviewed instructions contain assumptions needing correction; adopting ideas is different from executing their tools |
| D005 | Prioritize post-trade review and input provenance over new predictors | Existing rejected experiments and config drift provide concrete evidence; more agents do not establish an edge |
| D006 | Observer never returns trading readiness PASS | Public status cannot establish deployed-source identity, full history, eligibility or profitability |
| D007 | Keep generated JSON/HTML out of git | Snapshots may contain account details; current reports are bounded observations and become stale |
| D008 | No plugin/model required for observer | Works while Claude quota is exhausted; optional future SDK calls still have cost/availability constraints |
| D009 | Keep old operational and strategy docs, link rather than duplicate them | Control pack records gaps; existing docs retain their domain details and historical claims |

Risk limits, disabled experiments and runtime order behavior were not changed. Correcting deployment/approval documentation requires distinguishing observed source policy from actual environment settings; no secret value is inferred.
