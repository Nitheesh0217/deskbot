// FILTER-1: does a review layer add information beyond the rules? Forward paper experiment, pre-registered in docs/research/FILTER_EXPERIMENT.md.
// Every entry the engine takes is executed as usual (baseline). Two shadow filters record, at entry time and before any outcome, whether they
// would have kept it: "rules" (deterministic pre-trade checks) and "ai" (the optional LLM committee judge). Nothing here can change a trade.
// Pure functions: no I/O. The report is mechanical; it reads verdicts and closed trades and applies the frozen decision rule.
import type { Check } from "./desk.ts";

export const FILTER_EXPERIMENT = {
  id: "FILTER-1",
  minForReading: 30,      // decided trades in an arm before any number is shown as more than a count
  minForDecision: 100,    // decided trades in an arm before the decision rule may return anything but INSUFFICIENT_DATA
  bootstrap: 2000, seed: 20261029,
} as const;

export type VerdictRow = { ref: string; arm: "rules" | "ai"; sym: string; strategy: string; take: boolean | null; verdict: string; detail: Record<string, unknown>; provider: string | null; ms: number | null };
type Row = { agent: string; output?: Record<string, unknown> | null; provider?: string | null; ms?: number | null; error?: string | null };

/** The two shadow decisions for one entry. rules: skip if any pre-trade check is a warning. ai: keep on "agree", skip on "disagree", abstain otherwise. */
export function verdictsFor(ref: string, sym: string, strategy: string, checks: Check[], workflowRows: Row[]): VerdictRow[] {
  const warns = checks.filter((c) => c.level === "warn").map((c) => c.id);
  const rules: VerdictRow = { ref, arm: "rules", sym, strategy, take: warns.length === 0, verdict: warns.length ? "skip" : "keep", detail: { warns }, provider: null, ms: null };
  const judge = workflowRows.find((r) => r.agent === "desk-judge");
  const llm = workflowRows.filter((r) => r.agent.startsWith("desk-") && r.agent !== "desk-checks" && r.agent !== "desk-postmortem");
  const v = judge && !judge.error ? String((judge.output ?? {}).verdict ?? "") : "";
  const ms = llm.reduce((a, r) => a + (r.ms ?? 0), 0);
  const ai: VerdictRow = {
    ref, arm: "ai", sym, strategy, take: v === "agree" ? true : v === "disagree" ? false : null,
    verdict: v || (llm.length ? "error" : "no_provider"),
    detail: { calls: llm.filter((r) => r.provider).length, errors: llm.filter((r) => r.error).map((r) => String(r.error).slice(0, 120)), reason: judge?.output?.reason ?? null },
    provider: judge?.provider ?? null, ms: ms || null,
  };
  return [rules, ai];
}

type Trade = { id: string; symbol?: string; strategy: string; r: number | string; net: number | string; close_t: string };
type Stored = VerdictRow & { recorded_at: string };
type Agg = { n: number; sumR: number; meanR: number | null; net: number };
const agg = (xs: Trade[]): Agg => { const n = xs.length, sumR = xs.reduce((a, t) => a + +t.r, 0), net = xs.reduce((a, t) => a + +t.net, 0); return { n, sumR: +sumR.toFixed(4), meanR: n ? +(sumR / n).toFixed(4) : null, net: +net.toFixed(2) }; };

// deterministic PRNG so the reported interval is reproducible from the same rows
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Percentile bootstrap of the mean of d. Trades are resampled individually; overlapping or clustered trades make this optimistic, which the report says. */
export function bootstrapMean(d: number[], iters: number = FILTER_EXPERIMENT.bootstrap, seed: number = FILTER_EXPERIMENT.seed): [number, number] | null {
  if (d.length < 2) return null; const r = rng(seed), means: number[] = [];
  for (let k = 0; k < iters; k++) { let s = 0; for (let i = 0; i < d.length; i++) s += d[Math.floor(r() * d.length)]; means.push(s / d.length); }
  means.sort((a, b) => a - b); return [+means[Math.floor(0.025 * iters)].toFixed(4), +means[Math.ceil(0.975 * iters) - 1].toFixed(4)];
}

export type ArmReport = {
  arm: "rules" | "ai"; decided: number; abstained: number; lateOrMissing: number; kept: Agg; skipped: Agg;
  // per decided trade: the R the filter would have changed. Skipping a trade removes its R, so d = -R for skipped trades and 0 for kept ones.
  // mean(d) > 0 means the skipped trades lost on average (the filter helped); < 0 means it threw away winners.
  meanDeltaR: number | null; ci95: [number, number] | null; result: "INSUFFICIENT_DATA" | "FILTER_HELPED" | "FILTER_HURT" | "NO_EVIDENCE_OF_DIFFERENCE";
  calls: number; ms: number;
};
export function filterReport(trades: Trade[], verdicts: Stored[]): { experiment: string; baseline: Agg; arms: ArmReport[]; caveats: string[] } {
  const byRef = new Map(trades.map((t) => [t.id, t]));
  const arms = (["rules", "ai"] as const).map((arm): ArmReport => {
    const vs = verdicts.filter((v) => v.arm === arm);
    let abstained = 0, late = 0, calls = 0, ms = 0; const kept: Trade[] = [], skipped: Trade[] = [];
    for (const v of vs) {
      calls += Number((v.detail as { calls?: number })?.calls ?? 0); ms += v.ms ?? 0;
      const t = byRef.get(v.ref); if (!t) continue;   // still open: no outcome yet
      if (!(Date.parse(v.recorded_at) < Date.parse(t.close_t))) { late++; continue; }   // a verdict recorded after the outcome does not count
      if (v.take === null) { abstained++; continue; }
      (v.take ? kept : skipped).push(t);
    }
    const decided = kept.length + skipped.length, d = [...kept.map(() => 0), ...skipped.map((t) => -+t.r)];
    const meanDeltaR = decided ? +(d.reduce((a, x) => a + x, 0) / decided).toFixed(4) : null;
    const ci95 = decided >= FILTER_EXPERIMENT.minForReading ? bootstrapMean(d) : null;
    const result = decided < FILTER_EXPERIMENT.minForDecision || !ci95 ? "INSUFFICIENT_DATA" : ci95[0] > 0 ? "FILTER_HELPED" : ci95[1] < 0 ? "FILTER_HURT" : "NO_EVIDENCE_OF_DIFFERENCE";
    return { arm, decided, abstained, lateOrMissing: late, kept: agg(kept), skipped: agg(skipped), meanDeltaR: decided >= FILTER_EXPERIMENT.minForReading ? meanDeltaR : null, ci95, result, calls, ms };
  });
  const inExp = new Set(verdicts.map((v) => v.ref));
  return {
    experiment: FILTER_EXPERIMENT.id, baseline: agg(trades.filter((t) => inExp.has(t.id))), arms,
    caveats: [
      "Paper fills at modeled costs; PAPER only.",
      "Trades are resampled individually; clustered or overlapping trades make the interval too narrow.",
      "A difference is not trading skill until decision provenance and venue/candle replay discrepancies are resolved (T007).",
      "AI operating cost: calls and latency are counted; free-tier providers bill $0, so dollar cost is not separately recorded.",
    ],
  };
}
