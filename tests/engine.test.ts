// DeskBot v5 engine tests — run: npx tsx --test tests/engine.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  atrSeries, stSeries, chopSeries, emaSeries, rsiSeries, vwapDaySeries, idxAt, initState, openPosition,
  managePosition, backtest, summarize, dynamicRisk, CFG, entryGates, type Bar, type Signal,
} from "../supabase/functions/deskbot-v5/engine.ts";

const M5 = 300_000;
function mk(closes: number[], tf = M5, t0 = Date.UTC(2026, 9, 1), noise = 0.0015, vol = 10): Bar[] {
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c, w = c * noise;
    return { t: t0 + i * tf, o, h: Math.max(o, c) + w, l: Math.min(o, c) - w, c, v: vol, ct: t0 + (i + 1) * tf - 1 };
  });
}
function seeded(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
function walk(n: number, start: number, drift: number, sigma: number, seed = 7) {
  const r = seeded(seed), out = [start]; for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + drift + (r() - 0.5) * sigma)); return out;
}
function agg(b: Bar[], k: number): Bar[] {
  const out: Bar[] = []; for (let i = 0; i + k <= b.length; i += k) {
    const s = b.slice(i, i + k); out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map(x => x.h)), l: Math.min(...s.map(x => x.l)), c: s[k - 1].c, v: s.reduce((a, x) => a + x.v, 0), ct: s[k - 1].ct });
  } return out;
}

test("ATR seeds then Wilder-smooths", () => {
  const b = mk(walk(60, 100, 0, 0.01));
  const a = atrSeries(b, 14);
  assert.ok(isNaN(a[13]) && isFinite(a[14]) && a[59] > 0);
});

test("SuperTrend: up-trend → bull, down-trend → bear, persistence", () => {
  assert.equal(stSeries(mk(walk(200, 100, 0.002, 0.004))).dir.at(-1), 1);
  assert.equal(stSeries(mk(walk(200, 100, -0.002, 0.004))).dir.at(-1), -1);
  // noisy uptrend: should stay bullish most of the last 50 bars (legacy v4.1 failed this)
  const d = stSeries(mk(walk(400, 100, 0.0015, 0.01, 3))).dir.slice(-50);
  assert.ok(d.filter(x => x === 1).length > 35);
});

test("Chop high in flat noise, low in trend", () => {
  const flat = chopSeries(mk(walk(100, 100, 0, 0.01, 11))).at(-1)!;
  const trend = chopSeries(mk(walk(100, 100, 0.004, 0.001, 11))).at(-1)!;
  assert.ok(flat > trend, `${flat} vs ${trend}`); assert.ok(trend < 50);
});

test("EMA/RSI sane", () => {
  const up = mk(walk(100, 100, 0.003, 0.002));
  assert.ok(emaSeries(up, 20).at(-1)! > emaSeries(up, 50).at(-1)!);
  assert.ok(rsiSeries(up, 14).at(-1)! > 60);
});

test("VWAP resets at UTC midnight", () => {
  const b = mk(walk(400, 100, 0, 0.004), M5, Date.UTC(2026, 9, 1, 12)); // starts noon, crosses a midnight
  const { vwap } = vwapDaySeries(b);
  const iMid = b.findIndex(x => x.t % 86400_000 === 0);
  assert.ok(iMid > 0); assert.ok(Math.abs(vwap[iMid] - (b[iMid].h + b[iMid].l + b[iMid].c) / 3) < 1e-9);
});

test("idxAt never returns a forming bar", () => {
  const b = mk([1, 2, 3, 4]);
  assert.equal(idxAt(b, b[2].ct), 2); assert.equal(idxAt(b, b[2].ct - 1), 1);
});

test("Sizing: $353 equity, 2% tier, 100k/99k → risk incl. costs ≈ $7.06, partials sum to originalQty", () => {
  const st = initState(353, 0);
  const sig: Signal = { strategy: "TREND_MTF", dir: "long", entryRef: 100000, stop: 99000, score: 90, why: [], regime: "TREND", barT: 1 };
  const p = openPosition(st, sig, 100000, 1)!;
  assert.equal(dynamicRisk(353), 0.02);
  assert.ok(Math.abs(p.riskAmt - 7.06) < 1e-9);
  // full stop-out loses ≈ riskAmt (fees+slippage included in sizing)
  const st2 = structuredClone(st);
  managePosition(st2, [{ t: 2, o: 99500, h: 99600, l: 98900, c: 99000, v: 1, ct: 3 }], 0);
  assert.ok(Math.abs((353 - st2.equity) - 7.06) < 0.05, `loss ${(353 - st2.equity)}`);
  // TP path: TP1 → TP2 → TP3 sums exactly
  const bars: Bar[] = [
    { t: 2, o: 100000, h: p.tp1 + 1, l: 99900, c: p.tp1, v: 1, ct: 3 },
    { t: 4, o: p.tp1, h: p.tp2 + 1, l: p.tp1, c: p.tp2, v: 1, ct: 5 },
    { t: 6, o: p.tp2, h: p.tp3 + 1, l: p.tp2, c: p.tp3, v: 1, ct: 7 },
  ];
  const tr = managePosition(st, bars, 0);
  assert.equal(tr.length, 1);
  const q = tr[0].exits.reduce((a, e) => a + e.qty, 0);
  assert.ok(Math.abs(q - tr[0].originalQty) < 1e-12);
  assert.equal(tr[0].exits.map(e => e.kind).join(","), "tp1,tp2,tp3");
  assert.ok(tr[0].r > 1.5);
});

test("Stop-first when a bar spans stop and TP; BE after TP1; gap fills at open", () => {
  const st = initState(1000, 0);
  const sig: Signal = { strategy: "SWEEP_REV", dir: "short", entryRef: 100, stop: 101, score: 90, why: [], regime: "MIXED", barT: 1 };
  const p = openPosition(st, sig, 100, 1)!;
  const tr = managePosition(st, [{ t: 2, o: 100, h: 101.5, l: p.tp1 - 1, c: 100, v: 1, ct: 3 }], 0);
  assert.equal(tr[0].exits[0].kind, "stop"); assert.ok(tr[0].net < 0);
  const st2 = initState(1000, 0); const p2 = openPosition(st2, { ...sig, barT: 2 }, 100, 1)!;
  managePosition(st2, [{ t: 2, o: 100, h: 100.1, l: p2.tp1 - 0.01, c: p2.tp1, v: 1, ct: 3 }], 0);
  assert.equal(st2.pos!.stop, p2.entry);
  const tr2 = managePosition(st2, [{ t: 4, o: 102, h: 102.5, l: 101.8, c: 102, v: 1, ct: 5 }], 0); // gap through BE
  assert.equal(tr2[0].exits.at(-1)!.kind, "stop"); assert.ok(tr2[0].exits.at(-1)!.px >= 102);
});

test("Circuit breaker → cooldown, daily cap, duplicate-signal guard", () => {
  const st = initState(1000, 0);
  for (let k = 0; k < 3; k++) {
    openPosition(st, { strategy: "TREND_MTF", dir: "long", entryRef: 100, stop: 99, score: 90, why: [], regime: "T", barT: 10 + k }, 100, 10 + k);
    managePosition(st, [{ t: 20 + k, o: 99, h: 99, l: 98, c: 98, v: 1, ct: 21 + k }], 0);
  }
  assert.ok(st.cb.cooldownUntil > 100); assert.equal(st.cb.trips, 1);
  const g = entryGates(st, { strategy: "TREND_MTF", dir: "long", entryRef: 100, stop: 99, score: 90, why: [], regime: "T", barT: 50 }, 100);
  assert.equal(g.ok, false);
  const st2 = initState(1000, 0); st2.lastSig.TREND_MTF = 50;
  assert.equal(entryGates(st2, { strategy: "TREND_MTF", dir: "long", entryRef: 1, stop: 0.9, score: 90, why: [], regime: "T", barT: 50 }, 100).ok, false);
});

test("Leverage cap limits notional to 5× equity", () => {
  const st = initState(1000, 0);
  const p = openPosition(st, { strategy: "TREND_MTF", dir: "long", entryRef: 100000, stop: 99850, score: 90, why: [], regime: "T", barT: 1 }, 100000, 1)!;
  assert.ok(p.originalQty * p.entry <= 1000 * CFG.MAX_LEVERAGE * 1.0001);
});

test("Backtest runs end-to-end on synthetic multi-TF data, no look-ahead crash, accounting reconciles", () => {
  const closes = walk(3000, 60000, 0.00002, 0.004, 21);
  const m5 = mk(closes, M5, Date.UTC(2026, 8, 1), 0.001, 50);
  const m15 = agg(m5, 3), h1 = agg(m5, 12), h4 = agg(m5, 48);
  const r = backtest({ m5, m15, h1, h4 }, { startEquity: 1000 });
  const s = summarize(r.trades, 1000);
  assert.ok(Math.abs(s.endEquity - r.state.equity) < 1e-6, `${s.endEquity} vs ${r.state.equity}`);
  for (const t of r.trades) assert.ok(Math.abs(t.exits.reduce((a, e) => a + e.qty, 0) - t.originalQty) < 1e-9);
});

test("ensureState adds slots for strategies added later (no crash on finalize)", async () => {
  const { ensureState } = await import("../supabase/functions/deskbot-v5/engine.ts");
  const st = initState(500, 0); delete (st.stats.by as Record<string, unknown>).HTF_TREND; delete st.enabled.HTF_TREND;
  ensureState(st);
  openPosition(st, { strategy: "HTF_TREND", dir: "long", entryRef: 100, stop: 98, score: 80, why: [], regime: "T", barT: 1 }, 100, 1);
  const tr = managePosition(st, [{ t: 2, o: 99, h: 99, l: 97, c: 97, v: 1, ct: 3 }], 0);
  assert.equal(tr.length, 1); assert.equal(st.stats.by.HTF_TREND.n, 1);
});

test("dailyFrom4h builds only complete UTC days", async () => {
  const { dailyFrom4h } = await import("../supabase/functions/deskbot-v5/engine.ts");
  const t0 = Date.UTC(2026, 9, 1); const H4 = 14400_000;
  const bars = Array.from({ length: 15 }, (_, i) => ({ t: t0 + i * H4, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1, ct: t0 + (i + 1) * H4 - 1 }));
  const d = dailyFrom4h(bars);
  assert.equal(d.length, 2); assert.equal(d[0].o, 100); assert.equal(d[0].c, 105.5); assert.equal(d[1].h, 112);
});

test("D_BEARTRAP fires on engulf + next-day sweep/reclaim in bull regime", async () => {
  const m = await import("../supabase/functions/deskbot-v5/engine.ts");
  const H4 = 14400_000, t0 = Date.UTC(2026, 6, 1);
  // 70 rising days then: up day, bearish engulfing, sweep+reclaim day
  const days: { o: number; h: number; l: number; c: number }[] = [];
  let px = 50000; for (let i = 0; i < 70; i++) { days.push({ o: px, h: px + 300, l: px - 200, c: px + 200 }); px += 200; }
  days.push({ o: px, h: px + 500, l: px - 100, c: px + 400 });               // bullish day k-1
  days.push({ o: px + 450, h: px + 500, l: px - 300, c: px - 150 });          // bearish engulfing day k
  days.push({ o: px - 150, h: px + 100, l: px - 600, c: px - 100 });          // sweeps below k low, closes above it
  const h4: m.Bar[] = []; days.forEach((d, i) => { for (let j = 0; j < 6; j++) { const t = t0 + (i * 6 + j) * H4;
    const o = j === 0 ? d.o : d.c, c = j === 5 ? d.c : d.c; h4.push({ t, o: j === 0 ? d.o : (j === 5 ? d.c : (d.o + d.c) / 2), h: j === 2 ? d.h : Math.max(o, c), l: j === 3 ? d.l : Math.min(o, c), c: j === 5 ? d.c : (d.o + d.c) / 2, v: 10, ct: t + H4 - 1 }); } });
  const T = h4[h4.length - 1].ct;
  const mk = (tf: number) => { const out: m.Bar[] = []; for (let t = T - 400 * tf + 1; t < T; t += tf) out.push({ t, o: px, h: px + 10, l: px - 10, c: px - 100, v: 1, ct: t + tf - 1 }); return out; };
  const S = m.buildSeries({ m5: mk(300_000), m15: mk(900_000), h1: mk(3600_000), h4 });
  const snap = m.snapshot(S, S.f.m5.length - 1);
  assert.equal(snap.T, T);
  const { signals } = m.evaluate(snap, Object.fromEntries(m.STRATEGIES.map(s => [s, s === "D_BEARTRAP"])), S);
  assert.equal(signals.length, 1); assert.equal(signals[0].dir, "long"); assert.ok(signals[0].stop < px - 590);
});

test("Cost filter skips setups whose round-trip cost exceeds MAX_COST_R; MIN_STOP_PCT widens tight stops", () => {
  const st = initState(1000, 0);
  CFG.MAX_COST_R = 0.2;
  assert.equal(openPosition(st, { strategy: "SWEEP_REV", dir: "long", entryRef: 100000, stop: 99700, score: 90, why: [], regime: "T", barT: 1 }, 100000, 1), null);
  CFG.MAX_COST_R = 1; CFG.MIN_STOP_PCT = 0.01;
  const p = openPosition(st, { strategy: "SWEEP_REV", dir: "long", entryRef: 100000, stop: 99700, score: 90, why: [], regime: "T", barT: 2 }, 100000, 2)!;
  assert.ok(Math.abs(p.entry - p.stop - p.entry * 0.01) < 1e-6);
  CFG.MIN_STOP_PCT = 0;
});
