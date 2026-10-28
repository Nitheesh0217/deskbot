// Offline coverage scan: runs the engine's evaluate() with a trace over a historical 5m dataset and counts, per strategy,
// how often it was due, produced a valid setup, or was rejected and why. Descriptive only (no profitability claim).
//   npx tsx scripts/coverage_scan.ts --data kline5_BTC.csv.gz --book BTC|GOLD --cfg live_cfg.json --mode live|permissive [--from ms --to ms] [--out file.json]
// live       = the book's exact live overrides (regime gates, risk scales); entries are counted by running the real backtest on the same window
// permissive = every strategy at scale 1, no regime gate, MIN_SCORE 0: proves each code path is reachable on real data
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { applyCfg, buildSeries, snapshot, evaluate, initState, setMlAsset, backtest, STRATEGIES, type Bar, type StrategyTrace } from "../supabase/functions/deskbot-v5/engine.ts";
import { classifyReject, cadenceOf } from "../supabase/functions/deskbot-v5/coverage.ts";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const data = arg("data")!, book = arg("book", "BTC")!, mode = arg("mode", "live")!, cfgFile = arg("cfg");
const TF5 = 300_000, DAY = 86_400_000;
const rows = gunzipSync(readFileSync(data)).toString("utf8").trim().split("\n");
const m5: Bar[] = rows.map((r) => { const p = r.split(","); const t = +p[0]; return { t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5], ct: t + TF5 - 1 }; });
const agg = (tf: number): Bar[] => { const out: Bar[] = []; let i = 0; while (i < m5.length) { const k = Math.floor(m5[i].t / tf) * tf; let j = i, h = -Infinity, l = Infinity, v = 0; while (j < m5.length && Math.floor(m5[j].t / tf) * tf === k) { h = Math.max(h, m5[j].h); l = Math.min(l, m5[j].l); v += m5[j].v; j++; } if ((j - i) * TF5 === tf) out.push({ t: k, o: m5[i].o, h, l, c: m5[j - 1].c, v, ct: k + tf - 1 }); i = j; } return out; };
const from = +(arg("from") ?? m5[0].t + 130 * DAY), to = +(arg("to") ?? m5[m5.length - 1].ct);
const live = cfgFile ? JSON.parse(readFileSync(cfgFile, "utf8")).books[book] : { cfg: {}, startEquity: 350 };
const cfg = mode === "live" ? live.cfg : { RISK_SCALE: Object.fromEntries(STRATEGIES.map((s) => [s, 1])), REGIME_GATE: {}, MIN_SCORE: 0, HTF_DONCHIAN: live.cfg.HTF_DONCHIAN ?? 20 };
applyCfg(cfg); setMlAsset(book === "GOLD");
const frames = { m5, m15: agg(900_000), h1: agg(3_600_000), h4: agg(14_400_000) }; const S = buildSeries(frames);
const st = initState(live.startEquity, from);
const out: Record<string, any> = Object.fromEntries(STRATEGIES.map((id) => [id, { cadence: cadenceOf(id), bars: 0, notDue: 0, disabled: 0, insufficientData: 0, noSetup: 0, gateRejected: 0, errors: 0, setups: 0, firstSetupAt: null as string | null, gateReasons: {} as Record<string, number> }]));
let evaluated = 0;
for (let i = 1; i < m5.length; i++) {
  const T = m5[i].ct; if (T < from || T > to) continue; evaluated++;
  const snap = snapshot(S, i, { funding: null, oi: null, markPx: null, fng: null });
  const trace: StrategyTrace[] = []; evaluate(snap, st.enabled, S, st, trace);
  for (const t of trace) {
    const o = out[t.id]; o.bars++;
    if (t.kind === "OFF") o.disabled++; else if (t.kind === "WARMUP") o.insufficientData++; else if (t.kind === "ERROR") o.errors++;
    else if (t.kind === "ADMITTED") { o.setups++; o.firstSetupAt ??= new Date(T).toISOString(); }
    else { const c = classifyReject(t.reason); if (c === "NOT_DUE") o.notDue++; else if (c === "INSUFFICIENT_DATA") o.insufficientData++; else if (c === "GATE_REJECTED") { o.gateRejected++; const k = t.reason.replace(/\$?[-+]?\d[\d.,]*%?/g, "#").slice(0, 70); o.gateReasons[k] = (o.gateReasons[k] ?? 0) + 1; } else o.noSetup++; }
  }
}
let entries: Record<string, number> | null = null, net: Record<string, number> | null = null;
if (mode === "live") {
  const warm = m5.filter((b) => b.t < from).length;   // same windowing as the research harness: frames from data start, warm-up bars before `from`
  const bt = backtest(frames, { startEquity: live.startEquity, cfg: cfg as never, warmupBars: warm });
  entries = {}; net = {}; for (const t of bt.trades) { entries[t.strategy] = (entries[t.strategy] ?? 0) + 1; net[t.strategy] = +(((net[t.strategy] ?? 0) + t.r)).toFixed(2); }
}
const days = (to - from) / DAY, res = { book, mode, window: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), days: +days.toFixed(0), evaluatedBars: evaluated }, strategies: out, backtestEntriesByStrategy: entries, backtestNetRByStrategy: net, note: "descriptive counts; setups = valid after strategy rules and shared gates (before portfolio selection)" };
if (arg("out")) writeFileSync(arg("out")!, JSON.stringify(res, null, 1));
console.log(JSON.stringify({ book, mode, days: res.window.days, perStrategy: Object.fromEntries(Object.entries(out).map(([k, v]: any) => [k, { cad: v.cadence, setups: v.setups, per30d: +(v.setups / days * 30).toFixed(2), gate: v.gateRejected, noSetup: v.noSetup, off: v.disabled, data: v.insufficientData, err: v.errors, first: v.firstSetupAt?.slice(0, 10) }])), entries, netR: net }));
