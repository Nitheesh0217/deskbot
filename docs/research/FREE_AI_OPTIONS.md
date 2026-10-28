# Free AI options and limits

Checked October 28, 2026 against provider documentation. No model was downloaded, account created, key changed or paid call made. These options do not establish a trading edge.

Default recommendation: retain the existing optional Groq/Gemini advisory adapters, with explicit account-level free-plan verification and modest caps. Leave deterministic strategies, risk and position management independent of model availability. Do not add a third provider until a controlled latency/output-quality test shows a need. API access is separate from Claude chat quota; no subscription-quota bypass is implied.

| Option | Useful role | Limits / integration decision |
|---|---|---|
| [Groq](https://console.groq.com/docs/rate-limits) | Existing primary adapter for short structured summaries | Organization-level request/token limits vary by model/account. Inspect actual account limits and headers. A local daily cap is not a billing guarantee or a distributed organization-wide counter |
| [Gemini API](https://ai.google.dev/gemini-api/docs/pricing) | Existing fallback for optional news/AI review | Selected models have a free tier; availability/quota vary. The pricing page distinguishes free/paid data usage. Do not send private account records to a free tier without checking its data terms |
| [OpenRouter free models](https://openrouter.ai/collections/free-models) | Possible later shadow challenger | Current pricing describes 20 requests/minute and 50/day without the higher purchased-credit tier. Use only explicitly free models; adding paid fallbacks can incur charges. No adapter added here |
| [Ollama](https://github.com/ollama/ollama) | Local research/summarization on owned hardware | Runtime repository is open source; model licenses differ and compute is not free. Requires reachable hardware; localhost is not reachable from a remote Supabase function. Not installed |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | Alternative local CPU/GPU inference server | Useful infrastructure rather than a trained trading predictor. Hardware, memory, latency, model license and secure service access need separate review. Not installed |

Exact current model availability must be checked in the selected account before enabling a key. This patch does not change model IDs or turn on any provider. No trial account rotation, rate-limit evasion, arbitrary paid fallback or new hosted service is introduced.

## Concrete bug corrected

ai.ts checked the daily cap before the retry loop, allowing a retry to spend a call after reaching that cap. The loop now checks before each attempt. Invalid, negative or fractional budgets disable that provider; an explicit zero remains disabled. Tests cover cap-one retry/fallback, invalid budgets and environment parsing. Existing timeouts, schema validation, cooldowns and deterministic fallback remain intact.

The usage counter is still scoped to the application's supplied usage state; it is not an atomic cross-book or provider-organization billing meter. A later global budget requires a shared transactional counter. Do not describe this as a guaranteed $0 spend controller on a paid account.

## Research-only experiment

Freeze the same decision snapshots for rules-only versus an advisory model. Record prompt/model version, availability time, output validation, failure/late rate, latency and actual cost. Keep every recommendation before its outcome and charge failed calls. A quota outage returns unknown/WAIT for the AI opinion, not a stopped executor. Promote no signal filter from prose quality or model popularity alone.

Additional primary sources: [OpenRouter pricing](https://openrouter.ai/pricing), [free router behavior](https://github.com/OpenRouterTeam/docs/blob/main/cookbook/get-started/free-models-router-playground.mdx), [Groq billing](https://console.groq.com/docs/billing-faqs). Source review is not an authenticated account entitlement test.
