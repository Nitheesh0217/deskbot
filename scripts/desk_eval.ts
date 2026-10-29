// Measures whether the desk review's verdicts carry information about outcomes. Prospective, descriptive, never an authority.
//   npx tsx scripts/desk_eval.ts export.json     export = { rows: dbv5_agent_log rows (agent, output), trades: [{ id, r, net, strategy }] }
// Joins each desk-judge (or desk-pm) row to its closed trade by `output.ref` (the position id). Reports per verdict: n, mean R, win rate, net R, worst R, and the
// disagree-minus-agree difference in mean R with an iid bootstrap interval (trades are not independent, so treat it as optimistic).
import { readFileSync } from "node:fs";
type Row = { agent: string; output?: { ref?: string; verdict?: string; stance?: string } };
// desk-pm (agentic flow, v20+) records a direction-mapped stance; it maps onto the old judge verdicts so both eras are read the same way.
const PM: Record<string, string> = { keep: "agree", skip: "disagree", abstain: "unsure" }; type Tr = { id: string; r: number; net: number; strategy?: string };
export function evaluate(rows: Row[], trades: Tr[], seed = 20261029) {
  const byId = new Map(trades.map((t) => [t.id, t])), groups: Record<string, Tr[]> = { agree: [], disagree: [], unsure: [] }; let pending = 0;
  for (const r of rows) { const v = r.agent === "desk-judge" ? r.output?.verdict : r.agent === "desk-pm" ? PM[r.output?.stance ?? ""] : undefined; if (v && r.output?.ref) { const t = byId.get(r.output.ref); if (t) groups[v]?.push(t); else pending++; } }
  const stat = (g: Tr[]) => ({ n: g.length, meanR: g.length ? +(g.reduce((a, t) => a + t.r, 0) / g.length).toFixed(3) : null, winRate: g.length ? +(g.filter((t) => t.net > 0).length / g.length).toFixed(3) : null, netR: +g.reduce((a, t) => a + t.r, 0).toFixed(2), worstR: g.length ? +Math.min(...g.map((t) => t.r)).toFixed(2) : null });
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const a = groups.agree.map((t) => t.r), d = groups.disagree.map((t) => t.r); let diff: { diff: number; lo: number; hi: number } | null = null;
  if (a.length >= 5 && d.length >= 5) { const bs: number[] = []; for (let k = 0; k < 5000; k++) { let x = 0, y = 0; for (let i = 0; i < a.length; i++) x += a[Math.floor(rnd() * a.length)]; for (let i = 0; i < d.length; i++) y += d[Math.floor(rnd() * d.length)]; bs.push(y / d.length - x / a.length); } bs.sort((p, q) => p - q); diff = { diff: +(d.reduce((p, q) => p + q, 0) / d.length - a.reduce((p, q) => p + q, 0) / a.length).toFixed(3), lo: +bs[Math.floor(0.025 * 5000)].toFixed(3), hi: +bs[Math.floor(0.975 * 5000)].toFixed(3) }; }
  const sd = Math.sqrt([...a, ...d].reduce((p, q, _, all) => p + (q - all.reduce((m, v) => m + v, 0) / all.length) ** 2, 0) / Math.max(1, a.length + d.length - 1)) || 1, need = Math.ceil(2 * ((2.8 * sd) / 0.3) ** 2);
  return { perVerdict: { agree: stat(groups.agree), disagree: stat(groups.disagree), unsure: stat(groups.unsure) }, disagreeMinusAgreeMeanR: diff, judgedWithoutClosedTrade: pending,
    power: `to detect a 0.3R difference in mean R (sd about ${sd.toFixed(2)}R, 80% power) each arm needs about ${need} closed trades; there are ${groups.agree.length} agree and ${groups.disagree.length} disagree`,
    status: groups.agree.length >= need && groups.disagree.length >= need ? "ENOUGH_TO_TEST_A_SPECIFIC_FROZEN_HYPOTHESIS" : "INSUFFICIENT_EVIDENCE: no conclusion, no promotion", note: "Prospective and descriptive. A verdict can only ever become a risk-reducing skip after a frozen paired test; it can never raise size." };
}
if (process.argv[2] && import.meta.url === `file://${process.argv[1]}`) { const j = JSON.parse(readFileSync(process.argv[2], "utf8")); console.log(JSON.stringify(evaluate(j.rows, j.trades), null, 1)); }
