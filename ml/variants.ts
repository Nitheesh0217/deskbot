// DeskBot v5 — full-engine backtest of config variants on local 5m history, reported per year.
// usage: npx tsx ml/variants.ts <BTCUSDT_5m.csv> [variantName...]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { backtest, summarize, CFG, type Bar } from "../supabase/functions/deskbot-v5/engine.ts";

const [, , src, ...pick] = process.argv;
const M5 = 300_000;
const lines = readFileSync(src, "utf8").trim().split("\n"); lines.shift();
const m5: Bar[] = lines.map(ln => { const [ts, o, h, l, c, v] = ln.split(","); const t = Date.parse(ts); return { t, o: +o, h: +h, l: +l, c: +c, v: +v, ct: t + M5 - 1 }; });
function agg(b: Bar[], tf: number): Bar[] {
  const out: Bar[] = []; let cur: Bar | null = null; let key = -1;
  for (const x of b) { const k = Math.floor(x.t / tf);
    if (k !== key) { if (cur) out.push(cur); key = k; cur = { t: k * tf, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v, ct: (k + 1) * tf - 1 }; }
    else if (cur) { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v += x.v; } }
  if (cur) out.push(cur); return out;
}
const frames = { m5, m15: agg(m5, 900_000), h1: agg(m5, 3_600_000), h4: agg(m5, 14_400_000) };

const LIVE = { RISK_SCALE: { D_THRUST: 1, HTF_TREND: 1, SWEEP_REV: 0, TREND_MTF: 0.25, D_BEARTRAP: 1, SESSION_BO: 0.25, VWAP_REVERT: 0.25 }, HTF_DONCHIAN: 55 };
const GATE = { HTF_TREND: 0.03, TREND_MTF: 0.03, D_BEARTRAP: 0.03, SESSION_BO: 0.03 };
const V: Record<string, Partial<typeof CFG>> = {
  live: LIVE,
  gate: { ...LIVE, REGIME_GATE: GATE },
  gate_minstop: { ...LIVE, REGIME_GATE: GATE, MIN_STOP_BY: { TREND_MTF: 0.012, SESSION_BO: 0.012, VWAP_REVERT: 0.012 } },
  gate_minstop_hold: { ...LIVE, REGIME_GATE: GATE, MIN_STOP_BY: { TREND_MTF: 0.012, SESSION_BO: 0.012, VWAP_REVERT: 0.012 }, EXIT_MODE: "HOLD" },
  v51: { // lessons: gate trend strategies, wide stops, drop the setups that lose in every year, trend at full size
    HTF_DONCHIAN: 55, REGIME_GATE: { HTF_TREND: 0.03, TREND_MTF: 0.03, D_BEARTRAP: 0.03 },
    MIN_STOP_BY: { TREND_MTF: 0.012 }, EXIT_MODE: "HOLD",
    RISK_SCALE: { D_THRUST: 1, HTF_TREND: 1, SWEEP_REV: 0, TREND_MTF: 0.5, D_BEARTRAP: 1, SESSION_BO: 0, VWAP_REVERT: 0 },
  },
  v51_be: {
    HTF_DONCHIAN: 55, REGIME_GATE: { HTF_TREND: 0.03, TREND_MTF: 0.03, D_BEARTRAP: 0.03 },
    MIN_STOP_BY: { TREND_MTF: 0.012 },
    RISK_SCALE: { D_THRUST: 1, HTF_TREND: 1, SWEEP_REV: 0, TREND_MTF: 0.5, D_BEARTRAP: 1, SESSION_BO: 0, VWAP_REVERT: 0 },
  },
};
const out: Record<string, unknown> = {};
for (const [name, cfg] of Object.entries(V)) {
  if (pick.length && !pick.includes(name)) continue;
  const t0 = Date.now();
  const r = backtest(frames, { startEquity: 1000, cfg });
  const s = summarize(r.trades, 1000);
  const years: Record<string, string> = {};
  for (const y of [2023, 2024, 2025, 2026]) {
    const tr = r.trades.filter(t => new Date(t.closeT).getUTCFullYear() === y);
    const sy = summarize(tr, 1000); years[y] = `${tr.length}t ${sy.all.sumR >= 0 ? "+" : ""}${sy.all.sumR.toFixed(1)}R`;
  }
  const by = Object.entries(s.by).map(([k, v]) => `${k}:${v.n}/${v.expR >= 0 ? "+" : ""}${v.expR.toFixed(2)}`).join(" ");
  console.log(`${name.padEnd(18)} trades ${String(s.all.n).padStart(4)} expR ${s.all.expR >= 0 ? "+" : ""}${s.all.expR.toFixed(3)} PF ${s.all.pf.toFixed(2)} $1000→$${s.endEquity.toFixed(0)} maxDD ${(s.maxDD * 100).toFixed(1)}% | ${Object.entries(years).map(([y, v]) => `${y}:${v}`).join(" ")} | ${by}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  out[name] = { cfg, all: s.all, endEquity: s.endEquity, maxDD: s.maxDD, years, by: s.by };
}
mkdirSync("ml/data", { recursive: true }); writeFileSync(`ml/data/variants${pick.length ? "_" + pick.join("_") : ""}.json`, JSON.stringify(out, null, 1));
