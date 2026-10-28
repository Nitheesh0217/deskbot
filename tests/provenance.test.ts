import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  applyCfg, CFG, ML_IS_GOLD, setMlAsset, buildSeries, snapshot, evaluate, initState, ensureState, managePosition, resolvedCfg, type Bar, type State, type Signal, type Trade,
} from "../supabase/functions/deskbot-v5/engine.ts";
import { captureDecision, replayDecision, reconcileOutcome, verifyLifecycle, pickEntry, assertNoSecrets, decisionIdFor } from "../supabase/functions/deskbot-v5/provenance.ts";
import { BUILD } from "../supabase/functions/deskbot-v5/build_info.ts";

const M5 = 300_000, H4 = 14_400_000, T0 = Date.UTC(2026, 0, 1);
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function closesFor(seed: number, n: number) { const r = seeded(seed), c = [30000]; for (let i = 1; i < n; i++) c.push(c[i - 1] * (1 + 0.00003 * Math.sin(i / 900) + (r() - 0.5) * 0.004)); return c; }
const mk = (c: number[], tf: number, t0: number): Bar[] => c.map((x, i) => { const o = i ? c[i - 1] : x, w = x * 0.0015; return { t: t0 + i * tf, o, h: Math.max(o, x) + w, l: Math.min(o, x) - w, c: x, v: 10, ct: t0 + (i + 1) * tf - 1 }; });
function agg(b: Bar[], k: number): Bar[] { const out: Bar[] = []; for (let i = 0; i + k <= b.length; i += k) { const s = b.slice(i, i + k); out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)), c: s[k - 1].c, v: s.reduce((a, x) => a + x.v, 0), ct: s[k - 1].ct }); } return out; }
const LOOSE = { MIN_SCORE: 0 } as Partial<typeof CFG>;

/** Finds a bar where the unchanged engine, with only the score floor lowered, opens a paper entry. */
async function scenario(sym: "BTC" | "GOLD" = "BTC", seed = 1) {
  const closes = closesFor(seed, 36000), m5all = mk(closes, M5, T0);
  applyCfg(LOOSE); setMlAsset(sym === "GOLD");
  const full = { m5: m5all.slice(0, 35000), m15: agg(m5all.slice(0, 35000), 3), h1: agg(m5all.slice(0, 35000), 12), h4: agg(m5all.slice(0, 35000), 48) };
  const S = buildSeries(full);
  for (let i = 34000; i < 34990; i++) {
    const st = ensureState(initState(350, T0)); const snap = snapshot(S, i, { funding: 0.0001, oi: 5, markPx: null, fng: 50 });
    const { signals, rejects } = evaluate(snap, st.enabled, S, st); if (!signals.length) continue;
    const sb = JSON.parse(JSON.stringify(st)) as State, notes: string[] = [], now = snap.T + 4000;
    const picked = pickEntry(st, signals, now, () => snap.price, notes); if (!picked) continue;
    const upto = (b: Bar[]) => b.filter((x) => x.ct <= snap.T);
    const frames = { m5: { bars: upto(full.m5), source: "hyperliquid" }, m15: { bars: upto(full.m15), source: "hyperliquid" }, h1: { bars: upto(full.h1), source: "hyperliquid" }, h4: { bars: upto(full.h4), source: "binance" } };
    const cap = await captureDecision({ sym, now, experimentId: "test", frames, snapT: snap.T, external: { ctx: { funding: 0.0001, oi: 5, markPx: null }, markPxUsed: snap.price, fng: 50, flow: null },
      stateBefore: sb, cfgResolved: resolvedCfg(LOOSE), integrity: { hash: "h", approved: false, reason: "Configuration has no approved fingerprint" }, signals, rejects, gateNotes: notes, newsBlock: null,
      chosen: picked.sig, fillRef: picked.fillRef, position: picked.p, equityBefore: sb.equity });
    return { cap, picked, frames, stateAfter: st, snap, signals, sb, now };
  }
  throw new Error("no entry found in synthetic scan");
}
const rowsOf = (cap: Awaited<ReturnType<typeof scenario>>["cap"]) => cap.inputs.map((r) => ({ tf: r.tf, source: r.source, bars: r.bars, barsSha256: r.barsSha256 }));
test.afterEach(() => { applyCfg(); setMlAsset(false); });

for (const sym of ["BTC", "GOLD"] as const) test(`${sym}: a recorded entry replays from stored inputs with zero disagreements`, async () => {
  const s = await scenario(sym); const cfgBefore = JSON.stringify(CFG), gold = ML_IS_GOLD;
  const out = await replayDecision(JSON.parse(JSON.stringify(s.cap.record)), rowsOf(s.cap), s.cap.recordSha256);
  assert.deepEqual(out.diffs, []); assert.equal(out.reproduced, true);
  assert.equal(JSON.stringify(CFG), cfgBefore, "replay must restore global config"); assert.equal(ML_IS_GOLD, gold);
  assert.equal((s.cap.record as any).decisionId, decisionIdFor(s.picked.p.id));
  assert.equal((s.cap.record as any).governance.fundedExecution.status, "not_authorized");
  assert.equal((s.cap.record as any).governance.financialValidation.status, "none");
  assert.equal((s.cap.record as any).build.sourceSha256, BUILD.sourceSha256);
});

test("mutating live objects after capture cannot change stored evidence", async () => {
  const s = await scenario(); const hashBefore = s.cap.recordSha256, text = JSON.stringify(s.cap.record), inputsText = JSON.stringify(s.cap.inputs);
  s.picked.p.entry *= 2; s.picked.p.stop0 *= 2; s.picked.p.riskAmt = 0; s.picked.sig.why.push("tampered"); s.sb.equity = 1; s.sb.cb.consec = 99;
  s.signals.length = 0; for (const tf of Object.values(s.frames)) { tf.bars[0].c = -1; tf.bars.pop(); } CFG.MIN_SCORE = 77;
  assert.equal(JSON.stringify(s.cap.record), text); assert.equal(JSON.stringify(s.cap.inputs), inputsText);
  applyCfg(LOOSE);
  const out = await replayDecision(JSON.parse(text), rowsOf(s.cap), hashBefore); assert.deepEqual(out.diffs, []);
});

test("tampering with stored bars, config, plan or hashes is detected", async () => {
  const s = await scenario(); const rows = () => JSON.parse(JSON.stringify(rowsOf(s.cap)));
  let r = rows(); r[0].bars[r[0].bars.length - 3][4] += 1;
  assert.ok((await replayDecision(JSON.parse(JSON.stringify(s.cap.record)), r, s.cap.recordSha256)).diffs.some((d) => /inputs\.m5/.test(d.field)));
  const rec = JSON.parse(JSON.stringify(s.cap.record)); rec.plan.entry += 1;
  assert.ok((await replayDecision(rec, rows(), s.cap.recordSha256)).diffs.some((d) => d.field === "record.sha256"));
  const rec2 = JSON.parse(JSON.stringify(s.cap.record)); rec2.config.resolved.MIN_SCORE = 99;
  assert.ok((await replayDecision(rec2, rows())).diffs.some((d) => d.field === "config.sha256"));
  const rec3 = JSON.parse(JSON.stringify(s.cap.record)); rec3.plan.riskAmt *= 1.5;   // hash not supplied: the re-run still exposes the plan disagreement
  const o3 = await replayDecision(rec3, rows()); assert.ok(o3.diffs.some((d) => d.field === "plan.riskAmt")); assert.equal(o3.reproduced, false);
});

test("books stay isolated: different configs give different identities and replay does not leak config", async () => {
  const a = await scenario("BTC"); const b = await scenario("GOLD", 2);
  assert.notEqual((a.cap.record as any).decisionId, (b.cap.record as any).decisionId);
  assert.equal((a.cap.record as any).portfolio, "deskbot-v5/BTC"); assert.equal((b.cap.record as any).portfolio, "deskbot-v5/GOLD");
  assert.equal((b.cap.record as any).instrument.nativeSymbol, "PAXG");
  const other = resolvedCfg({ MIN_SCORE: 1 }); assert.notEqual(JSON.stringify(other), JSON.stringify((a.cap.record as any).config.resolved));
  const before = JSON.stringify(CFG); await replayDecision(JSON.parse(JSON.stringify(b.cap.record)), rowsOf(b.cap)); assert.equal(JSON.stringify(CFG), before);
});

test("records never contain secrets; secret-looking content fails closed", async () => {
  process.env.GROQ_API_KEY = "gsk_TESTSECRETTESTSECRETTESTSECRET"; process.env.DESKBOT_CRON_SECRET = "cron-secret-value-123456";
  const s = await scenario(); const all = JSON.stringify(s.cap.record) + JSON.stringify(s.cap.inputs);
  assert.ok(!all.includes("TESTSECRET") && !all.includes("cron-secret-value"));
  assert.doesNotThrow(() => assertNoSecrets(s.cap.record));
  assert.throws(() => assertNoSecrets({ a: { apiKey: "x" } }), /secret-like key/);
  assert.throws(() => assertNoSecrets({ why: ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345"] }), /secret-like value/);
  const sig: Signal = { ...s.picked.sig, why: [...s.picked.sig.why, "chat said gsk_ABCDEFGHIJKLMNOPQRSTUV"] };
  await assert.rejects(captureDecision({ sym: "BTC", now: s.now, experimentId: "t", frames: s.frames, snapT: s.snap.T, external: { ctx: null, markPxUsed: 1, fng: null, flow: null }, stateBefore: s.sb, cfgResolved: resolvedCfg(LOOSE),
    integrity: { hash: "h", approved: false, reason: null }, signals: [sig], rejects: [], gateNotes: [], newsBlock: null, chosen: sig, fillRef: s.picked.fillRef, position: s.picked.p, equityBefore: s.sb.equity }), /secret-like value/);
  delete process.env.GROQ_API_KEY; delete process.env.DESKBOT_CRON_SECRET;
});

test("build identity: build_info.ts matches the source files it describes", () => {
  const dir = new URL("../supabase/functions/deskbot-v5/", import.meta.url), sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
  const files = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "build_info.ts").sort().map((f) => [f, sha(readFileSync(new URL(f, dir)))]));
  assert.deepEqual(files, BUILD.files, "stale build_info.ts: run node scripts/gen_build_info.mjs");
  assert.equal(sha(Object.entries(files).map(([f, h]) => `${f}:${h}`).join("\n")), BUILD.sourceSha256);
});

/** Opens the scenario's position, takes TP1 (stop moves to breakeven), then stops out the runner. Returns the record and the closed trade. */
async function closedScenario() {
  const s = await scenario(); const st = s.stateAfter, p = st.pos!; const rec = JSON.parse(JSON.stringify(s.cap.record));
  const d = p.dir === "long" ? 1 : -1, bar = (n: number, o: number, h: number, l: number, c: number): Bar => ({ t: p.openT + n * 60_000, o, h, l, c, v: 1, ct: p.openT + (n + 1) * 60_000 - 1 });
  const mid = (p.entry + p.tp1) / 2;   // low/high stays on the profit side of the new breakeven stop
  const hit = d === 1 ? bar(1, p.entry, p.tp1 + 0.01, mid, p.tp1) : bar(1, p.entry, mid, p.tp1 - 0.01, p.tp1);
  assert.equal(managePosition(st, [hit], 0).length, 0); assert.ok(st.pos && st.pos.tp1Done, "TP1 filled, runner still open");
  const moved = st.pos!.stop; assert.notEqual(moved, p.stop0, "stop was moved by exit management");
  const back = d === 1 ? bar(2, p.tp1, p.tp1, moved - 1, moved) : bar(2, p.tp1, moved + 1, p.tp1, moved);
  const closed = managePosition(st, [back], 0); assert.equal(closed.length, 1);
  return { s, rec, t: closed[0] as Trade, moved };
}
const cloneT = (t: Trade) => JSON.parse(JSON.stringify(t)) as Trade;

test("outcome reconciliation uses the ORIGINAL plan: a stop moved to breakeven never rewrites risk or R", async () => {
  const { rec, t, moved } = await closedScenario();
  assert.equal(t.stop0, rec.plan.stop0, "original stop retained"); assert.equal(t.riskAmt, rec.plan.riskAmt, "original dollar risk retained");
  const ok = reconcileOutcome(rec, t); assert.deepEqual(ok.diffs, []); assert.ok(ok.checks > 15);
  assert.ok(ok.unverified.some((u) => /funding/.test(u)), "funding is reported as NOT independently verified");
  assert.ok(Math.abs(t.r - t.net / rec.plan.riskAmt) < 1e-12);
  const forged = { ...t, stop0: moved, riskAmt: t.riskAmt * 0.5, r: t.net / (t.riskAmt * 0.5) };   // what a stop-tightening rewrite would produce
  const diffs = reconcileOutcome(rec, forged).diffs; assert.ok(diffs.some((x) => x.field === "trade.stop0") && diffs.some((x) => x.field === "trade.riskAmt"));
});

test("exit economics are rebuilt, not trusted: each tampering is caught independently", async () => {
  const { rec, t } = await closedScenario(); const fields = (x: Trade) => reconcileOutcome(rec, x).diffs.map((d) => d.field);
  // (a) the reviewer's case: exit.pnl +100 with aggregate gross/net/R adjusted to match, prices and quantities unchanged
  const a = cloneT(t); a.exits[0].pnl += 100; a.gross += 100; a.net += 100; a.r = a.net / a.riskAmt; assert.ok(fields(a).includes("exit[0].pnl"), "pnl tampering with consistent aggregates is caught");
  // (b) exit price changed, pnl left alone
  const b = cloneT(t); b.exits[0].px *= 1.01; assert.ok(fields(b).some((f) => /exit\[0\]\.px/.test(f)) && fields(b).includes("exit[0].pnl"));
  // (c) exit price AND pnl changed consistently: planned TP level no longer matches
  const c = cloneT(t); c.exits[0].px *= 1.01; c.exits[0].pnl = (c.exits[0].px - rec.plan.entry) * (rec.plan.dir === "long" ? 1 : -1) * c.exits[0].qty; assert.ok(fields(c).some((f) => /exit\[0\]\.px/.test(f)));
  // (d) quantity changed
  const d = cloneT(t); d.exits[0].qty *= 0.9; assert.ok(fields(d).some((f) => /exit\[0\]\.qty/.test(f)));
  // (e) fee changed
  const e = cloneT(t); e.exits[1].fee += 0.5; assert.ok(fields(e).includes("exit[1].fee"));
  // (f) direction: trade.dir flipped, and the pnl sign flipped to look consistent for the opposite side
  const f = cloneT(t); f.dir = f.dir === "long" ? "short" : "long"; f.exits.forEach((x) => { x.pnl = -x.pnl; }); assert.ok(fields(f).includes("trade.dir") && fields(f).includes("exit[0].pnl"));
  // (g) aggregate-only edits
  for (const k of ["gross", "fees", "net", "r"] as const) { const g = cloneT(t); g[k] += 0.01; assert.ok(fields(g).some((x) => x.startsWith(`trade.${k}`)), `aggregate ${k} edit caught`); }
  // (h) funding edit is carried through net, but net stays consistent with the recorded funding, so it is reported unverified rather than silently accepted
  const h = cloneT(t); h.funding += 1; h.net -= 1; h.r = h.net / h.riskAmt; const oh = reconcileOutcome(rec, h); assert.deepEqual(oh.diffs, []); assert.ok(oh.unverified.some((u) => /funding/.test(u)));
});

test("lifecycle verification is binding on source identity and distinguishes entry, outcome, open and missing", async () => {
  const { s, rec, t } = await closedScenario(); const rows = rowsOf(s.cap), base = { record: JSON.parse(JSON.stringify(rec)), recordSha256: s.cap.recordSha256, inputs: rows };
  const full = await verifyLifecycle({ ...base, trade: t }); assert.equal(full.overall, "LIFECYCLE_VERIFIED_FUNDING_UNVERIFIED"); assert.equal(full.exitCode, 0); assert.ok(full.source.matches);
  assert.equal((await verifyLifecycle({ ...base, positionOpen: true })).overall, "ENTRY_VERIFIED_POSITION_OPEN");
  const miss = await verifyLifecycle({ ...base }); assert.equal(miss.overall, "ENTRY_VERIFIED_OUTCOME_MISSING"); assert.equal(miss.exitCode, 4);
  const bad = cloneT(t); bad.exits[0].pnl += 100; bad.gross += 100; bad.net += 100; bad.r = bad.net / bad.riskAmt;
  const o = await verifyLifecycle({ ...base, trade: bad }); assert.equal(o.overall, "OUTCOME_DISAGREEMENT"); assert.equal(o.exitCode, 1);
  // different recorded source: the entry still replays, but the result can never be verified (hash must be re-supplied because the record changed)
  const other = JSON.parse(JSON.stringify(rec)); other.build.sourceSha256 = "0".repeat(64);
  const sm = await verifyLifecycle({ record: other, inputs: rows, trade: t }); assert.equal(sm.entryReplay.status, "REPRODUCED"); assert.equal(sm.source.matches, false);
  assert.equal(sm.overall, "SOURCE_MISMATCH_NOT_VERIFIED"); assert.equal(sm.exitCode, 3);
  const dg = await verifyLifecycle({ record: other, inputs: rows, trade: t, allowSourceMismatch: true }); assert.equal(dg.overall, "DIAGNOSTIC_CROSS_VERSION_ONLY"); assert.equal(dg.exitCode, 3, "diagnostic replay never exits 0");
  const ed = JSON.parse(JSON.stringify(rec)); ed.plan.entry += 1; const e = await verifyLifecycle({ record: ed, inputs: rows, trade: t }); assert.equal(e.overall, "ENTRY_DISAGREEMENT"); assert.equal(e.exitCode, 1);
});

test("timing evidence separates run start, evaluation time, per-input receipt and completion; unknown stays null", async () => {
  const s = await scenario(); const tm = (s.cap.record as any).timing;
  assert.equal(tm.runStartMs, s.now); assert.equal(tm.evaluationTimeMs, s.now); assert.ok(tm.decisionCompletedMs >= Date.now() - 5000);
  assert.deepEqual(Object.keys(tm.inputReceivedAtMs).sort(), ["ctx", "flow", "fng", "h1", "h4", "m15", "m5"]);
  assert.ok(Object.values(tm.inputReceivedAtMs).every((v) => v === null), "no receipt times supplied -> unknown (null), not run-start");
  assert.equal((s.cap.record as any).dataAvailability.fetchedAtMs, undefined); assert.match(tm.note, /not a data-receipt time/);
  assert.match(tm.persistenceAck, /created_at/);
});
