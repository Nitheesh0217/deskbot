// PR #19 revision, issue 6: management-log identity and completeness. Written to fail against 33af114.
import { test } from "node:test";
import assert from "node:assert/strict";
import { managerRows, mergeOutbox, unrecorded } from "../supabase/functions/deskbot-v5/worklog.ts";

const did = (id: string) => `D-${id}`;
const pos = (o = {}) => ({ id: "V5-1", strategy: "SWEEP_REV", dir: "short", stop: 110, stop0: 110, tp1: 90, tp2: 80, tp3: 70, exits: [] as any[], plan: [] as any[], ...o });
const keys = (rows: { output: { key: string } }[]) => rows.map((r) => r.output.key);
const A = 1_000_000, B = A + 300_000, C = B + 300_000;

test("two distinct adjustments that return to the same destination get different identities", () => {
  // TP1 90 → 92 on bar A, 92 → 93 on bar B, 93 → 92 on bar C: the first and third land on the same price
  const r1 = managerRows("BTC", pos(), pos({ tp1: 92 }), [], did, { snapT: A, acts: ["TP1 90 → 92 (front-runs Asian low)"] });
  const r2 = managerRows("BTC", pos({ tp1: 92 }), pos({ tp1: 93 }), [], did, { snapT: B, acts: ["TP1 92 → 93 (front-runs Asian low)"] });
  const r3 = managerRows("BTC", pos({ tp1: 93 }), pos({ tp1: 92 }), [], did, { snapT: C, acts: ["TP1 93 → 92 (front-runs Asian low)"] });
  const all = [...keys(r1), ...keys(r2), ...keys(r3)]; assert.equal(new Set(all).size, 3, all.join(" | "));
  // a silent TP2 move back to an earlier value is also distinct (net change, flagged unattributed)
  const s1 = managerRows("BTC", pos(), pos({ tp2: 82 }), [], did, { snapT: A, acts: [] }), s2 = managerRows("BTC", pos({ tp2: 81 }), pos({ tp2: 82 }), [], did, { snapT: C, acts: [] });
  assert.notEqual(s1[0].output.key, s2[0].output.key); assert.equal(s1[0].output.attributed, false);
});

test("multiple adjustments within one management interval are each recorded, in order", () => {
  const before = pos(), after = pos({ stop: 100, tp1: 92, tp2: 81, exits: [{ kind: "tp1", px: 90, qty: 1, t: A + 60_000 }] });
  const acts = ["Stop tightened 110 → 100 (1H structure; risk now 10 pts)", "TP1 90 → 92 (front-runs Asian low)"];
  const r = managerRows("BTC", before, after, [], did, { snapT: B, acts });
  assert.deepEqual(r.map((x) => [x.output.action, x.output.kind ?? x.output.field]), [["target_fill", "tp1"], ["manage", "stop"], ["manage", "tp1"], ["tp2_change", "tp2"]]);
  assert.equal(new Set(keys(r)).size, r.length); assert.deepEqual(r.filter((x) => x.output.action === "manage").map((x) => x.output.seq), [0, 1]);
});

test("an adjustment followed by a closure within the same interval keeps both", () => {
  const acts = ["Stop tightened 110 → 104 (1H structure; risk now 4 pts)", "No follow-through after 9.0h (5% to TP1, 5m+1m against) — closing"];
  const closed = [{ id: "V5-1", reason: "MANUAL", net: -0.4, r: -0.1, closeT: B, exits: [{ kind: "manual", px: 101, qty: 1, t: B }] }] as never;
  const r = managerRows("BTC", pos(), null, closed, did, { snapT: B, acts });
  assert.deepEqual(r.map((x) => x.output.action), ["exit", "manage", "manage", "close"]); assert.deepEqual(r.filter((x) => x.output.action === "manage").map((x) => x.output.kind), ["stop", "close_request"]);
});

test("retry: each scenario rebuilds identical keys, and the outbox / batch filter drops the repeats", () => {
  const sc: [any, any, any[], number, string[]][] = [
    [pos(), pos({ tp1: 92 }), [], A, ["TP1 90 → 92 (x)"]],
    [pos(), pos({ stop: 100, tp1: 92, exits: [{ kind: "tp1", px: 90, qty: 1, t: A + 60_000 }] }), [], B, ["Stop tightened 110 → 100 (y)", "TP1 90 → 92 (x)"]],
    [pos(), null, [{ id: "V5-1", reason: "MANUAL", net: -0.4, r: -0.1, closeT: B, exits: [{ kind: "manual", px: 101, qty: 1, t: B }] }], B, ["Stop tightened 110 → 104 (z)", "No follow-through after 9.0h — closing"]],
  ];
  for (const [b, a, closed, T, acts] of sc) {
    const first = managerRows("BTC", b, a, closed as never, did, { snapT: T, acts }), retry = managerRows("BTC", b, a, closed as never, did, { snapT: T, acts });
    assert.deepEqual(keys(retry), keys(first));
    assert.deepEqual(mergeOutbox(first, retry).length, first.length, "the outbox holds each action once");
    assert.deepEqual(unrecorded(retry, new Set(keys(first))), [], "already logged: nothing to write");
  }
});

test("a fresh run on a different bar with the same wording is a new action, not a duplicate", () => {
  const a = managerRows("BTC", pos(), pos({ stop: 105 }), [], did, { snapT: A, acts: ["Stop tightened 110 → 105 (s)"] }), b = managerRows("BTC", pos({ stop: 105 }), pos({ stop: 100 }), [], did, { snapT: B, acts: ["Stop tightened 105 → 100 (s)"] });
  assert.notEqual(a[0].output.key, b[0].output.key);
});
