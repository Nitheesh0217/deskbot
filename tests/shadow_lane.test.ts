// W3 shadow research lane: switched-off evaluators are evaluated in isolation and recorded separately; they never enter a
// book and never count toward a market's promotion record. SYNTHETIC deterministic market.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCfg, STRATEGIES, type Bar } from "../supabase/functions/deskbot-v5/engine.ts";
import { signalsOverBars, trackRecord, shadowRecord } from "../supabase/functions/deskbot-v5/track.ts";

const M5 = 300_000, T0 = Date.UTC(2025, 0, 6);
function frames(n: number) {
  let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); const c = [50000];
  for (let i = 1; i < 40000; i++) c.push(c[i - 1] * (1 + 0.0002 * Math.sin(i / 2000) + (r() - 0.5) * 0.004));
  const m5: Bar[] = c.map((x, i) => { const o = i ? c[i - 1] : x, w = x * 0.004 * 0.4 * r(); return { t: T0 + i * M5, o, h: Math.max(o, x) + w, l: Math.min(o, x) - w * (0.5 + r()), c: x, v: 5 + 20 * r(), ct: T0 + (i + 1) * M5 - 1 }; }).slice(0, n);
  const agg = (k: number): Bar[] => { const out: Bar[] = []; for (let i = 0; i + k <= m5.length; i += k) { const q = m5.slice(i, i + k); out.push({ t: q[0].t, o: q[0].o, h: Math.max(...q.map((x) => x.h)), l: Math.min(...q.map((x) => x.l)), c: q[k - 1].c, v: q.reduce((a, x) => a + x.v, 0), ct: q[k - 1].ct }); } return out; };
  return { m5, m15: agg(3), h1: agg(12), h4: agg(48) };
}

test("shadow lane records only the listed (switched-off) evaluators, labelled shadow; the book lane is labelled book", () => {
  const f = frames(30432);   // HTF_SWEEP fires on bar 30431 of this series (strategy_fixtures.test.ts)
  applyCfg({ RISK_SCALE: Object.fromEntries(STRATEGIES.map((id) => [id, 1])), MIN_SCORE: 0 } as never);
  try {
    const sh = signalsOverBars("BTC", f, 3, { only: new Set(["HTF_SWEEP", "EMA_CROSS", "SSR", "EMA_PB"]), lane: "shadow" });
    assert.ok(sh.length > 0 && sh.every((x) => x.lane === "shadow" && ["HTF_SWEEP", "EMA_CROSS", "SSR", "EMA_PB"].includes(x.strategy)), JSON.stringify(sh.map((x) => x.strategy)));
  } finally { applyCfg(); }
  const book = signalsOverBars("BTC", f, 3); assert.ok(book.every((x) => x.lane === "book" && !["HTF_SWEEP", "EMA_CROSS", "SSR", "EMA_PB"].includes(x.strategy)), "default config keeps opt-in evaluators off");
});

test("shadow outcomes never count toward a market's record or promotion; they are reported per strategy", () => {
  const rows = [...Array.from({ length: 40 }, () => ({ sym: "BTC", strategy: "SSR", status: "tp1", r_net: 0.9, lane: "shadow" })), { sym: "BTC", strategy: "SWEEP_REV", status: "stop", r_net: -1.1, lane: "book" }];
  const btc = trackRecord(rows).find((x: any) => x.sym === "BTC")!; assert.equal(btc.resolved, 1); assert.equal(btc.verdict, "collecting (1/30)");
  const sh = shadowRecord(rows); assert.deepEqual(sh.map((x) => [x.sym, x.strategy, x.resolved, x.wins]), [["BTC", "SSR", 40, 40]]); assert.ok(sh[0].lo95! > 0);
  assert.deepEqual(shadowRecord([{ sym: "BTC", strategy: "SSR", status: "tp1", r_net: 1 }]), [], "rows without a lane are book rows (pre-migration)");
});

test("authority: the shadow lane runs inside the read-only scan job and restores the book config", () => {
  const idx = readFileSync(new URL("../supabase/functions/deskbot-v5/index.ts", import.meta.url), "utf8"), body = idx.slice(idx.indexOf("async function runScan"), idx.indexOf("async function status"));
  assert.match(body, /lane: "shadow" \}\)\); \} finally \{ applyCfg\(bookCfg\); \}/); assert.ok(!/saveState|openPosition|dbv5_trades/.test(body));
});
