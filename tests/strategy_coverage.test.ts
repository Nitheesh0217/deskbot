import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import {
  applyCfg, CFG, buildSeries, snapshot, evaluate, initState, ensureState, vwapDaySeries, setMlAsset, STRATEGIES, OPT_IN, type Bar, type Signal, type State, type StrategyId, type StrategyTrace,
} from "../supabase/functions/deskbot-v5/engine.ts";
import { classifyReject, classifyGate, dispositions, recordCoverage, operationalState, emptyCov, cadenceOf, CADENCE_MS, type Code } from "../supabase/functions/deskbot-v5/coverage.ts";

const PERMISSIVE = { RISK_SCALE: Object.fromEntries(STRATEGIES.map((s) => [s, 1])), REGIME_GATE: {}, MIN_SCORE: 0 } as never;
test.afterEach(() => { applyCfg(); setMlAsset(false); });
const dec = (a: number[][]): Bar[] => a.map(([t, o, h, l, c, v], i, arr) => ({ t, o, h, l, c, v, ct: t + 1 }) as Bar);
function load(id: string) {
  const fx = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/strategy_${id}_BTC.json.gz`, import.meta.url))).toString());
  const tfms = { m5: 300_000, m15: 900_000, h1: 3_600_000, h4: 14_400_000 } as const;
  const frames = Object.fromEntries(Object.entries(fx.frames as Record<string, number[][]>).map(([k, a]) => [k, a.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v, ct: t + tfms[k as keyof typeof tfms] - 1 }))])) as { m5: Bar[]; m15: Bar[]; h1: Bar[]; h4: Bar[] };
  return { fx, frames };
}
function evalAt(frames: { m5: Bar[]; m15: Bar[]; h1: Bar[]; h4: Bar[] }, st = ensureState(initState(350, 0))) {
  const S = buildSeries(frames), trace: StrategyTrace[] = [];
  const out = evaluate(snapshot(S, frames.m5.length - 1, { funding: null, oi: null, markPx: null, fng: null }), st.enabled, S, st, trace);
  return { out, trace };
}
const FIX = STRATEGIES.filter((id) => id !== "VWAP_REVERT");

for (const id of FIX) test(`${id}: a real-data fixture with live-sized windows reaches a valid setup; the previous bar and a zero risk scale do not`, () => {
  const { fx, frames } = load(id);
  assert.deepEqual([frames.m5.length, frames.m15.length, frames.h1.length, frames.h4.length], [400, 400, 300, 700], "exactly the windows the live function fetches");
  applyCfg(PERMISSIVE); const hit = evalAt(frames);
  const t = hit.trace.find((x) => x.id === id)!; assert.equal(t.kind, "ADMITTED", `${id} should fire at ${fx.at}: ${t.reason}`);
  assert.ok(hit.out.signals.some((s) => s.strategy === id));
  // one 5m bar earlier: not due or no setup, never a setup
  const prev = { ...frames, m5: frames.m5.slice(0, -1), m15: frames.m15.filter((b) => b.ct <= frames.m5.at(-2)!.ct), h1: frames.h1.filter((b) => b.ct <= frames.m5.at(-2)!.ct), h4: frames.h4.filter((b) => b.ct <= frames.m5.at(-2)!.ct) };
  const before = evalAt(prev).trace.find((x) => x.id === id)!;
  assert.notEqual(before.kind, "ADMITTED"); const code = classifyReject(before.reason); assert.notEqual(code, "UNCLASSIFIED", before.reason);
  // switched off by scale: DISABLED, not silent
  applyCfg({ ...(PERMISSIVE as object), RISK_SCALE: { ...Object.fromEntries(STRATEGIES.map((s) => [s, 1])), [id]: 0 } } as never);
  assert.equal(evalAt(frames).trace.find((x) => x.id === id)!.kind, "OFF");
});

test("VWAP_REVERT: reachable by construction (stub snapshot); the same rule is near-unreachable on 3 years of real data", () => {
  applyCfg(PERMISSIVE);
  const b15 = { t: 0, o: 102.2, h: 102.5, l: 101.6, c: 101.9, v: 10, ct: 1 };
  const snap = { T: 1, price: 101.9, atr5: 0.2, atr15: 0.4, chop15: 66, chop5: 60, regime: "RANGE", new15: true, b15, vwapSd: 0.5, vwapDev: 2.4, rsi15: 72, rsi1h: 55, st4h: 0, funding: null, fng: null, poc: NaN, roc5: 0 } as never;
  const trace: StrategyTrace[] = []; const r = evaluate(snap, {}, undefined, undefined, trace);
  assert.ok(r.signals.some((s) => s.strategy === "VWAP_REVERT" && s.dir === "short"));
  assert.equal(trace.find((x) => x.id === "VWAP_REVERT")!.kind, "ADMITTED");
  const calm = evaluate({ ...(snap as object), vwapDev: 0.4, rsi15: 52 } as never, {}, undefined, undefined, []).rejects.find((x) => x.strategy === "VWAP_REVERT")!;
  assert.match(calm.reason, /no extreme/); assert.equal(classifyReject(calm.reason), "NO_SETUP");
});

test("silent returns now say why (zero-range bar, VWAP sigma undefined, session range missing)", () => {
  applyCfg(PERMISSIVE);
  const base = { T: 1, price: 100, atr5: 0.2, atr15: 0.4, chop15: 66, chop5: 60, regime: "RANGE", new15: true, vwapSd: 0.5, vwapDev: 0, rsi15: 50, rsi1h: 50, st4h: 0, hour: 8, minute: 0, funding: null, fng: null, poc: NaN, roc5: 0, asian: null, london: null, hi20_15: 101, lo20_15: 99 };
  const flatBar = { t: 0, o: 100, h: 100, l: 100, c: 100, v: 1, ct: 1 };
  const why = (over: object, id: StrategyId) => evaluate({ ...base, b15: flatBar, ...over } as never, {}, undefined, undefined, []).rejects.filter((r) => r.strategy === id).map((r) => r.reason);
  assert.ok(why({}, "SWEEP_REV").some((r) => /Zero-range/.test(r)));
  assert.ok(why({ vwapSd: NaN }, "VWAP_REVERT").some((r) => /not defined yet/.test(r)));
  assert.ok(why({ regime: "TREND" }, "SESSION_BO").some((r) => /Asian range not available yet/.test(r)));
  for (const r of [...why({}, "SWEEP_REV"), ...why({ vwapSd: NaN }, "VWAP_REVERT"), ...why({ regime: "TREND" }, "SESSION_BO")]) assert.equal(classifyReject(r), "INSUFFICIENT_DATA", r);
});

test("every reason literal in engine.ts has a code (a new unclassified reason fails this test)", () => {
  const src = readFileSync(new URL("../supabase/functions/deskbot-v5/engine.ts", import.meta.url), "utf8");
  const reasons = [...src.matchAll(/reason:\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g)].map((m) => (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, "0"));
  assert.ok(reasons.length > 50, `found ${reasons.length} reason literals`);
  const bad = reasons.filter((r) => classifyReject(r) === "UNCLASSIFIED" && !/^(Score|Re-entry|Position already|Circuit|Daily (trade|marked)|Signal already|Setup passed every gate)/.test(r));
  assert.deepEqual(bad, [], "unclassified reasons");
  for (const g of ["Position already open", "Circuit-breaker cooldown until 10:00 UTC", "Daily trade cap reached", "Daily marked loss limit hit"]) assert.equal(classifyGate(g), "PORTFOLIO_BLOCKED");
  for (const g of ["Score 60 < 72", "Signal already acted on", "Re-entry needs score ≥ 78 (got 70)"]) assert.equal(classifyGate(g), "GATE_REJECTED");
});

test("tracing never changes what evaluate() returns", () => {
  const { frames } = load("SWEEP_REV"); applyCfg(PERMISSIVE);
  const S = buildSeries(frames), snap = snapshot(S, frames.m5.length - 1, { funding: null, oi: null, markPx: null, fng: null }), st = ensureState(initState(350, 0));
  const a = evaluate(snap, st.enabled, S, st), b = evaluate(snap, st.enabled, S, st, []);
  assert.deepEqual(a, b);
});

test("one failing strategy cannot blind the others: it is isolated and reported as ERROR", () => {
  applyCfg(PERMISSIVE);
  const snap = { T: 1, price: 100, atr5: 0.2, atr15: 0.4, chop15: 50, chop5: 50, regime: "MIXED", new15: false, new1h: false, new4h: false, i1d: 5, st5: 1, st5prev: 1, funding: null, fng: null, poc: NaN, roc5: 0, hour: 10, minute: 0, ema20: 1, ema50: 1 };
  const trace: StrategyTrace[] = []; const r = evaluate(snap as never, {}, {} as never, undefined, trace);   // empty series: every series-dependent runner throws
  assert.equal(trace.length, STRATEGIES.length, "every strategy is accounted for");
  const errs = trace.filter((t) => t.kind === "ERROR"); assert.ok(errs.length >= 1, "at least one runner threw");
  for (const e of errs) { assert.equal(classifyReject(e.reason), "ERROR"); assert.ok(r.rejects.some((x) => x.strategy === e.id && /Strategy error/.test(x.reason))); }
  assert.ok(trace.some((t) => t.kind === "REJECT"), "the strategies that do not need the series still ran");
});

test("VWAP sigma is undefined until 4 bars of the UTC day (the old 2-bar sigma produced deviations of thousands of sigma)", () => {
  const day = Date.UTC(2026, 5, 1), mk = (i: number, c: number, v = 1): Bar => ({ t: day + i * 900_000, o: c, h: c + 0.1, l: c - 0.1, c, v, ct: day + (i + 1) * 900_000 - 1 });
  const bars = [mk(0, 100, 5), mk(1, 100.8, 1), mk(2, 100.4, 1), mk(3, 100.2, 1), mk(4, 100.3, 1)];
  const { vwap, sd } = vwapDaySeries(bars);
  assert.ok([0, 1, 2].every((i) => Number.isNaN(sd[i])), "first three bars: sigma undefined"); assert.ok(Number.isFinite(sd[3]) && sd[3] > 0 && Number.isFinite(sd[4]));
  assert.ok(Math.abs((bars[4].c - vwap[4]) / sd[4]) < 10, "deviation sane once sigma exists");
  const next = vwapDaySeries([...bars, { ...mk(0, 90, 1), t: day + 86_400_000, ct: day + 86_400_000 + 899_999 }]); assert.ok(Number.isNaN(next.sd[5]), "resets at 00:00 UTC");
});

// ── coverage bookkeeping ──────────────────────────────────────────────────────────────────
const sig = (strategy: StrategyId, score: number, dir: "long" | "short" = "long"): Signal => ({ strategy, dir, entryRef: 100, stop: dir === "long" ? 99 : 101, score, why: [], regime: "TREND", barT: 1000 });
const newState = () => ensureState(initState(350, 0));

test("portfolio dispositions separate ENTERED, NOT_SELECTED, PORTFOLIO_BLOCKED and GATE_REJECTED", () => {
  applyCfg();
  const st = newState(), a = sig("HTF_TREND", 90), b = sig("SWEEP_REV", 80), c = sig("TREND_MTF", 60);
  const d1 = dispositions([a, b, c], { hadPos: false, opened: { strategy: "HTF_TREND", dir: "long" }, globalBlock: null, gateState: st, now: 5000 });
  assert.deepEqual(d1.map((x) => [x.id, x.code]), [["HTF_TREND", "ENTERED"], ["SWEEP_REV", "NOT_SELECTED"], ["TREND_MTF", "NOT_SELECTED"]]);
  const d2 = dispositions([a, c], { hadPos: true, opened: null, globalBlock: null, gateState: st, now: 5000 }); assert.ok(d2.every((x) => x.code === "PORTFOLIO_BLOCKED" && /Position already open/.test(x.reason)));
  const d3 = dispositions([a], { hadPos: false, opened: null, globalBlock: "Entries paused: news HIGH", gateState: st, now: 5000 }); assert.equal(d3[0].code, "PORTFOLIO_BLOCKED");
  const cool = newState(); cool.cb.cooldownUntil = 9_000_000; const d4 = dispositions([a], { hadPos: false, opened: null, globalBlock: null, gateState: cool, now: 5000 });
  assert.equal(d4[0].code, "PORTFOLIO_BLOCKED"); assert.match(d4[0].reason, /Circuit-breaker/);
  const d5 = dispositions([c], { hadPos: false, opened: null, globalBlock: null, gateState: st, now: 5000 }); assert.equal(d5[0].code, "GATE_REJECTED"); assert.match(d5[0].reason, /^Score 60/);   // below MIN_SCORE 72
  const seen = newState(); seen.lastSig.HTF_TREND = 1000; assert.equal(dispositions([a], { hadPos: false, opened: null, globalBlock: null, gateState: seen, now: 5000 })[0].reason, "Signal already acted on");
  // first signal passes gates but cannot open (price through stop): it is GATE_REJECTED and the next one is entered
  const d6 = dispositions([a, b], { hadPos: false, opened: { strategy: "SWEEP_REV", dir: "long" }, globalBlock: null, gateState: st, now: 5000 });
  assert.deepEqual(d6.map((x) => x.code), ["GATE_REJECTED", "ENTERED"]);
});

test("counters: due vs not-due vs skipped vs failed vs setups, and zero trades never means unevaluated", () => {
  applyCfg(); const st = newState(), T0 = 1_000_000 - 1;
  const tr = (kind: StrategyTrace["kind"], reason: string, id: StrategyId = "D_THRUST"): StrategyTrace[] => [{ id, kind, reason }];
  recordCoverage(st, { T: T0, now: T0 + 60_000, trace: tr("REJECT", "Waits for 1H close"), disp: [] });
  recordCoverage(st, { T: T0 + 300_000, now: T0 + 360_000, trace: tr("REJECT", "No 1H EMA20 pullback"), disp: [] });
  recordCoverage(st, { T: T0 + 600_000, now: T0 + 660_000, trace: tr("WARMUP", "Indicators warming up"), disp: [] });
  recordCoverage(st, { T: T0 + 900_000, now: T0 + 960_000, trace: tr("ERROR", "Strategy error: boom"), disp: [] });
  recordCoverage(st, { T: T0 + 1_200_000, now: T0 + 1_260_000, trace: tr("ADMITTED", "ok"), disp: [{ id: "D_THRUST", code: "NOT_SELECTED", reason: "Lower score than the entered setup (HTF_TREND)" }] });
  const c = st.cov!.D_THRUST;
  assert.deepEqual([c.bars, c.notDue, c.due, c.completed, c.skippedData, c.failed, c.noSetup, c.setups, c.notSelected], [5, 1, 4, 2, 1, 1, 1, 1, 1]);
  assert.equal(st.stats.by.D_THRUST.n, 0, "no closed trades");
  assert.equal(operationalState("D_THRUST", st, T0 + 1_300_000).state, "RUNNING", "evaluated 5 times, 0 trades: RUNNING, not unevaluated");
  assert.ok(Object.keys(c.reasons).some((k) => k.startsWith("NO_SETUP: No 1H EMA20")));
  // missed boundary bars are counted by cadence
  const m = st.covMeta!; recordCoverage(st, { T: m.lastEvalT! + 300_000 * 4, now: 0, trace: [], disp: [] }); assert.equal(m.missedBars, 3);
  recordCoverage(st, { T: 3_600_000 * 5 - 1 + 300_000 * 4 - 300_000 * 4 + 300_000 * 0, now: 0, trace: [], disp: [] });
});

test("operational states are separate from sizing and name the cause", () => {
  applyCfg({ RISK_SCALE: { D_THRUST: 1, EMA_CROSS: 0.25, SWEEP_REV: 1 } } as never);
  const st = newState(); const T = 1_000_000 - 1;
  assert.equal(operationalState("D_THRUST", st, T).state, "NO_EVALUATION_YET");
  assert.match(operationalState("SSR", st, T).offReason!, /opt-in strategy with no risk scale/);
  st.enabled.SWEEP_REV = false; assert.match(operationalState("SWEEP_REV", st, T).offReason!, /disabled by flag/);
  assert.equal(operationalState("EMA_CROSS", st, T).sizing, 0.25);
  const put = (id: StrategyId, kind: StrategyTrace["kind"], reason: string) => recordCoverage(st, { T, now: T + 1, trace: [{ id, kind, reason }], disp: [] });
  put("D_THRUST", "REJECT", "Waits for 1H close"); assert.equal(operationalState("D_THRUST", st, T).state, "WAITING_FOR_BAR");
  put("D_THRUST", "WARMUP", "x warming up"); assert.equal(operationalState("D_THRUST", st, T).state, "DATA_BLOCKED");
  put("D_THRUST", "ERROR", "Strategy error: x"); assert.equal(operationalState("D_THRUST", st, T).state, "ERROR");
  put("D_THRUST", "REJECT", "No recent daily thrust"); assert.equal(operationalState("D_THRUST", st, T).state, "RUNNING");
  put("D_THRUST", "REJECT", "Waits for 1H close"); assert.equal(operationalState("D_THRUST", st, T).state, "RUNNING", "an off-cadence bar after a healthy due evaluation does not flip the state");
  assert.equal(operationalState("D_THRUST", st, T + 3_600_000 * 1.5 + 700_000).state, "DATA_BLOCKED", "bars keep arriving but no due evaluation for over 1.5 cadences: the boundary was missed");
  assert.ok(operationalState("D_THRUST", st, T).nextDueT! > T && (operationalState("D_THRUST", st, T).nextDueT! + 1) % 3_600_000 === 0, "next due is the next 1H close");
  st.stats.by.D_THRUST = { ...st.stats.by.D_THRUST, n: 12, sumR: -3 }; const s = operationalState("D_THRUST", st, T); assert.equal(s.probation, true); assert.equal(s.sizing, 0.5, "probation halves size; 'full size' would be wrong");
  assert.deepEqual(STRATEGIES.map((id) => cadenceOf(id)).sort(), ["15m", "15m", "15m", "15m", "1d", "1h", "4h", "4h", "5m", "5m", "15m"].sort());
  assert.equal(CADENCE_MS["4h"], 14_400_000); void OPT_IN; void CFG;
});

test("a due boundary whose bar is missing from the feed is INSUFFICIENT_DATA, not 'waiting'", () => {
  applyCfg(); const st = newState(), T = 15 * 60_000 * 100 - 1;   // a 15m boundary
  const trace: StrategyTrace[] = [{ id: "SWEEP_REV", kind: "REJECT", reason: "Waits for 15m close" }, { id: "HTF_TREND", kind: "REJECT", reason: "Waits for 4H close" }];
  const miss = { due: { "15m": true, "1h": false, "4h": false, "1d": false }, have: { "15m": false, "1h": false, "4h": false, "1d": false } };
  const out = recordCoverage(st, { T, now: T + 60_000, trace, disp: [], boundary: miss });
  assert.equal(out.find((x) => x.id === "SWEEP_REV")!.code, "INSUFFICIENT_DATA"); assert.match(out.find((x) => x.id === "SWEEP_REV")!.reason, /15m bar is missing/);
  assert.equal(out.find((x) => x.id === "HTF_TREND")!.code, "NOT_DUE", "4H was not due");
  assert.equal(st.covMeta!.missingDue["15m"], 1);
  const ok = recordCoverage(st, { T: T + 300_000, now: 0, trace: [], disp: [], boundary: { due: { "15m": true, "1h": false, "4h": false, "1d": false }, have: { "15m": true, "1h": false, "4h": false, "1d": false } } }); void ok;
  assert.equal(st.covMeta!.missingDue["15m"], 1, "present bars are not counted as missing");
});

test("a session-window strategy outside its window stays RUNNING: a due bar spent outside the window is a completed evaluation", () => {
  applyCfg(); const st = newState(), T = 900_000 * 400 - 1;
  const B = (m15: boolean) => ({ due: { "15m": m15, "1h": false, "4h": false, "1d": false }, have: { "15m": m15, "1h": false, "4h": false, "1d": false } });
  const tr: StrategyTrace[] = [{ id: "SESSION_BO", kind: "REJECT", reason: "Outside London/NY open window" }];
  recordCoverage(st, { T, now: T + 60_000, trace: tr, disp: [], boundary: B(true) });
  recordCoverage(st, { T: T + 300_000, now: T + 360_000, trace: [{ id: "SESSION_BO", kind: "REJECT", reason: "Waits for 15m close" }], disp: [], boundary: B(false) });
  const c = st.cov!.SESSION_BO; assert.deepEqual([c.due, c.completed, c.windowClosed, c.notDue, c.skippedData], [1, 1, 1, 1, 0]);
  assert.equal(operationalState("SESSION_BO", st, T + 400_000).state, "RUNNING");
  assert.equal(operationalState("SESSION_BO", st, T + 3 * 3_600_000).state, "DATA_BLOCKED", "no due evaluation for 3 hours while bars keep arriving would mean missed boundaries");
});
