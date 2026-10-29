import { test } from "node:test";
import assert from "node:assert/strict";
import { zonesOf, confluence, atrOf, swingsOf, type Bar } from "../supabase/functions/deskbot-v5/zones.ts";

const T0 = 1_700_000_000_000, M = 900_000;
const bar = (i: number, o: number, h: number, l: number, c: number, v = 10): Bar => ({ t: T0 + i * M, o, h, l, c, v });
/** Quiet sideways market around 100 (range ~1) so ATR is ~1. */
function flat(n: number, start = 0): Bar[] { return Array.from({ length: n }, (_, k) => { const i = start + k, w = (i % 4) * 0.1; return bar(i, 100 + w, 100.6 + w, 99.6 + w, 100.2 + w); }); }

test("bullish FVG: detected with exact edges, kept while unfilled, dropped once a candle closes through it", () => {
  const b = flat(40);
  const n = b.length;
  b.push(bar(n, 100.2, 100.6, 99.8, 100.4));          // a (high 100.6)
  b.push(bar(n + 1, 100.4, 103.2, 100.3, 103.0));     // impulse
  b.push(bar(n + 2, 103.0, 104.0, 102.5, 103.8));     // c (low 102.5 > a.high 100.6) -> gap 100.6..102.5
  b.push(bar(n + 3, 103.8, 104.4, 103.2, 104.0));
  const r = zonesOf(b);
  const z = r.zones.find((x) => x.kind === "FVG" && x.side === "bull" && Math.abs(x.bot - 100.6) < 1e-9);
  assert.ok(z, "bull FVG found"); assert.equal(z!.top, 102.5); assert.equal(z!.touched, false);
  // a wick into the gap marks it touched and partially filled, but it stays
  const t = [...b, bar(n + 4, 104, 104.1, 101.6, 102.9)]; const z2 = zonesOf(t).zones.find((x) => x.kind === "FVG" && x.bot === 100.6)!;
  assert.equal(z2.touched, true); assert.ok(z2.filled > 0.4 && z2.filled < 0.6, `filled ${z2.filled}`);
});

test("a bullish FVG closed through becomes a bearish inverse FVG (IFVG); a later close back above removes it", () => {
  const b = flat(40), n = b.length;
  b.push(bar(n, 100.2, 100.6, 99.8, 100.4), bar(n + 1, 100.4, 103.2, 100.3, 103.0), bar(n + 2, 103.0, 104.0, 102.5, 103.8));
  b.push(bar(n + 3, 103.8, 103.9, 99.6, 100.0));      // closes below the gap bottom 100.6
  const r = zonesOf(b);
  assert.ok(!r.zones.some((x) => x.kind === "FVG" && x.bot === 100.6), "original FVG gone");
  const inv = r.zones.find((x) => x.kind === "IFVG" && x.bot === 100.6); assert.ok(inv); assert.equal(inv!.side, "bear");
  const back = [...b, bar(n + 4, 100.0, 103.5, 100.0, 103.3)];   // closes above the gap top 102.5 -> IFVG invalidated
  assert.ok(!zonesOf(back).zones.some((x) => x.kind === "IFVG" && x.bot === 100.6));
});

test("gaps smaller than the minimum fraction of ATR are ignored", () => {
  const b = flat(40), n = b.length;
  b.push(bar(n, 100.2, 100.6, 99.8, 100.4), bar(n + 1, 100.4, 100.9, 100.3, 100.8), bar(n + 2, 100.8, 101.2, 100.65, 101.0));   // gap 100.6..100.65
  assert.ok(!zonesOf(b).zones.some((x) => x.kind === "FVG" && x.bot === 100.6));
});

test("bullish order block: last down candle before a displacement that closes above the last swing high", () => {
  const b = flat(40), n = b.length;
  b.push(bar(n, 100.4, 100.5, 99.6, 99.7));            // the down candle (OB) 99.6..100.5
  b.push(bar(n + 1, 99.7, 103.5, 99.6, 103.3));        // displacement, closes above recent swing highs
  b.push(bar(n + 2, 103.3, 103.9, 103.0, 103.6));
  const r = zonesOf(b);
  const ob = r.zones.find((x) => x.kind === "OB" && x.side === "bull"); assert.ok(ob, "bull OB");
  assert.equal(ob!.bot, 99.6); assert.equal(ob!.top, 100.5);
  assert.ok(r.structure.some((e) => e.side === "bull"));
  // closed through -> removed
  assert.ok(!zonesOf([...b, bar(n + 3, 103.6, 103.7, 98.0, 98.5)]).zones.some((x) => x.kind === "OB" && x.side === "bull" && x.bot === 99.6));
});

test("value area: POC sits in the heaviest-volume bin and VAL <= POC <= VAH", () => {
  const b = flat(60).map((x, i) => ({ ...x, v: i % 5 === 0 ? 200 : 10 }));
  b.push(bar(60, 100, 112, 99, 110, 10));              // widens the range so bins differ
  const v = zonesOf(b).value!; assert.ok(v); assert.ok(v.val <= v.poc && v.poc <= v.vah); assert.ok(v.poc > 99 && v.poc < 102, `poc ${v.poc}`);
});

test("deterministic, does not mutate its input, and needs enough data", () => {
  const b = flat(80); const copy = JSON.stringify(b);
  assert.deepEqual(zonesOf(b), zonesOf(b)); assert.equal(JSON.stringify(b), copy);
  assert.deepEqual(zonesOf(flat(10)).zones, []); assert.ok(Number.isNaN(atrOf([])));
  assert.ok(swingsOf(b).length > 0);
});

test("confluence is a checklist of rule items, never a probability, and respects direction", () => {
  const b = flat(40), n = b.length;
  b.push(bar(n, 100.4, 100.5, 99.6, 99.7), bar(n + 1, 99.7, 103.5, 99.6, 103.3), bar(n + 2, 103.3, 103.9, 103.0, 103.6));
  const r = zonesOf(b); const long = { dir: "long" as const, entry: 100.2, stop: 99.4, tp1: 101.4, tp2: 102.2, tp3: 103 };
  const c = confluence(r, long); assert.ok(c.of >= 5 && c.met <= c.of);
  assert.ok(c.checks.find((x) => /bullish order block/.test(x.label))!.met, "long at bullish OB");
  const sh = confluence(r, { dir: "short", entry: 100.2, stop: 101.0, tp1: 99.0, tp2: 98.2, tp3: 97.4 });
  assert.ok(!sh.checks.find((x) => /bearish order block/.test(x.label))!.met, "short does not claim a bullish OB");
});
