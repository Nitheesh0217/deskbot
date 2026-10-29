// Builds a mocked status payload + candle series for the browser smoke test. Candles are REAL historical Binance BTCUSDT bars
// (research dataset), time-shifted so the last bar is "now". The open position is FABRICATED for rendering only.
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { initState, openPosition, applyCfg, type Bar } from "../../supabase/functions/deskbot-v5/engine.ts";
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
const status = { version: "5.8.0", mode: "PAPER", now: new Date().toISOString(), updated: new Date().toISOString(), integrity: { approved: false, hash: "mock", reason: "mock" }, state: st,
  lastRun: { ts: new Date().toISOString(), sym: "BTC", action: "HOLD", market: { price, regime: "RANGE", ema50D: price * 1.01 }, desk: { chart: { levels: [] } }, upnl: 1.2 },
  events: [], agents: [], trades: [], curve: [], books: null, backtest: null, config: {}, chat: { enabled: false, ai: [] } };
writeFileSync(out, JSON.stringify({ status, frames: Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, v.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v])])) }));
console.log("fixture", out, "15m bars", m15.length, "entry", p.entry.toFixed(1), "stop0", p.stop0.toFixed(1), "tp3", p.tp3.toFixed(1));
