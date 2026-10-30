# Real-account preparation: registry, read-only adapter contract, first-adapter recommendation

**Status:** design and contract only.
- No broker is connected.
- No credential is stored.
- Funded order submission is disabled by contract (`fundedOrders: "disabled"`; the adapter interface has no order-writing method).
- **No funded trading is authorized.**

## What exists now (`supabase/functions/deskbot-v5/accounts.ts`, not imported by the live loop)
- **Account registry record:**
  - broker and masked account reference
  - credential reference (the secret's *name* only)
  - paper/live mode
  - read permissions (`trade` is rejected)
  - supported order types (information only)
  - instrument classes
  - market-data source and entitlement
- **Instrument model:** venue, symbol, currency, tick, lot, contract multiplier, trading sessions, expiry and settlement.
  - **Prediction contracts are a separate class.** They carry event id, outcome, resolution source and rules, close/settle times, payout, executable price bounds and fees. They have no stop/target/R fields, so BTC target logic cannot attach to them; validation rejects it.
- **Read-only adapter interface:** `health`, `balances`, `positions`, `openOrders`, `fills`, `instruments`.
- **Freshness:** FRESH / STALE / DISCONNECTED / INVALID. Stale data is never shown as current.
- **Reconciliation:** positions implied by fills vs positions the broker reports, listing every break.
- **Consolidated exposure across accounts:**
  - price exposure is netted by underlying, with each account's share;
  - prediction contracts are reported as event exposure (contracts, max payout, cost), never netted against price exposure;
  - unmapped positions are listed, not dropped.
- **Research desks** (data sources) are a separate type that cannot hold credentials or permissions.
- **Reference adapter over the existing paper book.** The screenshot position maps to the contract and reconciles from its own fills.
- **Tests:** `tests/accounts.test.ts`, 6 tests.

## Broker evaluation
This session could not open the official documentation hosts: openapi.moomoo.com, interactivebrokers.com, robinhood.com and docs.polymarket.us are outside its network allow-list. The findings below come from search-engine excerpts of the official pages, marked "excerpt", or from third-party pages, marked "third-party". Every row must be re-checked on the official page before any adapter is built.

| Broker | Interface (source) | Fit for DeskBot's runtime (Supabase edge function, no long-running process) | Read-only control | Account eligibility to confirm |
|---|---|---|---|---|
| **moomoo** | OpenAPI through the **OpenD gateway**, which must run locally or on a server. It covers account funds, positions, orders and deals. US stocks, ETFs and options are covered; some quotes need paid quote cards (excerpt: moomoo help center, OpenAPI overview, API PDF) | Needs a host for OpenD: the owner's computer or a small server pushing snapshots. It cannot run inside the edge function | Queries vs a separate trade-unlock step. Expected: never call unlock-trade, expose only query calls. **Must be verified** | Owner's moomoo region/entity (US), OpenAPI enablement/questionnaire, quote rights for the instruments of interest |
| **IBKR** | Web API. Individuals use the **Client Portal Gateway** (Java, browser login); OAuth 1.0a is for advisors and third-party developers. The live account must be a funded IBKR Pro account (excerpt: IBKR Web API authentication docs) | Same problem: the gateway runs on a host and needs periodic re-authentication | No read-only scope documented in the excerpts | IBKR Pro, funded; paper account availability |
| **Robinhood** | **Crypto Trading API only** (official help page excerpt): view market data, account info and holdings, and place orders. Keys are created in the crypto account settings and "define which actions it can perform". Authentication is API key + Ed25519 signature (third-party listing). No official equities/options API was found | Pure HTTPS from the edge function; fits the current runtime | A key scoped to read actions only, per the excerpt. **Must be verified on docs.robinhood.com** | A Robinhood crypto account with API access in the owner's state |
| **Polymarket US** | CFTC-regulated US exchange, separate from the international Polymarket. Credentials come after account verification; there is an authenticated host for portfolio data and a public market-data host (third-party pages only) | HTTPS; would fit | Unknown (third-party) | Verified Polymarket US account; prediction-contract rules and fees per market |

## Recommendation: one first adapter
**Recommended: moomoo, read-only, through OpenD on the owner's computer.**

Reasons:
- The owner already has moomoo access.
- Account and position queries are separate from trade unlocking, so the adapter can stay read-only by never unlocking.
- The read path covers balances, positions, orders and deals.

The cost is a host for OpenD. The edge function cannot run it, so a small read-only bridge on the owner's computer would post snapshots.

**Fallback.** If moomoo's OpenAPI is not enabled for the owner's account, or its read path needs trade unlock, use Robinhood's Crypto Trading API with a read-only key. It runs directly from the existing runtime, and its BTC holdings relate to the current BTC book. Its limit is crypto only.

**Not first:**
- **IBKR** requires a funded IBKR Pro account and a gateway with browser re-authentication.
- **Polymarket US** is a different instrument class. It needs its own research before any data is consolidated.

## Next read-only milestone (M-B1)
1. **The owner confirms:**
   - moomoo account entity and region
   - OpenAPI enabled
   - which instruments they hold
   - that OpenD may run on their computer
   
   Also: allow `openapi.moomoo.com` in this session's network settings so the official pages can be read.
2. **Verify on the official docs** that the account, position, order and deal queries work without trade unlock. Record the rate limits.
3. **Build the `moomoo` read-only adapter against the contract** in a separate PR:
   - a local script that calls only query methods and maps to `Snapshot`;
   - a recorded-response test fixture;
   - no unlock or order calls (enforced by a test that greps the adapter source);
   - credentials kept on the owner's machine.
4. **Owner-run proof:** one snapshot, with freshness and reconciliation results shown on the tower as *read-only, not traded*.

Funded order submission stays out of scope until a separate, explicit authorization.
