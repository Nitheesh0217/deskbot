// Learning desk (learning.ts): causes from recorded trade facts, grouping of ACTIVE strategies' losses, the lesson ledger and the focus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { causesOf, learningReport, clusterWeight, LEDGER, type LTrade } from "../supabase/functions/deskbot-v5/learning.ts";

const H = 3600_000, T0 = Date.UTC(2026, 10, 20, 8);
const tr = (o: Partial<LTrade>): LTrade => ({ id: Math.random().toString(36).slice(2), symbol: "BTC", strategy: "HTF_TREND", dir: "short", r: -1, net: -3.5, gross: -3, openT: T0, closeT: T0 + 20 * H, reason: "STOP", regime: "TREND", path: ["stop"], ...o });

test("the 2026-11-20 cluster: three same-direction losers within 24h are cluster_loss; the breakeven one is not a loss", () => {
  const doge = tr({ symbol: "DOGE" }), xmr = tr({ symbol: "XMR", openT: T0 + H }), ada = tr({ symbol: "ADA", openT: T0 + 20 * H, closeT: T0 + 31 * H }), zec = tr({ symbol: "ZEC", r: 0, net: 0.01, gross: 0.5 });
  const all = [doge, xmr, ada, zec];
  for (const t of [doge, xmr, ada]) assert.deepEqual(causesOf(t, all), ["cluster_loss"], t.symbol);
  assert.deepEqual(causesOf(zec, all), [], "breakeven: no loss cause");
  const late = tr({ symbol: "ADA", openT: T0 + 30 * H, closeT: T0 + 50 * H }); assert.deepEqual(causesOf(late, [doge, xmr, late]), ["trend_failure"], "more than 24h after the others: not part of the cluster");
  assert.deepEqual(causesOf(doge, [doge, xmr]), ["trend_failure"], "one mate is not a cluster");
});

test("single-trade causes come from recorded facts only", () => {
  assert.deepEqual(causesOf(tr({ closeT: T0 + 20 * 60_000 }), []), ["stopped_fast"]);
  assert.deepEqual(causesOf(tr({ path: ["tp1", "stop"], r: -0.2 }), []), ["gave_back_after_tp1"]);
  assert.deepEqual(causesOf(tr({ path: ["time"], r: -0.4 }), []), ["time_exit_loss"]);
  assert.deepEqual(causesOf(tr({ regime: "RANGE" }), []), ["range_regime_loss"]);
  assert.deepEqual(causesOf(tr({ r: 0.05, gross: 2, net: -0.3 }), []), ["cost_drag"], "won before costs, lost after");
  assert.deepEqual(causesOf(tr({ r: 2.1, net: 7, gross: 8, path: ["tp1", "tp2", "tp3"] }), []), [], "a winner has no cause");
});

test("report: only ACTIVE strategies count; losses grouped by cause, costliest first; focus is the costliest cause with a test to run", () => {
  const now = T0 + 5 * 24 * H;
  const trades = [tr({ symbol: "DOGE" }), tr({ symbol: "XMR" }), tr({ symbol: "ADA" }), tr({ symbol: "SOL", regime: "RANGE", r: -0.5, openT: T0 + 72 * H, closeT: T0 + 80 * H }),
    tr({ strategy: "SWEEP_REV", symbol: "BTC", r: -1, closeT: T0 + 30 * 60_000 })];   // switched off: not a lesson for now
  const rep = learningReport(trades, new Set(["HTF_TREND"]), now);
  assert.equal(rep.window.trades, 4); assert.equal(rep.window.losses, 4);
  assert.deepEqual(rep.byCause.map((c) => c.cause), ["cluster_loss", "range_regime_loss"]);
  assert.equal(rep.byCause[0].rLost, -3); assert.deepEqual(rep.byCause[0].books, ["ADA", "DOGE", "XMR"]);
  assert.equal(rep.focus!.cause, "cluster_loss"); assert.equal(rep.focus!.status, "NARROW_REJECT"); assert.match(rep.focus!.ref, /cluster-cap/);
  assert.ok(!rep.byCause.some((c) => c.strategies.includes("SWEEP_REV")));
});

test("ledger: every cause has exactly one lesson; rejected ideas carry their document so they are not re-tested as new", () => {
  const causes = ["cluster_loss", "stopped_fast", "gave_back_after_tp1", "time_exit_loss", "range_regime_loss", "cost_drag", "trend_failure"];
  for (const c of causes) assert.equal(LEDGER.filter((l) => l.cause === c).length, 1, c);
  for (const l of LEDGER.filter((l) => l.status === "REJECTED" || l.status === "NARROW_REJECT" || l.status === "ADOPTED")) assert.ok(l.ref.length > 0, l.test);
  assert.equal(clusterWeight(1), 1); assert.equal(clusterWeight(3), 1); assert.equal(clusterWeight(6), 0.5); assert.equal(clusterWeight(0), 1);
});
