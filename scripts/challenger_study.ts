// EXIT/ENTRY challengers (frozen spec research/2026-10-30-entry-exit/SPEC_FROZEN.md, Sections 4-5). Research only, no orders.
// Runs one isolated lane per (book, strategy) twice on the same data: BASE and one challenger. The step mirrors lanes.stepLane exactly
// (verified: the hook-free run must reproduce stepLane's trades bit for bit, otherwise the run aborts) with exactly one hook per challenger:
//   EXIT_B  after openPosition: tp1 = entry ± min(TP1 distance, 1.25 × ATR of the strategy's timeframe at the signal). Stop, sizing, TP2/TP3 unchanged.
//   EXIT_C  after management: if TP1 is not done and held ≥ 50% of max hold, close at the next 5m open.
//   ENTRY_1 HTF_TREND only: skip a signal whose close is more than 1.0 × ATR4h beyond its Donchian trigger (closed signal bar only).
//   npx tsx scripts/challenger_study.ts --data kline5_BTC.csv.gz --book BTC --cfg live_cfg.json --strategy HTF_TREND --variant ENTRY_1 [--costx 1.5] --out dir
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  CFG, STRATEGIES, buildSeries, snapshot, evaluate, entryGates, openPosition, managePosition, traderManage, markEquity, closeNow, applyCfg,
  type Bar, type Trade, type StrategyId,
} from "../supabase/functions/deskbot-v5/engine.ts";
import { newLane, stepLane, finishLane, withLaneCfg, type Lane } from "../supabase/functions/deskbot-v5/lanes.ts";
import { cadenceFor } from "../supabase/functions/deskbot-v5/coverage_view.ts";

type Variant = "BASE" | "EXIT_B" | "EXIT_C" | "ENTRY_1";
const arg = (k: string, d?: string) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const TF5 = 300_000, DAY = 86_400_000, book = arg("book", "BTC")!, strategy = arg("strategy")! as StrategyId, variant = arg("variant")! as Variant;
const costx = +(arg("costx") ?? "1"), outDir = arg("out", "challenger_out")!;
const rows = gunzipSync(readFileSync(arg("data")!)).toString("utf8").trim().split("\n");
const all: Bar[] = rows.map((r) => { const p = r.split(","); const t = +p[0]; return { t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5], ct: t + TF5 - 1 }; });
const to = all[all.length - 1].t + TF5, from = to - 3 * 365 * DAY;   // identical window to M1 (excursion_study.ts)
const m5 = all.filter((b) => b.t >= from - 130 * DAY && b.t < to), warm = m5.filter((b) => b.t < from).length;
const agg = (tf: number): Bar[] => { const out: Bar[] = []; let i = 0; while (i < m5.length) { const k = Math.floor(m5[i].t / tf) * tf; let j = i, h = -Infinity, l = Infinity, v = 0; while (j < m5.length && Math.floor(m5[j].t / tf) * tf === k) { h = Math.max(h, m5[j].h); l = Math.min(l, m5[j].l); v += m5[j].v; j++; } out.push({ t: k, o: m5[i].o, h, l, c: m5[j - 1].c, v, ct: k + tf - 1 }); i = j; } return out; };
const live = JSON.parse(readFileSync(arg("cfg")!, "utf8")).books[book] as { startEquity: number; cfg: Record<string, unknown> };
applyCfg(live.cfg as never);
const S = buildSeries({ m5, m15: agg(900_000), h1: agg(3_600_000), h4: agg(14_400_000) });
const baseCfg = costx === 1 ? live.cfg : { ...live.cfg, TAKER_FEE: CFG.TAKER_FEE * costx, MAKER_FEE: CFG.MAKER_FEE * costx, SLIPPAGE: CFG.SLIPPAGE * costx, BT_FUNDING_PER_HOUR: CFG.BT_FUNDING_PER_HOUR * costx };
const TP1_GT_1R = new Set<StrategyId>(["HTF_TREND", "EMA_CROSS", "HTF_SWEEP", "D_THRUST", "D_BEARTRAP"]);

type Run = { trades: Trade[]; eq: { t: number; e: number }[]; skipped: number; modified: number; timeClosed: number };
async function run(v: Variant): Promise<Run> {
  const lane: Lane = await newLane({ sym: book, strategy, startEquity: live.startEquity, baseCfg, specVersion: "lane-spec-1" }, m5[0].t);
  const st = lane.state, trades: Trade[] = [], eq: { t: number; e: number }[] = []; let skipped = 0, modified = 0, timeClosed = 0;
  for (let i = Math.max(warm, 60); i < m5.length - 1; i++) {
    const bar = m5[i], fill = { px: m5[i + 1].o, t: m5[i + 1].t };
    withLaneCfg(lane, () => {
      if (st.pos) trades.push(...managePosition(st, [bar], null));
      if (st.pos && CFG.TRADER) { const sn = snapshot(S, i), r = traderManage(st, sn, S, { st: sn.st5, bos: sn.st5, c: bar.c }, bar.c, bar.ct); if (r.closed) trades.push(r.closed); }
      if (v === "EXIT_C" && st.pos && !st.pos.tp1Done && bar.ct - st.pos.openT >= 0.5 * st.pos.maxHoldH * 3600e3) {
        const t = closeNow(st, fill.px, fill.t); if (t) { trades.push({ ...t, reason: "time50" }); timeClosed++; }
      }
      const e = markEquity(st, bar.c); if (i % 12 === 0) eq.push({ t: bar.ct, e });
      if (!st.pos) {
        const snap = snapshot(S, i), { signals } = evaluate(snap, Object.fromEntries(STRATEGIES.map((s) => [s, s === strategy])), S, st);
        for (const sig of signals) {
          const d = sig.dir === "long" ? 1 : -1;
          if (v === "ENTRY_1" && strategy === "HTF_TREND") {
            const trig = d === 1 ? snap.hi4h : snap.lo4h;
            if (((snap.price - trig) * d) / snap.atr4h > 1.0) { skipped++; continue; }
          }
          if (!entryGates(st, sig, bar.ct).ok) continue;
          const p = openPosition(st, sig, fill.px, fill.t); if (!p) continue;
          if (v === "EXIT_B" && TP1_GT_1R.has(strategy)) {
            const cad = cadenceFor(strategy, CFG as never);
            const atr = cad === "5m" ? snap.atr5 : cad === "15m" ? snap.atr15 : cad === "1h" ? S.atr1h[snap.i1h] : snap.atr4h;
            const dist = Math.min(Math.abs(p.tp1 - p.entry), 1.25 * atr);
            if (isFinite(dist) && dist < Math.abs(p.tp1 - p.entry)) { p.tp1 = p.entry + d * dist; modified++; }
          }
          break;
        }
      }
    });
  }
  trades.push(...finishLane(lane, m5[m5.length - 1]).trades);
  eq.push({ t: m5[m5.length - 1].ct, e: st.equity });
  return { trades, eq, skipped, modified, timeClosed };
}

// identity check: the hook-free copy must equal the production lane executor
async function viaStepLane(): Promise<Trade[]> {
  const lane = await newLane({ sym: book, strategy, startEquity: live.startEquity, baseCfg, specVersion: "lane-spec-1" }, m5[0].t), out: Trade[] = [];
  for (let i = Math.max(warm, 60); i < m5.length - 1; i++) out.push(...stepLane(lane, { S, i, bar: m5[i], fill: { px: m5[i + 1].o, t: m5[i + 1].t } }).trades);
  out.push(...finishLane(lane, m5[m5.length - 1]).trades); return out;
}
const base = await run("BASE"), ref = await viaStepLane();
const sig = (ts: Trade[]) => ts.map((t) => `${t.openT}|${t.closeT}|${t.net.toFixed(6)}`).join(",");
if (sig(base.trades) !== sig(ref)) { console.error(`IDENTITY FAIL: copy ${base.trades.length} vs stepLane ${ref.length}`); process.exit(2); }
const ch = variant === "BASE" ? base : await run(variant);

const metrics = (r: Run) => {
  const R = r.trades.map((t) => t.r), wins = R.filter((x) => x > 0), loss = R.filter((x) => x <= 0), sorted = [...R].sort((a, b) => a - b);
  const k = Math.max(1, Math.floor(0.05 * R.length)); let peak = -Infinity, mdd = 0;
  for (const p of r.eq) { peak = Math.max(peak, p.e); mdd = Math.max(mdd, (peak - p.e) / peak); }
  return {
    trades: R.length, netR: +R.reduce((a, b) => a + b, 0).toFixed(3), expR: R.length ? +(R.reduce((a, b) => a + b, 0) / R.length).toFixed(4) : null,
    net: +r.trades.reduce((a, t) => a + t.net, 0).toFixed(2), win: R.length ? +(wins.length / R.length).toFixed(3) : null,
    pf: loss.length ? +(wins.reduce((a, b) => a + b, 0) / -loss.reduce((a, b) => a + b, 0)).toFixed(3) : null,
    maxDDpct: +(100 * mdd).toFixed(2), worstR: R.length ? sorted[0] : null, cvar5R: R.length ? +(sorted.slice(0, k).reduce((a, b) => a + b, 0) / k).toFixed(3) : null,
    fees: +r.trades.reduce((a, t) => a + t.fees, 0).toFixed(2), funding: +r.trades.reduce((a, t) => a + t.funding, 0).toFixed(2),
    exposureH: +r.trades.reduce((a, t) => a + (t.closeT - t.openT) / 3600e3, 0).toFixed(0),
    skipped: r.skipped, tp1Modified: r.modified, time50Closes: r.timeClosed,
  };
};
const daily = (ts: Trade[]) => { const m = new Map<number, number>(); for (const t of ts) { const d = Math.floor(t.closeT / DAY); m.set(d, (m.get(d) ?? 0) + t.r); } return m; };
const d0 = Math.floor(from / DAY), d1 = Math.floor(to / DAY), db = daily(base.trades), dc = daily(ch.trades);
const dR: number[] = []; for (let d = d0; d <= d1; d++) dR.push((dc.get(d) ?? 0) - (db.get(d) ?? 0));
mkdirSync(outDir, { recursive: true });
const tag = `${book}_${strategy}_${variant}${costx !== 1 ? `_cost${costx}` : ""}`;
writeFileSync(`${outDir}/daily_${tag}.json`, JSON.stringify({ book, strategy, variant, costx, day0: d0, dR }));
console.log(JSON.stringify({ book, strategy, variant, costx, identity: "ok", base: metrics(base), challenger: metrics(ch) }));
