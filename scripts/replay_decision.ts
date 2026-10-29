// Replays one recorded paper decision from its stored inputs and reconciles its closed trade (if any). Read-only, no network.
//   npx tsx scripts/replay_decision.ts bundle.json [--allow-source-mismatch]
// bundle.json = { decision: {id, record, record_sha256}, inputs: [{tf, source, bars, bars_sha256}], trade?: <dbv5_trades.data>, positionOpen?: true }
// Overall status (exit code): LIFECYCLE_VERIFIED_FUNDING_UNVERIFIED (0) | ENTRY_VERIFIED_POSITION_OPEN (0) | ENTRY_DISAGREEMENT / OUTCOME_DISAGREEMENT (1)
//   | bad input (2) | SOURCE_MISMATCH_NOT_VERIFIED / DIAGNOSTIC_CROSS_VERSION_ONLY (3, never verified) | ENTRY_VERIFIED_OUTCOME_MISSING (4).
// A result is only verified when the recorded source hash equals this checkout's build_info. --allow-source-mismatch runs a diagnostic replay and still exits 3.
import { readFileSync } from "node:fs";
import { verifyLifecycle } from "../supabase/functions/deskbot-v5/provenance.ts";

const args = process.argv.slice(2), file = args.find((a) => !a.startsWith("--")), allow = args.includes("--allow-source-mismatch");
if (!file) { console.error("usage: replay_decision.ts bundle.json [--allow-source-mismatch]"); process.exit(2); }
const b = JSON.parse(readFileSync(file, "utf8"));
const rec = b.decision?.record; if (!rec || !Array.isArray(b.inputs)) { console.error("bundle needs decision.record and inputs[]"); process.exit(2); }
const r = await verifyLifecycle({
  record: rec, recordSha256: b.decision.record_sha256, trade: b.trade ?? null, positionOpen: !!b.positionOpen, allowSourceMismatch: allow,
  inputs: b.inputs.map((x: any) => ({ tf: x.tf, source: x.source, bars: x.bars, barsSha256: x.bars_sha256 ?? x.barsSha256 })),
});
console.log(JSON.stringify({
  decisionId: rec.decisionId, sym: rec.sym, mode: rec.mode, instrument: rec.instrument.nativeSymbol, decidedAt: rec.decidedAt, timing: rec.timing,
  governance: rec.governance, chosen: `${rec.chosen.strategy} ${rec.chosen.dir} score ${rec.chosen.score} (heuristic, not a probability)`,
  plan: { entry: rec.plan.entry, stop0: rec.plan.stop0, tp: [rec.plan.tp1, rec.plan.tp2, rec.plan.tp3], qty: rec.plan.originalQty, riskAmt: rec.plan.riskAmt },
  verification: r, scope: "entry decision reconstruction and outcome economics; the one-minute management path is NOT reproduced",
}, null, 2));
process.exit(r.exitCode);
