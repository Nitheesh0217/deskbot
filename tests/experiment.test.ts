import test from "node:test";
import assert from "node:assert/strict";
import { verdictsFor, filterReport, bootstrapMean, FILTER_EXPERIMENT } from "../supabase/functions/deskbot-v5/experiment.ts";

const warn = [{ id: "round_trip_cost", level: "warn" as const, text: "" }], ok = [{ id: "tp1_under_1r", level: "info" as const, text: "" }];
const judge = (stance: string) => [{ agent: "desk-analysts", output: {} }, { agent: "desk-bull", output: {}, provider: "groq/x", ms: 400 }, { agent: "desk-pm", output: { rating: "Buy", stance, executive_summary: "s" }, provider: "groq/x", ms: 300 }];

test("rules arm skips on any warning; AI arm keeps/skips on the PM stance, abstains on Hold", () => {
  assert.equal(verdictsFor("p1", "BTC", "S", warn, [])[0].take, false);
  assert.equal(verdictsFor("p1", "BTC", "S", ok, [])[0].take, true);
  const [, a] = verdictsFor("p1", "BTC", "S", ok, judge("keep")); assert.equal(a.take, true); assert.equal(a.provider, "groq/x"); assert.equal(a.ms, 700); assert.equal((a.detail as any).calls, 2);
  assert.equal(verdictsFor("p1", "BTC", "S", ok, judge("skip"))[1].take, false);
  assert.equal(verdictsFor("p1", "BTC", "S", ok, judge("abstain"))[1].take, null);
  const none = verdictsFor("p1", "BTC", "S", ok, [])[1]; assert.equal(none.take, null); assert.equal(none.verdict, "no_provider");
  const err = verdictsFor("p1", "BTC", "S", ok, [{ agent: "desk-bull", output: {}, error: "429" }])[1]; assert.equal(err.take, null); assert.equal(err.verdict, "error");
});

const T0 = Date.parse("2026-11-01T00:00:00Z"), iso = (m: number) => new Date(T0 + m * 60000).toISOString();
function fixture(n: number, rFor: (i: number) => number, takeFor: (i: number) => boolean | null, arm: "rules" | "ai" = "rules") {
  const trades = [], verdicts = [];
  for (let i = 0; i < n; i++) { trades.push({ id: "t" + i, strategy: "S", r: rFor(i), net: rFor(i) * 3, close_t: iso(i * 60 + 30) });
    verdicts.push({ ref: "t" + i, arm, sym: "BTC", strategy: "S", take: takeFor(i), verdict: "", detail: {}, provider: null, ms: null, recorded_at: iso(i * 60) }); }
  return { trades, verdicts };
}

test("a filter that skips exactly the losers is reported as helping once there is enough data; too little data is INSUFFICIENT_DATA", () => {
  const r = (i: number) => (i % 2 ? 1.5 : -1);
  const big = fixture(120, r, (i) => r(i) > 0), rep = filterReport(big.trades, big.verdicts).arms[0];
  assert.equal(rep.decided, 120); assert.equal(rep.skipped.n, 60); assert.ok(rep.meanDeltaR! > 0); assert.equal(rep.result, "FILTER_HELPED");
  const small = fixture(20, r, (i) => r(i) > 0), s = filterReport(small.trades, small.verdicts).arms[0];
  assert.equal(s.result, "INSUFFICIENT_DATA"); assert.equal(s.meanDeltaR, null, "no number below the reading threshold");
});
test("skipping winners is FILTER_HURT; random skipping of zero-mean trades shows no evidence", () => {
  const r = (i: number) => (i % 2 ? 1.5 : -1);
  const hurt = fixture(120, r, (i) => r(i) < 0); assert.equal(filterReport(hurt.trades, hurt.verdicts).arms[0].result, "FILTER_HURT");
  const flat = fixture(200, (i) => (i % 4 < 2 ? 1 : -1), (i) => i % 2 === 0); assert.equal(filterReport(flat.trades, flat.verdicts).arms[0].result, "NO_EVIDENCE_OF_DIFFERENCE");
});
test("verdicts recorded at or after the close do not count; abstentions and open trades are excluded from the decided set", () => {
  const f = fixture(3, () => -1, () => false);
  f.verdicts[0].recorded_at = f.trades[0].close_t;     // same instant as the outcome
  f.verdicts[1].take = null;                            // abstained
  f.trades.splice(2, 1);                                // still open
  const a = filterReport(f.trades, f.verdicts).arms[0];
  assert.equal(a.lateOrMissing, 1); assert.equal(a.abstained, 1); assert.equal(a.decided, 0);
});
test("bootstrap is reproducible and refuses a single observation", () => {
  const d = [0, 0, 1, -1, 0.5, 0, 2]; assert.deepEqual(bootstrapMean(d), bootstrapMean(d)); assert.equal(bootstrapMean([1]), null);
  assert.equal(FILTER_EXPERIMENT.minForDecision, 100);
});
