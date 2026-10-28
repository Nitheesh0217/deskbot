# Project brief

Owner goal: an evidence-based trading research and paper-decision desk around BTC and gold, extending only to eligible instruments after the first slice works.

## Confirmed requirements

- Preserve this repository and working deterministic engine, chart, paper history and controls.
- Identify exact instruments/venues; current gold book is PAXG, not XAUUSD.
- Validate closed-bar market data and record decision-time evidence.
- Keep external signals separate from internally generated strategies.
- Research catalysts, test versioned hypotheses and retain failed experiments.
- Rank only eligible opportunities; UP/DOWN/WAIT must not imply calibrated probability.
- Keep sizing, limits, reconciliation and execution permission deterministic.
- Separate historical simulation, forward paper and eventual funded records.
- Review concrete diffs and actual tests before marking work verified.
- Maintain this control pack and concise handoff in the repository.

## Defaults and assumptions

One modular TypeScript/Deno repository, existing evaluation engine, existing static web interface. Node tools perform offline observation/research. A Python research adapter is conditional on an actual need. No Next.js rewrite, microservice fleet, new AI subscription or automatic plugin installation is required.

The intended user is the owner reviewing opportunities and bot behavior. A professional research process and earlier information are objectives, not established capabilities. Account growth and eventual income are aspirations. No fixed profit, win rate or 20× timeline is an acceptance criterion.

## Authority

Implementation and GitHub publication were authorized October 28, 2026. This increment uses a review branch based on the existing v5.8 branch. Production deployment, paid services, destructive migrations, credential changes, funded execution and risk-limit changes remain separate decisions. Read-only public observation is allowed; no raw snapshots or private credentials should be committed.

## First product slice

Captured public status → defensive normalization → per-book freshness/provenance and bounded-ledger checks → redacted JSON plus a local static evidence console. This provides a working observer without modifying the executor. It is not the completed six-workspace dashboard or a new prediction model.
