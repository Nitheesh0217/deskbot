// W3: the per-book coverage matrix keeps signal frequency (A) and selected paper outcomes (C) separate, names disabled reasons,
// derives risk per trade from the runner's reported risk × scale, and flags an ON evaluator whose due bars are not evaluated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { strategyMatrix, REQUIRES } from "../supabase/functions/deskbot-v5/coverage_view.ts";
import { STRATEGIES, OPT_IN } from "../supabase/functions/deskbot-v5/engine.ts";

const now = Date.UTC(2026, 9, 30, 0, 30), since = now - 7 * 3600e3, T = (m: number) => now - m * 60e3 - 1;
const cov = (o: Record<string, unknown> = {}) => ({ since, bars: 80, due: 27, completed: 27, windowClosed: 0, skippedData: 0, failed: 0, disabledBars: 0, notDue: 53, noSetup: 26, setups: 1, gateRejected: 1, portfolioBlocked: 0, notSelected: 0, entered: 0, lastEvalT: T(5), lastCompletedT: T(30), lastSetupT: T(200), lastCode: "NOT_DUE", lastReason: "Waits for 15m close", lastDueT: T(30), lastDueCode: "NO_SETUP", lastDueReason: "No sweep + rejection on 15m", reasons: { "GATE_REJECTED: Score # < #": 1, "NO_SETUP: No sweep + rejection on 15m": 26 }, ...o });
const scale = { D_BEARTRAP: 1, D_THRUST: 1, HTF_TREND: 1, TREND_MTF: 1, SWEEP_REV: 1, VWAP_REVERT: 1, SESSION_BO: 1, HTF_SWEEP: 0, EMA_CROSS: 0.25, SSR: 0, EMA_PB: 0 };

test("one row per registered evaluator; requirements known for each", () => {
  const m = strategyMatrix({ strategies: STRATEGIES, optIn: OPT_IN, cfg: { RISK_SCALE: scale }, st: { cov: {}, enabled: {} }, trades: [], riskPct: 0.02, now });
  assert.deepEqual(m.map((r) => r.id), STRATEGIES); for (const r of m) { assert.ok(REQUIRES[r.id], r.id); assert.equal(r.implemented, true); }
});

test("columns: disabled reason, eligibility, signals vs vetoes vs outcomes, risk per trade from the reported risk × scale", () => {
  const m = Object.fromEntries(strategyMatrix({ strategies: STRATEGIES, optIn: OPT_IN, cfg: { RISK_SCALE: scale }, st: { cov: { SWEEP_REV: cov(), EMA_CROSS: cov({ lastDueCode: "NO_SETUP", setups: 0, gateRejected: 0, reasons: {} }) }, enabled: {}, pos: { strategy: "SWEEP_REV" } },
    trades: [{ strategy: "SWEEP_REV", r: 1.3, net: 4.4 }, { strategy: "SWEEP_REV", r: -1, net: -3 }, { strategy: "EMA_CROSS", r: -0.9, net: -1 }], riskPct: 0.02, now }).map((r) => [r.id, r]));
  assert.equal(m.HTF_SWEEP.enabledForEval, false); assert.match(String(m.HTF_SWEEP.disabledReason), /risk scale 0|opt-in/);
  assert.equal(m.SWEEP_REV.signals, 1); assert.deepEqual(m.SWEEP_REV.vetoes, [{ reason: "Score # < #", n: 1 }]); assert.equal(m.SWEEP_REV.noSetup, 26);
  assert.deepEqual([m.SWEEP_REV.closed, m.SWEEP_REV.wins, m.SWEEP_REV.sumR, m.SWEEP_REV.net], [2, 1, 0.3, 1.4]); assert.equal(m.SWEEP_REV.openNow, true);
  assert.equal(m.SWEEP_REV.riskPerTradePct, 2); assert.equal(m.EMA_CROSS.riskPerTradePct, 0.5, "0.25 scale of 2% is 0.5%, never 'full size'");
  assert.equal(m.EMA_CROSS.eligiblePaper, true); assert.equal(m.HTF_SWEEP.riskPerTradePct, 0);
  const noRisk = strategyMatrix({ strategies: ["SWEEP_REV"], optIn: OPT_IN, cfg: { RISK_SCALE: scale }, st: { cov: { SWEEP_REV: cov() } }, trades: [], riskPct: null, now })[0]; assert.equal(noRisk.riskPerTradePct, 0, "unknown risk is not invented");
});

test("starvation: an ON evaluator with many bars but no due evaluation is flagged; one waiting for its first daily close is not", () => {
  const starved = strategyMatrix({ strategies: ["SWEEP_REV"], optIn: OPT_IN, cfg: { RISK_SCALE: scale }, st: { cov: { SWEEP_REV: cov({ due: 0, completed: 0, lastDueT: null, lastDueCode: null }) } }, trades: [], riskPct: 0.02, now })[0];
  assert.equal(starved.starved, true);
  const daily = strategyMatrix({ strategies: ["D_BEARTRAP"], optIn: OPT_IN, cfg: { RISK_SCALE: scale }, st: { cov: { D_BEARTRAP: cov({ bars: 80, due: 0, lastDueT: null, lastDueCode: null }) } }, trades: [], riskPct: 0.02, now })[0];
  assert.equal(daily.starved, false, "80 bars (6.7 h) is less than 1.5 days");
});
