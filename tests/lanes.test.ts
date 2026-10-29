import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCfg, CFG, buildSeries, backtest, STRATEGIES, type Bar, type Trade } from "../supabase/functions/deskbot-v5/engine.ts";
import { newLane, stepLane, finishLane, laneConfig, type LaneEvent, type LaneSpec } from "../supabase/functions/deskbot-v5/lanes.ts";

const M5 = 300_000, T0 = Date.UTC(2026, 0, 1);
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const closes = (seed: number, n: number) => { const r = seeded(seed), c = [30000]; for (let i = 1; i < n; i++) c.push(c[i - 1] * (1 + 0.00003 * Math.sin(i / 900) + (r() - 0.5) * 0.004)); return c; };
const mk = (c: number[]): Bar[] => c.map((x, i) => { const o = i ? c[i - 1] : x, w = x * 0.0015; return { t: T0 + i * M5, o, h: Math.max(o, x) + w, l: Math.min(o, x) - w, c: x, v: 10, ct: T0 + (i + 1) * M5 - 1 }; });
const agg = (b: Bar[], k: number): Bar[] => { const out: Bar[] = []; for (let i = 0; i + k <= b.length; i += k) { const s = b.slice(i, i + k); out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)), c: s[k - 1].c, v: s.reduce((a, x) => a + x.v, 0), ct: s[k - 1].ct }); } return out; };
const frames = (seed: number, n = 12000) => { const m5 = mk(closes(seed, n)); return { m5, m15: agg(m5, 3), h1: agg(m5, 12), h4: agg(m5, 48) }; };
const LOOSE = { MIN_SCORE: 0 };
test.afterEach(() => applyCfg());

async function replay(spec: LaneSpec, f: ReturnType<typeof frames>, start = 300) {
  const lane = await newLane(spec, f.m5[0].t), S = buildSeries(f), events: LaneEvent[] = [], trades: Trade[] = [];
  for (let i = start; i < f.m5.length - 1; i++) { const r = stepLane(lane, { S, i, bar: f.m5[i], fill: { px: f.m5[i + 1].o, t: f.m5[i + 1].t } }); events.push(...r.events); trades.push(...r.trades); }
  const fin = finishLane(lane, f.m5[f.m5.length - 1]); events.push(...fin.events); trades.push(...fin.trades);
  return { lane, events, trades };
}
const key = (t: Trade) => [t.id, t.strategy, t.dir, +t.net.toFixed(8), t.reason];

for (const strategy of ["SWEEP_REV", "EMA_CROSS"] as const) test(`${strategy}: a lane uses the same executor as engine.backtest (identical trades)`, async () => {
  const f = frames(1), spec: LaneSpec = { sym: "BTC", strategy, startEquity: 350, baseCfg: LOOSE, specVersion: "test-1" };
  const { lane, trades } = await replay(spec, f);
  const bt = backtest(f, { startEquity: 350, only: strategy, warmupBars: 300, cfg: lane.cfg as never });
  assert.ok(trades.length >= 5, `lane made ${trades.length} trades`);
  assert.deepEqual(trades.map(key), bt.trades.map(key));
  assert.ok(Math.abs(lane.state.equity - bt.state.equity) < 1e-9);
});

test("a portfolio-disabled research candidate runs in its lane without being enabled anywhere else", async () => {
  applyCfg(); const before = JSON.stringify(CFG);
  const portfolioCfg = { RISK_SCALE: { SWEEP_REV: 1 } };      // EMA_CROSS is opt-in and OFF for this book
  const spec: LaneSpec = { sym: "BTC", strategy: "EMA_CROSS", startEquity: 350, baseCfg: { ...portfolioCfg, ...LOOSE }, specVersion: "test-1" };
  const f = frames(2), { events, trades } = await replay(spec, f);
  assert.ok(trades.length > 0, "the lane trades its candidate");
  assert.equal(JSON.stringify(CFG), before, "global config unchanged after the lane ran");
  assert.equal(CFG.RISK_SCALE.EMA_CROSS, 0, "still off for the portfolio");
  assert.ok(events.every((e) => e.kind === "decision" ? e.strategy === "EMA_CROSS" : true));
  // the same bars through the portfolio configuration produce no EMA_CROSS trade
  const port = backtest(f, { startEquity: 350, warmupBars: 300, cfg: { ...portfolioCfg, ...LOOSE } as never });
  assert.equal(port.trades.filter((t) => t.strategy === "EMA_CROSS").length, 0);
});

test("decisions are recorded before outcomes, with a monotonic sequence, config hash and the original plan", async () => {
  const { events, trades, lane } = await replay({ sym: "BTC", strategy: "SWEEP_REV", startEquity: 350, baseCfg: LOOSE, specVersion: "test-1" }, frames(3));
  const seqs = events.map((e) => e.seq); assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b)); assert.equal(new Set(seqs).size, seqs.length);
  const seen = new Map<string, number>();
  for (const e of events) { if (e.kind === "decision") { seen.set(e.decisionId, e.seq); assert.equal(e.cfgSha256, lane.cfgSha256); assert.ok(e.plan.riskAmt > 0 && e.plan.stop0 !== e.plan.entry); } else assert.ok(seen.has(e.decisionId) && seen.get(e.decisionId)! < e.seq, "outcome has an earlier decision"); }
  assert.equal(events.filter((e) => e.kind === "decision").length, trades.length, "every lane trade has exactly one decision");
  assert.match(lane.cfgSha256, /^[0-9a-f]{64}$/);
});

test("lanes are independent: separate equity, positions, counters; one lane's trades never touch another", async () => {
  const f = frames(4), S = buildSeries(f);
  const a = await newLane({ sym: "BTC", strategy: "SWEEP_REV", startEquity: 350, baseCfg: LOOSE, specVersion: "t" }, f.m5[0].t), b = await newLane({ sym: "BTC", strategy: "EMA_CROSS", startEquity: 350, baseCfg: LOOSE, specVersion: "t" }, f.m5[0].t), c = await newLane({ sym: "GOLD", strategy: "SWEEP_REV", startEquity: 350, baseCfg: LOOSE, specVersion: "t" }, f.m5[0].t);
  for (let i = 300; i < f.m5.length - 1; i++) { const x = { S, i, bar: f.m5[i], fill: { px: f.m5[i + 1].o, t: f.m5[i + 1].t } }; stepLane(a, x); stepLane(b, x); stepLane(c, x); }
  assert.notEqual(a.state, b.state); assert.notEqual(a.id, c.id); assert.equal(a.id, "BTC:SWEEP_REV"); assert.equal(c.id, "GOLD:SWEEP_REV");
  assert.ok(a.state.stats.all.n > 0 && b.state.stats.all.n > 0);
  assert.equal(a.state.stats.by.EMA_CROSS.n, 0); assert.equal(b.state.stats.by.SWEEP_REV.n, 0, "a lane only ever trades its own strategy");
  assert.notEqual(a.state.equity, b.state.equity);
  assert.equal(a.state.stats.all.n, a.state.stats.by.SWEEP_REV.n);
});

test("auto-disable and probation sizing are observe-only in a lane: it records that the rule would have fired and keeps measuring", async () => {
  const f = frames(1), S = buildSeries(f), spec: LaneSpec = { sym: "BTC", strategy: "SWEEP_REV", startEquity: 350, baseCfg: LOOSE, specVersion: "t" };
  const lane = await newLane(spec, f.m5[0].t); lane.state.stats.by.SWEEP_REV = { n: 19, wins: 5, losses: 14, sumR: -12, grossWin: 5, grossLoss: 30, net: -25 };
  let first: number | null = null;
  for (let i = 300; i < f.m5.length - 1 && first === null; i++) { const r = stepLane(lane, { S, i, bar: f.m5[i], fill: { px: f.m5[i + 1].o, t: f.m5[i + 1].t } }); if (r.trades.length) first = i; }
  assert.ok(first !== null, "a trade closed");
  assert.ok(lane.wouldHaveDisabled && lane.wouldHaveDisabled.atTrade === 20 && lane.wouldHaveDisabled.expR < -0.15);
  assert.equal(lane.state.enabled.SWEEP_REV, true, "still measuring");
  // probation sizing is off: after 10+ losing trades the lane still risks full size (the portfolio would halve it)
  assert.equal(laneConfig(spec).PROBATION_MIN_TRADES, 1e9);
});

test("the lane's configuration records its differences from the book on purpose", () => {
  const cfg = laneConfig({ sym: "GOLD", strategy: "EMA_CROSS", startEquity: 350, baseCfg: { RISK_SCALE: { EMA_CROSS: 0.25, SWEEP_REV: 1 }, MIN_STOP_BY: { TREND_MTF: 0.004 } }, specVersion: "t" });
  assert.deepEqual(cfg.RISK_SCALE, Object.fromEntries(STRATEGIES.map((s) => [s, s === "EMA_CROSS" ? 0.25 : 0])), "the book's scale for the strategy; no other strategy runs");
  assert.deepEqual(cfg.MIN_STOP_BY, { TREND_MTF: 0.004 }); assert.equal(cfg.DISABLE_MIN_TRADES, 1e9);
  assert.equal((laneConfig({ sym: "BTC", strategy: "SSR", startEquity: 350, baseCfg: {}, specVersion: "t" }).RISK_SCALE as Record<string, number>).SSR, 1, "a candidate the book does not run gets scale 1");
});
