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

export type FramesIn = Record<TF, { bars: Bar[]; source: string }>;
export type InputRow = { decisionId: string; tf: TF; source: string; bars: number[][]; barsSha256: string };
export type CaptureArgs = {
  sym: Sym; now: number; experimentId: string; frames: FramesIn; snapT: number;
  external: { ctx: Context | null; markPxUsed: number; fng: number | null; flow: unknown };
  stateBefore: State; cfgResolved: unknown; integrity: { hash: string; approved: boolean; reason: string | null };
  signals: Signal[]; rejects: Reject[]; gateNotes: string[]; newsBlock: string | null;
  chosen: Signal; fillRef: number; position: Position; equityBefore: number; approvalEnforced?: boolean;
};

const accountView = (st: State) => {
  const v = clone(st) as unknown as Record<string, unknown>;
  for (const k of Object.keys(v)) if (k.startsWith("_") || k === "cfg" || k === "carried") delete v[k];
  v.pos = null; return v;
};

/** Builds the immutable record + its input rows. Everything is deep-copied: later mutation of live objects cannot change evidence. */
export async function captureDecision(a: CaptureArgs): Promise<{ record: Record<string, unknown>; recordSha256: string; inputs: InputRow[] }> {
  const p = a.position, decisionId = decisionIdFor(p.id);
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
    decidedAt: new Date(a.now).toISOString(), decidedAtMs: a.now,
    dataAvailability: { fetchedAtMs: a.now, snapshotBarClose: a.snapT, lagMs: a.now - a.snapT, note: "bars are closed bars only; fetch time = decision time" },
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
    const { signals } = evaluate(snap, st.enabled, S, st);
    const recSig = record.candidates.signals as any[];
    if (signals.length !== recSig.length) add("candidates.count", recSig.length, signals.length);
    signals.forEach((s, i) => { const r = recSig[i]; if (!r) return; for (const k of ["strategy", "dir", "score", "regime", "barT"] as const) if (r[k] !== (s as any)[k]) add(`candidates[${i}].${k}`, r[k], (s as any)[k]); if (!close(r.stop, s.stop)) add(`candidates[${i}].stop`, r.stop, s.stop); if (JSON.stringify(stripShadow(r.why)) !== JSON.stringify(stripShadow(s.why))) add(`candidates[${i}].why`, r.why, s.why); });
    const refFor = () => ex.markPxUsed;
    const got = pickEntry(st, signals, record.decidedAtMs, refFor, []);
    if (!got) { add("chosen", record.chosen.strategy, "no entry"); return { diffs, reproduced: false }; }
    const pl = record.plan;
    if (got.sig.strategy !== record.chosen.strategy || got.sig.dir !== record.chosen.dir) add("chosen", `${record.chosen.strategy} ${record.chosen.dir}`, `${got.sig.strategy} ${got.sig.dir}`);
    for (const k of ["entry", "stop0", "tp1", "tp2", "tp3", "originalQty", "riskAmt"] as const) if (!close(pl[k], (got.p as any)[k])) add(`plan.${k}`, pl[k], (got.p as any)[k]);
    if (got.p.id !== record.positionId) { /* position id derives from decision time; compare via openT */ }
    if (got.p.openT !== pl.openT) add("plan.openT", pl.openT, got.p.openT);
  } finally { Object.assign(CFG, cfgBefore); setMlAsset(glBefore); }
  return { diffs, reproduced: diffs.length === 0 };
}

/** Links a closed trade back to its original plan. Never recomputes risk from a moved stop: R uses the original dollar risk. */
export function reconcileOutcome(record: Record<string, any>, t: Trade): Diff[] {
  const diffs: Diff[] = []; const add = (field: string, recorded: unknown, actual: unknown) => diffs.push({ field, recorded, replayed: actual });
  const pl = record.plan;
  if (t.id !== record.positionId) add("trade.id", record.positionId, t.id);
  if (decisionIdFor(t.id) !== record.decisionId) add("decisionId", record.decisionId, decisionIdFor(t.id));
  if (!close(t.entry, pl.entry)) add("trade.entry", pl.entry, t.entry);
  if (!close(t.stop0, pl.stop0)) add("trade.stop0", pl.stop0, t.stop0);
  if (!close(t.riskAmt, pl.riskAmt)) add("trade.riskAmt", pl.riskAmt, t.riskAmt);
  if (!close(t.originalQty, pl.originalQty)) add("trade.originalQty", pl.originalQty, t.originalQty);
  if (t.openT !== pl.openT) add("trade.openT", pl.openT, t.openT);
  const q = t.exits.reduce((s, e) => s + e.qty, 0); if (!close(q, t.originalQty)) add("exits.qtySum", t.originalQty, q);
  const gross = t.exits.reduce((s, e) => s + e.pnl, 0), fees = pl.modeledCosts.entryFee + t.exits.reduce((s, e) => s + e.fee, 0);
  if (!close(gross, t.gross)) add("trade.gross", gross, t.gross);
  if (!close(fees, t.fees)) add("trade.fees", fees, t.fees);
  if (!close(gross - fees - t.funding, t.net)) add("trade.net", gross - fees - t.funding, t.net);
  if (!close(t.net / pl.riskAmt, t.r)) add("trade.r", t.net / pl.riskAmt, t.r);
  if (t.closeT > pl.expiryMs + 5 * 60_000 && !/TIME|MANUAL/i.test(t.reason)) add("trade.closeT", `<= expiry ${pl.expiryMs}`, t.closeT);
  return diffs;
}
