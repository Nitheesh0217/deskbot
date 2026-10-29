// v5.8 desk agents — run: npx tsx --test tests/agents.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CFG, applyCfg, resolvedCfg, buildSeries, snapshot, evaluate, bodyStop, validateSignal, chartRead, initState, openPosition,
  managePosition, entryGates, backtest, type Bar, type Signal, type Frames,
} from "../supabase/functions/deskbot-v5/engine.ts";
import { runDesk } from "../supabase/functions/deskbot-v5/agents.ts";

const M5 = 300_000;
function seeded(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
function walk(n: number, start: number, drift: number, sigma: number, seed = 7) {
  const r = seeded(seed), out = [start]; for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + drift + (r() - 0.5) * sigma)); return out;
}
function mk(closes: number[], tf = M5, t0 = Date.UTC(2026, 0, 1), noise = 0.0015): Bar[] {
  return closes.map((c, i) => { const o = i ? closes[i - 1] : c, w = c * noise; return { t: t0 + i * tf, o, h: Math.max(o, c) + w, l: Math.min(o, c) - w, c, v: 10, ct: t0 + (i + 1) * tf - 1 }; });
}
function agg(b: Bar[], k: number): Bar[] {
  const out: Bar[] = []; for (let i = 0; i + k <= b.length; i += k) { const s = b.slice(i, i + k); out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map(x => x.h)), l: Math.min(...s.map(x => x.l)), c: s[k - 1].c, v: s.reduce((a, x) => a + x.v, 0), ct: s[k - 1].ct }); } return out;
}
function frames(closes: number[]): Frames { const m5 = mk(closes); return { m5, m15: agg(m5, 3), h1: agg(m5, 12), h4: agg(m5, 48) }; }
const up = () => frames(walk(6000, 100, 0.0006, 0.004));
const reset = () => applyCfg();

test("defaults: every v5.8 agent is OFF, partial overrides keep the other defaults", () => {
  reset();
  assert.equal(CFG.BODY_SL.on, false); assert.equal(CFG.REENTRY.on, false); assert.equal(CFG.VALIDATOR.on, false);
  const r = resolvedCfg({ BODY_SL: { on: true } } as never);
  assert.equal(r.BODY_SL.on, true); assert.equal(r.BODY_SL.n, 3); assert.equal(r.BODY_SL.minPct, 0.003); assert.equal(r.REENTRY.on, false);
});

test("with all agents off the backtest is identical to passing no agent config", () => {
  reset(); const f = up();
  const a = backtest(f, { startEquity: 1000 }), b = backtest(f, { startEquity: 1000, cfg: { BODY_SL: { on: false }, REENTRY: { on: false }, VALIDATOR: { on: false } } as never });
  assert.equal(a.trades.length, b.trades.length); assert.equal(a.state.equity, b.state.equity);
});

function fakeSig(over: Partial<Signal> = {}): Signal {
  return { strategy: "TREND_MTF", dir: "long", entryRef: 0, stop: 0, score: 80, why: [], regime: "TREND", barT: 0, ...over };
}

test("risk agent: body stop sits at the candle-body extreme, never widens, respects the noise floor", () => {
  reset(); const f = up(), S = buildSeries(f), i5 = f.m5.length - 1, s = snapshot(S, i5);
  const wide = fakeSig({ stop: s.price * 0.9 });
  const b = bodyStop(s, S, wide)!; assert.ok(b);
  const bodies = f.m5.slice(-3).map((x) => Math.min(x.o, x.c));
  assert.ok(b.stop > wide.stop, "tighter than the wick/swing stop");
  assert.ok((s.price - b.stop) >= CFG.BODY_SL.minPct * s.price - 1e-9, "not inside the noise floor");
  assert.ok(b.stop <= Math.min(...bodies) + 1e-9 || (s.price - b.stop) / s.price - CFG.BODY_SL.minPct < 1e-9);
  // a stop that is already tighter is left alone
  assert.equal(bodyStop(s, S, fakeSig({ stop: s.price * 0.9999 })), null);
  // short side mirrors
  const sh = bodyStop(s, S, fakeSig({ dir: "short", stop: s.price * 1.1 }))!; assert.ok(sh.stop < s.price * 1.1 && sh.stop > s.price);
});

test("body stop bypasses the MIN_STOP floor in openPosition; a normal stop does not", () => {
  reset(); CFG.MIN_STOP_BY = { TREND_MTF: 0.02 };
  const mkst = () => initState(1000, 0);
  const tight = fakeSig({ stop: 99.7 }), a = openPosition(mkst(), { ...tight }, 100, 1)!, b = openPosition(mkst(), { ...tight, bodyStop: true }, 100, 1)!;
  assert.ok(Math.abs(a.entry - a.stop) / a.entry >= 0.0199, "floor widened a normal stop");
  assert.ok(Math.abs(b.entry - b.stop) / b.entry < 0.005, "body stop kept");
  reset();
});

test("validator agent: blocks a trade with no room, vetoes trend entries against 1H+4H, exempts reversals", () => {
  reset(); const f = up(), S = buildSeries(f);
  // find a real bar where a blocking resistance sits ahead of price (a pullback inside the uptrend)
  let s = snapshot(S, f.m5.length - 1), res = chartRead(s, S).levels.find((l) => l.side === "resistance" && l.blocks);
  for (let i = f.m5.length - 1; i > 1500 && !res; i -= 7) { s = snapshot(S, i); res = chartRead(s, S).levels.find((l) => l.side === "resistance" && l.blocks); }
  assert.ok(res, "test data must contain a bar with a blocking resistance ahead");
  const risk = (res!.px - s.price) * 5; // stop 5× further than the level → ~0.2R of room
  const v = validateSignal(s, S, fakeSig({ stop: s.price - risk }));
  assert.equal(v.ok, false); assert.ok(v.roomR! < 1);
  const roomy = validateSignal(s, S, fakeSig({ stop: s.price - (res!.px - s.price) / 3 }));   // 3R of room
  assert.equal(roomy.votes.find((x) => x.check === "room")!.pass, true);
  const against = { ...s, st1h: -1, st4h: -1 };
  assert.equal(validateSignal(against, S, fakeSig({ stop: s.price * 0.999 })).votes.find((x) => x.check === "htf")!.pass, false);
  assert.equal(validateSignal(against, S, fakeSig({ strategy: "SWEEP_REV", stop: s.price * 0.999 })).votes.some((x) => x.check === "htf"), false);
});

test("re-entry agent: armed only by a losing true stop-out, cleared by anything else, score floor enforced", () => {
  reset(); CFG.REENTRY = { ...CFG.REENTRY, on: true };
  const st = initState(1000, 0);
  const p = openPosition(st, fakeSig({ stop: 95 }), 100, 1_000)!; assert.ok(p);
  const bar = (o: number, h: number, l: number, c: number, t: number): Bar => ({ t, o, h, l, c, v: 1, ct: t + 59_999 });
  const closed = managePosition(st, [bar(100, 100.1, 94, 94.5, 2_000_000)], 0);
  assert.equal(closed.length, 1); assert.ok(closed[0].net < 0);
  assert.ok(st.reentry && st.reentry.dir === "long" && st.reentry.n === 1 && st.reentry.strategy === "TREND_MTF");
  assert.ok(Math.abs(st.reentry!.level - 95) < 1e-9);
  const g = entryGates(st, fakeSig({ reentry: true, score: 75, barT: 5_000_000 }), 5_000_000); assert.equal(g.ok, false);
  assert.equal(entryGates(st, fakeSig({ reentry: true, score: 80, barT: 5_000_000 }), 5_000_000).ok, true);
  // a winner ends the chain
  const p2 = openPosition(st, fakeSig({ stop: 95, barT: 6_000_000 }), 100, 6_000_000)!; assert.ok(p2);
  managePosition(st, [bar(100, 200, 99.9, 150, 7_000_000)], 0);
  assert.equal(st.pos, null); assert.equal(st.reentry, null);
  reset();
});

test("re-entry agent: no signal until price reclaims the stopped level; then a signal that carries the original strategy", () => {
  reset(); CFG.REENTRY = { ...CFG.REENTRY, on: true };
  const f = up(), S = buildSeries(f), st = initState(1000, 0);
  // find a bar where the trend is clean enough that a reclaim re-entry is legal
  let found: { i: number; sig: Signal } | null = null;
  for (let i = f.m5.length - 1; i > 1500 && !found; i--) {
    const s = snapshot(S, i); st.reentry = { strategy: "TREND_MTF", dir: "long", level: s.price * 0.99, t: s.T - 600_000, n: 1 };
    const sig = evaluate(s, st.enabled, S, st).signals.find((x) => x.reentry); if (sig) found = { i, sig };
  }
  assert.ok(found, "test data must contain a clean re-entry bar");
  const s = snapshot(S, found!.i), re = found!.sig;
  assert.equal(re.strategy, "TREND_MTF"); assert.ok(re.why[0].startsWith("RE-ENTRY")); assert.ok(re.stop < s.price);
  // level above price → waits for reclaim
  st.reentry = { strategy: "TREND_MTF", dir: "long", level: s.price * 1.02, t: s.T - 600_000, n: 1 };
  let r = evaluate(s, st.enabled, S, st); assert.ok(!r.signals.some((x) => x.reentry)); assert.ok(r.rejects.some((x) => /reclaim/.test(x.reason)));
  // expired window / too many re-entries
  st.reentry = { strategy: "TREND_MTF", dir: "long", level: s.price * 0.99, t: s.T - 4 * 3600_000, n: 1 };
  assert.ok(evaluate(s, st.enabled, S, st).rejects.some((x) => /window expired/.test(x.reason)));
  st.reentry = { strategy: "TREND_MTF", dir: "long", level: s.price * 0.99, t: s.T - 600_000, n: CFG.REENTRY.max + 1 };
  assert.ok(evaluate(s, st.enabled, S, st).rejects.some((x) => /limit/.test(x.reason)));
  // switched off → never evaluated
  CFG.REENTRY.on = false; st.reentry = { strategy: "TREND_MTF", dir: "long", level: s.price * 0.99, t: s.T - 600_000, n: 1 };
  assert.ok(!evaluate(s, st.enabled, S, st).signals.some((x) => x.reentry));
  reset();
});

test("backtest with all agents on runs, stays solvent, and marks body-stop trades", () => {
  reset(); const f = up();
  const r = backtest(f, { startEquity: 1000, cfg: { BODY_SL: { on: true }, REENTRY: { on: true }, VALIDATOR: { on: true } } as never });
  assert.ok(Number.isFinite(r.state.equity) && r.state.equity > 0);
  for (const t of r.trades) assert.ok(Number.isFinite(t.r) && Number.isFinite(t.net));
  reset();
});

test("desk report: chart row on a new 15m bar, validator/risk rows when signals exist, nothing when quiet", () => {
  reset(); const f = up(), S = buildSeries(f);
  let i = f.m5.length - 1; while (!snapshot(S, i).new15) i--;
  const s = snapshot(S, i), st = initState(1000, 0);
  const quiet = runDesk({ snap: s, S, m1: null, st, signals: [], rejects: [], traderActs: [], ms: 1 });
  assert.deepEqual(quiet.rows.map((r) => r.agent), ["chart"]);
  const sig = fakeSig({ stop: s.price * 0.99, score: 85, why: ["x"] });
  const busy = runDesk({ snap: s, S, m1: null, st, signals: [sig], rejects: [], traderActs: [], ms: 1 });
  assert.deepEqual(busy.rows.map((r) => r.agent), ["chart", "signals", "validator", "risk"]);
  assert.ok(busy.summary.chart);
});

test("desk summary carries per-timeframe zones and a failing zone read never breaks the desk", async () => {
  const { deskZones } = await import("../supabase/functions/deskbot-v5/agents.ts");
  const { buildSeries } = await import("../supabase/functions/deskbot-v5/engine.ts");
  const bars = Array.from({ length: 120 }, (_, i) => ({ t: i * 900000, o: 100 + Math.sin(i / 5), h: 101 + Math.sin(i / 5), l: 99 + Math.sin(i / 5), c: 100 + Math.sin(i / 5 + 0.2), v: 5, ct: i * 900000 + 899999 }));
  const z = deskZones({ f: { m5: bars, m15: bars, h1: bars, h4: bars } } as never);
  assert.ok("m15" in z && "h1" in z && "h4" in z && z.m15 && Array.isArray(z.m15.zones));
  const broken = deskZones({ f: { m15: null, h1: bars, h4: [] } } as never);
  assert.equal(broken.m15, null); void buildSeries;
});
