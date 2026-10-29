// End-to-end shadow lane on historical candles. Replays ONE lane (instrument x strategy) bar by bar with the shared executor, writes decisions
// before outcomes to a JSONL log, and reports three clearly separated views:
//   A  independent strategy performance (the lane)
//   B  the same strategy as executed inside the combined portfolio (engine.backtest, live cfg, with its auto-disable and one-position rule)
//   C  hypothetical candidate outcomes: lane trades that opened while the portfolio was occupied (not executable in the portfolio at that time)
// Research only. No orders. The portfolio configuration is never modified.
//   npx tsx scripts/lane_replay.ts --data kline5_BTC.csv.gz --book BTC --cfg live_cfg.json --strategy SWEEP_REV [--from ms --to ms] [--out dir]
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildSeries, backtest, applyCfg, type Bar, type Trade, type StrategyId } from "../supabase/functions/deskbot-v5/engine.ts";
import { newLane, stepLane, finishLane, type LaneEvent } from "../supabase/functions/deskbot-v5/lanes.ts";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const TF5 = 300_000, DAY = 86_400_000, book = arg("book", "BTC")!, strategy = arg("strategy")! as StrategyId, outDir = arg("out", "lane_out")!;
const rows = gunzipSync(readFileSync(arg("data")!)).toString("utf8").trim().split("\n");
const all: Bar[] = rows.map((r) => { const p = r.split(","); const t = +p[0]; return { t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5], ct: t + TF5 - 1 }; });
const to = +(arg("to") ?? all[all.length - 1].t + TF5), from = +(arg("from") ?? to - 365 * DAY);
const m5 = all.filter((b) => b.t >= from - 130 * DAY && b.t < to), warm = m5.filter((b) => b.t < from).length;
const agg = (tf: number): Bar[] => { const out: Bar[] = []; let i = 0; while (i < m5.length) { const k = Math.floor(m5[i].t / tf) * tf; let j = i, h = -Infinity, l = Infinity, v = 0; while (j < m5.length && Math.floor(m5[j].t / tf) * tf === k) { h = Math.max(h, m5[j].h); l = Math.min(l, m5[j].l); v += m5[j].v; j++; } if ((j - i) * TF5 === tf) out.push({ t: k, o: m5[i].o, h, l, c: m5[j - 1].c, v, ct: k + tf - 1 }); i = j; } return out; };
const frames = { m5, m15: agg(900_000), h1: agg(3_600_000), h4: agg(14_400_000) };
const live = JSON.parse(readFileSync(arg("cfg")!, "utf8")).books[book] as { startEquity: number; cfg: Record<string, unknown> };
applyCfg();

// A — the lane
const lane = await newLane({ sym: book, strategy, startEquity: live.startEquity, baseCfg: live.cfg, specVersion: "lane-spec-1" }, m5[0].t);
const S = buildSeries(frames), events: LaneEvent[] = [], laneTrades: Trade[] = [];
const start = Math.max(warm, 60); let peak = live.startEquity, mdd = 0;
for (let i = start; i < m5.length - 1; i++) {
  const r = stepLane(lane, { S, i, bar: m5[i], fill: { px: m5[i + 1].o, t: m5[i + 1].t } }); events.push(...r.events); laneTrades.push(...r.trades);
  peak = Math.max(peak, lane.state.equity); mdd = Math.max(mdd, (peak - lane.state.equity) / peak);
}
const fin = finishLane(lane, m5[m5.length - 1]); events.push(...fin.events); laneTrades.push(...fin.trades);
// B — the combined portfolio with the live configuration
const port = backtest(frames, { startEquity: live.startEquity, cfg: live.cfg as never, warmupBars: warm });
const mine = port.trades.filter((t) => t.strategy === strategy);
const span = to - from, metrics = (tr: Trade[]) => { const n = tr.length, R = tr.reduce((a, t) => a + t.r, 0), net = tr.reduce((a, t) => a + t.net, 0); const sorted = tr.map((t) => t.r).sort((a, b) => a - b); const k = Math.max(1, Math.ceil(0.05 * n));
  return { trades: n, netR: +R.toFixed(2), meanR: n ? +(R / n).toFixed(3) : null, net$: +net.toFixed(2), winRate: n ? +(tr.filter((t) => t.net > 0).length / n).toFixed(3) : null, worstR: n ? +sorted[0].toFixed(2) : null, cvar5R: n ? +(sorted.slice(0, k).reduce((a, x) => a + x, 0) / k).toFixed(2) : null, fees$: +tr.reduce((a, t) => a + t.fees, 0).toFixed(2), exposurePct: +(100 * tr.reduce((a, t) => a + Math.max(0, t.closeT - t.openT), 0) / span).toFixed(1) }; };
// C — lane trades that opened while the portfolio held a position
const occupied = port.trades.map((t) => [t.openT, t.closeT] as const), overlapped = laneTrades.filter((t) => occupied.some(([a, b]) => t.openT >= a && t.openT <= b));
const sameAsPortfolio = laneTrades.filter((t) => mine.some((p) => Math.abs(p.openT - t.openT) < 600_000 && p.dir === t.dir));
const summary = {
  lane: lane.id, specVersion: lane.spec.specVersion, laneCfgSha256: lane.cfgSha256, window: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), days: +(span / DAY).toFixed(0) },
  fidelityNote: "replay: 5m management path and next-bar-open fills, like engine.backtest; live manages on 1m and fills at the current price. Binance spot candles, not the traded venue.",
  A_independent_lane: { ...metrics(laneTrades), maxDD: +mdd.toFixed(3), signalsSeen: lane.signalsSeen, wouldHaveBeenAutoDisabled: lane.wouldHaveDisabled },
  B_inside_portfolio: { ...metrics(mine), note: "same strategy as executed in the combined portfolio with auto-disable, probation, one position and first-match selection" },
  C_hypothetical_not_executable_in_portfolio: { ...metrics(overlapped), note: "lane trades that opened while the portfolio held another position (a subset of A, not an additional result)" },
  laneTradesAlsoTakenByPortfolio: sameAsPortfolio.length, portfolioTotal: { trades: port.trades.length, netR: +port.trades.reduce((a, t) => a + t.r, 0).toFixed(2) },
  logInvariants: { decisions: events.filter((e) => e.kind === "decision").length, outcomes: events.filter((e) => e.kind === "outcome").length, decisionBeforeOutcome: (() => { const seen = new Map<string, number>(); for (const e of events) { if (e.kind === "decision") seen.set(e.decisionId, e.seq); else if (!(seen.has(e.decisionId) && seen.get(e.decisionId)! < e.seq)) return false; } return true; })() },
  disclaimer: "descriptive, in-sample history; not a profitability claim",
};
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/${lane.id.replace(":", "_")}_events.jsonl`, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
writeFileSync(`${outDir}/${lane.id.replace(":", "_")}_summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
