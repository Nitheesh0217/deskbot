# W4 (in progress, read-only): provider readiness and repository candidates

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

Still to verify from official pages: NVIDIA (build.nvidia.com terms), Cerebras, Mistral "Experiment" plan data use, OpenRouter free-model logging, and commercial-use restrictions for each.

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
1. Finish the official-source table for the remaining providers.
2. Write role-to-model assignments with daily, per-run and global call ceilings across both books.
3. Specify cache/dedup keys for news and committee calls.
4. Audit each skill.
5. Run no provider until the owner adds a key and authorizes a smoke test.
