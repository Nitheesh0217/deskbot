// Part E: the plan table for the screenshot trade (BTC HTF_TREND short V5-1793318461202, stored plan values from dbv5_decisions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { planRows, liveR, holdClock, roundLevel, pickRefs, levelLabels, exitTag } = createRequire(import.meta.url)("../web/plan.js");

const pos = { id: "V5-1793318461202", strategy: "HTF_TREND", dir: "short", entry: 77822.4324, stop: 80065.92995554466, stop0: 80065.92995554466, tp1: 74457.18606668302, tp2: 71091.93973336603, tp3: 64361.44706673206, tp1Done: false, tp2Done: false, tp3Done: false, openT: 1793318461202, maxHoldH: 504, originalQty: 0.002940028069314983, remainingQty: 0.002940028069314983, riskAmt: 6.851913300748431 };
const by = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.key, r]));

test("screenshot trade: distances, R from original risk, exit quantities, timeframe and max hold", () => {
  const { rows, meta } = planRows(pos, { price: 77300, cadence: "4h", exitMode: "HOLD", traderParts: "be", now: pos.openT + 3600e3 });
  const r = by(rows);
  assert.equal(+r.stop.pct.toFixed(2), 2.88); assert.equal(r.stop.r, -1); assert.equal(r.stop.label, "Stop (original = active)"); assert.equal(r.stop0, undefined);
  assert.deepEqual(["tp1", "tp2", "tp3"].map((k) => +r[k].pct.toFixed(2)), [-4.32, -8.65, -17.3]);
  assert.deepEqual(["tp1", "tp2", "tp3"].map((k) => +r[k].r.toFixed(2)), [1.5, 3, 6]);
  assert.deepEqual(["tp1", "tp2", "tp3"].map((k) => +r[k].qty.toFixed(8)), [0.00147001, 0.00073501, 0.00073501]);
  // executor semantics (engine.ts fill): close up to CUM × original; the label states both the increment and the cumulative level
  assert.deepEqual(["tp1", "tp2", "tp3"].map((k) => r[k].exitText), ["50% of original → 50% closed", "25% of original → 75% closed", "25% of original → 100% closed"]);
  assert.ok(meta.exitRules.some((x: string) => /a limit, not a forecast/.test(x)));
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

test("live R: signed, from the ORIGINAL risk, unrealised only (unchanged when the stop moves)", () => {
  // short: entry 77822.43, original 1R = 2243.50 pts; price 77300 is 522.43 pts in favour
  const a = liveR(pos, 77300); assert.equal(a.text, "+0.23R open"); assert.equal(a.tone, "up"); assert.match(a.note, /unrealised/);
  assert.equal(liveR(pos, 80065.92995554466).text, "-1.00R open");
  assert.equal(liveR({ ...pos, stop: pos.entry }, 77300).text, "+0.23R open", "a moved stop does not change 1R");
  assert.equal(liveR({ ...pos, dir: "long", stop0: 75000 }, 77822.4324).text, "0.00R open");
  assert.equal(liveR(pos, NaN), null); assert.equal(liveR({ ...pos, stop0: pos.entry }, 77300), null);
});

test("hold clock: elapsed vs max hold; amber from 75%, red from 90%; a limit, not a forecast", () => {
  const c = holdClock(pos.openT, 504, pos.openT + 16 * 3600e3);
  assert.equal(c.text, "held 16h of 504h (3%)"); assert.equal(c.state, "ok"); assert.match(c.note, /limit, not a forecast/);
  assert.equal(holdClock(0, 100, 74.9 * 3600e3).state, "ok");
  assert.equal(holdClock(0, 100, 75 * 3600e3).state, "amber");
  assert.equal(holdClock(0, 100, 90 * 3600e3).state, "red");
  assert.equal(holdClock(0, 100, 130 * 3600e3).state, "red");
  assert.equal(holdClock(0, 504, 45 * 60e3).text, "held 45m of 504h (0%)");
  assert.equal(holdClock(0, null, 1), null);
});

test("context refs: cap respected, nearest first, near-duplicates (within 0.05%) dropped", () => {
  const price = 77300;
  const cands = [
    { name: "4H 55-bar high", px: 82000 }, { name: "4H 55-bar low", px: 76100 }, { name: "prior day high", px: 78400 },
    { name: "prior day low", px: 77010 }, { name: "Asian high", px: 77650 }, { name: "Asian low", px: 77020 },
    roundLevel(price), { name: "bad", px: NaN },
  ];
  const r = pickRefs(cands, price);
  // distances: Asian low 280, prior day low 290 (10 pts from Asian low: duplicate), round 77,000 300 (20 pts: duplicate),
  // Asian high 350, prior day high 1100, 4H low 1200, 4H high 4700 → capped at 5; tolerance 0.05% of 77,300 = 38.65 pts
  assert.equal(r.length, 5);
  assert.deepEqual(r.map((x: any) => x.name), ["Asian low", "Asian high", "prior day high", "4H 55-bar low", "4H 55-bar high"]);
  assert.deepEqual(pickRefs(cands, price, { cap: 3 }).map((x: any) => x.name), ["Asian low", "Asian high", "prior day high"]);
  assert.deepEqual(pickRefs([{ name: "a", px: 77000 }, { name: "b", px: 77050 }], price).map((x: any) => x.name), ["b", "a"], "50 pts apart (> 0.05%) both kept");
  for (let i = 1; i < r.length; i++) assert.ok(r[i].dist >= r[i - 1].dist, "nearest first");
  for (const a of r) for (const b of r) if (a !== b) assert.ok(Math.abs(a.px - b.px) > 0.0005 * price, "no duplicates within 0.05%");
  assert.ok(r.every((x: any) => x.label === "Ref · " + x.name));
  assert.equal(pickRefs(cands, price, { cap: 2 }).length, 2);
  assert.deepEqual(pickRefs([], price), []);
  assert.deepEqual(roundLevel(77300), { name: "round number", px: 77000 }); assert.equal(roundLevel(2640).px, 2600);
});

test("level labels: short, coloured by role (entry neutral, stop red, targets green)", () => {
  const plan = planRows(pos, { price: 77300 });
  const L = Object.fromEntries(levelLabels(plan).map((x: any) => [x.key, x]));
  assert.equal(L.entry.title, "Entry · SHORT"); assert.equal(L.entry.role, "entry");
  assert.equal(L.stop.title, "Stop · -1.0R · +2.9%"); assert.equal(L.stop.role, "stop");
  assert.equal(L.tp2.title, "TP2 · +3.0R · -8.6%"); assert.equal(L.tp2.role, "target");
  assert.equal(L.current, undefined, "the current price uses the series' own last-value label");
  const moved = levelLabels(planRows({ ...pos, stop: pos.entry, tp1Done: true }, {}));
  assert.equal(moved.find((x: any) => x.key === "stop0").title, "Orig stop · -1R"); assert.match(moved.find((x: any) => x.key === "tp1").title, /^TP1 ✓/);
});

test("exit tag: read from the recorded reason, never inferred", () => {
  assert.deepEqual(exitTag({ reason: "TP1→TP2→TP3" }), { code: "TP3", text: "TP3", recorded: "TP1→TP2→TP3", locked: false });
  assert.equal(exitTag({ reason: "TP1→STOP (BE/locked)" }).code, "STOP"); assert.equal(exitTag({ reason: "TP1→STOP (BE/locked)" }).locked, true);
  assert.equal(exitTag({ reason: "STOP" }).code, "STOP"); assert.equal(exitTag({ reason: "TP1→TIME" }).code, "TIME"); assert.equal(exitTag({ reason: "MANUAL" }).code, "MANUAL");
  assert.deepEqual(exitTag({ reason: "liquidated?" }), { code: null, text: "liquidated?", recorded: "liquidated?", locked: false });
  assert.equal(exitTag({ reason: "", r: -1 }), null, "no recorded reason → no tag, even when R says it was a loss");
  assert.equal(exitTag(null), null);
});
