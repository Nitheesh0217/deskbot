// DeskBot — optional AI layer (advisory only). NO Anthropic/Claude dependency.
// Providers are OpenAI-compatible chat endpoints on free tiers (see PROVIDERS), tried in order as fallbacks. Keys come from Supabase
// secrets. Missing keys / quota / errors ⇒ returns null and the caller degrades to rules.
// AI output can never open a trade, size a trade or touch exits — see news.ts.
// Outbound payloads are allowlisted in egress.ts; decideJSON refuses any request text that still carries an account key.
import { egressViolations } from "./egress.ts";

export type Provider = { name: string; url: string; model: string; key: string; dailyCap: number };
export type Usage = Record<string, { day: string; calls: number; fails: number; coolUntil: number }>;
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const env = (k: string) => { try { return (globalThis as any).Deno?.env.get(k) ?? (globalThis as any).process?.env?.[k] ?? ""; } catch { return ""; } };
const dailyCap = (key: string, fallback: number) => {
  const raw = env(key); if (raw === "") return fallback;
  const cap = Number(raw);
  return Number.isSafeInteger(cap) && cap >= 0 ? cap : 0; // malformed config disables calls
};

// Free-tier, OpenAI-compatible chat endpoints (researched 29 Oct 2026 from github.com/mnfst/awesome-free-llm-apis and provider docs).
// Each is used only when its key secret exists; the model can be overridden with <NAME>_MODEL (free tiers rename models often:
// a 404 cools that provider for 30 min and the next one answers). Order = AI_PROVIDER_ORDER (comma list) or the default below.
// Free tiers may log prompts and may use them for training. Requests carry only egress.ts payloads (no account data); a provider is
// used only when its data-use terms have been checked from an official source (TERMS_VERIFIED below, or the owner's own record in
// AI_TERMS_VERIFIED). A key alone never activates an unverified provider.
export const PROVIDERS = [
  { name: "groq", keyVar: "GROQ_API_KEY", url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile", cap: 300 },          // ~30 RPM, ~1,000 RPD
  { name: "gemini", keyVar: "GEMINI_API_KEY", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-2.5-flash", cap: 200 },
  { name: "nvidia", keyVar: "NVIDIA_API_KEY", url: "https://integrate.api.nvidia.com/v1/chat/completions", model: "meta/llama-3.3-70b-instruct", cap: 500 },  // ~40 RPM (NVIDIA Developer Program)
  { name: "cerebras", keyVar: "CEREBRAS_API_KEY", url: "https://api.cerebras.ai/v1/chat/completions", model: "gpt-oss-120b", cap: 200 },
  { name: "mistral", keyVar: "MISTRAL_API_KEY", url: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest", cap: 200 },             // ~1 RPS free "Experiment" plan
  { name: "github", keyVar: "GITHUB_MODELS_TOKEN", url: "https://models.github.ai/inference/chat/completions", model: "openai/gpt-4.1-mini", cap: 100 }, // GitHub Models, fine-grained PAT with models:read
  { name: "openrouter", keyVar: "OPENROUTER_API_KEY", url: "https://openrouter.ai/api/v1/chat/completions", model: "openrouter/free", cap: 45 },        // ~20 RPM, 50 RPD without credits
] as const;

/** Providers whose official data-use terms were read and recorded. Others stay unavailable even with a key. */
export const TERMS_VERIFIED: Record<string, { checked: string; source: string; dataUse: string }> = {
  gemini: { checked: "2026-10-30", source: "ai.google.dev/pricing; ai.google.dev/gemini-api/docs/billing", dataUse: "free tier: prompts may be used to improve Google products; paid (billing on): not used" },
};
const ownerVerified = () => String(env("AI_TERMS_VERIFIED") || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
/** Every known provider: whether a key is configured and whether its terms are verified (status / tower). */
export function providerAvailability() {
  const own = ownerVerified();
  return PROVIDERS.map((p) => ({ name: p.name, configured: !!env(p.keyVar), termsVerified: !!TERMS_VERIFIED[p.name] || own.includes(p.name), verifiedBy: TERMS_VERIFIED[p.name] ? "code" : own.includes(p.name) ? "owner" : null }));
}
export function providersFromEnv(): Provider[] {
  const ok = new Set(providerAvailability().filter((a) => a.termsVerified).map((a) => a.name));
  const order = String(env("AI_PROVIDER_ORDER") || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const rank = (n: string) => (order.includes(n) ? order.indexOf(n) : order.length + PROVIDERS.findIndex((p) => p.name === n));
  return PROVIDERS.filter((p) => env(p.keyVar) && ok.has(p.name)).sort((a, b) => rank(a.name) - rank(b.name)).map((p) => {
    const up = p.name.toUpperCase();
    return { name: p.name, url: p.url, model: env(`${up}_MODEL`) || p.model, key: env(p.keyVar), dailyCap: dailyCap(`${up}_DAILY_CAP`, p.cap) };
  });
}

export type DecideResult<T> = { value: T; provider: string; model: string; ms: number } | { value: null; errors: string[] };

/**
 * Ask providers in order for a JSON object, validate it, return the first valid one.
 * Bounded: per-request timeout, one total deadline, max 1 retry per provider (only 429/5xx,
 * honouring Retry-After when it fits the deadline), per-provider daily cap + 30-min cooldown
 * after an auth/quota failure. Never throws.
 */
export async function decideJSON<T>(
  system: string, user: string, validate: (x: unknown) => T | null,
  opts: { providers: Provider[]; usage: Usage; now: number; deadlineMs?: number; timeoutMs?: number; maxTokens?: number; fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void> },
): Promise<DecideResult<T>> {
  const f = opts.fetchImpl ?? fetch, sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const t0 = Date.now(), end = t0 + (opts.deadlineMs ?? 20000), day = new Date(opts.now).toISOString().slice(0, 10);
  const errors: string[] = [];
  const leaked = egressViolations(system + "\n" + user);
  if (leaked.length) return { value: null, errors: [`egress blocked: request carries account fields (${leaked.join(", ")})`] };
  for (const p of opts.providers) {
    if (!Number.isSafeInteger(p.dailyCap) || p.dailyCap < 0) { errors.push(`${p.name}: invalid daily cap`); continue; }
    const u = (opts.usage[p.name] ??= { day, calls: 0, fails: 0, coolUntil: 0 });
    if (u.day !== day) { u.day = day; u.calls = 0; u.fails = 0; }
    if (u.coolUntil > opts.now) { errors.push(`${p.name}: cooling down`); continue; }
    if (u.calls >= p.dailyCap) { errors.push(`${p.name}: daily cap ${p.dailyCap} reached`); continue; }
    let jsonMode = true;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (u.calls >= p.dailyCap) { errors.push(`${p.name}: daily cap ${p.dailyCap} reached`); break; }
      const left = end - Date.now(); if (left < 1500) { errors.push("deadline"); return { value: null, errors }; }
      u.calls++;
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), Math.min(opts.timeoutMs ?? 8000, left));
      try {
        const r = await f(p.url, {
          method: "POST", signal: ctl.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
          body: JSON.stringify({ model: p.model, temperature: 0, max_tokens: opts.maxTokens ?? 400, ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
            messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        });
        if (r.status === 401 || r.status === 403 || r.status === 404) { u.fails++; u.coolUntil = opts.now + 30 * 60_000; errors.push(`${p.name}: HTTP ${r.status} (auth/model) — skipped 30 min`); break; }
        if (r.status === 429 || r.status >= 500) {
          u.fails++; const ra = +(r.headers.get("retry-after") ?? "") * 1000;
          errors.push(`${p.name}: HTTP ${r.status}`);
          if (r.status === 429 && !(ra > 0 && ra < end - Date.now() - 1500)) { u.coolUntil = opts.now + (ra > 0 ? ra : 10 * 60_000); break; }
          if (attempt === 0) { await sleep(Math.min(ra > 0 ? ra : 800 + Math.random() * 700, Math.max(0, end - Date.now() - 1500))); continue; }
          break;
        }
        if (r.status === 400 && jsonMode && attempt === 0) { jsonMode = false; errors.push(`${p.name}: HTTP 400 with JSON mode, retrying without it`); continue; }   // some free models reject response_format
        if (!r.ok) { u.fails++; errors.push(`${p.name}: HTTP ${r.status}`); break; }
        const j = await r.json();
        const txt: string = j?.choices?.[0]?.message?.content ?? "";
        const m = txt.match(/\{[\s\S]*\}/);
        let parsed: unknown = null; try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
        const v = validate(parsed);
        if (v === null) { u.fails++; errors.push(`${p.name}: invalid output`); break; }
        return { value: v, provider: p.name, model: p.model, ms: Date.now() - t0 };
      } catch (e) {
        const timedOut = (e as Error)?.name === "AbortError";
        u.fails++; errors.push(`${p.name}: ${timedOut ? "timeout" : "network"}`);
        if (!timedOut && attempt === 0 && end - Date.now() > 3000) { await sleep(500); continue; }
        break;
      } finally { clearTimeout(timer); }
    }
  }
  if (!opts.providers.length) errors.push("no AI provider configured");
  return { value: null, errors };
}
