import { test } from "node:test";
import assert from "node:assert/strict";
import { configIntegrity, serialExecutor } from "../supabase/functions/deskbot-v5/runtime.ts";
import { initState, openPosition, managePosition, markEquity, entryGates, rollDay, applyCfg, resolvedCfg, CFG, type Signal } from "../supabase/functions/deskbot-v5/engine.ts";

const signal = (dir: "long" | "short" = "long"): Signal => ({ strategy: "TREND_MTF", dir, entryRef: 100, stop: dir === "long" ? 90 : 110, score: 90, why: [], regime: "TREND", barT: 1 });

test("fingerprints ignore key order but bind asset, version and all settings", async () => {
  const a = await configIntegrity("v1", "BTC", { risk: 1, map: { b: 2, a: 1 } }, "");
  assert.equal(a.approved, false);
  assert.equal((await configIntegrity("v1", "BTC", { map: { a: 1, b: 2 }, risk: 1 }, a.hash)).approved, true);
  for (const [v, s, c] of [["v2", "BTC", { risk: 1 }], ["v1", "GOLD", { risk: 1 }], ["v1", "BTC", { risk: 2 }]] as const) {
    assert.equal((await configIntegrity(v, s, c, a.hash)).approved, false);
  }
  assert.equal((await configIntegrity("v1", "BTC", {}, "malformed")).approved, false);
});

test("public config resolution cannot change an in-flight book or mutate defaults", () => {
  applyCfg({ MIN_SCORE: 91 });
  const other = resolvedCfg({ MIN_SCORE: 51 });
  other.RISK_SCALE.TREND_MTF = 0;
  assert.equal(CFG.MIN_SCORE, 91);
  assert.equal(CFG.RISK_SCALE.TREND_MTF, 1);
  assert.equal(resolvedCfg().RISK_SCALE.TREND_MTF, 1);
  applyCfg();
});

test("requests wait for prior settings owner and a rejection does not poison the queue", async () => {
  const run = serialExecutor(), seen: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const a = run(async () => { seen.push("BTC-start"); await gate; seen.push("BTC-end"); });
  const b = run(async () => { seen.push("GOLD"); throw new Error("expected"); });
  const rejected = assert.rejects(b, /expected/);
  const c = run(async () => { seen.push("next"); });
  await Promise.resolve(); assert.deepEqual(seen, ["BTC-start"]);
  release(); await Promise.all([a, rejected, c]);
  assert.deepEqual(seen, ["BTC-start", "BTC-end", "GOLD", "next"]);
});

for (const dir of ["long", "short"] as const) test(`moved stop resolves ambiguous ${dir} before later targets`, () => {
  applyCfg(); const st = initState(1000, 0), p = openPosition(st, signal(dir), 100, 1)!;
  const tr = managePosition(st, [{ t: 2, ct: 60000, o: p.entry, h: dir === "long" ? p.tp3 + 1 : p.entry + 0.01,
    l: dir === "long" ? p.entry - 0.01 : p.tp3 - 1, c: p.entry, v: 1 }], 0);
  assert.deepEqual(tr[0].exits.map((x) => x.kind), ["tp1", "stop"]);
  assert.ok(Math.abs(tr[0].exits.reduce((q, e) => q + e.qty, 0) - p.originalQty) < 1e-10);
});

test("HOLD exit also resolves a stop newly activated by TP2", () => {
  applyCfg({ EXIT_MODE: "HOLD" }); const st = initState(1000, 0), p = openPosition(st, signal(), 100, 1)!;
  const tr = managePosition(st, [{ t: 2, ct: 60000, o: p.entry, h: p.tp3 + 1, l: p.entry - 0.01, c: p.entry, v: 1 }], 0);
  assert.deepEqual(tr[0].exits.map((x) => x.kind), ["tp1", "tp2", "stop"]);
  applyCfg();
});

test("entry-straddling candle ignores old extremes but handles known closing stop gap", () => {
  applyCfg(); const st = initState(1000, 0), p = openPosition(st, signal(), 100, 30000)!;
  const r = managePosition(st, [{ t: 0, ct: 59999, o: 100, h: p.tp3 + 5, l: 80, c: 100, v: 1 }], 0);
  assert.equal(r.length, 0); assert.equal(st.pos!.tp1Done, false);
  const stopped = managePosition(st, [{ t: 0, ct: 59999, o: 100, h: p.tp3 + 5, l: 80, c: 85, v: 1 }], 0);
  assert.equal(stopped[0].exits[0].kind, "stop");
  assert.ok(stopped[0].exitAvg < 85);
});

test("open losses contribute to sampled drawdown; daily halt latches until next UTC day", () => {
  applyCfg(); const st = initState(1000, 0); openPosition(st, signal(), 100, 1);
  const marked = markEquity(st, 95);
  assert.ok(marked < st.equity); assert.ok(st.maxDD > 0);
  st.equity = 940; markEquity(st, 100);
  assert.equal(st.day.halted, true);
  st.equity = 1000; st.pos = null; markEquity(st, 100);
  assert.equal(entryGates(st, { ...signal(), barT: 2 }, 100).ok, false);
  rollDay(st, 86400000); assert.equal(st.day.halted, false);
  assert.equal(entryGates(st, { ...signal(), barT: 2 }, 86400000).ok, true);
});
