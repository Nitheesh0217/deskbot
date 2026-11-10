// Structural fixes through the real edge handler. SYNTHETIC candles (same generator as cross_book.test.ts); every market serves the
// same bars, so differences between lanes / runs come only from configuration, data source and database answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initState, applyCfg, buildSeries, snapshot, evaluate, ensureState, type Bar, type State } from "../supabase/functions/deskbot-v5/engine.ts";
import { bookCfgId } from "../supabase/functions/deskbot-v5/track.ts";
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
const fresh = (cfg: Record<string, unknown>, enabled?: Record<string, boolean>) => { const s = initState(350, T0); s.cfg = cfg as never; if (enabled) s.enabled = { ...s.enabled, ...enabled }; return s; };

type Opt = { books?: string; states?: Record<string, State>; i5: number; method?: "GET" | "POST"; body?: unknown;
  db?: (path: string, method: string) => Response | undefined;   // override a database answer (undefined = default)
  hlFail?: (coin: string, interval: string) => boolean; bnFail?: (interval: string) => boolean };
async function call(o: Opt) {
  const nowMs = m5[o.i5].ct + 4000;
  const env: Record<string, string> = { SUPABASE_URL: "https://deskbot.test", SUPABASE_SERVICE_ROLE_KEY: "test-only", DESKBOT_CRON_SECRET: "test-only", NEWS_MODE: "off", DESKBOT_BOOKS: o.books ?? "BTC,GOLD" };
  const states = structuredClone(o.states ?? {}), lastRun: Record<string, any> = {}, posts: { path: string; body: any }[] = [];
  let handler!: (req: Request) => Promise<Response>; const pD = (globalThis as any).Deno, pF = globalThis.fetch, pN = Date.now;
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => { handler = h; } }; Date.now = () => nowMs;
  const json = (x: unknown, status = 200) => new Response(x == null ? "" : JSON.stringify(x), { status });
  const kl = (b: Bar) => [b.t, String(b.o), String(b.h), String(b.l), String(b.c), String(b.v), b.ct, "0", 0, "0", "0", "0"];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = decodeURIComponent(String(input)), body = init.body ? JSON.parse(String(init.body)) : null, method = init.method ?? "GET";
    if (url.startsWith("https://deskbot.test/rest/v1/")) {
      const path = url.split("/rest/v1/")[1], id = path.match(/dbv5_state\?id=eq\.(\w+)/)?.[1];
      const over = o.db?.(path, method); if (over) return over;
      if (method === "GET" && id) return json(states[id] ? [{ state: structuredClone(states[id]), cfg: states[id].cfg ?? null, enabled: states[id].enabled ?? null, last_run: lastRun[id] ?? null, updated_at: new Date(nowMs).toISOString() }] : []);
      if (method === "GET") return json([]);
      if (path === "rpc/dbv5_lease" || path === "rpc/dbv5_record_decision") return json(true);
      if (id && body?.state) { if (!casMatches(path, states[id])) return json([]); states[id] = structuredClone(body.state); if (body.last_run) lastRun[id] = body.last_run; return json([{ id }]); }
      posts.push({ path, body }); return json(null);
    }
    if (url.includes("hyperliquid")) {
      if (body.type === "metaAndAssetCtxs") return json([{ universe: [{ name: "BTC" }, { name: "PAXG" }] }, [{ funding: "0.0001", openInterest: "5", markPx: String(closes[o.i5]) }, { funding: "0.0001", openInterest: "5", markPx: String(closes[o.i5]) }]]);
      const { interval, startTime, endTime, coin } = body.req;
      if (o.hlFail?.(coin, interval)) return json({ error: "simulated feed outage" }, 500);
      return json(FR[interval].filter((b) => b.t >= startTime && b.t <= endTime && b.ct < nowMs).map((b) => ({ t: b.t, o: String(b.o), h: String(b.h), l: String(b.l), c: String(b.c), v: String(b.v) })));
    }
    if (url.includes("binance.vision")) {
      const q = new URL(url).searchParams, interval = q.get("interval")!, limit = +q.get("limit")!;
      if (o.bnFail?.(interval)) return json({ msg: "simulated" }, 500);
      if (limit === 26) return json([]);   // order flow (optional, shadow only)
      return json(FR[interval].filter((b) => b.ct < nowMs).slice(-limit).map(kl));
    }
    if (url.includes("alternative.me")) return json({ data: [{ value: "50", value_classification: "Neutral" }] });
    if (url.includes("deribit")) return json({ error: "offline in tests" }, 503);
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    await import("../supabase/functions/deskbot-v5/index.ts?x=" + Math.random());
    const r = await handler(o.method === "GET" ? new Request("https://edge.test") : new Request("https://edge.test", { method: "POST", headers: { "x-deskbot-key": "test-only", "Content-Type": "application/json" }, body: JSON.stringify(o.body ?? { action: "run" }) }));
    return { res: await r.json(), status: r.status, states, lastRun, posts, scanRow: posts.find((p) => p.path === "dbv5_scans")?.body?.[0], signals: posts.filter((p) => p.path.startsWith("dbv5_scan_signals")).flatMap((p) => p.body) };
  } finally { globalThis.fetch = pF; (globalThis as any).Deno = pD; Date.now = pN; applyCfg(); }
}

// ─── fix 2 + 4: scan books ──────────────────────────────────────────────────
const BTC_CFG = { ...LOOSE, TAKER_FEE: 0.0005 }, GOLD_CFG = { ...LOOSE, TAKER_FEE: 0.0009, EXIT_MODE: "BE_AT_TP1" };
const scanStates = () => ({ main: fresh(BTC_CFG, { SSR: false }), gold: fresh(GOLD_CFG) });

test("scan: each book's config applies only to its own symbol; other markets use the default config", async () => {
  const r = await call({ i5: firstEntryBar(), states: scanStates(), body: { action: "scan" } }), lanes = r.scanRow.work.lanes;
  assert.equal(r.res.ok, true); assert.deepEqual(r.scanRow.work.errors, []);
  assert.equal(lanes.BTC.bookCfgId, bookCfgId(BTC_CFG)); assert.equal(lanes.GOLD.bookCfgId, bookCfgId(GOLD_CFG));
  assert.notEqual(lanes.BTC.bookCfgId, lanes.GOLD.bookCfgId);
  for (const sym of ["ETH", "SOL", "DOGE"]) { assert.equal(lanes[sym].bookCfgId, bookCfgId(undefined), `${sym} is not a book: default config`); assert.equal(lanes[sym].shadowCfgId, null); }
  assert.ok(lanes.BTC.shadowIds.includes("SSR"), "BTC's own switch (SSR off) feeds its shadow lane");
  assert.equal(r.scanRow.markets.length, 10);
  const cfgOf = (sym: string) => r.signals.find((s: any) => s.sym === sym && s.lane === "book")?.cfg_id;
  assert.equal(cfgOf("BTC"), lanes.BTC.bookCfgId); assert.equal(cfgOf("GOLD"), lanes.GOLD.bookCfgId); assert.equal(cfgOf("ETH"), bookCfgId(undefined));
});

test("scan: a book whose state cannot be loaded is skipped (no default-config lane under its label) and the error is reported", async () => {
  const ok = await call({ i5: firstEntryBar(), states: scanStates(), body: { action: "scan" } });
  const r = await call({ i5: firstEntryBar(), states: scanStates(), body: { action: "scan" }, db: (p, m) => (m === "GET" && p.startsWith("dbv5_state?id=eq.gold") ? new Response("upstream down", { status: 503 }) : undefined) });
  const w = r.scanRow.work; assert.ok(ok.signals.some((s: any) => s.sym === "GOLD"), "fixture: GOLD fires when its book loads");
  assert.equal(w.lanes.GOLD, undefined, "no GOLD book or shadow lane");
  assert.ok(!r.signals.some((s: any) => s.sym === "GOLD"), "no GOLD rows recorded under a default config");
  assert.ok(w.errors.some((e: string) => /^GOLD book state not loaded \(DB dbv5_state 503: upstream down\): book and shadow lanes skipped/.test(e)), w.errors.join(" | "));
  assert.deepEqual(w.lanes.BTC, ok.scanRow.work.lanes.BTC, "the other book is unaffected");
  assert.deepEqual(r.signals.filter((s: any) => s.sym !== "GOLD"), ok.signals.filter((s: any) => s.sym !== "GOLD"));
  assert.ok(r.scanRow.markets.some((m: any) => m.sym === "GOLD" && m.ok !== false), "the GOLD market row itself is still scanned");
});

// ─── fix 8: dead code stays removed (carryFromV3 is kept by owner decision) ──
test("dead exports providerAvailability / allStates are gone; carryFromV3 stays", async () => {
  const { readFileSync } = await import("node:fs"), src = (f: string) => readFileSync(new URL(`../supabase/functions/deskbot-v5/${f}`, import.meta.url), "utf8");
  assert.ok(!/providerAvailability/.test(src("ai.ts"))); assert.ok(!/allStates/.test(src("coverage.ts")));
  assert.match(src("index.ts"), /async function carryFromV3\(/);
});

// ─── fix 3: backtest assumptions describe the costs the run used ────────────
test("backtest: the assumptions text reports the overridden costs, not the restored defaults", async () => {
  const bt = (cfg?: Record<string, unknown>) => call({ i5: 34000, body: { action: "backtest", sym: "BTC", days: 7, save: false, combinedOnly: true, ...(cfg ? { cfg } : {}) } });
  const over = (await bt({ TAKER_FEE: 0.0009, SLIPPAGE: 0.0004, MAKER_FEE: 0.0002, BT_FUNDING_PER_HOUR: 0.00003 })).res, base = (await bt()).res;
  assert.ok(over.bars5m >= 2000, "fixture: enough bars to run");
  assert.match(over.assumptions, /taker 0\.09\d*% \+ 0\.04\d*% slippage; TPs maker 0\.02\d*%; funding 0\.003\d*%\/h/, over.assumptions);
  assert.match(base.assumptions, /taker 0\.045\d*% \+ 0\.02\d*% slippage; TPs maker 0\.015\d*%; funding 0\.00125\d*%\/h/, base.assumptions);
  assert.ok(over.combined.all.n === 0 || over.combined.all.expR !== base.combined.all.expR || over.combined.endEquity !== base.combined.endEquity, "the override really changed the run");
});

// ─── fix 6 + 7: status identity and visible errors ──────────────────────────
const err = (status: number, code: string, message: string) => new Response(JSON.stringify({ code, message }), { status });
test("status: reports the deployed source identity (build_info.ts)", async () => {
  const { BUILD } = await import("../supabase/functions/deskbot-v5/build_info.ts");
  const r = await call({ i5: 34000, method: "GET" });
  assert.equal(r.status, 200); assert.deepEqual(r.res.build, { sourceSha256: BUILD.sourceSha256 }); assert.match(r.res.build.sourceSha256, /^[0-9a-f]{64}$/);
});

test("status: a table that is not migrated is null without an error; any other failure is exposed as an error string", async () => {
  const a = await call({ i5: 34000, method: "GET", db: (p) => p.startsWith("dbv5_filter_verdicts") ? err(500, "XX000", "verdicts exploded") : p.startsWith("dbv5_scan_signals") ? err(404, "42P01", 'relation "public.dbv5_scan_signals" does not exist') : undefined });
  assert.equal(a.res.experiment, null); assert.match(a.res.experimentError, /verdicts exploded/);
  assert.equal(a.res.track, null); assert.equal(a.res.trackError, null, "not migrated: expected, no error");
  const b = await call({ i5: 34000, method: "GET", db: (p) => p.startsWith("dbv5_filter_verdicts") ? err(404, "PGRST205", "Could not find the table 'public.dbv5_filter_verdicts' in the schema cache") : p.startsWith("dbv5_scan_signals") ? err(503, "", "pool exhausted") : undefined });
  assert.equal(b.res.experiment, null); assert.equal(b.res.experimentError, null);
  assert.equal(b.res.track, null); assert.match(b.res.trackError, /pool exhausted/, "a transient failure is not retried as an old schema and not hidden");
  const c = await call({ i5: 34000, method: "GET", db: (p) => p.startsWith("dbv5_calls") ? err(500, "", "calls down") : undefined });
  assert.ok(c.res.track, "the setup record still renders"); assert.match(c.res.trackError, /^calls: .*calls down/);
  const d = await call({ i5: 34000, method: "GET" });
  assert.equal(d.res.experimentError, null); assert.equal(d.res.trackError, null); assert.equal(d.res.experiment.started, false);
});

test("run: the 1m-candle fallback is kept and leaves a note", async () => {
  const i = firstEntryBar(), r = await call({ books: "BTC", states: { main: fresh(LOOSE) }, i5: i, hlFail: (_c, iv) => iv === "1m", bnFail: (iv) => iv === "1m" });
  assert.equal(r.res.books.BTC.ok, true, "the run still completes");
  assert.ok(r.lastRun.main.notes.some((n: string) => /^Warning: 1m candles unavailable \(Binance 1m HTTP 500\); the 1m trade-manager view is empty this run/.test(n)), r.lastRun.main.notes.join(" | "));
  const ok = await call({ books: "BTC", states: { main: fresh(LOOSE) }, i5: i });
  assert.ok(!ok.lastRun.main.notes.some((n: string) => /1m candles/.test(n)));
  assert.equal(!!r.states.main.pos, !!ok.states.main.pos, "a missing 1m view does not change the entry decision");
});

// ─── fix 1: one feed per evaluation ─────────────────────────────────────────
test("run: frames from different feeds are recorded per frame and block NEW entries (same bars from one feed open a position)", async () => {
  const i = firstEntryBar(), states = { main: fresh(LOOSE) };
  const same = await call({ books: "BTC", states, i5: i });
  assert.ok(same.states.main.pos, "fixture: one feed, the setup opens a position");
  assert.deepEqual(same.lastRun.main.sources, { m5: "hyperliquid", m15: "hyperliquid", h1: "hyperliquid", h4: "hyperliquid" });
  // Hyperliquid 1h fails: candles() serves 1h from Binance (identical bars), the other frames from Hyperliquid
  const mixed = await call({ books: "BTC", states, i5: i, hlFail: (_c, iv) => iv === "1h" });
  assert.equal(mixed.states.main.pos, null, "no entry on mixed feeds");
  assert.deepEqual(mixed.lastRun.main.sources, { m5: "hyperliquid", m15: "hyperliquid", h1: "binance", h4: "hyperliquid" });
  assert.equal(mixed.lastRun.main.source, "hyperliquid", "the m5 source field is kept for older readers");
  assert.deepEqual(mixed.res.books.BTC.sources, mixed.lastRun.main.sources);
  assert.ok(mixed.lastRun.main.notes.some((n: string) => /^Entries paused: evaluation frames came from different feeds \(m5 hyperliquid, m15 hyperliquid, h1 binance, h4 hyperliquid\)/.test(n)));
  const skip = mixed.posts.find((p) => p.path === "dbv5_events")?.body.find((e: any) => e.kind === "SKIP");
  assert.match(skip.msg, /different feeds/, "the SKIP event says why");
  assert.equal(mixed.states.main.lastEvalT, same.states.main.lastEvalT, "the bar is still evaluated once");
});

test("run: an open position is still managed when feeds are mixed", async () => {
  const i = firstEntryBar(), opened = (await call({ books: "BTC", states: { main: fresh(LOOSE) }, i5: i })).states.main;
  const pick = (s: State) => ({ equity: s.equity, pos: s.pos && { stop: s.pos.stop, remainingQty: s.pos.remainingQty, exits: s.pos.exits }, lastBarT: s.lastBarT, trades: s.stats.all.n });
  for (const off of [12, 48, 144]) {
    const a = await call({ books: "BTC", states: { main: opened }, i5: i + off }), b = await call({ books: "BTC", states: { main: opened }, i5: i + off, hlFail: (_c, iv) => iv === "4h" });
    assert.equal(b.lastRun.main.sources.h4, "binance");
    assert.deepEqual(pick(b.states.main), pick(a.states.main), `management identical ${off} bars later`);
  }
});
