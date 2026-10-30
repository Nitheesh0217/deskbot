// Part E: the plan table for the screenshot trade (BTC HTF_TREND short V5-1793318461202, stored plan values from dbv5_decisions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { planRows } = createRequire(import.meta.url)("../web/plan.js");

const pos = { id: "V5-1793318461202", strategy: "HTF_TREND", dir: "short", entry: 77822.4324, stop: 80065.92995554466, stop0: 80065.92995554466, tp1: 74457.18606668302, tp2: 71091.93973336603, tp3: 64361.44706673206, tp1Done: false, tp2Done: false, tp3Done: false, openT: 1793318461202, maxHoldH: 504, originalQty: 0.002940028069314983, remainingQty: 0.002940028069314983, riskAmt: 6.851913300748431 };
const by = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.key, r]));

test("screenshot trade: distances, R from original risk, exit quantities, timeframe and max hold", () => {
  const { rows, meta } = planRows(pos, { price: 77300, cadence: "4h", exitMode: "HOLD", traderParts: "be", now: pos.openT + 3600e3 });
  const r = by(rows);
  assert.equal(+r.stop.pct.toFixed(2), 2.88); assert.equal(r.stop.r, -1); assert.equal(r.stop.label, "Stop (original = active)"); assert.equal(r.stop0, undefined);
  assert.deepEqual(["tp1", "tp2", "tp3"].map((k) => +r[k].pct.toFixed(2)), [-4.32, -8.65, -17.3]);
  assert.deepEqual(["tp1", "tp2", "tp3"].map((k) => +r[k].r.toFixed(2)), [1.5, 3, 6]);
  assert.deepEqual(["tp1", "tp2", "tp3"].map((k) => +r[k].qty.toFixed(8)), [0.00147001, 0.00073501, 0.00073501]);
  assert.equal(+(r.tp1.qty + r.tp2.qty + r.tp3.qty).toFixed(12), +pos.originalQty.toFixed(12), "exit quantities reconcile to the original quantity");
  assert.equal(+r.current.r.toFixed(3), +((77822.4324 - 77300) / 2243.4975555).toFixed(3));
  assert.equal(meta.signalTimeframe, "4H close"); assert.equal(meta.maxHoldText, "21 days"); assert.equal(new Date(meta.expiresAt).toISOString(), "2026-11-20T00:01:01.202Z");
  assert.equal(+meta.riskPct.toFixed(2), 2.88); assert.ok(meta.exitRules.some((x: string) => /until TP2/.test(x)));
});

test("a moved stop shows both: the active stop (an order) and the original stop (reference that defines 1R)", () => {
  const { rows } = planRows({ ...pos, stop: pos.entry, tp1Done: true, tp2Done: true, remainingQty: pos.originalQty * 0.25 }, { price: 70000 });
  const r = by(rows);
  assert.equal(r.stop.label, "Active stop"); assert.equal(r.stop.r, 0); assert.equal(r.stop0.kind, "reference"); assert.equal(r.stop0.r, -1);
  assert.equal(r.tp1.status, "hit"); assert.equal(+r.stop.qty.toFixed(10), +(pos.originalQty * 0.25).toFixed(10));
  assert.equal(+r.tp1.r.toFixed(2), 1.5, "R stays measured from the original risk after the stop moves");
});
