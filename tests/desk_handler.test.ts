// Through the real edge handler: the desk review runs AFTER state is saved, is advisory, survives provider outages, and writes its rows to the agent log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initState, applyCfg, buildSeries, snapshot, evaluate, ensureState, type Bar, type State } from "../supabase/functions/deskbot-v5/engine.ts";

const M5 = 300_000, T0 = Date.UTC(2026, 0, 1);
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const closes = (() => { const r = seeded(1), c = [30000]; for (let i = 1; i < 36000; i++) c.push(c[i - 1] * (1 + 0.00003 * Math.sin(i / 900) + (r() - 0.5) * 0.004)); return c; })();
const m5: Bar[] = closes.map((x, i) => { const o = i ? closes[i - 1] : x, w = x * 0.0015; return { t: T0 + i * M5, o, h: Math.max(o, x) + w, l: Math.min(o, x) - w, c: x, v: 10, ct: T0 + (i + 1) * M5 - 1 }; });
const agg = (k: number): Bar[] => { const out: Bar[] = []; for (let i = 0; i + k <= m5.length; i += k) { const s = m5.slice(i, i + k); out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)), c: s[k - 1].c, v: 0, ct: s[k - 1].ct }); } return out; };
const FR: Record<string, Bar[]> = { "1m": [], "5m": m5, "15m": agg(3), "1h": agg(12), "4h": agg(48) };
const LOOSE = { MIN_SCORE: 0 };
const candidates = (): number[] => { applyCfg(LOOSE as never); const S = buildSeries({ m5, m15: FR["15m"], h1: FR["1h"], h4: FR["4h"] }), out: number[] = []; for (let i = 34000; i < 35000; i++) { const st = ensureState(initState(350, T0)); if (evaluate(snapshot(S, i, { funding: 0.0001, oi: 5, markPx: null, fng: 50 }), st.enabled, S, st).signals.length) out.push(i); } applyCfg(); return out; };

const good = {
  analyst: { summary: "Sweep and reclaim with a rejection wick.", key_facts: ["sweep"], risks: ["costs"] }, bear: { case: "Costs are heavy.", strongest_point: "costs" },
  bull: { case: "Clean rejection.", strongest_point: "wick" }, judge: { verdict: "agree", reason: "Rules satisfied.", concerns: ["costs"], would_change_my_mind: "News." },
};
async function run(i5: number, o: { env?: Record<string, string>; llm?: "ok" | "down" } = {}) {
  const nowMs = m5[i5].ct + 4000, env: Record<string, string> = { SUPABASE_URL: "https://deskbot.test", SUPABASE_SERVICE_ROLE_KEY: "test-only", DESKBOT_CRON_SECRET: "test-only", NEWS_MODE: "off", DESKBOT_BOOKS: "BTC", GROQ_API_KEY: "gsk_test_key_not_real", ...(o.env ?? {}) };
  const order: string[] = []; let state: State = initState(350, T0); state.cfg = LOOSE as never; state.lastEvalT = 0; const agentRows: any[] = []; let stateWrites = 0;
  let handler!: (req: Request) => Promise<Response>; const pD = (globalThis as any).Deno, pF = globalThis.fetch, pN = Date.now; (globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => { handler = h; } }; Date.now = () => nowMs;
  const json = (x: unknown, status = 200) => new Response(x == null ? "" : JSON.stringify(x), { status });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input), body = init.body ? JSON.parse(String(init.body)) : null;
    if (url.startsWith("https://deskbot.test/rest/v1/")) {
      const path = url.split("/rest/v1/")[1];
      if (init.method === "GET") return path.startsWith("dbv5_state?") ? json([{ state: structuredClone(state), updated_at: new Date(nowMs).toISOString() }]) : json([]);
      if (path === "rpc/dbv5_lease") return json(true);
      if (path.startsWith("dbv5_state?") && body.state) { stateWrites++; order.push("state"); state = structuredClone(body.state); }
      if (path === "dbv5_agent_log") { order.push("agent_log"); agentRows.push(...body); }
      return json(null);
    }
    if (url.includes("api.groq.com")) {
      order.push("llm"); if (o.llm === "down") return json({ error: "down" }, 500);
      const sys = JSON.parse(String(init.body)).messages[0].content as string, role = sys.includes("desk analyst") ? "analyst" : sys.includes("skeptical") ? "bear" : sys.includes("supportive") ? "bull" : "judge";
      return json({ choices: [{ message: { content: JSON.stringify((good as any)[role]) } }] });
    }
    if (url.includes("hyperliquid")) {
      if (body.type === "metaAndAssetCtxs") return json([{ universe: [{ name: "BTC" }] }, [{ funding: "0.0001", openInterest: "5", markPx: String(closes[i5]) }]]);
      const { interval, startTime, endTime } = body.req; return json(FR[interval].filter((b) => b.t >= startTime && b.t <= endTime && b.ct < nowMs).map((b) => ({ t: b.t, o: String(b.o), h: String(b.h), l: String(b.l), c: String(b.c), v: String(b.v) })));
    }
    if (url.includes("alternative.me")) return json({ data: [{ value: "50", value_classification: "Neutral" }] });
    if (url.includes("binance.vision")) return json([]);
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try { await import("../supabase/functions/deskbot-v5/index.ts?x=" + Math.random()); const res = await (await handler(new Request("https://edge.test", { method: "POST", headers: { "x-deskbot-key": "test-only", "Content-Type": "application/json" }, body: '{"action":"run"}' }))).json(); return { res, order, state, agentRows, stateWrites }; }
  finally { globalThis.fetch = pF; (globalThis as any).Deno = pD; Date.now = pN; applyCfg(); }
}
const entryBar = async (o: Parameters<typeof run>[1] = {}) => { for (const i of candidates()) { const r = await run(i, o); if (r.state.pos) return { i, r }; } throw new Error("no entry bar found"); };

test("an entry triggers the desk review after state is saved; counters are persisted by a second save; rows reach the agent log", async () => {
  const { r } = await entryBar();
  assert.ok(r.order.indexOf("state") < r.order.indexOf("llm"), "state saved before any LLM call");
  assert.equal(r.order.filter((x) => x === "llm").length, 4); assert.ok(r.stateWrites >= 2, "second save persists provider usage");
  assert.equal((r.state as any)._aiUsage.groq.calls, 4, "daily-cap counters survive the run");
  const agents = r.agentRows.map((x) => x.agent); for (const a of ["desk-checks", "desk-analyst", "desk-bear", "desk-bull", "desk-judge"]) assert.ok(agents.includes(a), a);
  const judge = r.agentRows.find((x) => x.agent === "desk-judge"); assert.equal(judge.output.verdict, "agree"); assert.equal(judge.output.ref, r.state.pos!.id); assert.equal(judge.output.authority, "advisory");
  assert.ok(r.order.indexOf("llm") < r.order.lastIndexOf("agent_log"), "rows are written after the LLM stages");
});

test("a provider outage changes nothing about the trade: position, equity and state are identical to a run with no providers", async () => {
  const { i, r: down } = await entryBar({ llm: "down" }); const none = await run(i, { env: { GROQ_API_KEY: "", GEMINI_API_KEY: "" } });
  assert.deepEqual(down.state.pos, none.state.pos); assert.equal(down.state.equity, none.state.equity); assert.equal(down.res.books.BTC.ok, true);
  assert.ok(down.agentRows.some((x) => x.agent === "desk-analyst" && x.error), "outage recorded on the stage row"); assert.ok(!none.order.includes("llm"), "no providers: no calls");
  assert.ok(none.agentRows.some((x) => x.agent === "desk-checks"), "deterministic checks still logged without providers");
});

test("switches: AGENT_AI=off keeps the free checks but makes no LLM call; DESK_WORKFLOW=off adds nothing", async () => {
  const { i, r } = await entryBar({ env: { AGENT_AI: "off" } }); assert.ok(!r.order.includes("llm")); assert.ok(r.agentRows.some((x) => x.agent === "desk-checks"));
  const off = await run(i, { env: { DESK_WORKFLOW: "off" } }); assert.ok(!off.agentRows.some((x) => String(x.agent).startsWith("desk-"))); assert.deepEqual(off.state.pos, r.state.pos, "same trade either way");
});
