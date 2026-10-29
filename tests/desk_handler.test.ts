// Through the real edge handler: the desk review runs AFTER state is saved, is advisory, survives provider outages, and writes its rows to the agent log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initState, applyCfg, buildSeries, snapshot, evaluate, ensureState, type Bar, type State } from "../supabase/functions/deskbot-v5/engine.ts";
import { replayDecision } from "../supabase/functions/deskbot-v5/provenance.ts";

const M5 = 300_000, T0 = Date.UTC(2026, 0, 1);
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const closes = (() => { const r = seeded(1), c = [30000]; for (let i = 1; i < 36000; i++) c.push(c[i - 1] * (1 + 0.00003 * Math.sin(i / 900) + (r() - 0.5) * 0.004)); return c; })();
const m5: Bar[] = closes.map((x, i) => { const o = i ? closes[i - 1] : x, w = x * 0.0015; return { t: T0 + i * M5, o, h: Math.max(o, x) + w, l: Math.min(o, x) - w, c: x, v: 10, ct: T0 + (i + 1) * M5 - 1 }; });
const agg = (k: number): Bar[] => { const out: Bar[] = []; for (let i = 0; i + k <= m5.length; i += k) { const s = m5.slice(i, i + k); out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)), c: s[k - 1].c, v: 0, ct: s[k - 1].ct }); } return out; };
const FR: Record<string, Bar[]> = { "1m": [], "5m": m5, "15m": agg(3), "1h": agg(12), "4h": agg(48) };
const LOOSE = { MIN_SCORE: 0 };
const candidates = (): number[] => { applyCfg(LOOSE as never); const S = buildSeries({ m5, m15: FR["15m"], h1: FR["1h"], h4: FR["4h"] }), out: number[] = []; for (let i = 34000; i < 35000; i++) { const st = ensureState(initState(350, T0)); if (evaluate(snapshot(S, i, { funding: 0.0001, oi: 5, markPx: null, fng: 50 }), st.enabled, S, st).signals.length) out.push(i); } applyCfg(); return out; };

const sp = (a: string) => ({ argument: a, strongest_point: a.slice(0, 20) });
// the PM rates in the trade's direction (Buy for a long, Sell for a short), so its stance is always "keep"
const good = (role: string, dir: string): unknown => ({
  bull: sp("Clean rejection."), bear: sp("Costs are heavy."), research: { rating: "Overweight", rationale: "Rules satisfied.", stronger_side: "bull" },
  trader: { action: "take", reason: "Plan matches the rules.", execution_note: "Filled." }, aggressive: sp("Reward covers costs."), conservative: sp("Costs are heavy."), neutral: sp("Both hold."),
  pm: { rating: dir === "short" ? "Sell" : "Buy", executive_summary: "Keep.", thesis: "Rules satisfied.", would_change_my_mind: "News." },
} as Record<string, unknown>)[role];
async function run(i5: number, o: { env?: Record<string, string>; llm?: "ok" | "down"; lastEvalT?: number; state?: State; log?: any[]; m1?: boolean } = {}) {
  const nowMs = m5[i5].ct + 4000, env: Record<string, string> = { SUPABASE_URL: "https://deskbot.test", SUPABASE_SERVICE_ROLE_KEY: "test-only", DESKBOT_CRON_SECRET: "test-only", NEWS_MODE: "off", DESKBOT_BOOKS: "BTC", GROQ_API_KEY: "gsk_test_key_not_real", ...(o.env ?? {}) };
  const order: string[] = []; let state: State = o.state ? structuredClone(o.state) : initState(350, T0); if (!o.state) { state.cfg = LOOSE as never; state.lastEvalT = o.lastEvalT ?? 0; } const evRows: any[] = [], decisions: any[] = []; const agentRows: any[] = [], verdicts: any[] = []; let stateWrites = 0;
  let handler!: (req: Request) => Promise<Response>; const pD = (globalThis as any).Deno, pF = globalThis.fetch, pN = Date.now; (globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => { handler = h; } }; Date.now = () => nowMs;
  const json = (x: unknown, status = 200) => new Response(x == null ? "" : JSON.stringify(x), { status });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input), body = init.body ? JSON.parse(String(init.body)) : null;
    if (url.startsWith("https://deskbot.test/rest/v1/")) {
      const path = url.split("/rest/v1/")[1];
      if (init.method === "GET" && path.startsWith("dbv5_agent_log?")) { const want = decodeURIComponent(path).match(/in\.\((.*)\)/)?.[1].split(",").map((x) => x.replace(/"/g, "")) ?? []; return json((o.log ?? []).filter((r) => want.includes(r.output?.key)).map((r) => ({ k: r.output.key }))); }
      if (init.method === "GET") return path.startsWith("dbv5_state?") ? json([{ state: structuredClone(state), updated_at: new Date(nowMs).toISOString() }]) : json([]);
      if (path === "rpc/dbv5_lease") return json(true);
      if (path === "rpc/dbv5_record_decision") { order.push("decision"); decisions.push(body); return json(true); }
      if (path.startsWith("dbv5_state?") && body.state) { stateWrites++; order.push("state"); state = structuredClone(body.state); }
      if (path === "dbv5_agent_log") { order.push("agent_log"); agentRows.push(...body); o.log?.push(...body); }
      if (path === "dbv5_events") evRows.push(...body);
      if (path === "dbv5_filter_verdicts") { order.push("verdicts"); verdicts.push(...body); }
      return json(null);
    }
    if (url.includes("api.groq.com")) {
      order.push("llm"); if (o.llm === "down") return json({ error: "down" }, 500);
      const sys = JSON.parse(String(init.body)).messages[0].content as string, role = (["Bull Researcher", "Bear Researcher", "Research Manager", "the Trader", "Aggressive Risk", "Conservative Risk", "Neutral Risk", "Portfolio Manager"] as const).map((k, j) => sys.includes(k) ? ["bull", "bear", "research", "trader", "aggressive", "conservative", "neutral", "pm"][j] : null).find(Boolean)!;
      return json({ choices: [{ message: { content: JSON.stringify(good(role, JSON.parse(JSON.parse(String(init.body)).messages[1].content).facts.direction)) } }] });
    }
    if (url.includes("hyperliquid")) {
      if (body.type === "metaAndAssetCtxs") return json([{ universe: [{ name: "BTC" }] }, [{ funding: "0.0001", openInterest: "5", markPx: String(closes[i5]) }]]);
      const { interval, startTime, endTime } = body.req; return json((interval === "1m" && o.m1 ? m5 : FR[interval]).filter((b) => b.t >= startTime && b.t <= endTime && b.ct < nowMs).map((b) => ({ t: b.t, o: String(b.o), h: String(b.h), l: String(b.l), c: String(b.c), v: String(b.v) })));
    }
    if (url.includes("alternative.me")) return json({ data: [{ value: "50", value_classification: "Neutral" }] });
    if (url.includes("binance.vision")) return json([]);
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try { await import("../supabase/functions/deskbot-v5/index.ts?x=" + Math.random()); const res = await (await handler(new Request("https://edge.test", { method: "POST", headers: { "x-deskbot-key": "test-only", "Content-Type": "application/json" }, body: '{"action":"run"}' }))).json(); return { res, order, state, agentRows, stateWrites, verdicts, evRows, decisions }; }
  finally { globalThis.fetch = pF; (globalThis as any).Deno = pD; Date.now = pN; applyCfg(); }
}
const entryBar = async (o: Parameters<typeof run>[1] = {}) => { for (const i of candidates()) { const r = await run(i, o); if (r.state.pos) return { i, r }; } throw new Error("no entry bar found"); };

test("an entry triggers the desk review after state is saved; counters are persisted by a second save; rows reach the agent log", async () => {
  const { r } = await entryBar();
  assert.ok(r.order.indexOf("state") < r.order.indexOf("llm"), "state saved before any LLM call");
  assert.equal(r.order.filter((x) => x === "llm").length, 8); assert.ok(r.stateWrites >= 2, "second save persists provider usage");
  assert.equal((r.state as any)._aiUsage.groq.calls, 8, "daily-cap counters survive the run");
  const agents = r.agentRows.map((x) => x.agent); for (const a of ["desk-checks", "desk-analysts", "desk-bull", "desk-bear", "desk-research", "desk-trader", "desk-risk-neutral", "desk-pm"]) assert.ok(agents.includes(a), a);
  const pm = r.agentRows.find((x) => x.agent === "desk-pm"); assert.ok(["Buy", "Sell"].includes(pm.output.rating)); assert.equal(pm.output.ref, r.state.pos!.id); assert.equal(pm.output.authority, "advisory"); assert.ok(["keep", "skip"].includes(pm.output.stance));
  assert.ok(r.order.indexOf("llm") < r.order.lastIndexOf("agent_log"), "rows are written after the LLM stages");
});

test("a provider outage changes nothing about the trade: position, equity and state are identical to a run with no providers", async () => {
  const { i, r: down } = await entryBar({ llm: "down" }); const none = await run(i, { env: { GROQ_API_KEY: "", GEMINI_API_KEY: "" } });
  assert.deepEqual(down.state.pos, none.state.pos); assert.equal(down.state.equity, none.state.equity); assert.equal(down.res.books.BTC.ok, true);
  assert.ok(down.agentRows.some((x) => x.agent === "desk-bull" && x.error), "outage recorded on the stage row"); assert.ok(!none.order.includes("llm"), "no providers: no calls");
  assert.ok(none.agentRows.some((x) => x.agent === "desk-checks"), "deterministic checks still logged without providers");
});

test("switches: AGENT_AI=off keeps the free checks but makes no LLM call; DESK_WORKFLOW=off adds nothing", async () => {
  const { i, r } = await entryBar({ env: { AGENT_AI: "off" } }); assert.ok(!r.order.includes("llm")); assert.ok(r.agentRows.some((x) => x.agent === "desk-checks"));
  const off = await run(i, { env: { DESK_WORKFLOW: "off" } }); assert.ok(!off.agentRows.some((x) => String(x.agent).startsWith("desk-"))); assert.deepEqual(off.state.pos, r.state.pos, "same trade either way");
});

test("FILTER-1: an entry records one rules verdict and one AI verdict after the LLM stages, keyed to the position; nothing else changes", async () => {
  const { r } = await entryBar();
  assert.deepEqual(r.verdicts.map((v: any) => v.arm).sort(), ["ai", "rules"]);
  for (const v of r.verdicts) assert.equal(v.ref, r.state.pos!.id);
  assert.equal(r.verdicts.find((v: any) => v.arm === "ai").take, true, "PM rated in the trade's direction");
  assert.ok(r.order.lastIndexOf("llm") < r.order.indexOf("verdicts"));
  assert.ok(r.order.indexOf("state") < r.order.indexOf("verdicts"), "state is saved before any verdict");
});

test("catch-up through the handler: a late run that skipped a signal bar enters it (labelled) or records MISSED; CATCHUP=off does neither", async () => {
  let checked = 0, sawCaught = 0, sawMissed = 0;
  for (const j of candidates()) {
    const T = m5[j].ct, sn = snapshot(buildSeries({ m5, m15: FR["15m"], h1: FR["1h"], h4: FR["4h"] }), j);
    if (!sn.new15) continue;
    const late = await run(j + 1, { lastEvalT: m5[j - 1].ct, env: { AGENT_AI: "off" } });
    const caught = late.state.pos && (late.state.pos as any).why?.some((w: string) => w.startsWith("CATCH-UP:"));
    const missed = late.evRows.some((e) => e.kind === "MISSED");
    const liveSignal = (late.state as any).pos && !caught;   // the newest bar produced its own signal: catch-up stays out of the way
    assert.ok(caught || missed || liveSignal, `bar ${j}: neither entered nor recorded`); if (caught) sawCaught++; if (missed) sawMissed++;
    if (caught) {
      assert.equal((late.res as any).ok, true);
      const d = late.decisions[0]; assert.ok(d, "a catch-up entry has a decision record");
      assert.equal(d.d.record.dataAvailability.catchUpFromT, m5[j - 1].ct);
      const out = await replayDecision(d.d.record, d.inputs.map((r: any) => ({ tf: r.tf, source: r.source, bars: r.bars, barsSha256: r.bars_sha256 })), d.d.record_sha256);
      assert.deepEqual(out.diffs, [], "the catch-up decision replays from its stored inputs"); assert.equal(out.reproduced, true);
      applyCfg();
    }
    const off = await run(j + 1, { lastEvalT: m5[j - 1].ct, env: { AGENT_AI: "off", CATCHUP: "off" } });
    assert.ok(!off.evRows.some((e) => e.kind === "MISSED") && !(off.state.pos && (off.state.pos as any).why?.some((w: string) => w.startsWith("CATCH-UP:"))));
    if (++checked >= 2) break;
    void T;
  }
  assert.ok(checked >= 1, "found a boundary signal bar to test");
  assert.ok(sawCaught >= 1 && sawMissed >= 1, "both outcomes are exercised on this deterministic series");
});

test("Theo's work log: management actions are recorded once with keys linked to the decision; a retry from the same state adds nothing and changes no trade", async () => {
  const { i, r } = await entryBar({ env: { AGENT_AI: "off" } }); const opened = structuredClone(r.state); const id = opened.pos!.id;
  let k = 0, first: Awaited<ReturnType<typeof run>> | null = null, log: any[] = [];
  for (k = i + 1; k < Math.min(i + 400, m5.length - 2); k += 3) {   // walk forward until the manager does something material
    log = []; const x = await run(k, { state: opened, log, m1: true, env: { AGENT_AI: "off" } });
    if (x.agentRows.some((a) => a.agent === "manager")) { first = x; break; }
  }
  assert.ok(first, "a management action happened within the window");
  const mine = first!.agentRows.filter((a) => a.agent === "manager");
  for (const a of mine) { assert.match(a.output.key, new RegExp(`^${id}:(target_fill|exit|stop_adjust|target_adjust|close):`)); assert.equal(a.output.ref, id); assert.ok(a.output.decisionId); assert.equal(a.output.authority, "deterministic"); }
  assert.equal(new Set(mine.map((a) => a.output.key)).size, mine.length, "no duplicate keys within a run");
  const linked = first!.evRows.filter((e) => e.data?.work); for (const e of linked) assert.ok(mine.some((a) => a.output.key === e.data.work), `event ${e.kind} links to a work-log record`);
  // retry: the same run again from the same starting state, with the first attempt's rows already in the log
  const again = await run(k, { state: opened, log, m1: true, env: { AGENT_AI: "off" } });
  assert.deepEqual(again.agentRows.filter((a) => a.agent === "manager"), [], "nothing recorded twice");
  assert.deepEqual(again.state.pos, first!.state.pos); assert.equal(again.state.equity, first!.state.equity, "the work log changes no trade or P&L");
});
