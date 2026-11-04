// Pure observe-only checks (checks.ts, cfg_guard.ts, data.ts hlContext metadata). Nothing here may change trading.
import { test } from "node:test";
import assert from "node:assert/strict";
import { positionChecks, rangeDiag, intentCheck, hlView, LIQ_BUFFER } from "../supabase/functions/deskbot-v5/checks.ts";
import { guardCfg } from "../supabase/functions/deskbot-v5/cfg_guard.ts";
import { hlContext, fundingApr, type HlDiag } from "../supabase/functions/deskbot-v5/data.ts";
import { resolvedCfg, initState, openPosition, applyCfg, type Bar, type Position } from "../supabase/functions/deskbot-v5/engine.ts";

const pos = (o: Partial<Position> = {}): Position => ({
  id: "V5-1", strategy: "HTF_TREND", dir: "long", entry: 100, stop: 98, stop0: 98, tp1: 103, tp2: 106, tp3: 112, originalQty: 2, remainingQty: 2, closedQty: 0,
  riskAmt: 4, entryFee: 0.1, fundingPaid: 0, exits: [], tp1Done: false, tp2Done: false, tp3Done: false, openT: 0, lastFundT: 0, maxHoldH: 24, score: 80, why: [], regime: "TREND", ...o,
});

test("positionChecks: null when flat; leverage, liquidation buffer, min notional, size decimals, degenerate stop", () => {
  assert.equal(positionChecks(null, 1000, 100, null), null);
  // notional 200 on equity 1000 -> 0.2x, liq ~ 500% away, stop 2% away -> 250x buffer
  const a = positionChecks(pos(), 1000, 100, { szDecimals: 2, maxLeverage: null })!;
  assert.equal(a.impliedLeverage, 0.2); assert.equal(a.notionalUsd, 200); assert.equal(a.liqBufferX, 250);
  assert.equal(a.liqOk, true); assert.equal(a.minNotionalOk, true); assert.equal(a.qtyRepresentable, true); assert.equal(a.degenerateStop, false); assert.equal(a.ok, true);
  // 5x leverage with a 10% stop: liq ~ 20% (minus 1/(2*maxLev) = 2% maintenance) -> 1.8x < 3
  const b = positionChecks(pos({ remainingQty: 50, stop: 90, stop0: 90 }), 1000, 100, { szDecimals: 2, maxLeverage: 25 })!;
  assert.equal(b.impliedLeverage, 5); assert.ok(Math.abs(b.liqBufferX! - 1.8) < 1e-9); assert.equal(b.liqOk, false); assert.ok(b.liqBufferX! < LIQ_BUFFER); assert.equal(b.ok, false);
  assert.ok(b.notes.some((n) => /liquidation/i.test(n)));
  // below the $10 minimum; quantity not representable at 1 size decimal (0.04 -> 0.0)
  const c = positionChecks(pos({ remainingQty: 0.04 }), 1000, 100, { szDecimals: 1, maxLeverage: 40 })!;
  assert.equal(c.minNotionalOk, false); assert.equal(c.qtyRepresentable, false); assert.equal(c.ok, false);
  // rounding off by more than 1%: 0.123 at 1 decimal -> 0.1 (19% off)
  assert.equal(positionChecks(pos({ remainingQty: 0.123 }), 1000, 100, { szDecimals: 1, maxLeverage: null })!.qtyRepresentable, false);
  assert.equal(positionChecks(pos({ remainingQty: 1.2049 }), 1000, 100, { szDecimals: 1, maxLeverage: null })!.qtyRepresentable, true);   // 1.2: 0.4% off
  // unknown size decimals -> null, does not fail ok
  const d = positionChecks(pos(), 1000, 100, null)!; assert.equal(d.qtyRepresentable, null); assert.equal(d.ok, true);
  // degenerate: original stop within 0.05% of entry (a later breakeven stop is not flagged)
  assert.equal(positionChecks(pos({ stop0: 99.97, stop: 99.97 }), 1000, 100, null)!.degenerateStop, true);
  assert.equal(positionChecks(pos({ stop: 100 }), 1000, 101, null)!.degenerateStop, false);
});

const bars = (closes: number[], hiLo = 0.5): Bar[] => closes.map((c, i) => ({ t: i * 3600_000, o: i ? closes[i - 1] : c, h: c + hiLo, l: c - hiLo, c, v: 1, ct: (i + 1) * 3600_000 - 1 }));
test("rangeDiag: a rotation inside a band is a range; a steady trend is not; too few bars is null; only closed bars count", () => {
  const rot = bars(Array.from({ length: 150 }, (_, i) => 100 + 10 * Math.sin(i / 6)));
  const r = rangeDiag(rot)!; assert.ok(r.efficiency < 0.25, String(r.efficiency)); assert.ok(r.touches >= 4); assert.equal(r.isRange, true);
  const trend = rangeDiag(bars(Array.from({ length: 150 }, (_, i) => 100 + i)))!;
  assert.ok(trend.efficiency > 0.9); assert.equal(trend.isRange, false);
  assert.equal(rangeDiag(bars([1, 2, 3])), null);
  // efficiency is |last-first| / path over exactly the last 120 bars
  const zig = bars(Array.from({ length: 120 }, (_, i) => (i % 2 ? 101 : 100)));
  assert.equal(rangeDiag(zig)!.efficiency, +(1 / 119).toFixed(4));
  // an unclosed bar is ignored
  assert.deepEqual(rangeDiag(rot, rot[149].ct), rangeDiag(rot.slice(0, 149)));
});

test("intentCheck: equal plan is ok; every differing field is listed", () => {
  const p = pos(), plan = { dir: "long", originalQty: 2, stop0: 98, tp1: 103, tp2: 106, tp3: 112 };
  assert.deepEqual(intentCheck(plan, p), { ok: true, mismatches: [] });
  const bad = intentCheck({ ...plan, dir: "short", tp2: 107 }, p);
  assert.equal(bad.ok, false); assert.deepEqual(bad.mismatches.map((m) => m.field), ["dir", "tp2"]);
  assert.equal(intentCheck(null, p).ok, false); assert.equal(intentCheck(plan, null).ok, false);
});

test("guardCfg: defaults pass; each named rule fires; it never rewrites the input", () => {
  const ok = guardCfg(resolvedCfg()); assert.deepEqual(ok.violations, []); assert.equal(ok.ok, true); assert.deepEqual(ok.info, []);
  const over = { RISK_SCALE: { ...resolvedCfg().RISK_SCALE, HTF_TREND: 1.5, SSR: 0.25 }, MAX_LEVERAGE: 10, TAKER_FEE: 0.02, SLIPPAGE: -0.001,
    TARGETS: { ...resolvedCfg().TARGETS, TREND_MTF: { tp1: 2, tp2: 1, tp3: 3, maxHoldH: 24 }, SWEEP_REV: { tp1: 0, tp2: 1, tp3: 2, maxHoldH: 0 } }, MIN_SCOR: 70 };
  const cfg = resolvedCfg(over as never), before = JSON.stringify(cfg), g = guardCfg(cfg);
  assert.equal(JSON.stringify(cfg), before, "input untouched");
  assert.equal(g.ok, false);
  const rules = g.violations.map((v) => v.rule).sort();
  assert.deepEqual(rules, ["COST_RANGE", "COST_RANGE", "MAX_HOLD_POSITIVE", "MAX_LEVERAGE_CAP", "RISK_SCALE_RANGE", "TARGETS_ORDER", "TARGETS_POSITIVE", "UNKNOWN_KEY"]);
  assert.ok(g.violations.some((v) => v.rule === "UNKNOWN_KEY" && /MIN_SCOR/.test(v.msg)));
  assert.deepEqual(g.info.map((i) => i.rule), ["OPT_IN_ENABLED"]); assert.match(g.info[0].msg, /SSR/);
  assert.equal(guardCfg(null).ok, false);
});

test("hlContext: one metaAndAssetCtxs request returns szDecimals, maxLeverage, delisted, oraclePx, premium and funding APR; missing coin is reported", async () => {
  const pF = globalThis.fetch; let calls = 0;
  const reply = (universe: unknown[], ctxs: unknown[]) => { globalThis.fetch = (async (_u: unknown, init: RequestInit) => { calls++; assert.equal(JSON.parse(String(init.body)).type, "metaAndAssetCtxs"); return new Response(JSON.stringify([{ universe }, ctxs])); }) as typeof fetch; };
  try {
    reply([{ name: "BTC", szDecimals: 5, maxLeverage: 40 }, { name: "PAXG", szDecimals: 3, maxLeverage: 10, isDelisted: true }],
      [{ funding: "0.0000125", openInterest: "100", markPx: "50000", oraclePx: "49990", premium: "0.0002" }, { funding: "-0.00001", openInterest: "5", markPx: "2600", oraclePx: "2601" }]);
    const d: HlDiag = {}, b = (await hlContext("BTC", d))!;
    assert.equal(calls, 1);
    assert.deepEqual(b, { funding: 0.0000125, oi: 100, markPx: 50000, premium: 0.0002, oraclePx: 49990, szDecimals: 5, maxLeverage: 40, delisted: false, fundingAprPct: fundingApr(0.0000125) });
    assert.ok(Math.abs(b.fundingAprPct - 10.95) < 1e-9); assert.equal(d.status, "ok");
    const dg: HlDiag = {}, g = (await hlContext("GOLD", dg))!; assert.equal(g.delisted, true); assert.equal(g.premium, 0); assert.equal(dg.status, "delisted");
    reply([{ name: "ETH" }], [{ funding: "0", openInterest: "1", markPx: "1" }]);
    const dm: HlDiag = {}; assert.equal(await hlContext("BTC", dm), null); assert.deepEqual(dm, { coin: "BTC", status: "missing" });
    reply([{ name: "BTC" }], [{ funding: "0", openInterest: "1", markPx: "85" }]);   // older payload without metadata: null fields
    assert.deepEqual(hlView(await hlContext("BTC")), { szDecimals: null, maxLeverage: null, delisted: false, oraclePx: null, premium: 0, fundingAprPct: 0, oi: 1 });
    assert.deepEqual(hlView(null), { szDecimals: null, maxLeverage: null, delisted: null, oraclePx: null, premium: null, fundingAprPct: null, oi: null });
  } finally { globalThis.fetch = pF; }
});

test("positionChecks on a real engine position does not touch the position", () => {
  applyCfg(); const st = initState(1000, 0);
  const p = openPosition(st, { strategy: "TREND_MTF", dir: "long", entryRef: 100, stop: 95, score: 90, why: [], regime: "TREND", barT: 0 }, 100, 0)!;
  const before = JSON.stringify(st); positionChecks(st.pos, st.equity, 101, { szDecimals: 2, maxLeverage: 20 }); assert.equal(JSON.stringify(st), before); assert.ok(p);
});
