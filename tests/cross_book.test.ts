// Cross-book scheduling through the real edge handler with two books (BTC = row "main", GOLD = row "gold"). SYNTHETIC candles.
// Phase 1 (management, entries, durable state save) must complete for EVERY book before any book's advisory work (work-log flush,
// desk / LLM review, agent rows) starts; each book keeps its own configuration in both phases; slow or failing advisory work leaves
// the other book's management and accounting unchanged and keeps its own pending records recoverable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initState, applyCfg, buildSeries, snapshot, evaluate, ensureState, type Bar, type State } from "../supabase/functions/deskbot-v5/engine.ts";
import { casMatches } from "./helpers/cas.ts";

const M5 = 300_000, T0 = Date.UTC(2026, 0, 1);
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const closes = (() => { const r = seeded(1), c = [30000]; for (let i = 1; i < 36000; i++) c.push(c[i - 1] * (1 + 0.00003 * Math.sin(i / 900) + (r() - 0.5) * 0.004)); return c; })();
const m5: Bar[] = closes.map((x, i) => { const o = i ? closes[i - 1] : x, w = x * 0.0015; return { t: T0 + i * M5, o, h: Math.max(o, x) + w, l: Math.min(o, x) - w, c: x, v: 10, ct: T0 + (i + 1) * M5 - 1 }; });
const agg = (k: number): Bar[] => { const out: Bar[] = []; for (let i = 0; i + k <= m5.length; i += k) { const s = m5.slice(i, i + k); out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)), c: s[k - 1].c, v: 0, ct: s[k - 1].ct }); } return out; };
const FR: Record<string, Bar[]> = { "5m": m5, "15m": agg(3), "1h": agg(12), "4h": agg(48) };
const LOOSE = { MIN_SCORE: 0 };
const candidateBars = (() => { let hits: number[] | null = null; return () => { if (hits) return hits; applyCfg(LOOSE as never); const S = buildSeries({ m5, m15: FR["15m"], h1: FR["1h"], h4: FR["4h"] }); hits = [];
  for (let i = 34000; i < 35000; i++) { const st = ensureState(initState(350, T0)); if (evaluate(snapshot(S, i), st.enabled, S, st).signals.length) hits.push(i); } applyCfg(); if (hits.length < 2) throw new Error("no candidates"); return hits; }; })();
const firstEntryBar = () => candidateBars()[0];
const sp = (a: string) => ({ argument: a, strongest_point: a.slice(0, 20) });
const reply = (sys: string, dir: string) => /Bull/.test(sys) || /Bear/.test(sys) || /Risk Analyst|Aggressive|Conservative|Neutral/.test(sys) ? sp("Rules satisfied.")
  : /Research Manager/.test(sys) ? { rating: "Hold", rationale: "Balanced.", stronger_side: "balanced" } : /Trader/.test(sys) ? { action: "take", reason: "Plan matches.", execution_note: "Filled." }
  : { rating: dir === "short" ? "Sell" : "Buy", executive_summary: "Keep.", thesis: "Rules.", would_change_my_mind: "News." };

type Opt = { books: string; states: Record<string, State>; llmDelayMs?: number; logDelayMs?: number; logFailFor?: string; failCandlesFor?: string; i5: number };
async function run(o: Opt) {
  const nowMs = m5[o.i5].ct + 4000, t0 = performance.now();
  const env: Record<string, string> = { SUPABASE_URL: "https://deskbot.test", SUPABASE_SERVICE_ROLE_KEY: "test-only", DESKBOT_CRON_SECRET: "test-only", NEWS_MODE: "off", DESKBOT_BOOKS: o.books, GROQ_API_KEY: "gsk_test_key_not_real", AI_TERMS_VERIFIED: "groq" };
  const states = structuredClone(o.states), order: { what: string; ms: number }[] = [], agentRows: any[] = [], evRows: any[] = [];
  const mark = (what: string) => order.push({ what, ms: performance.now() - t0 }), sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  let handler!: (req: Request) => Promise<Response>; const pD = (globalThis as any).Deno, pF = globalThis.fetch, pN = Date.now;
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => { handler = h; } }; Date.now = () => nowMs;
  const json = (x: unknown, status = 200) => new Response(x == null ? "" : JSON.stringify(x), { status });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = decodeURIComponent(String(input)), body = init.body ? JSON.parse(String(init.body)) : null;
    if (url.startsWith("https://deskbot.test/rest/v1/")) {
      const path = url.split("/rest/v1/")[1], id = path.match(/dbv5_state\?id=eq\.(\w+)/)?.[1];
      if (init.method === "GET" && id) return json(states[id] ? [{ state: structuredClone(states[id]), updated_at: new Date(nowMs).toISOString() }] : []);
      if (init.method === "GET") return json([]);
      if (path === "rpc/dbv5_lease" || path === "rpc/dbv5_record_decision") return json(true);
      if (path === "rpc/dbv5_ack_work") { const k = new Set(body.p_keys), s = states[body.p_id] as any; if (Array.isArray(s?._workOutbox)) s._workOutbox = s._workOutbox.filter((r: any) => !k.has(r.output.key)); return json(0); }
      if (id && body?.state) { if (!casMatches(path, states[id])) return json([]); states[id] = structuredClone(body.state); mark(`state:${id}`); return json([{ id }]); }
      if (path.startsWith("dbv5_agent_log")) {
        const sym = body?.[0]?.symbol ?? "?"; mark(`agent_log:${sym}`); await sleep(o.logDelayMs ?? 0);
        if (o.logFailFor === sym) return json({ message: "simulated work-log outage" }, 503);
        agentRows.push(...body); return json(null);
      }
      if (path === "dbv5_events") evRows.push(...body);
      return json(null);
    }
    if (url.includes("api.groq.com")) {
      mark("llm"); await sleep(o.llmDelayMs ?? 0);
      const b = JSON.parse(String(init.body)), facts = JSON.parse(b.messages[1].content).facts;
      return json({ choices: [{ message: { content: JSON.stringify(reply(b.messages[0].content, facts.direction)) } }] });
    }
    if (url.includes("hyperliquid")) {
      if (body.type === "metaAndAssetCtxs") return json([{ universe: [{ name: "BTC" }, { name: "PAXG" }] }, [{ funding: "0.0001", openInterest: "5", markPx: String(closes[o.i5]) }, { funding: "0.0001", openInterest: "5", markPx: String(closes[o.i5]) }]]);
      const { interval, startTime, endTime, coin } = body.req, sym = coin === "PAXG" ? "GOLD" : "BTC";
      if (o.failCandlesFor === sym) return json({ error: "simulated feed outage" }, 500);
      return json((interval === "1m" ? m5 : FR[interval]).filter((b) => b.t >= startTime && b.t <= endTime && b.ct < nowMs).map((b) => ({ t: b.t, o: String(b.o), h: String(b.h), l: String(b.l), c: String(b.c), v: String(b.v) })));
    }
    if (url.includes("alternative.me")) return json({ data: [{ value: "50", value_classification: "Neutral" }] });
    if (url.includes("binance.vision")) return json([]);
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    await import("../supabase/functions/deskbot-v5/index.ts?x=" + Math.random());
    const res = await (await handler(new Request("https://edge.test", { method: "POST", headers: { "x-deskbot-key": "test-only", "Content-Type": "application/json" }, body: '{"action":"run"}' }))).json();
    return { res, states, order, agentRows, evRows, at: (w: string) => order.find((x) => x.what === w), idx: (w: string) => order.findIndex((x) => x.what === w) };
  } finally { globalThis.fetch = pF; (globalThis as any).Deno = pD; Date.now = pN; applyCfg(); }
}

const fresh = (cfg: Record<string, unknown>) => { const s = initState(350, T0); s.cfg = cfg as never; return s; };
// a GOLD book holding an open position, with its OWN configuration (different fee and exit mode from BTC)
async function goldWithPosition() {
  const i = firstEntryBar(), r = await run({ books: "GOLD", states: { gold: fresh({ ...LOOSE, TAKER_FEE: 0.0009, EXIT_MODE: "BE_AT_TP1" }) }, i5: i });
  assert.ok(r.states.gold.pos, "fixture: GOLD opened a position"); return { i, gold: r.states.gold };
}
const pick = (s: State) => ({ equity: s.equity, pos: s.pos && { id: s.pos.id, stop: s.pos.stop, remainingQty: s.pos.remainingQty, exits: s.pos.exits }, lastBarT: s.lastBarT, trades: s.stats.all.n, cfg: s.cfg });

test("GOLD management and state save complete before BTC's slow LLM review and work-log writes; each book uses its own configuration", async () => {
  const { i, gold } = await goldWithPosition(), later = candidateBars().find((j) => j >= i + 12)!;   // later: GOLD manages its position, BTC opens a new one
  const alone = await run({ books: "GOLD", states: { gold }, i5: later });
  const both = await run({ books: "BTC,GOLD", states: { main: fresh(LOOSE), gold }, i5: later, llmDelayMs: 150, logDelayMs: 100 });
  assert.ok(both.states.main.pos, "fixture: BTC opened a position, so its desk review (8 LLM stages) runs");
  const goldSaved = both.idx("state:gold"), firstLlm = both.idx("llm"), firstBtcLog = both.idx("agent_log:BTC");
  assert.ok(goldSaved >= 0 && firstLlm > goldSaved && firstBtcLog > goldSaved, `order: ${both.order.map((x) => x.what).join(" → ")}`);
  const advisoryMs = both.order.filter((x) => x.what === "llm").length * 150;
  assert.ok(both.at("state:gold")!.ms < advisoryMs, `GOLD saved at ${both.at("state:gold")!.ms.toFixed(0)} ms, before ${advisoryMs} ms of BTC advisory work`);
  assert.deepEqual(pick(both.states.gold), pick(alone.states.gold), "GOLD management and accounting identical to a GOLD-only run");
  const btcChecks = both.agentRows.find((r) => r.agent === "desk-checks" && r.symbol === "BTC"), cost = btcChecks.output.checks.find((c: any) => c.id === "round_trip_cost");
  const btcAlone = await run({ books: "BTC", states: { main: fresh(LOOSE) }, i5: later });
  const costAlone = btcAlone.agentRows.find((r) => r.agent === "desk-checks").output.checks.find((c: any) => c.id === "round_trip_cost");
  assert.deepEqual(cost, costAlone, "BTC's deferred review uses BTC's fees, not GOLD's (GOLD ran last)");
  assert.deepEqual(pick(both.states.main), pick(btcAlone.states.main), "BTC's own management and accounting unchanged");
  assert.equal(both.states.gold.cfg.TAKER_FEE, 0.0009); assert.equal((both.states.main.cfg as any).TAKER_FEE, undefined);
  assert.ok((both.states.main as any)._aiUsage?.groq?.calls >= 1, "BTC's LLM calls are counted on BTC");
  assert.deepEqual((both.states.gold as any)._aiUsage, (alone.states.gold as any)._aiUsage, "GOLD's provider usage equals a GOLD-only run: BTC's review is not counted on GOLD");
});

test("a failing, slow work log for one book: the other book is managed first and its records are delivered; the failed book's records stay pending", async () => {
  const { i, gold } = await goldWithPosition();
  const btcOpen = (await run({ books: "BTC", states: { main: fresh(LOOSE) }, i5: i })).states.main; assert.ok(btcOpen.pos);
  // both books hold positions; 4 hours later both manage them (target/stop/manage records go to each book's outbox)
  const pend0 = (s: State) => ((s as any)._workOutbox ?? []).length;
  let r!: Awaited<ReturnType<typeof run>>;
  for (const off of [48, 144, 288, 576, 1152]) { r = await run({ books: "BTC,GOLD", states: { main: btcOpen, gold }, i5: i + off, logDelayMs: 200, logFailFor: "BTC" }); if (pend0(r.states.main) > 0) break; }
  const goldSaved = r.idx("state:gold"), btcLog = r.idx("agent_log:BTC");
  assert.ok(goldSaved >= 0 && (btcLog < 0 || btcLog > goldSaved), `order: ${r.order.map((x) => x.what).join(" → ")}`);
  const pend = (s: State) => ((s as any)._workOutbox ?? []).length;
  assert.ok(pend(r.states.main) > 0, "BTC's undelivered work-log records remain in its state for the next run");
  assert.equal(pend(r.states.gold), 0, "GOLD's records were delivered and acknowledged");
  assert.ok(r.evRows.some((e) => e.symbol === "BTC" && e.kind === "ERROR" && /work log/.test(e.msg)), "the BTC failure is an ERROR event");
});

test("a BTC phase-1 failure (data outage) does not stop GOLD's management", async () => {
  const { i, gold } = await goldWithPosition();
  const alone = await run({ books: "GOLD", states: { gold }, i5: i + 24 });
  const r = await run({ books: "BTC,GOLD", states: { main: fresh(LOOSE), gold }, i5: i + 24, failCandlesFor: "BTC" });
  assert.equal((r.res.books.BTC as any).ok, false); assert.ok(r.idx("state:gold") >= 0);
  assert.deepEqual(pick(r.states.gold), pick(alone.states.gold));
});
