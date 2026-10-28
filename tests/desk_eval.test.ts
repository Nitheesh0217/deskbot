import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../scripts/desk_eval.ts";

test("desk_eval joins verdicts to closed trades, separates the arms, and refuses to conclude from a small sample", () => {
  const trades = Array.from({ length: 40 }, (_, i) => ({ id: `T${i}`, r: i % 3 === 0 ? 1 : -1, net: i % 3 === 0 ? 1 : -1 })), rows = trades.map((t, i) => ({ agent: "desk-judge", output: { ref: t.id, verdict: i < 25 ? "agree" : i < 38 ? "disagree" : "unsure" } }));
  rows.push({ agent: "desk-judge", output: { ref: "OPEN-1", verdict: "agree" } }, { agent: "desk-bear", output: { ref: "T1", verdict: "agree" } } as never);
  const r = evaluate(rows, trades);
  assert.deepEqual([r.perVerdict.agree.n, r.perVerdict.disagree.n, r.perVerdict.unsure.n, r.judgedWithoutClosedTrade], [25, 13, 2, 1], "only judge rows with a closed trade are counted; open ones are pending");
  assert.ok(r.disagreeMinusAgreeMeanR && r.disagreeMinusAgreeMeanR.lo <= r.disagreeMinusAgreeMeanR.diff && r.disagreeMinusAgreeMeanR.diff <= r.disagreeMinusAgreeMeanR.hi);
  assert.match(r.status, /^INSUFFICIENT_EVIDENCE/); assert.match(r.power, /each arm needs about \d+ closed trades/); assert.match(r.note, /never raise size/);
  assert.equal(evaluate(rows.slice(0, 8), trades).disagreeMinusAgreeMeanR, null, "no interval with fewer than 5 per arm");
});
