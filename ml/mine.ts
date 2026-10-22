// DeskBot v5 — setup miner ("reverse engineering" every trade the system would have picked)
// For every 5m close in the history, run the live engine's evaluate() with ALL strategies on,
// simulate each signal on its own (fresh account, same costs/exits as live), and record the
// market state at entry plus the outcome. Output: ml/data/setups.csv
//
// usage: npx tsx ml/mine.ts <BTCUSDT_5m.csv> [out.csv]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  buildSeries, snapshot, evaluate, initState, openPosition, managePosition, STRATEGIES, CFG, emaSeries, atrSeries,
  type Bar, type Signal,
} from "../supabase/functions/deskbot-v5/engine.ts";

const [, , src, out = "ml/data/setups.csv"] = process.argv;
const M5 = 300_000;

function load(path: string): Bar[] {
  const lines = readFileSync(path, "utf8").trim().split("\n"); lines.shift();
  const bars: Bar[] = [];
  for (const ln of lines) {
    const [ts, o, h, l, c, v] = ln.split(",");
    const t = Date.parse(ts); bars.push({ t, o: +o, h: +h, l: +l, c: +c, v: +v, ct: t + M5 - 1 });
  }
  return bars;
}
function agg(b: Bar[], tf: number): Bar[] {
  const out: Bar[] = []; let cur: Bar | null = null; let key = -1;
  for (const x of b) {
    const k = Math.floor(x.t / tf);
    if (k !== key) { if (cur) out.push(cur); key = k; cur = { t: k * tf, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v, ct: (k + 1) * tf - 1 }; }
    else if (cur) { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v += x.v; }
  }
  if (cur) out.push(cur);
  return out;
}

const m5 = load(src);
const m15 = agg(m5, 900_000), h1 = agg(m5, 3_600_000), h4 = agg(m5, 14_400_000);
console.error(`bars 5m=${m5.length} 15m=${m15.length} 1h=${h1.length} 4h=${h4.length} ${new Date(m5[0].t).toISOString()} → ${new Date(m5.at(-1)!.t).toISOString()}`);

// all strategies on, full size, so every setup is visible
CFG.RISK_SCALE = Object.fromEntries(STRATEGIES.map(s => [s, 1])) as typeof CFG.RISK_SCALE;
CFG.HTF_DONCHIAN = 55;
if (process.env.MIN_STOP) CFG.MIN_STOP_PCT = +process.env.MIN_STOP;
if (process.env.MAX_COST) CFG.MAX_COST_R = +process.env.MAX_COST;
const S = buildSeries({ m5, m15, h1, h4 });
const ema200_1h = emaSeries(h1, 200), atr1h = atrSeries(h1, 14);
const enabled = Object.fromEntries(STRATEGIES.map(s => [s, true]));
const idxAt = (b: Bar[], T: number) => { let lo = 0, hi = b.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (b[m].ct <= T) { a = m; lo = m + 1; } else hi = m - 1; } return a; };
const ret = (b: Bar[], i: number, n: number) => (i - n >= 0 ? b[i].c / b[i - n].c - 1 : NaN);
function rvol(b: Bar[], i: number, n: number) { if (i - n < 1) return NaN; let s = 0; for (let j = i - n + 1; j <= i; j++) { const r = Math.log(b[j].c / b[j - 1].c); s += r * r; } return Math.sqrt(s / n); }

const COLS = ["t", "strategy", "dir", "score", "entry", "stop_atr15", "risk_pct",
  "hour", "dow", "regime", "st5", "st15", "st1h", "st4h", "align",
  "chop5", "chop15", "rsi15", "rsi1h", "vwap_dev", "atr5_pct", "atr15_pct", "atr4h_pct", "atrD_pct",
  "roc5", "ema_gap5", "poc_dist", "hi20_dist", "lo20_dist", "ema50_4h_dist", "ema200_1h_dist", "ema50D_dist",
  "r1h", "r4h", "r24h", "r72h", "r7d", "rv1h_24", "rv1h_168", "rv_ratio", "vol15_ratio", "asian_rng_pct", "dir_sign",
  "R", "win", "mfeR", "maeR", "bars_held", "exit"];
const rows: string[] = [COLS.join(",")];
const sgn = (d: string) => (d === "long" ? 1 : -1);

let nSig = 0;
const t0 = Date.now();
for (let i = 400; i < m5.length - 2; i++) {
  const snap = snapshot(S, i);
  const { signals } = evaluate(snap, enabled, S);
  if (!signals.length) continue;
  const T = snap.T, i1h = idxAt(h1, T), i4h = snap.i4h, iD = snap.i1d;
  for (const sig of signals as Signal[]) {
    nSig++;
    // simulate on its own account with the live exit rules
    const st = initState(1000, m5[i + 1].t);
    const p = openPosition(st, sig, m5[i + 1].o, m5[i + 1].t);
    if (!p) continue;
    const d = sgn(sig.dir), R0 = Math.abs(p.entry - p.stop0);
    let mfe = 0, mae = 0, j = i + 1, trade = null;
    for (; j < m5.length && st.pos; j++) {
      const b = m5[j];
      if (b.ct > p.openT) { mfe = Math.max(mfe, ((d === 1 ? b.h : b.l) - p.entry) * d / R0); mae = Math.min(mae, ((d === 1 ? b.l : b.h) - p.entry) * d / R0); }
      const tr = managePosition(st, [b], null); if (tr.length) { trade = tr[0]; break; }
    }
    if (!trade) continue; // still open at end of data
    const px = snap.price, D = S.d1;
    const f = {
      t: new Date(T + 1).toISOString(), strategy: sig.strategy, dir: sig.dir, score: sig.score, entry: p.entry.toFixed(2),
      stop_atr15: (R0 / snap.atr15), risk_pct: R0 / px,
      hour: snap.hour, dow: new Date(T + 1).getUTCDay(), regime: snap.regime,
      st5: snap.st5 * d, st15: snap.st15 * d, st1h: snap.st1h * d, st4h: snap.st4h * d, align: (snap.st5 + snap.st15 + snap.st1h + snap.st4h) * d,
      chop5: snap.chop5, chop15: snap.chop15, rsi15: snap.rsi15, rsi1h: snap.rsi1h, vwap_dev: snap.vwapDev * d,
      atr5_pct: snap.atr5 / px, atr15_pct: snap.atr15 / px, atr4h_pct: snap.atr4h / px, atrD_pct: iD >= 0 ? S.atrD[iD] / px : NaN,
      roc5: snap.roc5 * d, ema_gap5: (snap.ema20 - snap.ema50) / px * d, poc_dist: (px - snap.poc) / px * d,
      hi20_dist: (snap.hi20_15 - px) / snap.atr15, lo20_dist: (px - snap.lo20_15) / snap.atr15,
      ema50_4h_dist: (px - snap.ema50_4h) / px * d, ema200_1h_dist: i1h >= 0 ? (px - ema200_1h[i1h]) / px * d : NaN,
      ema50D_dist: iD >= 0 ? (px - S.ema50D[iD]) / px * d : NaN,
      r1h: ret(h1, i1h, 1) * d, r4h: ret(h1, i1h, 4) * d, r24h: ret(h1, i1h, 24) * d, r72h: ret(h1, i1h, 72) * d, r7d: ret(h1, i1h, 168) * d,
      rv1h_24: rvol(h1, i1h, 24), rv1h_168: rvol(h1, i1h, 168), rv_ratio: rvol(h1, i1h, 24) / rvol(h1, i1h, 168),
      vol15_ratio: snap.vol15 / snap.volAvg15, asian_rng_pct: snap.asian ? (snap.asian.hi - snap.asian.lo) / px : NaN, dir_sign: d,
      R: trade.r, win: trade.net > 0 ? 1 : 0, mfeR: mfe, maeR: mae, bars_held: j - i, exit: trade.reason.replace(/,/g, ";"),
    } as Record<string, unknown>;
    rows.push(COLS.map(c => { const v = f[c]; return typeof v === "number" ? (isFinite(v) ? +v.toFixed(6) : "") : String(v ?? ""); }).join(","));
  }
  if (i % 50000 === 0) console.error(`  ${i}/${m5.length} signals=${nSig} rows=${rows.length - 1} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
mkdirSync("ml/data", { recursive: true });
writeFileSync(out, rows.join("\n") + "\n");
console.error(`done: ${rows.length - 1} setups → ${out} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
