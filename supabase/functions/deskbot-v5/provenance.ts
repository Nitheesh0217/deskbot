// DeskBot decision provenance (additive, paper only). Captures, BEFORE a paper entry is persisted, everything needed to
// reconstruct the decision without guessing, and verifies/replays it later. No trading API, no credentials, no network.
// Record = immutable evidence. A record is never updated; later events link to it by decisionId (= "D-" + position id).
import {
  CFG, ML_IS_GOLD, setMlAsset, applyCfg, buildSeries, snapshot, evaluate, entryGates, openPosition, dynamicRisk, riskMultiplier, ensureState, idxAt,
  type Bar, type Signal, type Reject, type State, type Position, type Trade, type Context,
} from "./engine.ts";
import { SYMBOLS, type Sym } from "./data.ts";
import { BUILD } from "./build_info.ts";
import { canonical } from "./runtime.ts";
import { catchUp } from "./catchup.ts";

export const DECISION_SCHEMA = "deskbot.decision/1";
export const decisionIdFor = (positionId: string) => `D-${positionId}`;
const TFS = ["m5", "m15", "h1", "h4"] as const;
type TF = typeof TFS[number];

export async function sha256(x: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x === undefined ? null : x));
const SECRET_KEY = /(secret|passw(or)?d|api[_-]?key|apikey|token|authorization|bearer|cookie|private[_-]?key|credential)/i;
const SECRET_VALUE = /(sk-[A-Za-z0-9]{16,}|gsk_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._-]{16,})/;
/** Throws if a record or its inputs contain a secret-looking key or value. Defence in depth: records are built from whitelisted fields. */
export function assertNoSecrets(x: unknown, path = "$"): void {
  if (Array.isArray(x)) { x.forEach((v, i) => assertNoSecrets(v, `${path}[${i}]`)); return; }
  if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x)) {
      if (SECRET_KEY.test(k)) throw new Error(`provenance: secret-like key at ${path}.${k}`);
      assertNoSecrets(v, `${path}.${k}`);
    }
  } else if (typeof x === "string" && SECRET_VALUE.test(x)) throw new Error(`provenance: secret-like value at ${path}`);
}

const encBars = (b: Bar[]) => b.map((x) => [x.t, x.o, x.h, x.l, x.c, x.v, x.ct]);
const decBars = (a: number[][]): Bar[] => a.map(([t, o, h, l, c, v, ct]) => ({ t, o, h, l, c, v, ct }));

export type FramesIn = Record<TF, { bars: Bar[]; source: string; receivedAtMs?: number | null }>;
export type InputRow = { decisionId: string; tf: TF; source: string; bars: number[][]; barsSha256: string };
export type CaptureArgs = {
  sym: Sym;
  /** Engine evaluation time: the `now` used for entry gates and the modeled fill time (= run start). NOT a data-receipt time. */
  now: number;
  /** Wall-clock completion of the decision (when capture runs). Defaults to Date.now(). */
  completedMs?: number;
  experimentId: string; frames: FramesIn; snapT: number;
  external: { ctx: Context | null; markPxUsed: number; fng: number | null; flow: unknown };
  /** Actual receipt times (ms) of the optional external reads; missing = unknown. */
  externalReceivedAtMs?: { ctx?: number | null; fng?: number | null; fngCached?: boolean; flow?: number | null };
  stateBefore: State; cfgResolved: unknown; integrity: { hash: string; approved: boolean; reason: string | null };
  signals: Signal[]; rejects: Reject[]; gateNotes: string[]; newsBlock: string | null;
  chosen: Signal; fillRef: number; position: Position; equityBefore: number; approvalEnforced?: boolean; catchUpFromT?: number | null;
};

const accountView = (st: State) => {
  const v = clone(st) as unknown as Record<string, unknown>;
  for (const k of Object.keys(v)) if (k.startsWith("_") || k === "cfg" || k === "carried") delete v[k];
  v.pos = null; return v;
};

/** Builds the immutable record + its input rows. Everything is deep-copied: later mutation of live objects cannot change evidence. */
export async function captureDecision(a: CaptureArgs): Promise<{ record: Record<string, unknown>; recordSha256: string; inputs: InputRow[] }> {
  const p = a.position, decisionId = decisionIdFor(p.id), completedMs = a.completedMs ?? Date.now();
  const inputs: InputRow[] = []; const inputRefs: Record<string, unknown> = {};
  for (const tf of TFS) {
    const f = a.frames[tf], bars = encBars(f.bars), h = await sha256(canonical(bars));
    inputs.push({ decisionId, tf, source: f.source, bars: bars.map((r) => r.slice()), barsSha256: h });
    inputRefs[tf] = { source: f.source, count: bars.length, firstT: f.bars[0]?.t ?? null, lastBarClose: f.bars.at(-1)?.ct ?? null, sha256: h };
  }
  const external = clone(a.external); const externalSha256 = await sha256(canonical(external));
  const accountState = accountView(a.stateBefore); const accountSha256 = await sha256(canonical(accountState));
  const cfg = clone(a.cfgResolved); const cfgSha256 = await sha256(canonical(cfg));
  const d = p.dir === "long" ? 1 : -1, stopDist = Math.abs(p.entry - p.stop0);
  const costPerUnit = p.entry * CFG.TAKER_FEE + p.stop0 * (CFG.TAKER_FEE + CFG.SLIPPAGE);
  const dyn = dynamicRisk(a.equityBefore), mult = riskMultiplier(a.stateBefore, p.strategy), scale = CFG.RISK_SCALE[p.strategy] ?? 1;
  const qtyUncapped = p.riskAmt / (stopDist + costPerUnit), qtyCap = (a.equityBefore * CFG.MAX_LEVERAGE) / p.entry;
  const record: Record<string, unknown> = {
    schema: DECISION_SCHEMA, decisionId, positionId: p.id, sym: a.sym,
    decidedAt: new Date(completedMs).toISOString(),
    timing: {
      runStartMs: a.now, evaluationTimeMs: a.now, decisionCompletedMs: completedMs, snapshotBarClose: a.snapT, evaluationLagMs: a.now - a.snapT,
      inputReceivedAtMs: Object.fromEntries([...TFS.map((tf) => [tf, a.frames[tf].receivedAtMs ?? null]), ["ctx", a.externalReceivedAtMs?.ctx ?? null], ["fng", a.externalReceivedAtMs?.fng ?? null], ["flow", a.externalReceivedAtMs?.flow ?? null]]),
      fngCached: a.externalReceivedAtMs?.fngCached ?? null,
      persistenceAck: "dbv5_decisions.created_at (database clock) after the atomic RPC commits; not part of the hashed record",
      note: "evaluationTimeMs is the engine's run-start time used for entry gates and the modeled fill (plan.openT). It is not a data-receipt time. null = unknown. Provider candle responses carry no server timestamp, so receipt is the local time the response was read.",
    },
    dataAvailability: { snapshotBarClose: a.snapT, note: "closed bars only", ...(a.catchUpFromT != null ? { catchUpFromT: a.catchUpFromT } : {}) },
    mode: "PAPER", portfolio: `deskbot-v5/${a.sym}`, experiment: a.experimentId,
    instrument: {
      book: a.sym, name: SYMBOLS[a.sym].name, venue: "hyperliquid", nativeSymbol: SYMBOLS[a.sym].hl, fallbackVenue: "binance-spot", fallbackSymbol: SYMBOLS[a.sym].bn,
      instrumentKind: "unverified (code only knows the native coin name)",
      contractSpecVersion: "deskbot-modeled-v1", contractSpec: { quote: "USD", multiplier: 1, lotSize: null, tickSize: null, note: "engine models continuous quantity; exchange lot/tick/min-notional are not applied" },
    },
    build: { engineVersion: BUILD.engineVersion, sourceSha256: BUILD.sourceSha256, files: BUILD.files, note: "source hash of the repo files; the deployed bundle is a build of them (see deployment record)" },
    config: { sha256: cfgSha256, versionedHash: a.integrity.hash, resolved: cfg },
    governance: {
      configIdentity: { hash: a.integrity.hash, engineVersion: BUILD.engineVersion },
      experimentApproval: { status: a.integrity.approved ? "approved-fingerprint-match" : "unapproved", reason: a.integrity.reason, enforced: a.approvalEnforced ?? null },
      financialValidation: { status: "none", note: "a deployed or observed configuration is not financially validated" },
      fundedExecution: { status: "not_authorized" },
    },
    inputs: { frames: inputRefs, external, externalSha256 },
    accountState: { sha256: accountSha256, state: accountState },
    candidates: { signals: clone(a.signals.map((s) => ({ strategy: s.strategy, dir: s.dir, score: s.score, regime: s.regime, barT: s.barT, stop: s.stop, entryRef: s.entryRef, why: s.why, reentry: !!s.reentry, bodyStop: !!s.bodyStop }))), rejects: clone(a.rejects), gateNotes: clone(a.gateNotes), newsBlock: a.newsBlock },
    chosen: { strategy: a.chosen.strategy, dir: a.chosen.dir, score: a.chosen.score, regime: a.chosen.regime, barT: a.chosen.barT, reentry: !!a.chosen.reentry, why: clone(a.chosen.why), heuristicScoreNote: "heuristic score, not a calibrated probability" },
    plan: {
      fillRef: a.fillRef, entry: p.entry, stop0: p.stop0, tp1: p.tp1, tp2: p.tp2, tp3: p.tp3, dir: p.dir,
      expiryMs: p.openT + p.maxHoldH * 3600_000, maxHoldH: p.maxHoldH, originalQty: p.originalQty, riskAmt: p.riskAmt, openT: p.openT,
      sizing: { equityBefore: a.equityBefore, dynamicRisk: dyn, riskMultiplier: mult, riskScale: scale, riskAmtFormula: a.equityBefore * dyn * mult * scale, stopDist, qtyUncapped, qtyLeverageCap: qtyCap, leverageCapped: qtyUncapped > qtyCap, maxLeverage: CFG.MAX_LEVERAGE },
      modeledCosts: { takerFee: CFG.TAKER_FEE, makerFee: CFG.MAKER_FEE, slippage: CFG.SLIPPAGE, entryFee: p.entryFee, roundTripTakerCostPctOfEntry: 2 * CFG.TAKER_FEE + 2 * CFG.SLIPPAGE, roundTripCostR: (p.entry * (2 * CFG.TAKER_FEE + 2 * CFG.SLIPPAGE)) / stopDist, direction: d },
    },
  };
  assertNoSecrets(record); assertNoSecrets(inputs);
  const recordSha256 = await sha256(canonical(record));
  return { record, recordSha256, inputs };
}

/** Mirrors the live entry loop so the live path and the replay share one implementation. Mutates `st` exactly as live does. */
export function pickEntry(st: State, signals: Signal[], now: number, refFor: (s: Signal) => number, notes: string[]) {
  for (const sig of signals) {
    const g = entryGates(st, sig, now);
    if (!g.ok) { notes.push(`${sig.strategy} ${sig.dir} ${sig.score}: ${g.reason}`); continue; }
    const fillRef = refFor(sig);
    const p = openPosition(st, sig, fillRef, now);
    if (!p) { notes.push(`${sig.strategy}: price already through stop`); continue; }
    return { sig, p, fillRef };
  }
  return null;
}

export type Diff = { field: string; recorded: unknown; replayed: unknown };
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const stripShadow = (w: string[]) => w.filter((x) => !/^Order flow 24h/.test(x));

/** Verifies stored hashes and re-runs the decision from stored inputs. Returns every disagreement; empty list = reproduced. */
export async function replayDecision(record: Record<string, any>, rows: Pick<InputRow, "tf" | "source" | "bars" | "barsSha256">[], recordSha256?: string): Promise<{ diffs: Diff[]; reproduced: boolean }> {
  const diffs: Diff[] = []; const add = (field: string, recorded: unknown, replayed: unknown) => diffs.push({ field, recorded, replayed });
  if (recordSha256 !== undefined && (await sha256(canonical(record))) !== recordSha256) add("record.sha256", recordSha256, "recomputed differs");
  if ((await sha256(canonical(record.config.resolved))) !== record.config.sha256) add("config.sha256", record.config.sha256, "recomputed differs");
  if ((await sha256(canonical(record.inputs.external))) !== record.inputs.externalSha256) add("inputs.externalSha256", record.inputs.externalSha256, "recomputed differs");
  if ((await sha256(canonical(record.accountState.state))) !== record.accountState.sha256) add("accountState.sha256", record.accountState.sha256, "recomputed differs");
  const frames: Record<string, Bar[]> = {};
  for (const tf of TFS) {
    const r = rows.find((x) => x.tf === tf);
    if (!r) { add(`inputs.${tf}`, "present", "missing"); continue; }
    if ((await sha256(canonical(r.bars))) !== r.barsSha256 || r.barsSha256 !== record.inputs.frames[tf].sha256) add(`inputs.${tf}.sha256`, record.inputs.frames[tf].sha256, "stored bars differ");
    frames[tf] = decBars(r.bars);
  }
  if (diffs.length) return { diffs, reproduced: false };
  const cfgBefore = clone(CFG), glBefore = ML_IS_GOLD;
  try {
    applyCfg(record.config.resolved); setMlAsset(record.sym === "GOLD");
    const S = buildSeries({ m5: frames.m5, m15: frames.m15, h1: frames.h1, h4: frames.h4 });
    const i5 = idxAt(frames.m5, record.dataAvailability.snapshotBarClose);
    if (i5 < 0 || frames.m5[i5].ct !== record.dataAvailability.snapshotBarClose) { add("snapshotBar", record.dataAvailability.snapshotBarClose, i5 < 0 ? "not found" : frames.m5[i5].ct); return { diffs, reproduced: false }; }
    const ex = record.inputs.external, ctx = ex.ctx;
    const snap = snapshot(S, i5, { funding: ctx?.funding ?? null, oi: ctx?.oi ?? null, markPx: ctx?.markPx ?? null, fng: ex.fng ?? null });
    const st = ensureState(clone(record.accountState.state) as State); st.pos = null;
    let { signals } = evaluate(snap, st.enabled, S, st);
    // a catch-up entry: the live bar had nothing, the candidate came from a skipped boundary bar (catchup.ts), scanned from catchUpFromT
    const cuFrom = (record.dataAvailability as { catchUpFromT?: number }).catchUpFromT;
    if (!signals.length && cuFrom != null) signals = catchUp(S, i5, cuFrom, st, st.enabled, { funding: ctx?.funding ?? null, oi: ctx?.oi ?? null, markPx: ctx?.markPx ?? null, fng: ex.fng ?? null }).candidates;
    const recSig = record.candidates.signals as any[];
    if (signals.length !== recSig.length) add("candidates.count", recSig.length, signals.length);
    signals.forEach((s, i) => { const r = recSig[i]; if (!r) return; for (const k of ["strategy", "dir", "score", "regime", "barT"] as const) if (r[k] !== (s as any)[k]) add(`candidates[${i}].${k}`, r[k], (s as any)[k]); if (!close(r.stop, s.stop)) add(`candidates[${i}].stop`, r.stop, s.stop); if (JSON.stringify(stripShadow(r.why)) !== JSON.stringify(stripShadow(s.why))) add(`candidates[${i}].why`, r.why, s.why); });
    const refFor = () => ex.markPxUsed;
    const got = pickEntry(st, signals, record.timing.evaluationTimeMs, refFor, []);
    if (!got) { add("chosen", record.chosen.strategy, "no entry"); return { diffs, reproduced: false }; }
    const pl = record.plan;
    if (got.sig.strategy !== record.chosen.strategy || got.sig.dir !== record.chosen.dir) add("chosen", `${record.chosen.strategy} ${record.chosen.dir}`, `${got.sig.strategy} ${got.sig.dir}`);
    for (const k of ["entry", "stop0", "tp1", "tp2", "tp3", "originalQty", "riskAmt"] as const) if (!close(pl[k], (got.p as any)[k])) add(`plan.${k}`, pl[k], (got.p as any)[k]);
    if (got.p.id !== record.positionId) { /* position id derives from decision time; compare via openT */ }
    if (got.p.openT !== pl.openT) add("plan.openT", pl.openT, got.p.openT);
  } finally { Object.assign(CFG, cfgBefore); setMlAsset(glBefore); }
  return { diffs, reproduced: diffs.length === 0 };
}

export type Outcome = { diffs: Diff[]; unverified: string[]; checks: number };
/**
 * Links a closed trade to its original plan and INDEPENDENTLY rebuilds its economics from direction, entry, executed quantity and price,
 * and the fee/slippage model recorded with the decision. Stored pnl/fee/gross/net/R are compared with the rebuild, never trusted.
 * R always uses the original dollar risk and stop0. Things that cannot be rebuilt from stored evidence are listed in `unverified`.
 */
export function reconcileOutcome(record: Record<string, any>, t: Trade): Outcome {
  const diffs: Diff[] = []; const unverified: string[] = []; let checks = 0;
  const eq = (field: string, recorded: unknown, actual: unknown, ok: boolean) => { checks++; if (!ok) diffs.push({ field, recorded, replayed: actual }); };
  const pl = record.plan, mc = pl.modeledCosts, d = pl.dir === "long" ? 1 : -1;
  eq("trade.id", record.positionId, t.id, t.id === record.positionId);
  eq("decisionId", record.decisionId, decisionIdFor(t.id), decisionIdFor(t.id) === record.decisionId);
  eq("trade.dir", pl.dir, t.dir, t.dir === pl.dir);
  eq("trade.entry", pl.entry, t.entry, close(t.entry, pl.entry));
  eq("trade.stop0", pl.stop0, t.stop0, close(t.stop0, pl.stop0));
  eq("trade.riskAmt", pl.riskAmt, t.riskAmt, close(t.riskAmt, pl.riskAmt));
  eq("trade.originalQty", pl.originalQty, t.originalQty, close(t.originalQty, pl.originalQty));
  eq("trade.openT", pl.openT, t.openT, t.openT === pl.openT);
  // entry fill and fee from the recorded model
  const entryRebuilt = pl.fillRef * (1 + d * mc.slippage); eq("entry = fillRef x (1 + dir x slippage)", pl.entry, entryRebuilt, close(pl.entry, entryRebuilt));
  const entryFee = pl.originalQty * pl.entry * mc.takerFee; eq("entryFee = qty x entry x taker", mc.entryFee, entryFee, close(mc.entryFee, entryFee));
  // each exit: quantity rule, price rule, pnl and fee rebuilt
  const CUM: Record<string, number> = { tp1: 0.5, tp2: 0.75, tp3: 1 }, level: Record<string, number> = { tp1: pl.tp1, tp2: pl.tp2, tp3: pl.tp3 };
  let closedQty = 0, gross = 0, fees = entryFee;
  t.exits.forEach((e, i) => {
    const tp = e.kind in CUM, remaining = pl.originalQty - closedQty;
    const expQty = tp ? Math.max(0, Math.min(pl.originalQty * CUM[e.kind] - closedQty, remaining)) : remaining;
    eq(`exit[${i}].qty (${e.kind})`, expQty, e.qty, close(e.qty, expQty));
    if (tp) eq(`exit[${i}].px (${e.kind} = planned level)`, level[e.kind], e.px, close(e.px, level[e.kind]));
    else unverified.push(`exit[${i}] ${e.kind} price: the stop/market level in force at that moment comes from the management path, which is not stored yet`);
    const pnl = (e.px - pl.entry) * d * e.qty; eq(`exit[${i}].pnl`, e.pnl, pnl, close(e.pnl, pnl));
    const fee = e.qty * e.px * (tp ? mc.makerFee : mc.takerFee); eq(`exit[${i}].fee`, e.fee, fee, close(e.fee, fee));
    closedQty += e.qty; gross += pnl; fees += fee;
  });
  eq("exits.qtySum = originalQty", pl.originalQty, closedQty, close(pl.originalQty, closedQty));
  eq("trade.gross (rebuilt)", t.gross, gross, close(t.gross, gross));
  eq("trade.fees (rebuilt)", t.fees, fees, close(t.fees, fees));
  const net = gross - fees - t.funding; eq("trade.net = gross - fees - funding", t.net, net, close(t.net, net));
  eq("trade.r = net / original risk", t.r, net / pl.riskAmt, close(t.r, net / pl.riskAmt));
  const avg = t.exits.reduce((s2, e) => s2 + e.px * e.qty, 0) / pl.originalQty; eq("trade.exitAvg (rebuilt)", t.exitAvg, avg, close(t.exitAvg, avg));
  eq("trade.closeT within plan expiry (or a time/manual exit)", `<= ${pl.expiryMs}`, t.closeT, t.closeT <= pl.expiryMs + 5 * 60_000 || /TIME|MANUAL/i.test(t.reason));
  unverified.push("funding: hourly rates over the holding period are not stored, so the funding amount is taken as recorded and is NOT independently verified");
  return { diffs, unverified, checks };
}

export type LifecycleInput = {
  record: Record<string, any>; recordSha256?: string; inputs: Pick<InputRow, "tf" | "source" | "bars" | "barsSha256">[];
  trade?: Trade | null; positionOpen?: boolean; allowSourceMismatch?: boolean;
};
export type Lifecycle = {
  overall: "LIFECYCLE_VERIFIED_FUNDING_UNVERIFIED" | "ENTRY_VERIFIED_POSITION_OPEN" | "ENTRY_VERIFIED_OUTCOME_MISSING" | "ENTRY_DISAGREEMENT" | "OUTCOME_DISAGREEMENT" | "SOURCE_MISMATCH_NOT_VERIFIED" | "DIAGNOSTIC_CROSS_VERSION_ONLY";
  exitCode: number;
  source: { recorded: string; current: string; matches: boolean };
  entryReplay: { status: "REPRODUCED" | "DISAGREEMENT"; diffs: Diff[] };
  outcome: { status: "RECONCILED" | "DISAGREEMENT" | "OPEN_POSITION" | "MISSING"; diffs: Diff[]; unverified: string[]; checks: number };
};
/** Binding verification: a result is only "verified" when the recorded source identity equals the running source. */
export async function verifyLifecycle(x: LifecycleInput): Promise<Lifecycle> {
  const rec = x.record, source = { recorded: rec.build?.sourceSha256 as string, current: BUILD.sourceSha256 as string, matches: rec.build?.sourceSha256 === BUILD.sourceSha256 };
  const rep = await replayDecision(rec, x.inputs, x.recordSha256);
  const entryReplay = { status: (rep.reproduced ? "REPRODUCED" : "DISAGREEMENT") as "REPRODUCED" | "DISAGREEMENT", diffs: rep.diffs };
  let outcome: Lifecycle["outcome"];
  if (x.trade) { const o = reconcileOutcome(rec, x.trade); outcome = { status: o.diffs.length ? "DISAGREEMENT" : "RECONCILED", ...o }; }
  else outcome = { status: x.positionOpen ? "OPEN_POSITION" : "MISSING", diffs: [], unverified: [], checks: 0 };
  let overall: Lifecycle["overall"], exitCode: number;
  if (!source.matches) { overall = x.allowSourceMismatch ? "DIAGNOSTIC_CROSS_VERSION_ONLY" : "SOURCE_MISMATCH_NOT_VERIFIED"; exitCode = 3; }
  else if (entryReplay.status !== "REPRODUCED") { overall = "ENTRY_DISAGREEMENT"; exitCode = 1; }
  else if (outcome.status === "DISAGREEMENT") { overall = "OUTCOME_DISAGREEMENT"; exitCode = 1; }
  else if (outcome.status === "OPEN_POSITION") { overall = "ENTRY_VERIFIED_POSITION_OPEN"; exitCode = 0; }
  else if (outcome.status === "MISSING") { overall = "ENTRY_VERIFIED_OUTCOME_MISSING"; exitCode = 4; }
  else { overall = "LIFECYCLE_VERIFIED_FUNDING_UNVERIFIED"; exitCode = 0; }
  return { overall, exitCode, source, entryReplay, outcome };
}
