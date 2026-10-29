# Free AI providers for the desk's AI seats

The committee seats (bull, bear, research manager, trader, three risk analysts, portfolio manager), the news reader and the owner chat use any **OpenAI-compatible** free endpoint below. Each is used only if its secret exists. They are tried in order, and the next one answers when one is rate-limited, out of quota or renamed its model. With none set, only the rule-based seats run and trading is unaffected: the AI is advisory.

Researched 29 Oct 2026 from [mnfst/awesome-free-llm-apis](https://github.com/mnfst/awesome-free-llm-apis), [xyzs996/free-llm-api](https://github.com/xyzs996/free-llm-api) and [OpenRouter's comparison](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/). Free tiers change without notice; check the provider's own page.

| Secret (Supabase → Edge Functions → Secrets) | Where to get it | Free limit (as listed) | Default model (override with `<NAME>_MODEL`) |
|---|---|---|---|
| `GROQ_API_KEY` | console.groq.com → API keys | ~30 req/min, ~1,000/day, no card | `llama-3.3-70b-versatile` |
| `GEMINI_API_KEY` | aistudio.google.com → Get API key | per-model daily caps, no card | `gemini-2.5-flash` |
| `NVIDIA_API_KEY` | build.nvidia.com (NVIDIA Developer Program) | ~40 req/min | `meta/llama-3.3-70b-instruct` |
| `CEREBRAS_API_KEY` | cloud.cerebras.ai | listed as limited / trial | `gpt-oss-120b` |
| `MISTRAL_API_KEY` | console.mistral.ai, "Experiment" plan | ~1 req/s | `mistral-small-latest` |
| `GITHUB_MODELS_TOKEN` | github.com → Settings → fine-grained token with *Models: read* | low daily caps | `openai/gpt-4.1-mini` |
| `OPENROUTER_API_KEY` | openrouter.ai → Keys | ~20 req/min, ~50/day without credits | `openrouter/free` |

Optional: `AI_PROVIDER_ORDER=groq,nvidia,gemini` sets the order; `<NAME>_DAILY_CAP` lowers a daily call cap. Recommended minimum: **Groq + Gemini + NVIDIA**. These three are independent, cover each other's outages and are enough for about 8 committee calls per entry.

Rules that do not change with a key:
- The AI cannot open, size or close a trade. Its rating is a shadow verdict in FILTER-1, recorded before the outcome.
- Every answer is schema-checked. An answer that states a probability, a price target or a URL is rejected.
- Never paste a key into chat, a commit or an issue. Free tiers may log prompts. Prompts contain market facts and the paper plan only, never keys or personal data.
