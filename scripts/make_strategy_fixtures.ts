// Generates one deterministic fixture per strategy from a historical 5m dataset: the exact four input windows the live function
// fetches (5m x400, 15m x400, 1h x300, 4h x700) ending at a bar where the strategy produces a valid setup under permissive config.
// A fixture proves the code path is reachable with live-sized history. It says nothing about profitability.
//   npx tsx scripts/make_strategy_fixtures.ts --data kline5_BTC.csv.gz --sym BTC --outdir tests/fixtures [--dataset-sha <sha256>]
import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { applyCfg, buildSeries, snapshot, evaluate, initState, setMlAsset, STRATEGIES, type Bar, type StrategyId, type StrategyTrace } from "../supabase/functions/deskbot-v5/engine.ts";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const TF5 = 300_000, DAY = 86_400_000, sym = arg("sym", "BTC")!, outdir = arg("outdir", "tests/fixtures")!;
const rows = gunzipSync(readFileSync(arg("data")!)).toString("utf8").trim().split("\n");
const m5: Bar[] = rows.map((r) => { const p = r.split(","); const t = +p[0]; return { t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5], ct: t + TF5 - 1 }; });
const agg = (b: Bar[], tf: number): Bar[] => { const out: Bar[] = []; let i = 0; while (i < b.length) { const k = Math.floor(b[i].t / tf) * tf; let j = i, h = -Infinity, l = Infinity, v = 0; while (j < b.length && Math.floor(b[j].t / tf) * tf === k) { h = Math.max(h, b[j].h); l = Math.min(l, b[j].l); v += b[j].v; j++; } if ((j - i) * TF5 === tf) out.push({ t: k, o: b[i].o, h, l, c: b[j - 1].c, v, ct: k + tf - 1 }); i = j; } return out; };
const PERMISSIVE = { RISK_SCALE: Object.fromEntries(STRATEGIES.map((s) => [s, 1])), REGIME_GATE: {}, MIN_SCORE: 0 };
applyCfg(PERMISSIVE as never); setMlAsset(sym === "GOLD" || sym === "PAXG");
const full = { m5, m15: agg(m5, 900_000), h1: agg(m5, 3_600_000), h4: agg(m5, 14_400_000) };
const S = buildSeries(full);
// 1) candidate bars from the full-history series
const cands: Record<string, number[]> = Object.fromEntries(STRATEGIES.map((s) => [s, []]));
const from = m5[0].t + 130 * DAY;
for (let i = 1; i < m5.length; i++) {
  if (m5[i].ct < from) continue;
  const trace: StrategyTrace[] = []; const snap = snapshot(S, i, { funding: null, oi: null, markPx: null, fng: null }); evaluate(snap, {}, S, initState(350, from), trace);
  for (const t of trace) if (t.kind === "ADMITTED" && cands[t.id].length < 12) cands[t.id].push(i);
}
// 2) the same decision must hold with ONLY the live-sized windows
const window = (i: number) => { const T = m5[i].ct; const cut = (b: Bar[], n: number) => { const e = b.filter((x) => x.ct <= T); return e.slice(-n); }; return { m5: cut(full.m5, 400), m15: cut(full.m15, 400), h1: cut(full.h1, 300), h4: cut(full.h4, 700) }; };
const summary: Record<string, unknown> = {};
for (const id of STRATEGIES) {
  let done = false;
  for (const i of cands[id]) {
    const w = window(i), S2 = buildSeries(w), i5 = w.m5.length - 1; const trace: StrategyTrace[] = [];
    evaluate(snapshot(S2, i5, { funding: null, oi: null, markPx: null, fng: null }), {}, S2, initState(350, 0), trace);
    if (trace.find((t) => t.id === id)?.kind !== "ADMITTED") continue;
    const enc = (b: Bar[]) => b.map((x) => [x.t, x.o, x.h, x.l, x.c, x.v]);
    const fx = { strategy: id, sym, T: m5[i].ct, at: new Date(m5[i].ct).toISOString(), source: "Binance spot 5m (research dataset), aggregated", datasetSha256: arg("dataset-sha") ?? null, windows: "m5x400 m15x400 h1x300 h4x700", cfg: "permissive: RISK_SCALE all 1, no regime gate, MIN_SCORE 0", frames: { m5: enc(w.m5), m15: enc(w.m15), h1: enc(w.h1), h4: enc(w.h4) } };
    writeFileSync(`${outdir}/strategy_${id}_${sym}.json.gz`, gzipSync(JSON.stringify(fx), { level: 9 })); summary[id] = { sym, at: fx.at, candidatesTried: cands[id].indexOf(i) + 1 }; done = true; break;
  }
  if (!done) summary[id] = { sym, none: true, candidates: cands[id].length };
}
console.log(JSON.stringify(summary, null, 1));
