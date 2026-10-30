// W3: one qualifying and one non-qualifying fixture for every registered evaluator (SYNTHETIC deterministic markets).
// Fixtures prove software behaviour (the evaluator is reachable, isolated and emits valid geometry), not profitability.
// VWAP_REVERT and D_BEARTRAP qualify on constructed snapshots in strategy_coverage.test.ts / engine.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCfg, buildSeries, snapshot, evaluate, initState, ensureState, STRATEGIES, type Bar, type StrategyId } from "../supabase/functions/deskbot-v5/engine.ts";
import { classifyReject } from "../supabase/functions/deskbot-v5/coverage.ts";

const M5 = 300_000, T0 = Date.UTC(2025, 0, 6);
function series(seed: number, n: number, drift: number, vol: number) {
  let s = seed; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); const c = [50000];
  for (let i = 1; i < n; i++) c.push(c[i - 1] * (1 + drift * Math.sin(i / 2000) + (r() - 0.5) * vol));
  const m5: Bar[] = c.map((x, i) => { const o = i ? c[i - 1] : x, w = x * vol * 0.4 * r(); return { t: T0 + i * M5, o, h: Math.max(o, x) + w, l: Math.min(o, x) - w * (0.5 + r()), c: x, v: 5 + 20 * r(), ct: T0 + (i + 1) * M5 - 1 }; });
  const agg = (k: number): Bar[] => { const out: Bar[] = []; for (let i = 0; i + k <= m5.length; i += k) { const q = m5.slice(i, i + k); out.push({ t: q[0].t, o: q[0].o, h: Math.max(...q.map((x) => x.h)), l: Math.min(...q.map((x) => x.l)), c: q[k - 1].c, v: q.reduce((a, x) => a + x.v, 0), ct: q[k - 1].ct }); } return out; };
  return { m5, m15: agg(3), h1: agg(12), h4: agg(48) };
}
// found by a deterministic search over seeds 7 / 11 / 13 (first qualifying bar per evaluator)
const FIX: Record<string, [number, number]> = { HTF_TREND: [7, 30047], SWEEP_REV: [7, 30059], EMA_PB: [7, 30387], HTF_SWEEP: [7, 30431], EMA_CROSS: [7, 30881], SESSION_BO: [7, 33212], TREND_MTF: [7, 36689], SSR: [7, 36968], D_THRUST: [11, 36767] };
const PARAMS: Record<number, [number, number]> = { 7: [0.0002, 0.004], 11: [-0.0002, 0.005] };
const only = (id: string) => Object.fromEntries(STRATEGIES.map((x) => [x, x === id]));

test("every registered evaluator has a qualifying fixture here or a constructed one elsewhere", () => {
  assert.deepEqual([...Object.keys(FIX), "VWAP_REVERT", "D_BEARTRAP"].sort(), [...STRATEGIES].sort());
});

test("qualifying fixtures: each evaluator fires alone and identically with all others on (no shared-state interference); valid geometry", () => {
  applyCfg({ RISK_SCALE: Object.fromEntries(STRATEGIES.map((id) => [id, 1])), MIN_SCORE: 0 } as never);   // isolated test config: every evaluator invoked
  try {
    const cache: Record<number, { f: ReturnType<typeof series>; S: ReturnType<typeof buildSeries> }> = {};
    for (const [id, [seed, i]] of Object.entries(FIX)) {
      const { f, S } = (cache[seed] ??= (() => { const f = series(seed, 40000, ...PARAMS[seed]); return { f, S: buildSeries(f) }; })());
      const sn = snapshot(S, i, { funding: 0, oi: 1, markPx: null, fng: 50 });
      const alone = evaluate(sn, only(id), S, ensureState(initState(1000, sn.T))).signals.find((g) => g.strategy === id);
      const all = evaluate(sn, {}, S, ensureState(initState(1000, sn.T))).signals.find((g) => g.strategy === id);
      assert.ok(alone, `${id} qualifies at seed ${seed} bar ${i}`); assert.ok(all, `${id} also qualifies with every evaluator on`);
      assert.deepEqual([alone!.dir, alone!.entryRef, alone!.stop], [all!.dir, all!.entryRef, all!.stop], `${id}: other evaluators do not change its signal`);
      const d = alone!.dir === "long" ? 1 : -1; assert.ok((alone!.entryRef - alone!.stop) * d > 0, `${id}: stop on the losing side`);
      assert.ok(alone!.why.length > 0 && alone!.barT === sn.T, `${id}: reasons and the evaluated bar are recorded`);
      // a non-qualifying bar nearby: no signal and a classified reason (never silent, never unclassified)
      let found = false;
      for (let j = i - 1; j > i - 400 && !found; j--) {
        const s2 = snapshot(S, j, { funding: 0, oi: 1, markPx: null, fng: 50 }), r = evaluate(s2, only(id), S, ensureState(initState(1000, s2.T)));
        if (r.signals.some((g) => g.strategy === id)) continue;
        const mine = r.rejects.filter((x) => x.strategy === id); if (!mine.length) continue;
        assert.notEqual(classifyReject(mine[mine.length - 1].reason), "UNCLASSIFIED", `${id}: ${mine[mine.length - 1].reason}`); found = true;
      }
      assert.ok(found, `${id}: a non-qualifying bar with a recorded reason exists`);
    }
  } finally { applyCfg(); }
});
