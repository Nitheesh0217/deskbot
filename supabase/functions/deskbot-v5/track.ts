// Forward tracking of scanner setups: the evidence a market needs before it may ever get a paper book.
// Every setup the bot's own rules fire on any scanned market is recorded at the bar it fired (before any outcome exists) and then
// followed bar by bar until the FIRST of: TP1 (win), stop (loss) or the strategy's max hold (closed at that bar's close).
// Conservative conventions: entry = the signal bar's reference price; a bar that touches both stop and TP1 counts as the stop;
// the stop is widened to the engine's minimum exactly as the engine's entry does; setups whose costs exceed MAX_COST_R are not tracked
// (the engine would not take them). Net R subtracts the round-trip taker fees and slippage. This is a bracket test of the entry
// signal, not a replay of the full trade manager (partials, trailing): it measures whether the rules see the move first.
// Pure functions only; index.ts does the I/O.
import { buildSeries, snapshot, evaluate, initState, ensureState, CFG, type Bar } from "./engine.ts";
import type { Frames } from "./scan.ts";

// Priority: 1 = trades as a paper book now; 2 = next in line (tracked, shown first); 3 = tracked.
export const PRIORITY: Record<string, 1 | 2 | 3> = { BTC: 1, GOLD: 1, ETH: 2, SOL: 2, XRP: 3, BNB: 3, DOGE: 3, LINK: 3, AVAX: 3, SUI: 3 };
export const PROMOTION = { minResolved: 30, rule: "≥30 resolved setups, mean net R > 0 and the 95% bootstrap lower bound > 0. Meeting it makes a market a CANDIDATE for a paper book; the owner decides. Nothing is promoted automatically." };

export type NewSignal = { sym: string; strategy: string; dir: "long" | "short"; bar_t: number; entry: number; stop: number; tp1: number; r_dist: number; cost_r: number; max_hold_h: number; score: number; why: string[] };
export type OpenSignal = NewSignal & { id: number; checked_t: number | null };
export type Resolution = { id: number; status: "open" | "tp1" | "stop" | "time"; checked_t: number; exit_t?: number; exit_px?: number; r_gross?: number; r_net?: number };

/** Setups fired on each of the last `lookback` closed 5m bars (a scan every 15 min sees all three bars since the previous scan). */
export function signalsOverBars(sym: string, f: Frames, lookback = 3): NewSignal[] {
  if (f.m5.length < 300 || f.m15.length < 100 || f.h1.length < 60 || f.h4.length < 60) return [];
  const S = buildSeries(f), out: NewSignal[] = [];
  for (let i5 = f.m5.length - lookback; i5 < f.m5.length; i5++) {
    if (i5 < 1) continue;
    const s = snapshot(S, i5, {}), st = ensureState(initState(1000, s.T));
    for (const g of evaluate(s, st.enabled, S, st).signals) {
      const d = g.dir === "long" ? 1 : -1, entry = g.entryRef, minStop = Math.max(CFG.MIN_STOP_PCT, CFG.MIN_STOP_BY[g.strategy] ?? 0);
      let stop = g.stop; if ((stop - entry) * d >= 0) continue;
      if (!g.bodyStop && minStop > 0 && Math.abs(entry - stop) < minStop * entry) stop = entry - d * minStop * entry;
      const R = Math.abs(entry - stop), costR = (entry * (2 * CFG.TAKER_FEE + 2 * CFG.SLIPPAGE)) / R;
      if (!(R > 0) || costR > CFG.MAX_COST_R) continue;
      const T = CFG.TARGETS[g.strategy];
      out.push({ sym, strategy: g.strategy, dir: g.dir, bar_t: s.T, entry, stop, tp1: entry + d * T.tp1 * R, r_dist: R, cost_r: +costR.toFixed(4), max_hold_h: T.maxHoldH, score: g.score, why: g.why.slice(0, 5) });
    }
  }
  return out;
}

/** Advance one open setup over 5m bars that closed after it was last checked. */
export function resolve(sig: OpenSignal, m5: Bar[]): Resolution {
  const d = sig.dir === "long" ? 1 : -1, end = sig.bar_t + sig.max_hold_h * 3600_000, from = sig.checked_t ?? sig.bar_t;
  let checked = from;
  const done = (status: "tp1" | "stop" | "time", t: number, px: number): Resolution => {
    const g = ((px - sig.entry) * d) / sig.r_dist;
    return { id: sig.id, status, checked_t: t, exit_t: t, exit_px: px, r_gross: +g.toFixed(4), r_net: +(g - sig.cost_r).toFixed(4) };
  };
  for (const b of m5) {
    if (b.ct <= from) continue;
    const hitStop = d > 0 ? b.l <= sig.stop : b.h >= sig.stop, hitTp = d > 0 ? b.h >= sig.tp1 : b.l <= sig.tp1;
    if (hitStop) return done("stop", b.ct, sig.stop);          // both in one bar: the stop is assumed first
    if (hitTp) return done("tp1", b.ct, sig.tp1);
    if (b.ct >= end) return done("time", b.ct, b.c);
    checked = b.ct;
  }
  return { id: sig.id, status: "open", checked_t: checked };
}

function bootLo(xs: number[], n = 2000, seed = 20261029): number | null {
  if (xs.length < 2) return null;
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647), means: number[] = [];
  for (let k = 0; k < n; k++) { let t = 0; for (let i = 0; i < xs.length; i++) t += xs[Math.floor(rnd() * xs.length)]; means.push(t / xs.length); }
  means.sort((a, b) => a - b); return +means[Math.floor(0.025 * n)].toFixed(4);
}
type Row = { sym: string; strategy: string; status: string; r_net: number | null };
/** Per-market forward record from resolved setups, with the promotion check. Descriptive; never feeds the executor. */
export function trackRecord(rows: Row[]) {
  const by = new Map<string, Row[]>(); for (const r of rows) { if (!by.has(r.sym)) by.set(r.sym, []); by.get(r.sym)!.push(r); }
  return Object.keys(PRIORITY).map((sym) => {
    const all = by.get(sym) ?? [], res = all.filter((r) => r.status !== "open" && typeof r.r_net === "number"), xs = res.map((r) => r.r_net as number);
    const mean = xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4) : null, lo = xs.length >= PROMOTION.minResolved ? bootLo(xs) : null;
    const strat = new Map<string, number[]>(); for (const r of res) { if (!strat.has(r.strategy)) strat.set(r.strategy, []); strat.get(r.strategy)!.push(r.r_net as number); }
    return {
      sym, priority: PRIORITY[sym], open: all.length - res.length, resolved: res.length, wins: res.filter((r) => r.status === "tp1").length,
      meanNetR: mean, sumNetR: xs.length ? +xs.reduce((a, b) => a + b, 0).toFixed(3) : 0, lo95: lo,
      verdict: res.length < PROMOTION.minResolved ? `collecting (${res.length}/${PROMOTION.minResolved})` : lo !== null && lo > 0 && (mean ?? 0) > 0 ? "CANDIDATE" : "NOT_YET",
      byStrategy: [...strat.entries()].map(([s, v]) => ({ strategy: s, n: v.length, meanNetR: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) })).sort((a, b) => b.n - a.n),
    };
  }).sort((a, b) => a.priority - b.priority || b.resolved - a.resolved);
}

// ─── CALL-1 scoring: each market's directional call checked CALL_HORIZON_H hours later ─────────────
export type OpenCall = { id: number; sym: string; t: number; horizon_h: number; lean: "LONG" | "SHORT"; px: number; atr: number };
export type CallScore = { id: number; px_end: number; end_t: number; move_pct: number; move_atr: number; hit: boolean };
/** Score a call on the close of the first 5m bar at or after t + horizon. null while that bar has not closed. */
export function scoreCall(c: OpenCall, m5: Bar[]): CallScore | null {
  const end = c.t + c.horizon_h * 3600_000, b = m5.find((x) => x.ct >= end);
  if (!b) return null;
  const d = c.lean === "LONG" ? 1 : -1, mv = (b.c - c.px) * d;
  return { id: c.id, px_end: b.c, end_t: b.ct, move_pct: +((mv / c.px) * 100).toFixed(4), move_atr: c.atr > 0 ? +(mv / c.atr).toFixed(3) : 0, hit: mv > 0 };
}
type CallRow = { sym: string; lean: string; status: string; hit: boolean | null; move_atr: number | null; move_pct: number | null; source?: string };
/** Per-market call record. Right = price moved the called way after 4 h (before costs). Compared with 50%, it is descriptive only. */
export function callRecord(rows: CallRow[]) {
  return Object.keys(PRIORITY).map((sym) => {
    const sc = rows.filter((r) => r.sym === sym && r.status === "scored" && typeof r.hit === "boolean"), n = sc.length, hits = sc.filter((r) => r.hit).length;
    const mean = (xs: number[]) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : null);
    return { sym, priority: PRIORITY[sym], scored: n, open: rows.filter((r) => r.sym === sym && r.status === "open").length, hitRate: n ? +(hits / n * 100).toFixed(1) : null,
      meanMoveAtr: mean(sc.map((r) => r.move_atr as number)), meanMovePct: mean(sc.map((r) => r.move_pct as number)),
      verdict: n < 30 ? `collecting (${n}/30)` : (bootLo(sc.map((r) => r.move_atr as number)) ?? 0) > 0 ? "CALLS AHEAD OF MARKET" : "NO EDGE YET" };
  }).sort((a, b) => a.priority - b.priority);
}
