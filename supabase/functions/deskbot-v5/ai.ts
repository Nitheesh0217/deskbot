// DeskBot v5.2 — optional AI layer (advisory only). NO Anthropic/Claude dependency.
// Providers are OpenAI-compatible chat endpoints on free tiers: Groq (primary) and
// Google Gemini via its OpenAI-compatible endpoint (fallback). Keys come from Supabase
// secrets. Missing keys / quota / errors ⇒ returns null and the caller degrades to rules.
// AI output can never open a trade, size a trade or touch exits — see news.ts.

export type Provider = { name: string; url: string; model: string; key: string; dailyCap: number };
export type Usage = Record<string, { day: string; calls: number; fails: number; coolUntil: number }>;
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const env = (k: string) => { try { return (globalThis as any).Deno?.env.get(k) ?? (globalThis as any).process?.env?.[k] ?? ""; } catch { return ""; } };

export function providersFromEnv(): Provider[] {
  const out: Provider[] = [];
  if (env("GROQ_API_KEY")) out.push({ name: "groq", url: "https://api.groq.com/openai/v1/chat/completions", model: env("GROQ_MODEL") || "llama-3.3-70b-versatile", key: env("GROQ_API_KEY"), dailyCap: +(env("GROQ_DAILY_CAP") || 300) });
  if (env("GEMINI_API_KEY")) out.push({ name: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: env("GEMINI_MODEL") || "gemini-2.5-flash", key: env("GEMINI_API_KEY"), dailyCap: +(env("GEMINI_DAILY_CAP") || 200) });
  return out;
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
  for (const p of opts.providers) {
    const u = (opts.usage[p.name] ??= { day, calls: 0, fails: 0, coolUntil: 0 });
    if (u.day !== day) { u.day = day; u.calls = 0; u.fails = 0; }
    if (u.coolUntil > opts.now) { errors.push(`${p.name}: cooling down`); continue; }
    if (u.calls >= p.dailyCap) { errors.push(`${p.name}: daily cap ${p.dailyCap} reached`); continue; }
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = end - Date.now(); if (left < 1500) { errors.push("deadline"); return { value: null, errors }; }
      u.calls++;
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), Math.min(opts.timeoutMs ?? 8000, left));
      try {
        const r = await f(p.url, {
          method: "POST", signal: ctl.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
          body: JSON.stringify({ model: p.model, temperature: 0, max_tokens: opts.maxTokens ?? 400, response_format: { type: "json_object" },
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
