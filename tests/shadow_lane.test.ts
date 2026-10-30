// W3 shadow research lane (release corrections): every disabling mechanism, invocation + input proof, versioned config,
// config restored on throw, lane identity, and outcome labelling. SYNTHETIC deterministic market (strategy_fixtures seeds).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCfg, CFG, STRATEGIES, type Bar } from "../supabase/functions/deskbot-v5/engine.ts";
import { signalsOverBars, signalInsertRequest, trackRecord, shadowRecord, offInBook, withConfig, shadowCfg, shadowCfgId, bookCfgId, SHADOW_VERSION, OUTCOME_BASIS, type LaneTrace } from "../supabase/functions/deskbot-v5/track.ts";

const M5 = 300_000, T0 = Date.UTC(2025, 0, 6);
let base: Bar[] | null = null;
function frames(n: number) {
  if (!base) { let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); const c = [50000]; for (let i = 1; i < 40000; i++) c.push(c[i - 1] * (1 + 0.0002 * Math.sin(i / 2000) + (r() - 0.5) * 0.004));
    base = c.map((x, i) => { const o = i ? c[i - 1] : x, w = x * 0.004 * 0.4 * r(); return { t: T0 + i * M5, o, h: Math.max(o, x) + w, l: Math.min(o, x) - w * (0.5 + r()), c: x, v: 5 + 20 * r(), ct: T0 + (i + 1) * M5 - 1 }; }); }
  const m5 = base.slice(0, n), agg = (k: number): Bar[] => { const out: Bar[] = []; for (let i = 0; i + k <= m5.length; i += k) { const q = m5.slice(i, i + k); out.push({ t: q[0].t, o: q[0].o, h: Math.max(...q.map((x) => x.h)), l: Math.min(...q.map((x) => x.l)), c: q[k - 1].c, v: q.reduce((a, x) => a + x.v, 0), ct: q[k - 1].ct }); } return out; };
  return { m5, m15: agg(3), h1: agg(12), h4: agg(48) };
}
const BOOK_CFG = { RISK_SCALE: { D_BEARTRAP: 1, D_THRUST: 1, HTF_TREND: 1, TREND_MTF: 1, SWEEP_REV: 1, VWAP_REVERT: 1, SESSION_BO: 1 }, MIN_SCORE: 0 };

test("disabled discovery covers every mechanism: enabled flag, risk scale 0 and opt-in without a scale", () => {
  applyCfg({ RISK_SCALE: { ...BOOK_CFG.RISK_SCALE, TREND_MTF: 0 } } as never);
  try {
    assert.deepEqual([...offInBook({ SWEEP_REV: false })].sort(), ["EMA_CROSS", "EMA_PB", "HTF_SWEEP", "SSR", "SWEEP_REV", "TREND_MTF"]);
  } finally { applyCfg(); }
  // an all-on risk scale alone does not switch on a strategy whose book flag is false
  withConfig(shadowCfg(BOOK_CFG), undefined, () => assert.deepEqual([...offInBook({ SWEEP_REV: false })], ["SWEEP_REV"]));
});

test("a strategy switched off by its book flag is never recorded in the book lane; it is recorded in the shadow lane under SHADOW-1", () => {
  const f = frames(30060);   // SWEEP_REV qualifies at bar 30059 (strategy_fixtures)
  applyCfg(BOOK_CFG as never);
  try {
    const on = signalsOverBars("BTC", f, 3, { cfgId: bookCfgId(BOOK_CFG) }); assert.ok(on.some((x) => x.strategy === "SWEEP_REV" && x.lane === "book"), "control: it fires when on");
    const book = signalsOverBars("BTC", f, 3, { enabled: { SWEEP_REV: false }, cfgId: bookCfgId(BOOK_CFG) }); assert.ok(!book.some((x) => x.strategy === "SWEEP_REV"), "flag-off strategy absent from the book lane");
    const off = offInBook({ SWEEP_REV: false }), tr: LaneTrace = {};
    const sh = withConfig(shadowCfg(BOOK_CFG), BOOK_CFG, () => signalsOverBars("BTC", f, 3, { only: off, lane: "shadow", cfgId: shadowCfgId(BOOK_CFG), trace: tr }));
    const r = sh.find((x) => x.strategy === "SWEEP_REV")!; assert.ok(r, "recorded in the shadow lane"); assert.equal(r.lane, "shadow"); assert.match(r.cfg_id!, new RegExp(`^${SHADOW_VERSION}:[0-9a-f]{8}$`));
    assert.ok(sh.every((x) => off.has(x.strategy)), "shadow records only evaluators the book does not evaluate");
  } finally { applyCfg(); }
});

test("each intended shadow evaluator is invoked with its inputs present on its own qualifying bar", () => {
  const FIX: Record<string, number> = { HTF_SWEEP: 30431, EMA_CROSS: 30881, SSR: 36968, EMA_PB: 30387 };
  applyCfg(BOOK_CFG as never);
  try {
    for (const [id, i] of Object.entries(FIX)) {
      const f = frames(i + 1), off = offInBook({}), tr: LaneTrace = {};
      assert.ok(off.has(id), `${id} is off in the book config`);
      const sh = withConfig(shadowCfg(BOOK_CFG), BOOK_CFG, () => signalsOverBars("BTC", f, 3, { only: off, lane: "shadow", cfgId: shadowCfgId(BOOK_CFG), trace: tr }));
      assert.ok(tr[id] && tr[id].evaluated > 0 && tr[id].off === 0, `${id} invoked: ${JSON.stringify(tr[id])}`);
      assert.equal(tr[id].noData + tr[id].errors, 0, `${id}: required inputs present`);
      assert.ok(sh.some((x) => x.strategy === id), `${id} produced its shadow setup`);
    }
  } finally { applyCfg(); }
});

test("the book config is restored even when the shadow evaluation throws; config ids are versioned and stable", () => {
  applyCfg(BOOK_CFG as never);
  try {
    const before = JSON.stringify(CFG.RISK_SCALE);
    assert.throws(() => withConfig(shadowCfg(BOOK_CFG), BOOK_CFG, () => { assert.equal(CFG.RISK_SCALE.SSR, 1, "shadow config active inside"); throw new Error("boom"); }), /boom/);
    assert.equal(JSON.stringify(CFG.RISK_SCALE), before, "book config restored after a throw");
  } finally { applyCfg(); }
  assert.equal(shadowCfgId(BOOK_CFG), shadowCfgId(structuredClone(BOOK_CFG))); assert.notEqual(shadowCfgId(BOOK_CFG), shadowCfgId({ ...BOOK_CFG, MIN_SCORE: 50 }));
  assert.match(bookCfgId(BOOK_CFG), /^book:[0-9a-f]{8}$/); assert.notEqual(bookCfgId(BOOK_CFG), shadowCfgId(BOOK_CFG));
});

test("lane identity: the same strategy and bar in both lanes (a config transition) keeps both rows; neither lane counts in the other", () => {
  const sig = (lane: "book" | "shadow") => ({ lane, cfg_id: lane === "book" ? "book:aaaa0000" : "SHADOW-1:bbbb0000", sym: "BTC", strategy: "SSR", dir: "long" as const, bar_t: 123, entry: 100, stop: 99, tp1: 101, r_dist: 1, cost_r: 0.1, max_hold_h: 8, score: 1, why: [] });
  const q = signalInsertRequest([sig("book"), sig("shadow")], true);
  assert.match(q.path, /on_conflict=sym,strategy,bar_t,lane$/); assert.match(q.path, /columns=lane,cfg_id,/); assert.equal(JSON.parse(q.init.body).length, 2, "both lanes sent");
  const old = signalInsertRequest([sig("book"), sig("shadow")], false); assert.match(old.path, /on_conflict=sym,strategy,bar_t$/); assert.deepEqual(JSON.parse(old.init.body).map((r: any) => r.lane), [undefined], "pre-migration: book row only, no lane column");
  const rows = [{ sym: "BTC", strategy: "SSR", status: "tp1", r_net: 0.9, lane: "book" }, { sym: "BTC", strategy: "SSR", status: "stop", r_net: -1.1, lane: "shadow", cfg_id: "SHADOW-1:bbbb0000" }];
  const btc = trackRecord(rows).find((x: any) => x.sym === "BTC")!; assert.equal(btc.resolved, 1); assert.equal(btc.wins, 1, "book record ignores the shadow row");
  const sh = shadowRecord(rows); assert.equal(sh.length, 1); assert.equal(sh[0].resolved, 1); assert.equal(sh[0].wins, 0, "shadow record ignores the book row"); assert.deepEqual(sh[0].cfgIds, ["SHADOW-1:bbbb0000"]);
});

test("outcomes are labelled as simplified hypothetical setup outcomes, not book returns", () => {
  assert.match(OUTCOME_BASIS, /simplified hypothetical setup outcome/); assert.match(OUTCOME_BASIS, /no partial exits, trailing stops/);
  assert.equal(shadowRecord([{ sym: "BTC", strategy: "SSR", status: "open", r_net: null, lane: "shadow" }])[0].basis, OUTCOME_BASIS);
  assert.equal(trackRecord([])[0].basis, OUTCOME_BASIS);
});

test("authority: shadow evaluation runs inside the read-only scan job through withConfig", () => {
  const idx = readFileSync(new URL("../supabase/functions/deskbot-v5/index.ts", import.meta.url), "utf8"), body = idx.slice(idx.indexOf("async function runScan"), idx.indexOf("async function status"));
  assert.match(body, /withConfig\(shadowCfg\(book\.cfg\), book\.cfg, \(\) => signalsOverBars\(sym, frames, 3, \{ only: off, lane: "shadow"/); assert.ok(!/saveState|openPosition|dbv5_trades/.test(body));
});
