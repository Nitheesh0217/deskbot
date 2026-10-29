// Forward tracking: setups recorded at the bar they fire, resolved by the first of TP1 / stop / max hold, conservatively.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCfg, type Bar } from "../supabase/functions/deskbot-v5/engine.ts";
import { signalsOverBars, resolve, trackRecord, PRIORITY, type OpenSignal } from "../supabase/functions/deskbot-v5/track.ts";

const M5 = 300_000, T0 = Date.UTC(2026, 0, 1);
const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({ t: T0 + i * M5, o, h, l, c, v: 1, ct: T0 + (i + 1) * M5 - 1 });
const sig = (o: Partial<OpenSignal> = {}): OpenSignal => ({ id: 1, sym: "ETH", strategy: "SWEEP_REV", dir: "long", bar_t: T0 + M5 - 1, entry: 100, stop: 99, tp1: 101, r_dist: 1, cost_r: 0.1, max_hold_h: 1, score: 1, why: [], checked_t: T0 + M5 - 1, ...o });

test("resolve: TP1 win, stop loss, same-bar touch counts as the stop, time exit at the close, open until then", () => {
  assert.deepEqual(resolve(sig(), [bar(0, 100, 100, 100, 100), bar(1, 100, 101.2, 99.5, 101)]), { id: 1, status: "tp1", checked_t: T0 + 2 * M5 - 1, exit_t: T0 + 2 * M5 - 1, exit_px: 101, r_gross: 1, r_net: 0.9 });
  assert.equal(resolve(sig(), [bar(1, 100, 100.5, 98.9, 99)]).r_net, -1.1);
  assert.equal(resolve(sig(), [bar(1, 100, 101.5, 98.5, 100)]).status, "stop", "both touched in one bar: stop first");
  const short = resolve(sig({ dir: "short", stop: 101, tp1: 99 }), [bar(1, 100, 100.2, 98.9, 99)]); assert.equal(short.status, "tp1"); assert.equal(short.r_gross, 1);
  const bars = Array.from({ length: 12 }, (_, k) => bar(k + 1, 100, 100.4, 99.6, 100.3));
  const t = resolve(sig(), bars); assert.equal(t.status, "time"); assert.equal(t.exit_t, T0 + 13 * M5 - 1, "the bar that reaches max hold"); assert.equal(t.r_gross, 0.3);
  const open = resolve(sig(), bars.slice(0, 3)); assert.equal(open.status, "open"); assert.equal(open.checked_t, bars[2].ct);
  assert.equal(resolve(sig({ checked_t: bars[2].ct }), bars.slice(0, 3)).checked_t, bars[2].ct, "bars already checked are not re-read");
});

test("signalsOverBars records the rules' own setups with the engine's stop floor, target and cost; nothing without history", () => {
  applyCfg({ MIN_SCORE: 0 } as never);
  try {
    const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647), r = seeded(5), c = [100];
    for (let i = 1; i < 9000; i++) c.push(c[i - 1] * (1 + 0.00004 * Math.sin(i / 700) + (r() - 0.5) * 0.004));
    const m5: Bar[] = c.map((x, i) => bar(i, i ? c[i - 1] : x, Math.max(i ? c[i - 1] : x, x) * 1.0015, Math.min(i ? c[i - 1] : x, x) * 0.9985, x));
    const agg = (k: number, n: number): Bar[] => { const out: Bar[] = []; for (let i = 0; i + k <= n; i += k) { const s = m5.slice(i, i + k); out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)), c: s[k - 1].c, v: 1, ct: s[k - 1].ct }); } return out; };
    let found = 0;
    for (let n = 6000; n < 9000 && found < 5; n += 3) {
      for (const g of signalsOverBars("ETH", { m5: m5.slice(0, n), m15: agg(3, n), h1: agg(12, n), h4: agg(48, n) })) {
        found++; const d = g.dir === "long" ? 1 : -1;
        assert.ok(g.bar_t <= m5[n - 1].ct && g.bar_t >= m5[n - 3].ct, "only the last three closed bars");
        assert.ok((g.entry - g.stop) * d > 0 && (g.tp1 - g.entry) * d > 0 && g.cost_r > 0 && g.cost_r <= 1);
      }
    }
    assert.ok(found > 0);
    assert.deepEqual(signalsOverBars("X", { m5: [], m15: [], h1: [], h4: [] }), []);
  } finally { applyCfg(); }
});

test("trackRecord: priorities first, collecting until 30 resolved, CANDIDATE only with a positive mean and lower bound", () => {
  assert.deepEqual([PRIORITY.BTC, PRIORITY.GOLD, PRIORITY.ETH], [1, 1, 2]);
  const rows = [...Array.from({ length: 40 }, (_, i) => ({ sym: "SOL", strategy: "A", status: i % 4 ? "tp1" : "stop", r_net: i % 4 ? 0.9 : -1.1 })),
    ...Array.from({ length: 40 }, () => ({ sym: "DOGE", strategy: "A", status: "stop", r_net: -1.1 })), { sym: "ETH", strategy: "B", status: "open", r_net: null }];
  const t = trackRecord(rows), by = Object.fromEntries(t.map((x: any) => [x.sym, x]));
  assert.deepEqual(t.slice(0, 2).map((x: any) => x.priority), [1, 1]);
  assert.equal(by.SOL.verdict, "CANDIDATE"); assert.equal(by.SOL.wins, 30); assert.ok(by.SOL.lo95 > 0);
  assert.equal(by.DOGE.verdict, "NOT_YET"); assert.equal(by.ETH.open, 1); assert.equal(by.ETH.verdict, "collecting (0/30)"); assert.equal(by.BTC.resolved, 0);
});

test("authority: tracking never touches the books", () => {
  const src = readFileSync(new URL("../supabase/functions/deskbot-v5/track.ts", import.meta.url), "utf8");
  assert.ok(!/openPosition|managePosition|traderManage|saveState|fetch\(/.test(src));
  const idx = readFileSync(new URL("../supabase/functions/deskbot-v5/index.ts", import.meta.url), "utf8"), body = idx.slice(idx.indexOf("async function runScan"), idx.indexOf("async function status"));
  assert.ok(!/saveState|dbv5_state\?id=eq[^&]*", \{ method: "PATCH"|dbv5_trades/.test(body));
});
