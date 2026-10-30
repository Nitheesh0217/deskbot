// Theo's work log (worklog.ts): pure diff of a position before/after management, keyed for idempotency.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { managerRows, managerFailure, snapshotPos, unrecorded, workKey } from "../supabase/functions/deskbot-v5/worklog.ts";

const did = (id: string) => `D-${id}`;
const pos = (o = {}) => ({ id: "V5-1", strategy: "SWEEP_REV", dir: "short", stop: 110, stop0: 110, tp1: 90, tp2: 80, tp3: 70, exits: [], plan: [], ...o });

test("no position before → nothing; unchanged position → nothing", () => {
  assert.deepEqual(managerRows("BTC", null, pos(), [], did), []);
  assert.deepEqual(managerRows("BTC", pos(), pos(), [], did), []);
});

test("target fill, announced stop and target actions, and a silent target change each produce one keyed record", () => {
  const before = pos(), after = pos({ stop: 100, tp1: 92, tp2: 81, exits: [{ kind: "tp1", px: 90, qty: 1, pnl: 10, t: 500 }] });
  const acts = ["Stop tightened 110 → 100 (1H structure)", "TP1 90 → 92 (front-runs Asian low)"];
  const rows = managerRows("BTC", before, after, [], did, { snapT: 600, acts });
  assert.deepEqual(rows.map((r) => r.output.action), ["target_fill", "manage", "manage", "tp2_change"]);
  assert.equal(rows[0].output.key, "V5-1:target_fill:tp1:500"); assert.match(rows[1].output.key, /^V5-1:manage:600:0:stop:[0-9a-f]{8}$/); assert.match(rows[2].output.key, /^V5-1:manage:600:1:tp1:/);
  assert.equal(rows[1].output.message, acts[0]); assert.equal(rows[3].output.attributed, false, "TP2 moved without an announcement: net change only");
  assert.ok(rows.every((r) => r.output.decisionId === "D-V5-1" && r.output.authority === "deterministic"));
});

test("a stop moved by the exit rule after a target fill is a net change attributed to the rule; a full close is recorded with its result", () => {
  const before = pos({ exits: [{ kind: "tp1", px: 90, qty: 1, t: 500 }] }), after = pos({ stop: 100, exits: [{ kind: "tp1", px: 90, qty: 1, t: 500 }, { kind: "tp2", px: 80, qty: 0.5, t: 700 }] });
  const r = managerRows("BTC", before, after, [], did, { snapT: 900, acts: [] }); assert.deepEqual(r.map((x) => x.output.action), ["target_fill", "stop_change"]); assert.match(String(r[1].output.note), /exit rule/); assert.equal(r[1].output.key, "V5-1:stop_change:900:110->100");
  const closed = [{ id: "V5-1", reason: "TP1→TP2→TP3", net: 4.4, r: 1.3, closeT: 900, exits: [...after.exits, { kind: "tp3", px: 70, qty: 0.5, t: 900 }] }] as never;
  const c = managerRows("BTC", before, null, closed, did, { snapT: 900, acts: [] }); assert.deepEqual(c.map((x) => x.output.action), ["target_fill", "target_fill", "close"]); assert.equal(c[2].output.key, "V5-1:close:final"); assert.equal(c[2].output.r, 1.3);
});

test("failure records are keyed by the stuck bar; unrecorded() drops keys already logged and keeps keyless rows", () => {
  const f = managerFailure("BTC", pos(), 1234, new Error("candles 503"), did);
  assert.equal(f.output.key, "V5-1:failure:1234"); assert.equal(f.error, "candles 503");
  assert.deepEqual(unrecorded([{ output: { key: "a" } }, { output: { key: "b" } }, { output: {} }], new Set(["a"])), [{ output: { key: "b" } }, { output: {} }]);
  assert.equal(workKey("P", "close", "final"), "P:close:final");
  const p = pos({ plan: [{ t: 1, msg: "x" }] }), s = snapshotPos(p as never)!; (p.plan as any[]).push({ t: 2, msg: "y" }); assert.equal(s.plan!.length, 1, "snapshot is a copy");
});

test("authority: the work log imports types only and cannot change a position", () => {
  const src = readFileSync(new URL("../supabase/functions/deskbot-v5/worklog.ts", import.meta.url), "utf8");
  assert.deepEqual([...src.matchAll(/^import (.*) from "(.+)";/gm)].map((m) => [m[1].startsWith("type "), m[2]]), [[true, "./engine.ts"]]);
  assert.ok(!/\.(stop|tp1|equity|remainingQty)\s*=[^=]/.test(src.replace(/^\s*\/\/.*$/gm, "")), "no assignment to position or equity fields");
});
