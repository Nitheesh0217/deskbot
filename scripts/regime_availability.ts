// How often is the daily regime gate (price beyond EMA50D by REGIME_GATE) open, per direction? Descriptive; uses closed daily EMA50 like the engine.
//   npx tsx scripts/regime_availability.ts --data kline5_BTC.csv.gz [--gate 0.03]
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { buildSeries, snapshot, type Bar } from "../supabase/functions/deskbot-v5/engine.ts";
const arg = (k: string, d?: string) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const TF5 = 300_000, gate = +(arg("gate", "0.03")!), DAY = 86_400_000;
const rows = gunzipSync(readFileSync(arg("data")!)).toString("utf8").trim().split("\n");
const m5: Bar[] = rows.map((r) => { const p = r.split(","); const t = +p[0]; return { t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5], ct: t + TF5 - 1 }; });
const agg = (tf: number): Bar[] => { const out: Bar[] = []; let i = 0; while (i < m5.length) { const k = Math.floor(m5[i].t / tf) * tf; let j = i, h = -Infinity, l = Infinity, v = 0; while (j < m5.length && Math.floor(m5[j].t / tf) * tf === k) { h = Math.max(h, m5[j].h); l = Math.min(l, m5[j].l); v += m5[j].v; j++; } if ((j - i) * TF5 === tf) out.push({ t: k, o: m5[i].o, h, l, c: m5[j - 1].c, v, ct: k + tf - 1 }); i = j; } return out; };
const S = buildSeries({ m5, m15: agg(900_000), h1: agg(3_600_000), h4: agg(14_400_000) });
let n = 0, longOpen = 0, shortOpen = 0, neither = 0; const byYear: Record<string, [number, number, number]> = {};
for (let i = 1; i < m5.length; i += 12) {   // hourly sample
  if (m5[i].t < m5[0].t + 130 * DAY) continue; const s = snapshot(S, i, {}); if (s.i1d < 0 || !isFinite(S.ema50D[s.i1d])) continue;
  const dist = (s.price - S.ema50D[s.i1d]) / s.price, y = new Date(m5[i].t).toISOString().slice(0, 4); n++;
  const L = dist > gate, Sh = -dist > gate; if (L) longOpen++; if (Sh) shortOpen++; if (!L && !Sh) neither++;
  const a = (byYear[y] ??= [0, 0, 0]); a[0]++; if (L) a[1]++; if (Sh) a[2]++;
}
console.log(JSON.stringify({ gate, hourlySamples: n, longGateOpenPct: +(100 * longOpen / n).toFixed(1), shortGateOpenPct: +(100 * shortOpen / n).toFixed(1), neitherPct: +(100 * neither / n).toFixed(1), byYear: Object.fromEntries(Object.entries(byYear).map(([y, a]) => [y, { long: +(100 * a[1] / a[0]).toFixed(0), short: +(100 * a[2] / a[0]).toFixed(0) }])) }));
