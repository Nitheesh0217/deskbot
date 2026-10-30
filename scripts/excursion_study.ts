// EXIT/ENTRY research, measurement M1 (frozen spec: research/2026-10-30-entry-exit/SPEC_FROZEN.md). Research only, no orders.
// For each (book, strategy) the strategy runs as an isolated lane (scripts/lane_replay.ts executor: same evaluate / entryGates /
// openPosition / managePosition / traderManage, fills at the next 5m open). Every lane trade is then measured on the same 5m path:
//   MFE / MAE (price %, ATR of the strategy's own timeframe at the signal bar, original R), first-touch time of TP1/TP2/TP3/stop0,
//   max-hold expiry, realized net R and costs, giveback (MFE R − realized R), ATR% tercile, and causal entry-timing measures
//   (signal bar's own move in ATR, breakout distance beyond its trigger level in ATR). Trades still open at the data end are CENSORED.
//   npx tsx scripts/excursion_study.ts --data kline5_BTC.csv.gz --book BTC --cfg live_cfg.json --strategies HTF_TREND,SWEEP_REV --out dir
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildSeries, snapshot, applyCfg, CFG, type Bar, type Trade, type StrategyId } from "../supabase/functions/deskbot-v5/engine.ts";
import { newLane, stepLane, finishLane, type LaneDecision } from "../supabase/functions/deskbot-v5/lanes.ts";
import { cadenceFor } from "../supabase/functions/deskbot-v5/coverage_view.ts";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const TF5 = 300_000, DAY = 86_400_000, book = arg("book", "BTC")!, outDir = arg("out", "excursion_out")!;
const rows = gunzipSync(readFileSync(arg("data")!)).toString("utf8").trim().split("\n");
const all: Bar[] = rows.map((r) => { const p = r.split(","); const t = +p[0]; return { t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5], ct: t + TF5 - 1 }; });
const to = +(arg("to") ?? all[all.length - 1].t + TF5), from = +(arg("from") ?? to - 3 * 365 * DAY);
const m5 = all.filter((b) => b.t >= from - 130 * DAY && b.t < to), warm = m5.filter((b) => b.t < from).length;
const agg = (tf: number): Bar[] => { const out: Bar[] = []; let i = 0; while (i < m5.length) { const k = Math.floor(m5[i].t / tf) * tf; let j = i, h = -Infinity, l = Infinity, v = 0; while (j < m5.length && Math.floor(m5[j].t / tf) * tf === k) { h = Math.max(h, m5[j].h); l = Math.min(l, m5[j].l); v += m5[j].v; j++; } out.push({ t: k, o: m5[i].o, h, l, c: m5[j - 1].c, v, ct: k + tf - 1 }); i = j; } return out; };
const frames = { m5, m15: agg(900_000), h1: agg(3_600_000), h4: agg(14_400_000) };
const live = JSON.parse(readFileSync(arg("cfg")!, "utf8")).books[book] as { startEquity: number; cfg: Record<string, unknown> };
applyCfg(live.cfg as never);   // the book's own configuration for the series (e.g. HTF_DONCHIAN) — lanes apply it again per step
const S = buildSeries(frames);
const idxByCt = new Map<number, number>(); m5.forEach((b, i) => idxByCt.set(b.ct, i));
const tIdx = new Map<number, number>(); m5.forEach((b, i) => tIdx.set(b.t, i));

type Row = Record<string, unknown>;
const out: Row[] = [];
for (const strategy of arg("strategies")!.split(",") as StrategyId[]) {
  const lane = await newLane({ sym: book, strategy, startEquity: live.startEquity, baseCfg: live.cfg, specVersion: "lane-spec-1" }, m5[0].t);
  const decisions: LaneDecision[] = [], trades: Trade[] = [];
  for (let i = Math.max(warm, 60); i < m5.length - 1; i++) {
    const r = stepLane(lane, { S, i, bar: m5[i], fill: { px: m5[i + 1].o, t: m5[i + 1].t } });
    for (const e of r.events) if (e.kind === "decision") decisions.push(e); trades.push(...r.trades);
  }
  const fin = finishLane(lane, m5[m5.length - 1]); trades.push(...fin.trades);
  const finalIds = new Set(fin.trades.map((t) => t.id));
  applyCfg(lane.cfg as never);
  const cad = cadenceFor(strategy, CFG as never), T = CFG.TARGETS[strategy];
  for (const t of trades) {
    const dec = decisions.find((d) => d.fillTime === t.openT); if (!dec) continue;
    const si = idxByCt.get(dec.snapshotBarClose)!, sn = snapshot(S, si), d = t.dir === "long" ? 1 : -1, R = Math.abs(t.entry - t.stop0);
    const atr = cad === "5m" ? sn.atr5 : cad === "15m" ? sn.atr15 : cad === "1h" ? S.atr1h[sn.i1h] : sn.atr4h;   // daily strategies use 4H ATR (no daily ATR series)
    // causal entry timing: the signal bar of the strategy's own timeframe, and breakout distance beyond its trigger
    const tfBars = cad === "4h" || cad === "1d" ? frames.h4 : cad === "1h" ? frames.h1 : cad === "15m" ? frames.m15 : frames.m5;
    const sb = tfBars.find((b) => b.ct === dec.snapshotBarClose) ?? null;
    const signalBarMoveATR = sb ? ((sb.c - sb.o) * d) / atr : null;
    const trigger = strategy === "HTF_TREND" ? (d === 1 ? sn.hi4h : sn.lo4h) : null;
    const beyondTriggerATR = trigger != null && isFinite(trigger) ? ((sn.price - trigger) * d) / atr : null;
    const fillGapR = ((t.entry - sn.price) * d) / R;   // >0: filled worse than the signal close
    // path from the entry bar to the close bar (exit view) and to max hold (bracket view, for time-to-target)
    const i0 = tIdx.get(t.openT) ?? si + 1, iClose = idxByCt.get(Math.floor(t.closeT / TF5) * TF5 + TF5 - 1) ?? m5.length - 1;
    const expiry = t.openT + T.maxHoldH * 3600e3, iExp = Math.min(m5.length - 1, i0 + Math.ceil((T.maxHoldH * 3600e3) / TF5));
    let mfe = 0, mae = 0, ambiguous = 0; const first: Record<string, number | null> = { tp1: null, tp2: null, tp3: null, stop: null };
    for (let i = i0; i <= iExp; i++) {
      const b = m5[i], fav = d === 1 ? b.h - t.entry : t.entry - b.l, adv = d === 1 ? t.entry - b.l : b.h - t.entry;
      if (i <= iClose) { mfe = Math.max(mfe, fav); mae = Math.max(mae, adv); }
      const hitStop = d === 1 ? b.l <= t.stop0 : b.h >= t.stop0;
      for (const k of ["tp1", "tp2", "tp3"] as const) { const lvl = dec.plan[k]; if (first[k] == null && (d === 1 ? b.h >= lvl : b.l <= lvl)) { first[k] = b.ct; if (hitStop && first.stop == null) ambiguous++; } }
      if (first.stop == null && hitStop) first.stop = b.ct;
      if (first.stop != null && first.tp3 != null) break;
    }
    const censored = finalIds.has(t.id) && t.closeT < expiry;   // forced close at the data end before its own expiry
    const hrs = (x: number | null) => (x == null ? null : +((x - t.openT) / 3600e3).toFixed(2));
    const before = (k: "tp1" | "tp2" | "tp3") => first[k] != null && first[k]! <= expiry && (first.stop == null || first[k]! < first.stop);
    out.push({
      book, strategy, dir: t.dir, openT: new Date(t.openT).toISOString(), closeT: new Date(t.closeT).toISOString(), reason: t.reason, censored,
      period: t.openT < Date.UTC(2024, 9, 22) ? "A" : t.openT < Date.UTC(2025, 9, 22) ? "B" : "C",
      riskPct: +((R / t.entry) * 100).toFixed(3), atrPct: +((atr / sn.price) * 100).toFixed(3), stopATR: +(R / atr).toFixed(2),
      mfeR: +(mfe / R).toFixed(3), maeR: +(mae / R).toFixed(3), mfePct: +((mfe / t.entry) * 100).toFixed(3), mfeATR: +(mfe / atr).toFixed(2), maeATR: +(mae / atr).toFixed(2),
      netR: +t.r.toFixed(3), net: +t.net.toFixed(3), costs: +(t.fees + t.funding).toFixed(4), givebackR: +(mfe / R - t.r).toFixed(3),
      hTp1: hrs(first.tp1), hTp2: hrs(first.tp2), hTp3: hrs(first.tp3), hStop: hrs(first.stop), heldH: +((t.closeT - t.openT) / 3600e3).toFixed(2), maxHoldH: T.maxHoldH,
      tp1BeforeStop: before("tp1"), tp2BeforeStop: before("tp2"), tp3BeforeStop: before("tp3"), ambiguousBars: ambiguous,
      signalBarMoveATR: signalBarMoveATR == null ? null : +signalBarMoveATR.toFixed(2), beyondTriggerATR: beyondTriggerATR == null ? null : +beyondTriggerATR.toFixed(2), fillGapR: +fillGapR.toFixed(3),
      regime: sn.regime,
    });
  }
  console.error(`${book} ${strategy}: ${trades.length} trades, ${decisions.length} decisions`);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/excursions_${book}.json`, JSON.stringify({ book, from: new Date(from).toISOString(), to: new Date(to).toISOString(), engineVersion: CFG ? "5.8.0" : null, rows: out }, null, 0));
console.log(JSON.stringify({ book, rows: out.length }));
