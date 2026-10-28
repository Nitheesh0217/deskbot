// Replays one recorded paper decision from its stored inputs and reconciles its closed trade (if any). Read-only, no network.
//   npx tsx scripts/replay_decision.ts bundle.json
// bundle.json = { decision: {id, record, record_sha256}, inputs: [{tf, source, bars, bars_sha256}], trade?: <dbv5_trades.data> , positionOpen?: true }
// Exit 0 = fully reproduced and reconciled, 1 = at least one disagreement (all are printed), 2 = bad input.
import { readFileSync } from "node:fs";
import { replayDecision, reconcileOutcome } from "../supabase/functions/deskbot-v5/provenance.ts";
import { BUILD } from "../supabase/functions/deskbot-v5/build_info.ts";

const file = process.argv[2]; if (!file) { console.error("usage: replay_decision.ts bundle.json"); process.exit(2); }
const b = JSON.parse(readFileSync(file, "utf8"));
const rec = b.decision?.record; if (!rec || !Array.isArray(b.inputs)) { console.error("bundle needs decision.record and inputs[]"); process.exit(2); }
const rows = b.inputs.map((r: any) => ({ tf: r.tf, source: r.source, bars: r.bars, barsSha256: r.bars_sha256 ?? r.barsSha256 }));
const replay = await replayDecision(rec, rows, b.decision.record_sha256);
const outcome = b.trade ? reconcileOutcome(rec, b.trade) : null;
const report = {
  decisionId: rec.decisionId, sym: rec.sym, decidedAt: rec.decidedAt, instrument: rec.instrument.nativeSymbol, mode: rec.mode,
  recordedBuildSourceSha256: rec.build.sourceSha256, currentCheckoutSourceSha256: BUILD.sourceSha256, sameSourceAsRecorded: rec.build.sourceSha256 === BUILD.sourceSha256,
  governance: rec.governance, chosen: `${rec.chosen.strategy} ${rec.chosen.dir} score ${rec.chosen.score} (heuristic, not a probability)`,
  plan: { entry: rec.plan.entry, stop0: rec.plan.stop0, tp: [rec.plan.tp1, rec.plan.tp2, rec.plan.tp3], qty: rec.plan.originalQty, riskAmt: rec.plan.riskAmt },
  replay: { reproduced: replay.reproduced, disagreements: replay.diffs },
  outcome: outcome === null ? (b.positionOpen ? "position still open" : "no closed trade supplied") : { reconciled: outcome.length === 0, disagreements: outcome, net: b.trade.net, r: b.trade.r, fees: b.trade.fees, funding: b.trade.funding },
};
console.log(JSON.stringify(report, null, 2));
process.exit(replay.reproduced && (outcome === null || outcome.length === 0) ? 0 : 1);
