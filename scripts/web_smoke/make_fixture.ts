// Builds a mocked status payload + candle series for the browser smoke test. Candles are REAL historical Binance BTCUSDT bars
// (research dataset), time-shifted so the last bar is "now". The open position is FABRICATED for rendering only.
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { initState, openPosition, applyCfg, buildSeries, snapshot, evaluate, backtest, ensureState, type Bar, type StrategyTrace } from "../../supabase/functions/deskbot-v5/engine.ts";
import { recordCoverage, dispositions } from "../../supabase/functions/deskbot-v5/coverage.ts";
const src = process.argv[2], out = process.argv[3];
const rows = gunzipSync(readFileSync(src)).toString().trim().split("\n").slice(-60000);
const m5: Bar[] = rows.map((r) => { const p = r.split(","); const t = +p[0]; return { t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5], ct: t + 299999 }; });
const shift = Math.floor(Date.now() / 300000) * 300000 - m5[m5.length - 1].t - 300000;
for (const b of m5) { b.t += shift; b.ct += shift; }
const agg = (tf: number): Bar[] => { const res: Bar[] = []; let i = 0; while (i < m5.length) { const k = Math.floor(m5[i].t / tf) * tf; let j = i, h = -Infinity, l = Infinity, v = 0; while (j < m5.length && Math.floor(m5[j].t / tf) * tf === k) { h = Math.max(h, m5[j].h); l = Math.min(l, m5[j].l); v += m5[j].v; j++; } if ((j - i) * 300000 === tf) res.push({ t: k, o: m5[i].o, h, l, c: m5[j - 1].c, v, ct: k + tf - 1 }); i = j; } return res; };
const frames = { "5m": m5, "15m": agg(900000), "1h": agg(3600000), "4h": agg(14400000), "1d": agg(86400000) };
// fabricated long opened ~6 hours ago at that bar's close, stop 0.5% below, targets 1R/2R/3R
applyCfg(); const m15 = frames["15m"], k = m15.length - 24, entryBar = m15[k];
const st = initState(350, entryBar.t); const sig = { strategy: "SWEEP_REV", dir: "long", entryRef: entryBar.c, stop: entryBar.c * 0.995, score: 82, why: ["MOCK: sell-side sweep then reclaim", "MOCK: rendering fixture only"], regime: "RANGE", barT: entryBar.t } as never;
const p = openPosition(st, sig, entryBar.c, entryBar.ct + 1000)!;
const price = m15[m15.length - 1].c;
// REAL coverage counters: the engine evaluates the last 3 days of the real candles (live-like BTC config) and folds each bar into counters.
const LIVE = { XC_TF: "15m", TRADER: true, EXIT_MODE: "HOLD", TRADER_PARTS: "be", HTF_DONCHIAN: 55, RISK_SCALE: { D_THRUST: 1, HTF_TREND: 1, SWEEP_REV: 1, TREND_MTF: 1, D_BEARTRAP: 1, SESSION_BO: 1, VWAP_REVERT: 1 }, MIN_STOP_BY: { TREND_MTF: 0.012 }, REGIME_GATE: { HTF_TREND: 0.03, TREND_MTF: 0.03, D_BEARTRAP: 0.03 } };
applyCfg(LIVE as never);
{
  const S2 = buildSeries({ m5, m15: frames["15m"], h1: frames["1h"], h4: frames["4h"] }), cs = ensureState(initState(350, 0)), n5 = m5.length;
  for (let i = n5 - 864; i < n5; i++) {
    const trace: StrategyTrace[] = [], snap = snapshot(S2, i, { funding: null, oi: null, markPx: null, fng: null }), T = m5[i].ct;
    const { signals } = evaluate(snap, cs.enabled, S2, cs, trace);
    recordCoverage(cs, { T, now: T + 60_000, trace, disp: dispositions(signals, { hadPos: false, opened: null, globalBlock: null, gateState: cs, now: T }) });
  }
  (st as any).cov = cs.cov; (st as any).covMeta = cs.covMeta;
  // closed paper trades from a real-candle backtest of the last 60 days (mock rows for rendering; not live trades)
  const cut = m5[n5 - 1].t - 60 * 86_400_000, sub = m5.filter((b) => b.t >= cut - 130 * 86_400_000), warm = sub.filter((b) => b.t < cut).length;
  const agg2 = (tf: number) => frames[tf === 900000 ? "15m" : tf === 3600000 ? "1h" : "4h"].filter((b) => b.t >= sub[0].t);
  const bt = backtest({ m5: sub, m15: agg2(900000), h1: agg2(3600000), h4: agg2(14400000) }, { startEquity: 350, cfg: LIVE as never, warmupBars: warm });
  (globalThis as any).__trades = bt.trades.slice(-100).map((t) => ({ id: t.id, symbol: "BTC", strategy: t.strategy, dir: t.dir, entry: t.entry, exit_avg: t.exitAvg, net: t.net, r: t.r, fees: t.fees, funding: t.funding, open_t: new Date(t.openT).toISOString(), close_t: new Date(t.closeT).toISOString(), reason: t.reason }));
  for (const t of bt.trades) { const a = st.stats.by[t.strategy]; a.n++; a.sumR += t.r; a.net += t.net; if (t.net > 0) { a.wins++; a.grossWin += t.net; } else { a.losses++; a.grossLoss -= t.net; } }
  (st as any).cfg = LIVE; st.pos = null; applyCfg(LIVE as never);
}
if (process.argv.includes("--demo-states")) {   // MOCK: force one strategy into each non-running state so the layout can be checked
  const c = (st as any).cov; Object.assign(c.D_THRUST, { lastDueCode: "ERROR", lastDueReason: "Strategy error: MOCK for layout check", failed: 3 });
  Object.assign(c.VWAP_REVERT, { lastDueCode: "INSUFFICIENT_DATA", lastDueReason: "VWAP deviation not defined yet (day just opened, no spread)", skippedData: 4 });
}
st.pos = null; const posAfter = openPosition(st, { ...sig, strategy: "SWEEP_REV" } as never, entryBar.c, entryBar.ct + 1000)!; void posAfter;
const status = { version: "5.8.0", mode: "PAPER", now: new Date().toISOString(), updated: new Date().toISOString(), integrity: { approved: false, hash: "mock", reason: "mock" }, state: st,
  lastRun: { ts: new Date().toISOString(), sym: "BTC", action: "HOLD", market: { price, regime: "RANGE", ema50D: price * 1.01 }, desk: { chart: { levels: [] } }, upnl: 1.2 },
  events: [], agents: [], trades: (globalThis as any).__trades ?? [], curve: [], books: null, backtest: null, config: {}, chat: { enabled: false, ai: [] } };
writeFileSync(out, JSON.stringify({ status, frames: Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, v.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v])])) }));
console.log("fixture", out, "15m bars", m15.length, "entry", p.entry.toFixed(1), "stop0", p.stop0.toFixed(1), "tp3", p.tp3.toFixed(1));
