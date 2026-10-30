// Pure operational-state logic shared by the edge function (coverage.ts) and the dashboard (compiled to web/coverage_view.js).
// No engine imports: everything it needs is passed in, so the browser and the server cannot disagree about what "RUNNING" means.
export type Cadence = "5m" | "15m" | "1h" | "4h" | "1d";
export const CADENCE_MS: Record<Cadence, number> = { "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
export type CovLike = { since: number; bars: number; due: number; completed: number; windowClosed?: number; skippedData: number; failed: number; disabledBars: number; notDue: number; noSetup: number; setups: number; gateRejected: number; portfolioBlocked: number; notSelected: number; entered: number;
  lastEvalT: number | null; lastCompletedT: number | null; lastSetupT: number | null; lastCode: string | null; lastReason: string | null;
  lastDueT?: number | null; lastDueCode?: string | null; lastDueReason?: string | null;   // the most recent evaluation that was actually DUE (not an off-cadence bar)
  reasons: Record<string, number> };
export type OpState = "RUNNING" | "WAITING_FOR_BAR" | "DISABLED" | "DATA_BLOCKED" | "ERROR" | "NO_EVALUATION_YET";

/** Timeframe on whose close each strategy can fire. `cfg` supplies the two configurable triggers (EMA_CROSS XC_TF, HTF_SWEEP HSW_TF). */
export function cadenceFor(id: string, cfg: { XC_TF?: string; HSW_TF?: string } = {}): Cadence {
  switch (id) {
    case "TREND_MTF": case "EMA_PB": return "5m";
    case "SWEEP_REV": case "VWAP_REVERT": case "SESSION_BO": case "SSR": return "15m";
    case "EMA_CROSS": return cfg.XC_TF === "1h" ? "1h" : "15m";
    case "HTF_TREND": return "4h";
    case "HTF_SWEEP": return cfg.HSW_TF === "1h" ? "1h" : "4h";
    case "D_THRUST": return "1h";
    default: return "1d";   // D_BEARTRAP
  }
}
export type ViewArgs = { id: string; cfg?: { XC_TF?: string; HSW_TF?: string }; riskScale: number | undefined; optIn: boolean; enabledFlag: boolean | undefined; cov: CovLike | null | undefined; stat: { n: number; sumR: number } | undefined; probationMin: number; now: number };
/** Operational state is separate from sizing: "full size" never says a strategy is running. */
export function viewStrategy(a: ViewArgs) {
  const flag = a.enabledFlag === false, scale = a.riskScale;
  const offReason = flag ? "disabled by flag (auto-off after weak live results, or manual)" : scale === 0 ? "risk scale 0" : a.optIn && !(typeof scale === "number" && scale > 0) ? "opt-in strategy with no risk scale set" : null;
  const cad = cadenceFor(a.id, a.cfg), c = a.cov ?? null, cms = CADENCE_MS[cad];
  const dueCode = c?.lastDueCode ?? null, dueT = c?.lastDueT ?? null, fresh = dueT !== null && a.now - dueT <= 1.5 * cms + 600_000;
  let state: OpState;
  if (offReason) state = "DISABLED";
  else if (!c || c.lastEvalT === null) state = "NO_EVALUATION_YET";
  else if (dueCode === "ERROR") state = "ERROR";                                  // the last due evaluation failed
  else if (dueCode === "INSUFFICIENT_DATA") state = "DATA_BLOCKED";               // the last due evaluation could not read its inputs
  else if (dueT === null) state = "WAITING_FOR_BAR";                              // healthy, but its first due bar has not arrived since the counters began
  else if (!fresh) state = "DATA_BLOCKED";                                        // bars keep arriving but its due bar was not evaluated recently (missed or missing boundary)
  else state = "RUNNING";                                                         // completed a due evaluation within the last cadence window
  const nextDueT = c?.lastEvalT != null ? Math.ceil((c.lastEvalT + 2) / cms) * cms - 1 : null;
  const probation = !!(a.stat && a.stat.n >= a.probationMin && a.stat.sumR / a.stat.n < 0);
  const sizing = offReason ? 0 : (typeof scale === "number" ? scale : 1) * (probation ? 0.5 : 1);
  return { id: a.id, state, offReason, cadence: cad, cadenceMs: cms, nextDueT, sizing, riskScale: scale ?? null, probation, lastCompletedAgeMs: c?.lastCompletedT ? a.now - c.lastCompletedT : null, cov: c };
}

// ─── W3: strategy coverage matrix (one row per registered evaluator per book) ───────────────────────────────────────────
/** What each evaluator reads before it can fire, from engine.ts (the trigger timeframe is cadenceFor). */
export const REQUIRES: Record<string, string> = {
  D_BEARTRAP: "complete UTC daily bars (built from 4H), daily engulf + next-day sweep/reclaim",
  D_THRUST: "recent daily thrust + 1H EMA20 pullback (1H close)",
  HTF_TREND: "4H ATR, 4H Donchian high/low, 4H EMA50 (4H close)",
  TREND_MTF: "5m SuperTrend flip, 15m/1H alignment, 4H bias",
  SWEEP_REV: "15m 20-bar swing sweep + rejection wick, 4H bias",
  VWAP_REVERT: "15m session VWAP with ≥4 bars of the UTC day, RANGE regime",
  SESSION_BO: "Asian (or London) range, London/NY open window, 15m close",
  HTF_SWEEP: "4H (or 1H) high/low and ATR, failed break",
  EMA_CROSS: "15m (or 1H) EMA20/EMA50 cross, 4H bias",
  SSR: "Asian range, London 03–05 / NY 08–11 ET window, 4H EMA50",
  EMA_PB: "M15 EMA50/200 trend, 5m EMA20 pullback, 08:00–11:30 ET weekdays",
};
export type MatrixArgs = {
  strategies: string[]; optIn: string[]; cfg: { RISK_SCALE?: Record<string, number>; XC_TF?: string; HSW_TF?: string };
  st: { enabled?: Record<string, boolean>; cov?: Record<string, CovLike>; stats?: { by?: Record<string, { n: number; sumR: number; net?: number }> }; pos?: { strategy?: string } | null } | null;
  trades: { strategy: string; r: number | string; net: number | string; close_t?: string }[]; riskPct: number | null; now: number; probationMin?: number;
};
/**
 * Coverage matrix rows. Three kinds of evidence stay separate: A) signal frequency (setups the rules produced), B) standalone
 * hypothetical outcomes (not here: the scanner's setup tracker), C) portfolio-selected paper outcomes (closed trades of this book).
 * `vetoes` are gate rejections and portfolio blocks by reason; `starved` flags an ON strategy whose due bars are not being evaluated.
 */
export function strategyMatrix(a: MatrixArgs) {
  const st = a.st || {}, by = (st.stats && st.stats.by) || {};
  return a.strategies.map((id) => {
    const v = viewStrategy({ id, cfg: a.cfg, riskScale: a.cfg.RISK_SCALE?.[id], optIn: a.optIn.includes(id), enabledFlag: st.enabled?.[id], cov: st.cov?.[id] ?? null, stat: by[id], probationMin: a.probationMin ?? 10, now: a.now });
    const c = v.cov, reasons = Object.entries((c && c.reasons) || {});
    const pick = (code: string) => reasons.filter(([k]) => k.startsWith(code + ": ")).map(([k, n]) => ({ reason: k.slice(code.length + 2), n })).sort((x, y) => y.n - x.n);
    const mine = a.trades.filter((t) => t.strategy === id), rs = mine.map((t) => +t.r).filter(Number.isFinite);
    const riskPerTrade = a.riskPct != null && v.sizing > 0 ? +(a.riskPct * 100 * v.sizing).toFixed(3) : 0;
    return {
      id, registered: true, implemented: !!REQUIRES[id], enabledForEval: v.state !== "DISABLED", eligiblePaper: v.state !== "DISABLED" && v.sizing > 0,
      disabledReason: v.offReason, cadence: v.cadence, requires: REQUIRES[id] ?? "unknown", state: v.state,
      lastEvalT: c ? c.lastEvalT : null, lastDueT: c?.lastDueT ?? null, lastDueCode: c?.lastDueCode ?? null, lastDueReason: c?.lastDueReason ?? null,
      bars: c ? c.bars : 0, due: c ? c.due : 0, completed: c ? c.completed : 0, windowClosed: c?.windowClosed ?? 0, missingData: c ? c.skippedData : 0, errors: c ? c.failed : 0,
      noSetup: c ? c.noSetup : 0, signals: c ? c.setups : 0, gateRejected: c ? c.gateRejected : 0, vetoes: [...pick("GATE_REJECTED"), ...pick("PORTFOLIO_BLOCKED")],
      portfolioBlocked: c ? c.portfolioBlocked : 0, notSelected: c ? c.notSelected : 0, entered: c ? c.entered : 0,
      closed: rs.length, wins: rs.filter((r) => r > 0).length, sumR: +rs.reduce((x, y) => x + y, 0).toFixed(3), net: +mine.reduce((x, t) => x + (+t.net || 0), 0).toFixed(2),
      openNow: !!(st.pos && st.pos.strategy === id), riskScale: v.riskScale, probation: v.probation, riskPerTradePct: riskPerTrade,
      starved: v.state === "DATA_BLOCKED" || (v.state !== "DISABLED" && !!c && c.bars > 0 && c.due === 0 && c.bars * 300_000 > 1.5 * v.cadenceMs),
    };
  });
}
