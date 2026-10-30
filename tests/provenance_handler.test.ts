// End-to-end through the real edge handler: a new paper entry must (1) persist its decision evidence BEFORE state,
// (2) fail closed when the evidence write fails, and (3) be replayable from exactly the rows the handler wrote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initState, openPosition, applyCfg, buildSeries, snapshot, evaluate, ensureState, type Bar, type State } from "../supabase/functions/deskbot-v5/engine.ts";
import { replayDecision, decisionIdFor } from "../supabase/functions/deskbot-v5/provenance.ts";
import { casMatches } from "./helpers/cas.ts";

const M5 = 300_000, T0 = Date.UTC(2026, 0, 1);
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const closes = (() => { const r = seeded(1), c = [30000]; for (let i = 1; i < 36000; i++) c.push(c[i - 1] * (1 + 0.00003 * Math.sin(i / 900) + (r() - 0.5) * 0.004)); return c; })();
const mk = (c: number[], tf: number): Bar[] => c.map((x, i) => { const o = i ? c[i - 1] : x, w = x * 0.0015; return { t: T0 + i * tf, o, h: Math.max(o, x) + w, l: Math.min(o, x) - w, c: x, v: 10, ct: T0 + (i + 1) * tf - 1 }; });
const m5 = mk(closes, M5);
const agg = (k: number): Bar[] => { const out: Bar[] = []; for (let i = 0; i + k <= m5.length; i += k) { const s = m5.slice(i, i + k); out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)), c: s[k - 1].c, v: 0, ct: s[k - 1].ct }); } return out; };
// 1m path derived from the synthetic 5m bars (high/low placed inside the 5m bar) so open positions can be managed
const m1: Bar[] = m5.flatMap((b) => Array.from({ length: 5 }, (_, k) => { const o = b.o + (b.c - b.o) * k / 5, c = b.o + (b.c - b.o) * (k + 1) / 5; return { t: b.t + k * 60_000, o, c, h: k === 1 ? b.h : Math.max(o, c), l: k === 2 ? b.l : Math.min(o, c), v: 2, ct: b.t + (k + 1) * 60_000 - 1 }; }));
const FR: Record<string, Bar[]> = { "1m": m1, "5m": m5, "15m": agg(3), "1h": agg(12), "4h": agg(48) };
const MS: Record<string, number> = { "1m": 60_000, "5m": M5, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000 };
const LOOSE = { MIN_SCORE: 0 };

function candidateBars(): number[] {   // 5m bar indices with an entry signal under the loose score floor, scanned on the full series
  applyCfg(LOOSE as never); const S = buildSeries({ m5, m15: FR["15m"], h1: FR["1h"], h4: FR["4h"] }), out: number[] = [];
  for (let i = 34000; i < 35000; i++) { const st = ensureState(initState(350, T0)); if (evaluate(snapshot(S, i, { funding: 0.0001, oi: 5, markPx: null, fng: 50 }), st.enabled, S, st).signals.length) out.push(i); }
  applyCfg(); return out;
}

type World = { state: State; calls: string[]; decision: any; events: any[]; trades: any[] };
const newWorld = (): World => { const state = initState(350, T0); state.cfg = LOOSE as never; state.lastEvalT = 0; return { state, calls: [], decision: null, events: [], trades: [] }; };
async function runAt(i5: number, failDecision: boolean, w: World = newWorld()) {
  const nowMs = m5[i5].ct + 4000;
  const env: Record<string, string> = { SUPABASE_URL: "https://deskbot.test", SUPABASE_SERVICE_ROLE_KEY: "test-only", DESKBOT_CRON_SECRET: "test-only", NEWS_MODE: "off", DESKBOT_BOOKS: "BTC", AGENT_AI: "off" };
  const calls = w.calls;
  let handler!: (req: Request) => Promise<Response>;
  const pDeno = (globalThis as any).Deno, pFetch = globalThis.fetch, pNow = Date.now;
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => { handler = h; } };
  let tick = 0; Date.now = () => nowMs + tick++;   // advances 1 ms per call so run start, receipts and completion are distinguishable
  const json = (x: unknown, status = 200) => new Response(x == null ? "" : JSON.stringify(x), { status });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input), body = init.body ? JSON.parse(String(init.body)) : null;
    if (url.startsWith("https://deskbot.test/rest/v1/")) {
      const path = url.split("/rest/v1/")[1];
      if (init.method === "GET") return path.startsWith("dbv5_state?") ? json([{ state: structuredClone(w.state), updated_at: new Date(nowMs).toISOString() }]) : json([]);
      calls.push(path.split("?")[0]);
      if (path === "rpc/dbv5_lease") return json(true);
      if (path === "rpc/dbv5_record_decision") { if (failDecision) return json({ message: "down" }, 500); w.decision = body; return json(true); }
      if (path.startsWith("dbv5_state?") && body.state) { if (!casMatches(path, w.state)) return json([]); w.state = structuredClone(body.state); return json([{ id: "main" }]); }
      if (path === "dbv5_events") w.events = w.events.concat(body);
      if (path === "dbv5_trades") w.trades = w.trades.concat(body);
      return json(null);
    }
    if (url.includes("hyperliquid")) {
      if (body.type === "metaAndAssetCtxs") return json([{ universe: [{ name: "BTC" }] }, [{ funding: "0.0001", openInterest: "5", markPx: String(closes[i5]) }]]);
      const { interval, startTime, endTime } = body.req;
      return json(FR[interval].filter((b) => b.t >= startTime && b.t <= endTime && b.ct < nowMs).map((b) => ({ t: b.t, o: String(b.o), h: String(b.h), l: String(b.l), c: String(b.c), v: String(b.v) })));
    }
    if (url.includes("alternative.me")) return json({ data: [{ value: "50", value_classification: "Neutral" }] });
    if (url.includes("binance.vision")) return json([]);
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    await import("../supabase/functions/deskbot-v5/index.ts?x=" + Math.random());
    const res = await (await handler(new Request("https://edge.test", { method: "POST", headers: { "x-deskbot-key": "test-only", "Content-Type": "application/json" }, body: '{"action":"run"}' }))).json();
    return { res, calls, decision: w.decision, state: w.state, events: w.events, trades: w.trades, world: w };
  } finally { globalThis.fetch = pFetch; (globalThis as any).Deno = pDeno; Date.now = pNow; applyCfg(); }
}

test("a new entry writes its decision first, links events, and replays from the rows the handler wrote", async () => {
  let got: Awaited<ReturnType<typeof runAt>> | null = null;
  for (const i of candidateBars()) { const r = await runAt(i, false); if (r.decision) { got = r; break; } }
  assert.ok(got, "handler opened a paper entry for some candidate bar"); const { calls, decision, state, events } = got!;
  assert.ok(calls.indexOf("rpc/dbv5_record_decision") >= 0 && calls.indexOf("rpc/dbv5_record_decision") < calls.indexOf("dbv5_state"), "decision persisted before state");
  assert.ok(state.pos, "position persisted"); assert.equal(decision.d.id, decisionIdFor(state.pos!.id));
  const open = events.find((e) => e.kind === "OPEN"); assert.equal(open.data.decisionId, decision.d.id);
  assert.equal(decision.inputs.length, 4);
  const rows = decision.inputs.map((r: any) => ({ tf: r.tf, source: r.source, bars: r.bars, barsSha256: r.bars_sha256 }));
  const out = await replayDecision(decision.d.record, rows, decision.d.record_sha256);
  assert.deepEqual(out.diffs, []);
  assert.equal(decision.d.record.plan.entry, state.pos!.entry); assert.equal(decision.d.record.plan.riskAmt, state.pos!.riskAmt); assert.equal(decision.d.record.plan.stop0, state.pos!.stop0);
  assert.equal(decision.d.record.governance.experimentApproval.status, "unapproved");
  const tm = decision.d.record.timing, rx = tm.inputReceivedAtMs;
  assert.equal(tm.evaluationTimeMs, tm.runStartMs); assert.equal(decision.d.record.plan.openT, tm.evaluationTimeMs);
  for (const k of ["m5", "m15", "h1", "h4", "ctx", "flow"]) assert.ok(rx[k] != null && rx[k] > tm.runStartMs, `${k} receipt is a real later time, not run start`);
  assert.ok(tm.decisionCompletedMs > Math.max(...["m5", "m15", "h1", "h4", "ctx", "flow"].map((k) => rx[k])), "completion after every receipt");
  assert.equal(decision.d.ts, decision.d.record.decidedAt); assert.equal(decision.d.record.dataAvailability.fetchedAtMs, undefined);
});

test("a failed decision write rejects the entry only: the run still persists and the failure is visible", async () => {
  let checked = false;
  for (const i of candidateBars()) {
    const ok = await runAt(i, false); if (!ok.decision) continue;
    const r = await runAt(i, true); checked = true;
    assert.equal(r.res.books.BTC.ok, true); assert.match(r.res.books.BTC.provenanceError, /decision evidence not recorded/);
    assert.equal(r.state.pos, null, "no position persisted"); assert.ok(r.calls.includes("dbv5_state"), "run state saved");
    assert.ok(!r.events.some((e) => e.kind === "OPEN"), "no OPEN event"); assert.ok(r.events.some((e) => e.kind === "ERROR" && e.data?.provenance), "ERROR event is visible");
    assert.equal(r.state.day.trades, 0, "replacement not counted"); break;
  }
  assert.ok(checked, "found an entry bar to test");
});

/** A long that was opened a few bars earlier with its stop moved ABOVE the market (test setup only) so management closes it on this run. */
function worldWithClosingPosition(i5: number) {
  const w = newWorld(), st = w.state; applyCfg(LOOSE as never);
  const openT = m5[i5 - 6].ct + 1000, entry = closes[i5 - 6];
  const p = openPosition(st, { strategy: "TREND_MTF", dir: "long", entryRef: entry, stop: entry * 0.99, score: 90, why: [], regime: "TREND", barT: m5[i5 - 6].ct } as never, entry, openT)!;
  p.stop = closes[i5] * 1.2; st.lastBarT = openT; st.lastEvalT = m5[i5 - 1].ct; applyCfg();
  return { w, p };
}

test("close + replacement: a failed replacement decision never discards the completed closure, and a retry does not double-realize it", async () => {
  let done = false;
  for (const i of candidateBars()) {
    const base = worldWithClosingPosition(i); const ok = await runAt(i, false, base.w);
    if (!ok.decision || ok.trades.length !== 1 || !ok.state.pos) continue;      // need: closure AND a replacement entry in the baseline run
    const f = worldWithClosingPosition(i); const r = await runAt(i, true, f.w);
    // 1. the original closure is persisted exactly as in the baseline run
    assert.equal(r.trades.length, 1); assert.equal(r.trades[0].id, base.p.id); assert.equal(r.trades[0].id, ok.trades[0].id);
    for (const k of ["net", "r", "fees", "funding", "entry", "exit_avg"] as const) assert.equal(r.trades[0][k], ok.trades[0][k], `closure ${k} identical to the run without the failure`);
    assert.deepEqual(r.trades[0].data.exits, ok.trades[0].data.exits); assert.equal(r.trades[0].data.originalQty, ok.trades[0].data.originalQty);
    assert.equal(r.state.stats.all.n, 1); assert.equal(r.state.stats.all.net, ok.trades[0].net);
    assert.ok(Math.abs(r.state.equity - (350 + ok.trades[0].net)) < 1e-9, "equity = 350 start + closure net; the rejected replacement charged no entry fee");
    assert.ok(Math.abs(ok.state.equity + ok.state.pos!.entryFee - r.state.equity) < 1e-9, "failed-run equity = baseline equity before the replacement's entry fee");
    // 2. the replacement is not persisted and was not counted
    assert.equal(r.state.pos, null); assert.ok(!r.events.some((e) => e.kind === "OPEN")); assert.equal(r.state.day.trades, ok.state.day.trades - 1);
    // management events for the closure are persisted and linked to the ORIGINAL decision id
    const closeEv = r.events.find((e) => e.kind === "LOSS" || e.kind === "WIN"); assert.ok(closeEv, "closure event persisted"); assert.equal(closeEv.data.decisionId, `D-${base.p.id}`);
    // 3. the failure is visible
    assert.match(r.res.books.BTC.provenanceError, /decision evidence not recorded/); assert.ok(r.events.some((e) => e.kind === "ERROR" && e.data?.provenance));
    assert.equal(r.res.books.BTC.closed, 1);
    // 4. retry on the same bar: nothing is realized twice
    const equityAfter = r.state.equity, nTrades = r.trades.length; const again = await runAt(i, false, f.w);
    assert.equal(again.trades.length, nTrades, "no second trade write for the same closure"); assert.equal(again.state.equity, equityAfter); assert.equal(again.state.stats.all.n, 1);
    assert.equal(again.decision, null, "the consumed bar is not re-evaluated"); done = true; break;
  }
  assert.ok(done, "found a bar with closure + replacement to test");
});

test("full lifecycle: decision -> management events -> closed trade, all linked and reconciled to the original plan", async () => {
  const { reconcileOutcome } = await import("../supabase/functions/deskbot-v5/provenance.ts");
  for (const i of candidateBars()) {
    const w = newWorld(); const first = await runAt(i, false, w); if (!first.decision) continue;
    for (let j = i + 12; j < i + 1800 && w.trades.length === 0; j += 12) await runAt(j, false, w);   // keep running the real handler on later bars
    if (!w.trades.length) continue;
    const dec = w.decision.d, tr = w.trades[0], t = tr.data;
    assert.equal(t.decisionId, dec.id); assert.equal(tr.id, dec.record.positionId);
    assert.deepEqual(reconcileOutcome(dec.record, t).diffs, [], "closed trade reconciles to the original plan");
    const linked = w.events.filter((e) => e.data?.decisionId === dec.id).map((e) => e.kind);
    assert.ok(linked.includes("OPEN") && (linked.includes("WIN") || linked.includes("LOSS")), `events linked to the decision: ${linked}`);
    if (process.env.PROVENANCE_BUNDLE) { const { writeFileSync } = await import("node:fs"); writeFileSync(process.env.PROVENANCE_BUNDLE, JSON.stringify({ note: "SYNTHETIC-MARKET lifecycle produced by the real edge handler against a mocked database; not a live decision", decision: dec, inputs: w.decision.inputs, trade: t, events: linked })); }
    return;
  }
  assert.fail("no candidate closed within the scan window");
});
