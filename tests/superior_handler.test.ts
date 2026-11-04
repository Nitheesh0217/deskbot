// Observe-only checks through the real edge handler (same SYNTHETIC-candle harness as backend_structure.test.ts).
// The core guarantee: BTC/GOLD positions, equity, trades and events are identical with the checks on and off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initState, applyCfg, buildSeries, snapshot, evaluate, ensureState, type Bar, type State } from "../supabase/functions/deskbot-v5/engine.ts";
import { casMatches } from "./helpers/cas.ts";

const M5 = 300_000, T0 = Date.UTC(2026, 0, 1);
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const closes = (() => { const r = seeded(1), c = [30000]; for (let i = 1; i < 36000; i++) c.push(c[i - 1] * (1 + 0.00003 * Math.sin(i / 900) + (r() - 0.5) * 0.004)); return c; })();
const m5: Bar[] = closes.map((x, i) => { const o = i ? closes[i - 1] : x, w = x * 0.0015; return { t: T0 + i * M5, o, h: Math.max(o, x) + w, l: Math.min(o, x) - w, c: x, v: 10, ct: T0 + (i + 1) * M5 - 1 }; });
const agg = (k: number): Bar[] => { const out: Bar[] = []; for (let i = 0; i + k <= m5.length; i += k) { const s = m5.slice(i, i + k); out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)), c: s[k - 1].c, v: 0, ct: s[k - 1].ct }); } return out; };
const FR: Record<string, Bar[]> = { "1m": m5, "5m": m5, "15m": agg(3), "1h": agg(12), "4h": agg(48) };
const LOOSE = { MIN_SCORE: 0 };
let hit: number | null = null;
const firstEntryBar = () => {
  if (hit != null) return hit; applyCfg(LOOSE as never); const S = buildSeries({ m5, m15: FR["15m"], h1: FR["1h"], h4: FR["4h"] });
  for (let i = 34000; i < 35000 && hit == null; i++) { const st = ensureState(initState(350, T0)); if (evaluate(snapshot(S, i), st.enabled, S, st).signals.length) hit = i; }
  applyCfg(); if (hit == null) throw new Error("no candidate"); return hit;
};
const fresh = (cfg: Record<string, unknown>) => { const s = initState(350, T0); s.cfg = cfg as never; return s; };
const UNIVERSE = [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }, { name: "PAXG", szDecimals: 3, maxLeverage: 10 }];

type Opt = { states: Record<string, State>; i5: number; obs?: boolean; universe?: unknown[]; db?: (path: string, method: string) => Response | undefined };
async function call(o: Opt) {
  const nowMs = m5[o.i5].ct + 4000;
  const env: Record<string, string> = { SUPABASE_URL: "https://deskbot.test", SUPABASE_SERVICE_ROLE_KEY: "test-only", DESKBOT_CRON_SECRET: "test-only", NEWS_MODE: "off", DESKBOT_BOOKS: "BTC,GOLD", ...(o.obs === false ? { DESKBOT_OBSERVE_CHECKS: "off" } : {}) };
  const states = structuredClone(o.states), lastRun: Record<string, any> = {}, posts: { path: string; body: any }[] = [];
  let handler!: (req: Request) => Promise<Response>; const pD = (globalThis as any).Deno, pF = globalThis.fetch, pN = Date.now;
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => { handler = h; } }; Date.now = () => nowMs;
  const json = (x: unknown, status = 200) => new Response(x == null ? "" : JSON.stringify(x), { status });
  const kl = (b: Bar) => [b.t, String(b.o), String(b.h), String(b.l), String(b.c), String(b.v), b.ct, "0", 0, "0", "0", "0"];
  const universe = o.universe ?? UNIVERSE;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = decodeURIComponent(String(input)), body = init.body ? JSON.parse(String(init.body)) : null, method = init.method ?? "GET";
    if (url.startsWith("https://deskbot.test/rest/v1/")) {
      const path = url.split("/rest/v1/")[1], id = path.match(/dbv5_state\?id=eq\.(\w+)/)?.[1];
      const over = o.db?.(path, method); if (over) return over;
      if (method === "GET" && id) return json(states[id] ? [{ state: structuredClone(states[id]), last_run: lastRun[id] ?? null, updated_at: new Date(nowMs).toISOString() }] : []);
      if (method === "GET") return json([]);
      if (path === "rpc/dbv5_lease") return json(true);
      if (path === "rpc/dbv5_record_decision") { posts.push({ path, body }); return json(true); }
      if (id && body?.state) { if (!casMatches(path, states[id])) return json([]); states[id] = structuredClone(body.state); if (body.last_run) lastRun[id] = body.last_run; return json([{ id }]); }
      posts.push({ path, body }); return json(null);
    }
    if (url.includes("hyperliquid")) {
      if (body.type === "metaAndAssetCtxs") return json([{ universe }, universe.map(() => ({ funding: "0.0001", openInterest: "5", markPx: String(closes[o.i5]), oraclePx: String(closes[o.i5] * 0.9999), premium: "0.0001" }))]);
      const { interval, startTime, endTime } = body.req;
      return json(FR[interval].filter((b) => b.t >= startTime && b.t <= endTime && b.ct < nowMs).map((b) => ({ t: b.t, o: String(b.o), h: String(b.h), l: String(b.l), c: String(b.c), v: String(b.v) })));
    }
    if (url.includes("binance.vision")) {
      const q = new URL(url).searchParams, interval = q.get("interval")!, limit = +q.get("limit")!;
      if (limit === 26) return json([]);
      return json(FR[interval].filter((b) => b.ct < nowMs).slice(-limit).map(kl));
    }
    if (url.includes("alternative.me")) return json({ data: [{ value: "50", value_classification: "Neutral" }] });
    if (url.includes("superior")) throw new Error("no Superior-hosted request is allowed");
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    await import("../supabase/functions/deskbot-v5/index.ts?x=" + Math.random());
    const r = await handler(new Request("https://edge.test", { method: "POST", headers: { "x-deskbot-key": "test-only", "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) }));
    const evs = posts.filter((p) => p.path === "dbv5_events").flatMap((p) => p.body);
    return { res: await r.json(), states, lastRun, posts, evs, trades: posts.filter((p) => p.path.startsWith("dbv5_trades")).flatMap((p) => p.body), decisions: posts.filter((p) => p.path === "rpc/dbv5_record_decision").map((p) => p.body.d.record) };
  } finally { globalThis.fetch = pF; (globalThis as any).Deno = pD; Date.now = pN; applyCfg(); }
}
const core = (r: Awaited<ReturnType<typeof call>>) => ({
  states: Object.fromEntries(Object.entries(r.states).map(([k, s]) => [k, { pos: s.pos, equity: s.equity, markedEquity: s.markedEquity, stats: s.stats, day: s.day, cb: s.cb, lastEvalT: s.lastEvalT }])),
  events: r.evs, trades: r.trades, books: Object.fromEntries(Object.entries(r.res.books).map(([k, b]: [string, any]) => [k, { action: b.action, equity: b.equity, pos: b.pos, closed: b.closed }])),
});

test("regression: BTC and GOLD positions, equity, trades and events are identical with the observe checks on and off (entry run and later management runs)", async () => {
  const i = firstEntryBar(), states = { main: fresh(LOOSE), gold: fresh(LOOSE) };
  const on = await call({ states, i5: i }), off = await call({ states, i5: i, obs: false });
  assert.ok(on.states.main.pos && on.states.gold.pos, "fixture: both books open a position on this bar");
  assert.deepEqual(core(on), core(off));
  // the decision plan itself is unchanged; only the optional observe field is added
  assert.equal(on.decisions.length, 2); assert.equal(off.decisions.length, 2);
  for (const k of [0, 1]) { assert.deepEqual(on.decisions[k].plan, off.decisions[k].plan); assert.deepEqual(on.decisions[k].chosen, off.decisions[k].chosen); assert.equal(off.decisions[k].observe, undefined); }
  // with the checks off, lastRun carries none of the new fields
  for (const id of ["main", "gold"]) for (const k of ["positionChecks", "cfgGuard", "intentCheck", "timing", "marketCtxLog"]) assert.ok(!(k in off.lastRun[id]), `${id}.${k} absent when off`);
  assert.equal(off.lastRun.main.market.hl, undefined); assert.ok(!off.posts.some((p) => p.path === "dbv5_market_ctx"));
  for (const off2 of [12, 48, 144]) {
    const a = await call({ states: on.states, i5: i + off2 }), b = await call({ states: on.states, i5: i + off2, obs: false });
    assert.deepEqual(core(a), core(b), `management identical ${off2} bars later`); if (off2 === 48) assert.ok(a.trades.length > 0, "fixture: the comparison covers closed trades");
  }
});

test("run: lastRun carries market.hl, rangeDiag, positionChecks, cfgGuard, intentCheck and timing; the decision record carries the entry checks", async () => {
  const i = firstEntryBar(), r = await call({ states: { main: fresh(LOOSE), gold: fresh(LOOSE) }, i5: i }), L = r.lastRun.main;
  assert.deepEqual(Object.keys(L.market.hl).sort(), ["delisted", "fundingAprPct", "maxLeverage", "oi", "oraclePx", "premium", "szDecimals"]);
  assert.equal(L.market.hl.szDecimals, 5); assert.equal(L.market.hl.maxLeverage, 40); assert.equal(L.market.hl.delisted, false);
  assert.ok(Math.abs(L.market.hl.fundingAprPct - 87.6) < 1e-9); assert.equal(r.lastRun.gold.market.hl.szDecimals, 3);
  assert.deepEqual(Object.keys(L.market.rangeDiag).sort(), ["efficiency", "isRange", "touches"]);
  const pc = L.positionChecks; assert.ok(pc, "an open position is checked");
  assert.deepEqual(Object.keys(pc).sort(), ["degenerateStop", "impliedLeverage", "liqBufferX", "liqOk", "minNotionalOk", "notes", "notionalUsd", "ok", "qtyRepresentable"]);
  assert.ok(Math.abs(pc.notionalUsd - r.states.main.pos!.remainingQty * L.market.price) < 0.01);
  assert.deepEqual(L.cfgGuard.violations, []); assert.equal(L.cfgGuard.ok, true);
  assert.deepEqual(L.intentCheck, { ok: true, mismatches: [] });
  const rec = r.decisions.find((d: any) => d.sym === "BTC");
  assert.deepEqual(L.timing, { barCloseT: rec.timing.snapshotBarClose, evalStartMs: rec.timing.evaluationTimeMs, fillMs: rec.plan.openT, lagMs: rec.timing.evaluationLagMs });
  assert.equal(rec.schema, "deskbot.decision/1"); assert.equal(rec.observe.positionChecks.impliedLeverage > 0, true);
  assert.ok(!r.evs.some((e: any) => e.kind === "ERROR"), "no intent ERROR on a faithful entry");
  // a flat run: positionChecks null, intentCheck null, timing without a fill
  const flat = await call({ states: { main: fresh({ MIN_SCORE: 101 }), gold: fresh({ MIN_SCORE: 101 }) }, i5: i });
  assert.equal(flat.states.main.pos, null); assert.equal(flat.lastRun.main.positionChecks, null); assert.equal(flat.lastRun.main.intentCheck, null);
  assert.equal(flat.lastRun.main.timing.fillMs, null); assert.equal(flat.lastRun.main.timing.lagMs, flat.lastRun.main.timing.evalStartMs - flat.lastRun.main.timing.barCloseT);
});

test("market ctx history: one row per book per run; a table that is not migrated is skipped with one note and the run is unchanged", async () => {
  const i = firstEntryBar(), states = { main: fresh(LOOSE), gold: fresh(LOOSE) };
  const ok = await call({ states, i5: i }), rows = ok.posts.filter((p) => p.path === "dbv5_market_ctx").flatMap((p) => p.body);
  assert.deepEqual(rows.map((x: any) => x.symbol).sort(), ["BTC", "GOLD"]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["funding", "mark", "oi", "oracle", "premium", "symbol"]);
  assert.equal(ok.lastRun.main.marketCtxLog, "ok");
  const missing = await call({ states, i5: i, db: (p) => p.startsWith("dbv5_market_ctx") ? new Response(JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public.dbv5_market_ctx' in the schema cache" }), { status: 404 }) : undefined });
  assert.equal(missing.res.books.BTC.ok, true); assert.equal(missing.lastRun.main.marketCtxLog, "not_migrated"); assert.equal(missing.lastRun.gold.marketCtxLog, "not_migrated");
  const noted = [...missing.lastRun.main.notes, ...missing.lastRun.gold.notes].filter((n: string) => /dbv5_market_ctx not migrated/.test(n));
  assert.equal(noted.length, 1, "noted once");
  assert.ok(!missing.evs.some((e: any) => e.kind === "ERROR"));
  assert.deepEqual(core(missing).states, core(ok).states);
});

test("instrument metadata: a coin missing from (or delisted on) Hyperliquid is a note only; positions are unchanged", async () => {
  const i = firstEntryBar(), states = { main: fresh(LOOSE), gold: fresh(LOOSE) };
  const base = await call({ states, i5: i, obs: false });
  const gone = await call({ states, i5: i, universe: [UNIVERSE[0]] });
  assert.ok(gone.lastRun.gold.notes.includes("Instrument metadata: PAXG missing on Hyperliquid"), gone.lastRun.gold.notes.join(" | "));
  assert.ok(!gone.lastRun.main.notes.some((n: string) => /^Instrument metadata/.test(n)));
  assert.deepEqual(gone.lastRun.gold.market.hl, { szDecimals: null, maxLeverage: null, delisted: null, oraclePx: null, premium: null, fundingAprPct: null, oi: null });
  const baseGone = await call({ states, i5: i, universe: [UNIVERSE[0]], obs: false });
  assert.deepEqual(core(gone).states, core(baseGone).states, "same positions with and without the note");
  const del = await call({ states, i5: i, universe: [UNIVERSE[0], { ...UNIVERSE[1], isDelisted: true }] });
  assert.ok(del.lastRun.gold.notes.includes("Instrument metadata: PAXG delisted on Hyperliquid")); assert.equal(del.lastRun.gold.market.hl.delisted, true);
  assert.deepEqual(core(del).states, core(base).states, "delisted is observe-only: same positions");
});

test("config guard: a book override with an unknown key and an opt-in strategy is reported, the book still runs unchanged", async () => {
  const i = firstEntryBar(), cfg = { ...LOOSE, NOT_A_KEY: 1, RISK_SCALE: { SSR: 0.25 } };
  const r = await call({ states: { main: fresh(LOOSE), gold: fresh(cfg) }, i5: i }), g = r.lastRun.gold.cfgGuard;
  assert.equal(g.ok, false); assert.deepEqual(g.violations.map((v: any) => v.rule), ["UNKNOWN_KEY"]); assert.match(g.violations[0].msg, /NOT_A_KEY/);
  assert.deepEqual(g.info.map((v: any) => v.rule), ["OPT_IN_ENABLED"]);
  assert.equal(r.lastRun.main.cfgGuard.ok, true);
  const off = await call({ states: { main: fresh(LOOSE), gold: fresh(cfg) }, i5: i, obs: false });
  assert.deepEqual(core(r), core(off), "observe-only for books");
});
