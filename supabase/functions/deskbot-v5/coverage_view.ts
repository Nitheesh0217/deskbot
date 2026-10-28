// Pure operational-state logic shared by the edge function (coverage.ts) and the dashboard (compiled to web/coverage_view.js).
// No engine imports: everything it needs is passed in, so the browser and the server cannot disagree about what "RUNNING" means.
export type Cadence = "5m" | "15m" | "1h" | "4h" | "1d";
export const CADENCE_MS: Record<Cadence, number> = { "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
export type CovLike = { since: number; bars: number; due: number; completed: number; skippedData: number; failed: number; disabledBars: number; notDue: number; noSetup: number; setups: number; gateRejected: number; portfolioBlocked: number; notSelected: number; entered: number;
  lastEvalT: number | null; lastCompletedT: number | null; lastSetupT: number | null; lastCode: string | null; lastReason: string | null; reasons: Record<string, number> };
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
  const cad = cadenceFor(a.id, a.cfg), c = a.cov ?? null;
  let state: OpState;
  if (offReason) state = "DISABLED";
  else if (!c || c.lastEvalT === null) state = "NO_EVALUATION_YET";
  else if (c.lastCode === "ERROR") state = "ERROR";
  else if (c.lastCode === "INSUFFICIENT_DATA") state = "DATA_BLOCKED";
  else if (c.lastCode === "NOT_DUE") state = "WAITING_FOR_BAR";
  else state = "RUNNING";
  const probation = !!(a.stat && a.stat.n >= a.probationMin && a.stat.sumR / a.stat.n < 0);
  const sizing = offReason ? 0 : (typeof scale === "number" ? scale : 1) * (probation ? 0.5 : 1);
  return { id: a.id, state, offReason, cadence: cad, cadenceMs: CADENCE_MS[cad], sizing, riskScale: scale ?? null, probation, lastCompletedAgeMs: c?.lastCompletedT ? a.now - c.lastCompletedT : null, cov: c };
}
