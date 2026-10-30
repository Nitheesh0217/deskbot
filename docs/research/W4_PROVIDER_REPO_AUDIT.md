# W4 (read-only, bounded research): provider readiness and repository candidates

Started 30 Oct 2026. Nothing here is activated or installed. Quotas below are as published at the time; providers change them without notice. The provider's console or official page is authoritative.

## Provider adapters already in the code
`ai.ts` already provides:
- an ordered fallback across seven OpenAI-compatible providers
- per-provider daily caps and a 30-minute cooldown on auth/model errors
- one retry on 429/5xx (honouring Retry-After)
- one retry without JSON mode on HTTP 400
- schema validation, a total deadline per call, and per-stage deadlines in `desk.ts`

A gateway (LiteLLM) is therefore **not** needed for routing or fallbacks.

## Official-source findings so far
| Provider | Finding | Source | Consequence |
|---|---|---|---|
| Google Gemini | Pricing page: free tier "Used to improve our products: Yes"; paid tier "No". Billing docs: with billing enabled, prompts and responses are not used to improve Google products. | ai.google.dev/pricing, ai.google.dev/gemini-api/docs/billing | Free tier is acceptable only because prompts contain public market data and the paper plan. Keep the redaction rule: no keys, balances beyond the paper book, or personal data. |
| Groq | Limits are per organization and per model; the authoritative values are on the console limits page; exceeding them returns 429, never a charge. | console.groq.com/docs/rate-limits (via Groq community post) | Read the actual limits from the console after the owner creates a key; set `GROQ_DAILY_CAP` below it. |
| GitHub Models | Official table: Copilot Free gets 150 requests/day (low tier) and 50/day (high tier), 15 / 10 per minute, 8000 in / 4000 out tokens per request; "public preview, subject to change". | docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models | The default cap of 100/day in `ai.ts` fits the low tier. Use the low-tier model for debate seats only. |

| NVIDIA (build.nvidia.com API trial) | Trial access is for evaluation and testing, **not production use**. Statements about whether prompts may be used to improve products conflict across sources. | NVIDIA developer forum staff answers ("Clarification On Trial API Use", "NVIDIA NIM FAQ"); the full Trial ToS page was not retrievable from this session | **Do not use for the running bot** (even a paper bot running on a schedule is operational use) until the owner reads the current Trial ToS and confirms. Keep the adapter, but leave it unconfigured. |
| Cerebras | Only third-party summaries were found: they say inference inputs and outputs are not retained. Free-tier terms are not stated. | cerebras.ai/privacy-policy (only via search snippets) | UNVERIFIED. The owner reads the policy and the Developer-tier terms before a key is added. |
| Mistral (Experiment plan) | Not verified: help.mistral.ai is outside this session's network allow-list. | — | UNVERIFIED. Free plans are commonly opt-out for training; the owner checks the console's data-use toggle before any key is added. |
| OpenRouter (`openrouter/free`) | Not verified: openrouter.ai is outside this session's network allow-list. Free routes are served by third-party providers whose logging and training policies differ per model. | — | UNVERIFIED. If ever used, the account's privacy settings must disallow providers that train on or retain prompts, and the free router must not be used for chat. |

Network note: openrouter.ai and help.mistral.ai have to be allowed in this session's network settings before their official pages can be checked here.

## Outgoing payload audit (code as of release candidate 5662f80)
| Caller | What leaves the system | Account information? | Finding |
|---|---|---|---|
| `news.ts` classification | Public RSS headlines + rule score | No | OK |
| `agents.ts` aiReview (shadow) | `{trade: {strategy, dir, entry, stop, reentry, why}, rulesSaid, chart}` | No (prices and rule reasons only) | OK |
| `desk.ts` committee (8 stages) | facts: instrument, strategy, plan **including `riskAmt`**, analyst reports (public market data, funding, OI, F&G, headlines), checks, lessons | **Yes, small**: `riskAmt` is 2% of paper equity, so it reveals the paper account size | NEEDS CHANGE: send the plan in price/R terms only (drop `riskAmt`); the committee does not use it |
| `chat.ts` owner chat | `chatContext()`: paper equity, startEquity, maxDD, open position, stats, live config, the last 20 trades with $ net, backtests, other books' equity and positions | **Yes**: the full paper account state | NEEDS CHANGE: owner-initiated, but consent to send account data to a provider that may train on it is not implied. Proposal: chat uses only providers whose data-use setting the owner has confirmed as "no training" (`CHAT_PROVIDERS` allow-list, empty by default → chat says it is unavailable), and sends equity as % change and trades in R, not $ |

Nothing sends keys, wallet addresses, personal data or funded-account information (there is no funded account).

## Proposed role budgets and fallback (not applied)
| Role | Calls per trigger | Daily ceiling (both books) | Allowed providers | On failure |
|---|---|---|---|---|
| News classification | 1 per new headline batch, cached by headline hash | 60 | any configured | Rule score only (current behaviour) |
| aiReview (shadow) | 1 per entry | 20 | any configured | Row with error; no effect on trading |
| Committee (8 stages) | ≤ 8 per entry, 75 s deadline | 80 (≈ 10 entries) | any configured, low tier first | Stage row with error; stance "abstain"; never blocks or opens a trade |
| Owner chat | 1 per message | 50 | `CHAT_PROVIDERS` allow-list only | "Unavailable" message |
| Global | — | sum of the provider caps already in `ai.ts`; the lowest of (provider cap, role ceiling) wins | — | Fallback to the next provider; all exhausted → rules only |

No key is shared between roles or books to multiply quota, and no provider is rotated to evade a limit: the caps above sit below each provider's published limit.

## Repository candidates (preliminary)
| Repo | Recommendation | Reason |
|---|---|---|
| mnfst/awesome-free-llm-apis | **BORROW PATTERN** (directory only) | Discovery list; provider docs govern terms. Already used to choose candidates. |
| BerriAI/litellm | **DEFER** | Core proxy is MIT, with a separately licensed `enterprise/` directory. Its fallbacks, budgets and rate limits duplicate `ai.ts`. Adds a Python service to host. Revisit only if cross-worker budgets must be enforced by a separate gateway. |
| ollama/ollama | **DEFER** | Local inference needs compute that DeskBot does not have (edge function + free tiers). Not free hosting. |
| langchain-ai/langgraph | **DEFER** | Durable stateful orchestration is not a demonstrated gap: the committee is a bounded sequential pipeline with persisted rows. |
| TauricResearch/TradingAgents | **BORROW PATTERN** (done) | Role structure only; already adapted, no code copied. |
| microsoft/RD-Agent, microsoft/qlib | **DEFER** (isolated research only) | Research tooling, not live dependencies; relevant only to W6 offline experiments. |
| tradermonty/claude-trading-skills, marian2js/trading-skills, Jakeschincariol/trader-skill | **AUDIT PENDING** | Earlier integration used selected skills as workflow guidance. Each SKILL.md still needs a per-skill permission and relevance review. Skills improve workflow; they are not prediction models. |

## Next W4 steps
1. Owner: read the NVIDIA Trial ToS, Cerebras, Mistral and OpenRouter terms (or allow those hosts in the session network) and record the data-use settings.
2. Implement the two payload redactions (desk `riskAmt`, chat allow-list + R units) as a separate reviewed change.
3. Specify cache/dedup keys for news and committee calls.
4. Audit each skill.
5. Run no provider until the owner adds a key and authorizes a smoke test.
