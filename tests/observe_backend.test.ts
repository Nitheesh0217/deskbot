// Observability fields in lastRun (observe.ts): per-timeframe `frames` and decision `receipts`, through the real edge handler.
// SYNTHETIC candles (same generator and harness as backend_structure.test.ts). These tests only read lastRun; trading is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initState, applyCfg, buildSeries, snapshot, evaluate, ensureState, STRATEGIES, type Bar, type State } from "../supabase/functions/deskbot-v5/engine.ts";
import { receiptsFor, frameInfo } from "../supabase/functions/deskbot-v5/observe.ts";
import { casMatches } from "./helpers/cas.ts";

const M5 = 300_000, T0 = Date.UTC(2026, 0, 1);
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const closes = (() => { const r = seeded(1), c = [30000]; for (let i = 1; i < 36000; i++) c.push(c[i - 1] * (1 + 0.00003 * Math.sin(i / 900) + (r() - 0.5) * 0.004)); return c; })();
const m5: Bar[] = closes.map((x, i) => { const o = i ? closes[i - 1] : x, w = x * 0.0015; return { t: T0 + i * M5, o, h: Math.max(o, x) + w, l: Math.min(o, x) - w, c: x, v: 10, ct: T0 + (i + 1) * M5 - 1 }; });
const agg = (k: number): Bar[] => { const out: Bar[] = []; for (let i = 0; i + k <= m5.length; i += k) { const s = m5.slice(i, i + k); out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)), c: s[k - 1].c, v: 0, ct: s[k - 1].ct }); } return out; };
const FR: Record<string, Bar[]> = { "1m": m5, "5m": m5, "15m": agg(3), "1h": agg(12), "4h": agg(48) };
const LOOSE = { MIN_SCORE: 0 };
const firstEntryBar = (() => { let hit: number | null = null; return () => { if (hit != null) return hit; applyCfg(LOOSE as never); const S = buildSeries({ m5, m15: FR["15m"], h1: FR["1h"], h4: FR["4h"] });
  for (let i = 34000; i < 35000 && hit == null; i++) { const st = ensureState(initState(350, T0)); if (evaluate(snapshot(S, i), st.enabled, S, st).signals.length) hit = i; } applyCfg(); if (hit == null) throw new Error("no candidate"); return hit; }; })();
const fresh = (cfg: Record<string, unknown>) => { const s = initState(350, T0); s.cfg = cfg as never; return s; };

type Opt = { states: Record<string, State>; i5: number; hlFail?: (coin: string, interval: string) => boolean };
async function call(o: Opt) {
  const nowMs = m5[o.i5].ct + 4000;
  const env: Record<string, string> = { SUPABASE_URL: "https://deskbot.test", SUPABASE_SERVICE_ROLE_KEY: "test-only", DESKBOT_CRON_SECRET: "test-only", NEWS_MODE: "off", DESKBOT_BOOKS: "BTC" };
  const states = structuredClone(o.states), lastRun: Record<string, any> = {};
  let handler!: (req: Request) => Promise<Response>; const pD = (globalThis as any).Deno, pF = globalThis.fetch, pN = Date.now;
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => { handler = h; } }; Date.now = () => nowMs;
  const json = (x: unknown, status = 200) => new Response(x == null ? "" : JSON.stringify(x), { status });
  const kl = (b: Bar) => [b.t, String(b.o), String(b.h), String(b.l), String(b.c), String(b.v), b.ct, "0", 0, "0", "0", "0"];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = decodeURIComponent(String(input)), body = init.body ? JSON.parse(String(init.body)) : null, method = init.method ?? "GET";
    if (url.startsWith("https://deskbot.test/rest/v1/")) {
      const path = url.split("/rest/v1/")[1], id = path.match(/dbv5_state\?id=eq\.(\w+)/)?.[1];
      if (method === "GET" && id) return json(states[id] ? [{ state: structuredClone(states[id]), cfg: states[id].cfg ?? null, enabled: states[id].enabled ?? null, last_run: lastRun[id] ?? null, updated_at: new Date(nowMs).toISOString() }] : []);
      if (method === "GET") return json([]);
      if (path === "rpc/dbv5_lease" || path === "rpc/dbv5_record_decision") return json(true);
      if (id && body?.state) { if (!casMatches(path, states[id])) return json([]); states[id] = structuredClone(body.state); if (body.last_run) lastRun[id] = body.last_run; return json([{ id }]); }
      return json(null);
    }
    if (url.includes("hyperliquid")) {
      if (body.type === "metaAndAssetCtxs") return json([{ universe: [{ name: "BTC" }, { name: "PAXG" }] }, [{ funding: "0.0001", openInterest: "5", markPx: String(closes[o.i5]) }, { funding: "0.0001", openInterest: "5", markPx: String(closes[o.i5]) }]]);
      const { interval, startTime, endTime, coin } = body.req;
      if (o.hlFail?.(coin, interval)) return json({ error: "simulated feed outage" }, 500);
      return json(FR[interval].filter((b) => b.t >= startTime && b.t <= endTime && b.ct < nowMs).map((b) => ({ t: b.t, o: String(b.o), h: String(b.h), l: String(b.l), c: String(b.c), v: String(b.v) })));
    }
    if (url.includes("binance.vision")) {
      const q = new URL(url).searchParams, interval = q.get("interval")!, limit = +q.get("limit")!;
      if (limit === 26) return json([]);
      return json(FR[interval].filter((b) => b.ct < nowMs).slice(-limit).map(kl));
    }
    if (url.includes("alternative.me")) return json({ data: [{ value: "50", value_classification: "Neutral" }] });
    if (url.includes("deribit")) return json({ error: "offline in tests" }, 503);
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    await import("../supabase/functions/deskbot-v5/index.ts?x=" + Math.random());
    const r = await handler(new Request("https://edge.test", { method: "POST", headers: { "x-deskbot-key": "test-only", "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) }));
    return { res: await r.json(), states, lr: lastRun.main, nowMs };
  } finally { globalThis.fetch = pF; (globalThis as any).Deno = pD; Date.now = pN; applyCfg(); }
}
const OUTCOMES = new Set(["EXECUTED", "WAIT", "GATE_REJECTED", "NOT_DUE", "DISABLED", "NO_SETUP", "SHADOW_SIGNAL"]);
const executed = (lr: any) => (lr.receipts ?? []).filter((r: any) => r.outcome === "EXECUTED");

test("lastRun.frames: one entry per evaluation frame with source, last closed bar, receipt time and bar count", async () => {
  const i = firstEntryBar(), r = await call({ states: { main: fresh(LOOSE) }, i5: i });
  assert.deepEqual(Object.keys(r.lr.frames), ["m5", "m15", "h1", "h4"]);
  for (const k of ["m5", "m15", "h1", "h4"]) {
    const f = r.lr.frames[k];
    assert.deepEqual(Object.keys(f).sort(), ["bars", "gaps", "lastClosedBarT", "receivedAtMs", "source"]); assert.ok(Number.isInteger(f.gaps) && f.gaps >= 0);
    assert.equal(f.source, r.lr.sources[k], `${k} source matches lastRun.sources`);
    assert.ok(f.bars > 0 && Number.isInteger(f.bars)); assert.equal(f.receivedAtMs, r.nowMs, "receipt time is the (mocked) wall clock of the fetch");
    assert.ok(f.lastClosedBarT < r.nowMs, "the newest bar is closed");
  }
  assert.equal(r.lr.frames.m5.lastClosedBarT, m5[i].ct); assert.equal(r.lr.frames.m5.lastClosedBarT, r.lr.market.barT);
});

test("lastRun.receipts: newest bar, one per strategy, EXECUTED exactly once and only for the position actually opened", async () => {
  const i = firstEntryBar(), r = await call({ states: { main: fresh(LOOSE) }, i5: i });
  assert.ok(r.states.main.pos, "fixture: a position opens on this bar");
  const rc = r.lr.receipts;
  assert.equal(rc.filter((x: any) => x.outcome !== "SHADOW_SIGNAL").length, STRATEGIES.length);
  for (const x of rc) { assert.ok(OUTCOMES.has(x.outcome), x.outcome); assert.equal(typeof x.reason, "string"); assert.ok(x.reason.length <= 90); assert.equal(x.barT, r.lr.market.barT); }
  assert.deepEqual(executed(r.lr).map((x: any) => x.strategy), [r.states.main.pos.strategy]);
  assert.match(r.lr.action, /^OPEN_/);
  assert.ok(JSON.stringify(rc).length < 2048, `receipts stay compact (${JSON.stringify(rc).length} bytes)`);
});

test("lastRun.receipts: mixed feeds block the entry; the setup is GATE_REJECTED with the recorded reason, never EXECUTED", async () => {
  const i = firstEntryBar(), base = await call({ states: { main: fresh(LOOSE) }, i5: i }), want = base.states.main.pos.strategy;
  const r = await call({ states: { main: fresh(LOOSE) }, i5: i, hlFail: (_c, iv) => iv === "1h" });
  assert.equal(r.states.main.pos, null); assert.equal(r.lr.frames.h1.source, "binance");
  assert.equal(executed(r.lr).length, 0);
  const x = r.lr.receipts.find((y: any) => y.strategy === want);
  assert.equal(x.outcome, "GATE_REJECTED"); assert.equal(x.code, "PORTFOLIO_BLOCKED"); assert.match(x.reason, /different feeds/);
});

test("lastRun.receipts: with a position held, later bars show no EXECUTED; a re-run on the same bar reports no receipts", async () => {
  const i = firstEntryBar(), opened = (await call({ states: { main: fresh(LOOSE) }, i5: i })).states.main;
  const same = await call({ states: { main: opened }, i5: i });
  assert.equal(same.lr.receipts, null, "no new bar evaluated: nothing invented");
  let seen = 0;
  for (const off of [1, 12, 48]) {
    const r = await call({ states: { main: opened }, i5: i + off });
    if (!Array.isArray(r.lr.receipts)) continue; seen++;
    assert.equal(executed(r.lr).length, 0, `bar +${off}: no position was opened`);
    for (const x of r.lr.receipts) if (x.code === "PORTFOLIO_BLOCKED" && /Position already open/.test(x.reason)) assert.equal(x.outcome, "WAIT");
  }
  assert.ok(seen > 0, "at least one later bar was evaluated");
});

test("receiptsFor / frameInfo: pure mapping", () => {
  assert.equal(receiptsFor(null, { barT: 1, opened: null }), null);
  const cov = [{ id: "SSR", code: "ENTERED", reason: "Entered" }, { id: "EMA_PB", code: "NOT_SELECTED", reason: "Lower score" }, { id: "HTF_SWEEP", code: "INSUFFICIENT_DATA", reason: "warming up" }, { id: "D_THRUST", code: "PORTFOLIO_BLOCKED", reason: "Circuit-breaker: 3 losses" }] as any;
  const none = receiptsFor(cov, { barT: 9, opened: null })!;
  assert.equal(none[0].outcome, "GATE_REJECTED", "ENTERED without an opened position is never EXECUTED");
  const yes = receiptsFor(cov, { barT: 9, opened: { strategy: "SSR" }, shadow: [{ strategy: "SWEEP_REV", barT: 8 }] })!;
  assert.deepEqual(yes.map((x) => [x.outcome, x.code ?? null]), [["EXECUTED", null], ["WAIT", "NOT_SELECTED"], ["WAIT", "INSUFFICIENT_DATA"], ["GATE_REJECTED", "PORTFOLIO_BLOCKED"], ["SHADOW_SIGNAL", null]]);
  assert.equal(yes[4].barT, 8);
  assert.equal(receiptsFor([{ id: "SSR", code: "NO_SETUP", reason: "x".repeat(300) }] as any, { barT: 1, opened: null })![0].reason.length, 90);
  const f = frameInfo({ m5: { bars: [], source: "hyperliquid" }, m15: { bars: m5.slice(0, 2), source: "binance" }, h1: { bars: [], source: "hyperliquid" }, h4: { bars: [], source: "hyperliquid" } }, { m15: 5 });
  assert.deepEqual(f.m5, { source: "hyperliquid", lastClosedBarT: null, receivedAtMs: null, bars: 0, gaps: 0 });
  assert.deepEqual(f.m15, { source: "binance", lastClosedBarT: m5[1].ct, receivedAtMs: 5, bars: 2, gaps: 0 });
});

test("missing-bar count per frame is observe-only data and counts each absent bar", async () => {
  const { frameInfo, gapCount } = await import("../supabase/functions/deskbot-v5/observe.ts");
  const mk = (ts: number[], ms: number) => ts.map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1, ct: t + ms - 1 }));
  assert.equal(gapCount(mk([0, 300_000, 600_000], 300_000), 300_000), 0);
  assert.equal(gapCount(mk([0, 300_000, 1_200_000], 300_000), 300_000), 2, "two 5m bars missing between 300000 and 1200000");
  const f = frameInfo({ m5: { bars: mk([0, 900_000], 300_000), source: "hyperliquid" }, m15: { bars: [], source: "hyperliquid" }, h1: { bars: [], source: "hyperliquid" }, h4: { bars: [], source: "binance" } }, {});
  assert.equal(f.m5.gaps, 2); assert.equal(f.m15.gaps, 0); assert.equal(f.h4.source, "binance");
});
