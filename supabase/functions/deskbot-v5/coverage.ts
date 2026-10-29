// Strategy coverage: for every strategy and every 5-minute evaluation, WHY there was or was not a trade. Observability only:
// nothing here is read by entry, sizing, exit or risk logic. Zero closed trades is never evidence that a strategy was not evaluated;
// these counters are what shows whether it was due, evaluated, blocked, displaced or entered.
import { CFG, STRATEGIES, OPT_IN, entryGates, type StrategyId, type StrategyTrace, type Signal, type State } from "./engine.ts";

export type Code = "NOT_DUE" | "DISABLED" | "INSUFFICIENT_DATA" | "NO_SETUP" | "GATE_REJECTED" | "PORTFOLIO_BLOCKED" | "NOT_SELECTED" | "ERROR" | "ENTERED";
import { type Cadence, CADENCE_MS, cadenceFor, viewStrategy, type OpState } from "./coverage_view.ts";
export { type Cadence, CADENCE_MS, type OpState };
/** Timeframe on whose CLOSE each strategy can fire (the strategy still sees every 5m bar; off-cadence bars are NOT_DUE). */
export const cadenceOf = (id: StrategyId): Cadence => cadenceFor(id, CFG);

/** Reason text -> code. Order matters. A test extracts every reason literal from engine.ts and fails if one is unclassified. */
const RULES: [RegExp, Code][] = [
  [/^Strategy switched off/, "DISABLED"],
  [/^Strategy error/, "ERROR"],
  [/^Waits for /, "NOT_DUE"],
  [/^Outside .*(window|ET weekdays)/, "NOT_DUE"],
  [/warming up|^No Asian range yet|not available yet|not defined yet|^Zero-range|no data to read/, "INSUFFICIENT_DATA"],
  [/^(Daily regime gate|AI filter|Validator)/, "GATE_REJECTED"],
  [/^(Against 4H bias|Sweep against 4H|Breakout against 4H|Cross against 4H|4H bias neutral)/, "GATE_REJECTED"],
  [/^(Asian session block|Range regime|Regime .* \(needs RANGE\)|Chop |15m\/1h not aligned|EMA20\/50 against)/, "GATE_REJECTED"],
  [/stop (out of bounds|too wide|inside noise|above price)|^Stop inside noise|^Stop too wide|^Swing stop|^Bar > 2×ATR|^Breakout volume|already (taken|fired)/, "GATE_REJECTED"],
  [/^Re-entry|^Score |^Signal already acted on/, "GATE_REJECTED"],
  [/^No |^Swept, no reclaim|^VWAP dev .* no extreme|no extreme/, "NO_SETUP"],
];
export function classifyReject(reason: string): Code | "UNCLASSIFIED" {
  for (const [re, c] of RULES) if (re.test(reason)) return c;
  return "UNCLASSIFIED";
}
/** Entry-level (portfolio) gate reasons from entryGates(): which are portfolio state and which are strategy-level filters. */
export function classifyGate(reason: string): Code {
  return /^(Position already open|Circuit-breaker|Daily trade cap|Daily marked loss|Entries paused|Paper entries paused)/.test(reason) ? "PORTFOLIO_BLOCKED" : "GATE_REJECTED";
}

export type Cov = {
  since: number; bars: number; due: number; completed: number; skippedData: number; failed: number; disabledBars: number; notDue: number;
  noSetup: number; setups: number; gateRejected: number; portfolioBlocked: number; notSelected: number; entered: number;
  lastEvalT: number | null; lastCompletedT: number | null; lastSetupT: number | null; lastCode: Code | null; lastReason: string | null;
  reasons: Record<string, number>;   // normalised reason text -> count, for GATE_REJECTED / PORTFOLIO_BLOCKED / NO_SETUP / INSUFFICIENT_DATA / ERROR
};
export type CovMeta = { since: number; evalBars: number; missedBars: number; missedDue: Record<"15m" | "1h" | "4h" | "1d", number>; missingDue: Record<"15m" | "1h" | "4h" | "1d", number>; lastEvalT: number | null; lastLagMs: number | null };
export const emptyCov = (now: number): Cov => ({ since: now, bars: 0, due: 0, completed: 0, skippedData: 0, failed: 0, disabledBars: 0, notDue: 0, noSetup: 0, setups: 0, gateRejected: 0, portfolioBlocked: 0, notSelected: 0, entered: 0, lastEvalT: null, lastCompletedT: null, lastSetupT: null, lastCode: null, lastReason: null, reasons: {} });
export const emptyMeta = (now: number): CovMeta => ({ since: now, evalBars: 0, missedBars: 0, missedDue: { "15m": 0, "1h": 0, "4h": 0, "1d": 0 }, missingDue: { "15m": 0, "1h": 0, "4h": 0, "1d": 0 }, lastEvalT: null, lastLagMs: null });

// prices, decimals and percentages vary bar to bar; timeframes and indicator lengths (1H, 15m, EMA20) must stay readable
const normalise = (r: string) => r.replace(/\$[\d.,]+|[-+]?\d+\.\d+%?|\b\d{3,}\b/g, "#").slice(0, 96);
const bump = (cov: Cov, code: Code, reason: string) => {
  const k = `${code}: ${normalise(reason)}`; cov.reasons[k] = (cov.reasons[k] ?? 0) + 1;
  const keys = Object.keys(cov.reasons); if (keys.length > 14) { const lo = keys.sort((a, b) => cov.reasons[a] - cov.reasons[b])[0]; if (lo !== k) delete cov.reasons[lo]; }
};

export type Disposition = { id: StrategyId; code: Code; reason: string };
/**
 * What the portfolio did with each VALID setup (signals are already sorted by score, as pickEntry sees them).
 * `gateState` must be the account state BEFORE the entry was taken (a copy). `globalBlock` = news / approval pause that stops all entries.
 */
export function dispositions(signals: Signal[], a: { hadPos: boolean; opened: { strategy: StrategyId; dir: string } | null; globalBlock: string | null; gateState: State; now: number }): Disposition[] {
  const out: Disposition[] = []; let taken = false;
  const gs = JSON.parse(JSON.stringify(a.gateState)) as State;
  for (const sig of signals) {
    const id = sig.strategy;
    if (a.hadPos) { out.push({ id, code: "PORTFOLIO_BLOCKED", reason: "Position already open (portfolio holds one position at a time)" }); continue; }
    if (a.globalBlock) { out.push({ id, code: "PORTFOLIO_BLOCKED", reason: a.globalBlock }); continue; }
    if (taken) { out.push({ id, code: "NOT_SELECTED", reason: `Lower score than the entered setup (${a.opened!.strategy})` }); continue; }
    const g = entryGates(gs, sig, a.now);
    if (!g.ok) { out.push({ id, code: classifyGate(g.reason), reason: g.reason }); continue; }
    if (a.opened && a.opened.strategy === id && a.opened.dir === sig.dir) { out.push({ id, code: "ENTERED", reason: "Entered" }); taken = true; continue; }
    out.push({ id, code: "GATE_REJECTED", reason: "Entry could not be opened (price already through stop or cost filter)" });
  }
  return out;
}

/** Folds one evaluation into the book's counters. `T` = closed-bar time evaluated, `now` = wall clock. */
export type Boundary = Record<"15m" | "1h" | "4h" | "1d", boolean>;
/** Which timeframe boundaries closed at this 5m bar (`due`) and which of those bars actually exist in the data (`have`). */
export const boundaryFlags = (T: number, have: Boundary) => ({ due: { "15m": (T + 1) % CADENCE_MS["15m"] === 0, "1h": (T + 1) % CADENCE_MS["1h"] === 0, "4h": (T + 1) % CADENCE_MS["4h"] === 0, "1d": (T + 1) % CADENCE_MS["1d"] === 0 } as Boundary, have });
export function recordCoverage(st: State, a: { T: number; now: number; trace: StrategyTrace[]; disp: Disposition[]; boundary?: { due: Boundary; have: Boundary } }): { id: StrategyId; code: Code; reason: string; valid: boolean }[] {
  const cov = (st.cov ??= {}), meta = (st.covMeta ??= emptyMeta(a.now));
  // missed boundary bars: the live loop evaluates only the newest closed 5m bar; anything between the previous and this bar was never evaluated
  if (meta.lastEvalT !== null && a.T > meta.lastEvalT) {
    const gap = Math.round((a.T - meta.lastEvalT) / 300_000) - 1;
    for (let j = 1; j <= gap; j++) {
      const T = meta.lastEvalT + 300_000 * j; meta.missedBars++;
      if ((T + 1) % CADENCE_MS["15m"] === 0) meta.missedDue["15m"]++; if ((T + 1) % CADENCE_MS["1h"] === 0) meta.missedDue["1h"]++;
      if ((T + 1) % CADENCE_MS["4h"] === 0) meta.missedDue["4h"]++; if ((T + 1) % CADENCE_MS["1d"] === 0) meta.missedDue["1d"]++;
    }
  }
  const missing = new Set<string>();
  if (a.boundary) for (const k of ["15m", "1h", "4h", "1d"] as const) if (a.boundary.due[k] && !a.boundary.have[k]) { missing.add(k); meta.missingDue[k]++; }   // boundary reached but the bar is absent from the feed
  meta.evalBars++; meta.lastEvalT = a.T; meta.lastLagMs = a.now - a.T;
  const dmap = new Map(a.disp.map((d) => [d.id, d])), now1: { id: StrategyId; code: Code; reason: string; valid: boolean }[] = [];
  for (const t of a.trace) {
    const c = (cov[t.id] ??= emptyCov(a.now)); c.bars++; c.lastEvalT = a.T;
    let code: Code, reason = t.reason, valid = false;
    if (t.kind === "OFF") code = "DISABLED";
    else if (t.kind === "WARMUP") code = "INSUFFICIENT_DATA";
    else if (t.kind === "ERROR") code = "ERROR";
    else if (t.kind === "ADMITTED") { valid = true; const d = dmap.get(t.id); code = d ? d.code : "GATE_REJECTED"; reason = d ? d.reason : "No portfolio disposition recorded"; }
    else {
      const k = classifyReject(t.reason); code = k === "UNCLASSIFIED" ? "NO_SETUP" : k;
      if (code === "NOT_DUE" && /^Waits for /.test(t.reason) && missing.has(cadenceOf(t.id))) { code = "INSUFFICIENT_DATA"; reason = `Due ${cadenceOf(t.id)} bar is missing from the data feed`; }
    }
    // bookkeeping
    if (code === "NOT_DUE") c.notDue++;
    else if (code === "DISABLED") c.disabledBars++;
    else {
      c.due++;
      if (code === "INSUFFICIENT_DATA") c.skippedData++; else if (code === "ERROR") c.failed++; else { c.completed++; c.lastCompletedT = a.T; }
    }
    if (valid) { c.setups++; c.lastSetupT = a.T; }
    if (code === "NO_SETUP") c.noSetup++; else if (code === "GATE_REJECTED") c.gateRejected++; else if (code === "PORTFOLIO_BLOCKED") c.portfolioBlocked++; else if (code === "NOT_SELECTED") c.notSelected++; else if (code === "ENTERED") c.entered++;
    c.lastCode = code; c.lastReason = reason.slice(0, 200); now1.push({ id: t.id, code, reason: reason.slice(0, 160), valid });
    if (code !== "NOT_DUE" && code !== "ENTERED" && code !== "DISABLED") bump(c, code, reason);
  }
  return now1;
}

/** Operational state of one strategy in one book (separate from sizing). */
export function operationalState(id: StrategyId, st: State, now: number) {
  return viewStrategy({ id, cfg: CFG, riskScale: CFG.RISK_SCALE[id], optIn: OPT_IN.includes(id), enabledFlag: st.enabled?.[id], cov: st.cov?.[id] ?? null, stat: st.stats?.by?.[id], probationMin: CFG.PROBATION_MIN_TRADES, now });
}
export const allStates = (st: State, now: number) => STRATEGIES.map((id) => operationalState(id, st, now));
