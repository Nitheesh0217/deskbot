// Independent shadow lanes: one isolated paper lane per (instrument, strategy). Research only, paper only, no orders.
// A lane has its OWN equity, position, counters, cooldown and daily limits, and the SAME executor as the portfolio
// (evaluate / entryGates / openPosition / managePosition / traderManage, same costs, sizing and fill assumptions as engine.backtest).
// Lanes never touch the live portfolio state. Running a portfolio-disabled strategy here does NOT enable it in the portfolio.
// Differences from the portfolio, on purpose: auto-disable and probation sizing are OBSERVE-ONLY (a lane keeps measuring and records when
// the rule would have fired); only one strategy is evaluated; no other strategy can take the lane's turn.
import {
  CFG, STRATEGIES, applyCfg, resolvedCfg, snapshot, evaluate, entryGates, openPosition, managePosition, traderManage, markEquity, initState, ensureState, closeNow,
  type Series, type Bar, type State, type Trade, type StrategyId,
} from "./engine.ts";

export type LaneSpec = { sym: string; strategy: StrategyId; startEquity: number; baseCfg: Record<string, unknown>; specVersion: string };
export type LaneDecision = {
  seq: number; kind: "decision"; laneId: string; decisionId: string; snapshotBarClose: number; fillTime: number; strategy: StrategyId; dir: string; score: number; why: string[];
  plan: { entry: number; stop0: number; tp1: number; tp2: number; tp3: number; originalQty: number; riskAmt: number }; equityBefore: number; cfgSha256: string; specVersion: string;
};
export type LaneOutcome = { seq: number; kind: "outcome"; laneId: string; decisionId: string; closeT: number; reason: string; net: number; r: number; fees: number; funding: number; exitAvg: number };
export type LaneEvent = LaneDecision | LaneOutcome;
export type Lane = {
  id: string; spec: LaneSpec; cfg: Record<string, unknown>; cfgSha256: string; state: State; seq: number; decisionIdOf: Record<string, string>;
  wouldHaveDisabled: { atTrade: number; expR: number; closeT: number } | null; signalsSeen: number; lastBarT: number | null;
};

const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}` : JSON.stringify(v) ?? "null";
export async function sha256(s: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join(""); }
export const laneIdOf = (sym: string, strategy: StrategyId) => `${sym}:${strategy}`;

/** The lane's configuration: the book's own overrides; this strategy at the book's scale for it (1 if the book has none); learning rules observe-only. */
export function laneConfig(spec: LaneSpec): Record<string, unknown> {
  const base = (spec.baseCfg.RISK_SCALE as Record<string, number> | undefined)?.[spec.strategy], scale = typeof base === "number" && base > 0 ? base : 1;
  return { ...spec.baseCfg, RISK_SCALE: Object.fromEntries(STRATEGIES.map((s) => [s, s === spec.strategy ? scale : 0])), PROBATION_MIN_TRADES: 1e9, DISABLE_MIN_TRADES: 1e9 };
}
export async function newLane(spec: LaneSpec, t0: number): Promise<Lane> {
  const cfg = laneConfig(spec);
  const st = ensureState(initState(spec.startEquity, t0)); for (const s of STRATEGIES) st.enabled[s] = s === spec.strategy;
  return { id: laneIdOf(spec.sym, spec.strategy), spec, cfg, cfgSha256: await sha256(canonical({ spec: { ...spec, baseCfg: undefined }, cfg: resolvedCfg(cfg as never) })), state: st, seq: 0, decisionIdOf: {}, wouldHaveDisabled: null, signalsSeen: 0, lastBarT: null };
}

/** Runs `fn` with the lane's config applied to the module-global CFG and restores it afterwards (never leaks into the portfolio). */
export function withLaneCfg<T>(lane: Lane, fn: () => T): T {
  const saved = JSON.parse(JSON.stringify(CFG)); applyCfg(lane.cfg as never);
  try { return fn(); } finally { Object.assign(CFG, saved); }
}

export type StepInput = {
  S: Series; i: number;                       // series and index of the newest CLOSED 5m bar
  bar: Bar;                                   // that bar (the path the open position is managed on, 5m in replay)
  fill: { px: number; t: number } | null;     // where a new entry fills: next open in replay, current price live; null = no entry this bar
};
function recordClose(lane: Lane, t: Trade, events: LaneEvent[], trades: Trade[], nextSeq: () => number) {
  const st = lane.state, id = lane.spec.strategy; trades.push(t);
  events.push({ seq: nextSeq(), kind: "outcome", laneId: lane.id, decisionId: lane.decisionIdOf[t.id] ?? `LD-${lane.id}-${t.openT}`, closeT: t.closeT, reason: t.reason, net: t.net, r: t.r, fees: t.fees, funding: t.funding, exitAvg: t.exitAvg });
  const s = st.stats.by[id]; if (!lane.wouldHaveDisabled && s.n >= 20 && s.sumR / s.n < -0.15) lane.wouldHaveDisabled = { atTrade: s.n, expR: +(s.sumR / s.n).toFixed(4), closeT: t.closeT };
  st.enabled[id] = true;   // observe-only: the auto-off rule must never stop the measurement
}
/** One bar for one lane. Mirrors engine.backtestInner step by step so the lane and the portfolio share one executor. */
export function stepLane(lane: Lane, a: StepInput, nextSeq: () => number = () => ++lane.seq): { events: LaneEvent[]; trades: Trade[] } {
  const events: LaneEvent[] = [], trades: Trade[] = [], st = lane.state, id = lane.spec.strategy;
  withLaneCfg(lane, () => {
    const closeOut = (t: Trade) => recordClose(lane, t, events, trades, nextSeq);
    if (st.pos) for (const t of managePosition(st, [a.bar], null)) closeOut(t);
    if (st.pos && CFG.TRADER) { const sn = snapshot(a.S, a.i), r = traderManage(st, sn, a.S, { st: sn.st5, bos: sn.st5, c: a.bar.c }, a.bar.c, a.bar.ct); if (r.closed) closeOut(r.closed); }
    markEquity(st, a.bar.c);
    if (!st.pos && a.fill) {
      const snap = snapshot(a.S, a.i), enabledOnly = Object.fromEntries(STRATEGIES.map((s) => [s, s === id]));
      const { signals } = evaluate(snap, enabledOnly, a.S, st);
      for (const sig of signals) {
        lane.signalsSeen++;
        const g = entryGates(st, sig, a.bar.ct); if (!g.ok) continue;
        const equityBefore = st.equity, p = openPosition(st, sig, a.fill.px, a.fill.t); if (!p) continue;
        const did = `LD-${lane.id}-${a.bar.ct}`; lane.decisionIdOf[p.id] = did;
        events.push({ seq: nextSeq(), kind: "decision", laneId: lane.id, decisionId: did, snapshotBarClose: a.bar.ct, fillTime: a.fill.t, strategy: id, dir: sig.dir, score: sig.score, why: sig.why.slice(0, 8),
          plan: { entry: p.entry, stop0: p.stop0, tp1: p.tp1, tp2: p.tp2, tp3: p.tp3, originalQty: p.originalQty, riskAmt: p.riskAmt }, equityBefore, cfgSha256: lane.cfgSha256, specVersion: lane.spec.specVersion });
        break;
      }
    }
  });
  lane.lastBarT = a.bar.ct; return { events, trades };
}
/** Closes a lane's open position at the end of a replay (same as engine.backtest's final manual close). */
export function finishLane(lane: Lane, last: Bar, nextSeq: () => number = () => ++lane.seq): { events: LaneEvent[]; trades: Trade[] } {
  const events: LaneEvent[] = [], trades: Trade[] = [];
  withLaneCfg(lane, () => {
    if (lane.state.pos) for (const t of managePosition(lane.state, [last], null)) recordClose(lane, t, events, trades, nextSeq);
    if (lane.state.pos) { const t = closeNow(lane.state, last.c, last.ct); if (t) recordClose(lane, t, events, trades, nextSeq); }
    markEquity(lane.state, last.c);
  });
  return { events, trades };
}
