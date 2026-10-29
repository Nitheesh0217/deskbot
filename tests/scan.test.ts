// Scanner and derivatives context: pure parts on fixtures. The scanner is read-only and never states a probability.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCfg, type Bar } from "../supabase/functions/deskbot-v5/engine.ts";
import { scanMarket, rankScan, expiryMs, parseOptions, parseFutures, parseDvol, derivatives, SCAN_NOTE } from "../supabase/functions/deskbot-v5/scan.ts";

const M5 = 300_000, T0 = Date.UTC(2026, 0, 1);
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function frames(n = 9000, seed = 3) {
  const r = seeded(seed), c = [100]; for (let i = 1; i < n; i++) c.push(c[i - 1] * (1 + 0.00004 * Math.sin(i / 700) + (r() - 0.5) * 0.004));
  const m5: Bar[] = c.map((x, i) => { const o = i ? c[i - 1] : x, w = x * 0.0015; return { t: T0 + i * M5, o, h: Math.max(o, x) + w, l: Math.min(o, x) - w, c: x, v: 10, ct: T0 + (i + 1) * M5 - 1 }; });
  const agg = (k: number): Bar[] => { const out: Bar[] = []; for (let i = 0; i + k <= m5.length; i += k) { const s = m5.slice(i, i + k); out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)), c: s[k - 1].c, v: 10, ct: s[k - 1].ct }); } return out; };
  return { m5, m15: agg(3), h1: agg(12), h4: agg(48) };
}

test("scanMarket reports measured context and the rules' own setups, with no probability anywhere", () => {
  applyCfg({ MIN_SCORE: 0 } as never);
  try {
    const f = frames(), now = f.m5.at(-1)!.ct + 1000;
    let found = 0;
    for (let cut = 6000; cut < 9000 && found < 3; cut += 7) {
      const s = scanMarket("ETH", { m5: f.m5.slice(0, cut), m15: f.m15.filter((b) => b.ct <= f.m5[cut - 1].ct), h1: f.h1.filter((b) => b.ct <= f.m5[cut - 1].ct), h4: f.h4.filter((b) => b.ct <= f.m5[cut - 1].ct) }, { funding: 0.0002, oi: 1e6, markPx: 100, premium: 0 }, now);
      assert.ok(s.ok); if (!s.ok) continue;
      assert.ok(["RANGE", "TREND", "MIXED"].includes(s.regime)); assert.match(s.trend, /up|down|mixed/);
      assert.ok(s.notes.some((n) => /funding .*longs paying/.test(n)));
      for (const g of s.setups) { found++; assert.ok(["long", "short"].includes(g.dir)); assert.ok(g.stopPct! > 0); assert.ok(g.dir === "long" ? g.stop! < g.entry! : g.stop! > g.entry!); }
      assert.ok(!/%\s*(chance|probab)/i.test(JSON.stringify(s)));
    }
    assert.ok(found > 0, "the engine's rules fire somewhere on a long synthetic series");
    assert.deepEqual(scanMarket("X", { m5: [], m15: [], h1: [], h4: [] }, null, 0), { sym: "X", ok: false, error: "not enough history" });
  } finally { applyCfg(); }
});

test("rankScan puts fired setups first, then aligned trends, failures last", () => {
  const base = { ok: true, chg24h: 1, setups: [], trend: "mixed" } as never as Record<string, unknown>;
  const rows = [{ ...base, sym: "A" }, { ok: false, sym: "F" }, { ...base, sym: "B", trend: "up on 15m/1h/4h" }, { ...base, sym: "C", setups: [{ score: 0.4 }] }, { ...base, sym: "D", setups: [{ score: 0.9 }] }];
  assert.deepEqual(rankScan(rows as never).map((x: any) => x.sym), ["D", "C", "B", "A", "F"]);
});

const NOW = Date.UTC(2026, 9, 29, 12);
const opt = (name: string, oi: number, iv = 50, u = 100000) => ({ instrument_name: name, open_interest: oi, mark_iv: iv, underlying_price: u });
test("options: put/call OI, max pain of the nearest expiry, near-the-money put minus call IV; expired contracts ignored", () => {
  assert.equal(expiryMs("30OCT26"), Date.UTC(2026, 9, 30, 8)); assert.equal(expiryMs("BAD"), null);
  const rows = [
    opt("BTC-30OCT26-95000-P", 100), opt("BTC-30OCT26-100000-C", 50), opt("BTC-30OCT26-105000-C", 300), opt("BTC-30OCT26-100000-P", 20),
    opt("BTC-6NOV26-100000-C", 10, 48), opt("BTC-6NOV26-100000-P", 10, 52), opt("BTC-6NOV26-104000-P", 5, 54),
    opt("BTC-28OCT26-100000-C", 9999),   // already expired
  ];
  const o = parseOptions(rows, NOW)!;
  assert.equal(o.callOI, 360); assert.equal(o.putOI, 135); assert.equal(o.putCallOI, +(135 / 360).toFixed(3)); assert.equal(o.contracts, 7);
  assert.equal(o.nearestExpiry, new Date(Date.UTC(2026, 9, 30, 8)).toISOString());
  // payout at 95k: calls 0, puts 20*5000=100000; at 100k: puts 100*0 + calls 0 → 0 + put 95k OTM → 0 ... min is 100000 strike
  assert.equal(o.maxPainNearest, 100000);
  assert.equal(o.ivExpiry, new Date(Date.UTC(2026, 10, 6, 8)).toISOString()); assert.equal(o.atmIV, 51.3); assert.equal(o.putMinusCallIV, 5);
  assert.equal(o.topOIStrikes[0].strike, 105000);
  assert.equal(parseOptions([], NOW), null);
});

test("futures basis is annualised by days to expiry; perpetual has no annualisation; dvol change over 24h", () => {
  const f = parseFutures([{ instrument_name: "BTC-PERPETUAL", mark_price: 100050 }, { instrument_name: "BTC-25DEC26", mark_price: 101000, volume_usd: 5e6 }, { instrument_name: "BTC-1OCT26", mark_price: 1 }], 100000, NOW);
  assert.equal(f.length, 2); assert.equal(f[1].instrument, "BTC-25DEC26"); assert.equal(f[1].basisPct, 1);
  const days = (Date.UTC(2026, 11, 25, 8) - NOW) / 86400_000; assert.equal(f[1].annualisedPct, +((0.01 * 365 / days) * 100).toFixed(2));
  assert.equal(f[0].instrument, "BTC-PERPETUAL"); assert.equal(f[0].expiry, null); assert.equal(f[0].annualisedPct, null); assert.equal(f[0].basisPct, 0.05);
  const d = Array.from({ length: 26 }, (_, i) => [i, 0, 0, 0, 50 + i]); assert.deepEqual(parseDvol({ data: d }), { last: 75, chg24h: 24 });
  assert.deepEqual(parseDvol(null), { last: null, chg24h: null });
});

test("derivatives(): each Deribit call fails on its own and is reported, never thrown", async () => {
  const f = (async (u: string) => {
    if (u.includes("kind=option")) return new Response(JSON.stringify({ result: [opt("BTC-30OCT26-100000-C", 5)] }));
    if (u.includes("get_index_price")) return new Response(JSON.stringify({ result: { index_price: 100000 } }));
    return new Response("down", { status: 503 });
  }) as typeof fetch;
  const d = await derivatives("BTC", NOW, f);
  assert.equal(d.index, 100000); assert.equal(d.options!.callOI, 5); assert.equal(d.futures, null); assert.equal(d.dvol, null); assert.equal(d.errors.length, 2);
  assert.match(SCAN_NOTE, /not a prediction/); assert.match(SCAN_NOTE, /untested/);
});

test("authority: the scanner imports only pure engine functions and never writes trading state", () => {
  const src = readFileSync(new URL("../supabase/functions/deskbot-v5/scan.ts", import.meta.url), "utf8");
  assert.deepEqual([...src.matchAll(/^import .* from "(.+)";/gm)].map((m) => m[1]), ["./engine.ts"]);
  assert.ok(!/openPosition|managePosition|traderManage|saveState|insert\(/.test(src));
  const idx = readFileSync(new URL("../supabase/functions/deskbot-v5/index.ts", import.meta.url), "utf8"), body = idx.slice(idx.indexOf("async function runScan"), idx.indexOf("async function status"));
  assert.ok(!/saveState|dbv5_state\?id=eq.*PATCH|openPosition|dbv5_trades/.test(body), "runScan only reads config and appends a scan row");
  assert.match(body, /finally \{ applyCfg\(\); setMlAsset\(false\); \}/, "global config restored after the scan");
});
