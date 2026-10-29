import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const I = createRequire(import.meta.url)("../web/indicators.js");
const C = (closes: number[], vol = 1) => closes.map((c, i) => ({ time: i, open: c, high: c + 1, low: c - 1, close: c, volume: vol }));

test("SMA and EMA: known values and alignment", () => {
  assert.deepEqual(I.sma(C([1, 2, 3, 4, 5]), 3).map((p: any) => p.value), [2, 3, 4]);
  const e = I.ema(C([1, 2, 3, 4, 5]), 3); assert.equal(e.length, 3); assert.equal(e[0].time, 2);
  assert.ok(Math.abs(e[2].value - 4.0625) < 1e-12, "seeded with the first close, k = 0.5");
});
test("RSI is 100 for a straight rise, 0 for a straight fall, and starts at the period", () => {
  const up = I.rsi(C(Array.from({ length: 30 }, (_, i) => 100 + i))), dn = I.rsi(C(Array.from({ length: 30 }, (_, i) => 100 - i)));
  assert.equal(up[0].time, 14); assert.ok(up.every((p: any) => p.value === 100)); assert.ok(dn.every((p: any) => p.value === 0));
});
test("MACD histogram = MACD − signal; series aligned", () => {
  const r = I.macd(C(Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 5)));
  assert.equal(r.macd.length, 80 - 25); r.histogram.forEach((h: any, i: number) => assert.ok(Math.abs(h.value - (r.macd[i].value - r.signal[i].value)) < 1e-12));
});
test("Bollinger (rolling sums) matches OpenTerminal's direct formula", () => {
  const cs = C(Array.from({ length: 120 }, (_, i) => 50000 + Math.sin(i / 7) * 800 + (i % 5) * 13));
  const got = I.bollinger(cs, 20, 2);
  for (let i = 19; i < cs.length; i++) {
    const sl = cs.slice(i - 19, i + 1), m = sl.reduce((a, c) => a + c.close, 0) / 20, sd = Math.sqrt(sl.reduce((a, c) => a + (c.close - m) ** 2, 0) / 20);
    assert.ok(Math.abs(got.middle[i - 19].value - m) < 1e-6 && Math.abs(got.upper[i - 19].value - (m + 2 * sd)) < 1e-4 && Math.abs(got.lower[i - 19].value - (m - 2 * sd)) < 1e-4);
  }
});
test("VWAP of constant typical price is that price; zero volume yields nothing", () => {
  assert.ok(I.vwap(C([10, 10, 10])).every((p: any) => p.value === 10)); assert.equal(I.vwap(C([10, 11], 0)).length, 0);
});
