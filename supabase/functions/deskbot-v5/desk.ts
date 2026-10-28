// DeskBot desk review layer: a TradingAgents-style role workflow plus deterministic pre-trade checks and post-trade review.
// ADVISORY ONLY. Nothing in this file can open, size, block, move or close a trade, change configuration, or touch risk limits.
// The existing deterministic gates (entryGates, regime gate, circuit breaker, daily limits) remain the only authority over entries.
// LLM stages are optional (free providers via ai.ts), strictly validated, capped, logged, and a missing/failed provider changes nothing.
// Method sources (patterns, not code): execution-plan-check and post-trade-review (marian2js, MIT), day-trader-skill risk/exit/budget ideas
// (Jakeschincariol, MIT), TradingAgents analyst -> bull/bear -> risk -> decision staging (TauricResearch, Apache-2.0). See docs/AGENT_WORKFLOWS.md.
import { decideJSON, type Provider, type Usage, type FetchLike } from "./ai.ts";
import type { AgentRow } from "./agents.ts";

export type Check = { id: string; level: "info" | "warn"; text: string; value?: number };
export type Plan = { dir: "long" | "short"; entry: number; stop0: number; tp1: number; maxHoldH: number; strategy: string };
export type CheckInput = {
  plan: Plan; atr15: number; hour: number; funding: number | null; costs: { taker: number; slippage: number }; newsRisk?: string | null;
  levels?: { px: number; name: string; side: "support" | "resistance"; blocks: boolean }[];
};

/** Deterministic checks (execution-plan-check pattern). Information for the reviewer; none of them blocks anything. */
export function preTradeChecks(a: CheckInput): Check[] {
  const p = a.plan, R = Math.abs(p.entry - p.stop0), out: Check[] = [];
  if (!(R > 0)) return [{ id: "plan", level: "warn", text: "Plan has no stop distance" }];
  const costR = (p.entry * (2 * a.costs.taker + 2 * a.costs.slippage)) / R;
  out.push({ id: "round_trip_cost", level: costR > 0.25 ? "warn" : "info", value: +costR.toFixed(3), text: `Modeled round-trip fees+slippage are ${costR.toFixed(2)}R of the stop distance${costR > 0.25 ? " (a large share of what a stop-out costs and of what a first target earns)" : ""}` });
  const stopAtr = R / a.atr15;
  if (stopAtr < 0.5) out.push({ id: "stop_inside_noise", level: "warn", value: +stopAtr.toFixed(2), text: `Stop is ${stopAtr.toFixed(2)}x the 15m ATR: inside normal candle noise` });
  else if (stopAtr > 3) out.push({ id: "stop_wide", level: "info", value: +stopAtr.toFixed(2), text: `Stop is ${stopAtr.toFixed(2)}x the 15m ATR: wide` });
  const rr1 = Math.abs(p.tp1 - p.entry) / R; if (rr1 < 1) out.push({ id: "tp1_under_1r", level: "warn", value: +rr1.toFixed(2), text: `First target is only ${rr1.toFixed(2)}R away` });
  if (a.hour >= 0 && a.hour < 7) out.push({ id: "thin_session", level: "info", text: "Entry during 00:00-06:59 UTC, the thin session" });
  if (a.funding != null) {
    const pays = (p.dir === "long" && a.funding > 0) || (p.dir === "short" && a.funding < 0), driftR = pays ? (Math.abs(a.funding) * p.maxHoldH * p.entry) / R : 0;
    if (driftR > 0.1) out.push({ id: "funding_drag", level: "warn", value: +driftR.toFixed(2), text: `Holding the full ${p.maxHoldH}h at the current funding would cost about ${driftR.toFixed(2)}R` });
  }
  if (a.newsRisk === "HIGH") out.push({ id: "news_high", level: "warn", text: "News layer reports HIGH risk" }); else if (a.newsRisk === "MEDIUM") out.push({ id: "news_medium", level: "info", text: "News layer reports MEDIUM risk" });
  if (a.levels) {
    const d = p.dir === "long" ? 1 : -1, opp = a.levels.filter((l) => l.blocks && (l.px - p.entry) * d > 0).sort((x, y) => Math.abs(x.px - p.entry) - Math.abs(y.px - p.entry))[0];
    if (opp) { const room = Math.abs(opp.px - p.entry) / R; if (room < 1) out.push({ id: "room_to_opposing_level", level: "warn", value: +room.toFixed(2), text: `Nearest opposing level (${opp.name}) is ${room.toFixed(2)}R away, closer than 1R` }); }
  }
  return out;
}

export type ClosedTrade = { id: string; strategy: string; dir: string; gross: number; fees: number; funding: number; net: number; r: number; openT: number; closeT: number; reason: string; exits: { kind: string }[]; why?: string[] };
/** Deterministic post-trade review (post-trade-review pattern): facts and process flags only. The outcome alone never grades the decision. */
export function postTradeReview(t: ClosedTrade) {
  const holdMin = Math.round((t.closeT - t.openT) / 60_000), kinds = t.exits.map((e) => e.kind), flags: string[] = [];
  if (kinds.length === 1 && kinds[0] === "stop" && holdMin <= 30) flags.push("stopped_within_30_min");
  if (kinds[0] === "tp1" && t.r <= 0.05) flags.push("gave_back_after_first_target");
  const costs = t.fees + Math.max(0, t.funding); if (t.gross > 0 && costs / t.gross > 0.5) flags.push("costs_over_half_of_gross"); if (t.gross <= 0) flags.push("lost_before_costs");
  if (t.gross > 0 && t.net <= 0) flags.push("won_before_costs_lost_after");
  return { id: t.id, strategy: t.strategy, dir: t.dir, holdMin, path: kinds.join(">"), r: +t.r.toFixed(3), net: +t.net.toFixed(2), gross: +t.gross.toFixed(2), costs: +costs.toFixed(2), flags,
    separation: { recordedThesis: (t.why ?? []).slice(0, 4), execution: `fees ${t.fees.toFixed(2)} + funding ${t.funding.toFixed(2)} against gross ${t.gross.toFixed(2)}`, outcome: `${t.r >= 0 ? "+" : ""}${t.r.toFixed(2)}R after costs` }, note: "Descriptive. One outcome does not show the decision was good or bad." };
}

// ─── LLM roles (all optional, shadow) ────────────────────────────────────────────────────────────
const BAD = /(\b\d{1,3}(\.\d+)?\s?%\s*(chance|probab|likel|odds|confiden))|(\b(will|should) (reach|hit|go to|rise to|fall to)\b)|(\btarget (price )?of\b)|https?:\/\//i;
const str = (x: unknown, max: number): string | null => (typeof x === "string" && x.trim().length > 0 && x.length <= max * 2 && !BAD.test(x) ? x.trim().slice(0, max) : null);
const list = (x: unknown, n: number, max: number): string[] | null => (Array.isArray(x) && x.length <= n * 2 ? (x.map((v) => str(v, max)).filter(Boolean).slice(0, n) as string[]) : null);
const RULES = "Use ONLY the facts in the JSON you are given. Do not invent numbers, news, prices or probabilities. Never state a chance, odds or a price target. You are advisory only: you cannot trade, size or change anything. Reply with one JSON object and nothing else.";
export const ROLES = {
  analyst: { system: `You are the desk analyst for a PAPER trading bot. Summarise what the rules saw and the main risks. ${RULES} Schema: {"summary":"<=300 chars","key_facts":["<=5 items"],"risks":["<=4 items"]}`,
    validate: (x: any) => { const s = str(x?.summary, 300), k = list(x?.key_facts, 5, 140), r = list(x?.risks, 4, 140); return s && k && r ? { summary: s, key_facts: k, risks: r } : null; } },
  bear: { system: `You are the skeptical researcher. Make the strongest case AGAINST this trade using only the given facts. ${RULES} Schema: {"case":"<=300 chars","strongest_point":"<=160 chars"}`,
    validate: (x: any) => { const c = str(x?.case, 300), p = str(x?.strongest_point, 160); return c && p ? { case: c, strongest_point: p } : null; } },
  bull: { system: `You are the supportive researcher. Make the strongest case FOR this trade using only the given facts. ${RULES} Schema: {"case":"<=300 chars","strongest_point":"<=160 chars"}`,
    validate: (x: any) => { const c = str(x?.case, 300), p = str(x?.strongest_point, 160); return c && p ? { case: c, strongest_point: p } : null; } },
  judge: { system: `You are the risk reviewer. Weigh the analyst, bear and bull notes and the deterministic checks. Say whether the plan is agreeable, not agreeable, or unclear. ${RULES} Schema: {"verdict":"agree|disagree|unsure","reason":"<=200 chars","concerns":["<=3 items"],"would_change_my_mind":"<=160 chars"}`,
    validate: (x: any) => { const v = ["agree", "disagree", "unsure"].includes(x?.verdict) ? (x.verdict as "agree" | "disagree" | "unsure") : null, r = str(x?.reason, 200), c = list(x?.concerns, 3, 140), w = str(x?.would_change_my_mind, 160); return v && r && c && w ? { verdict: v, reason: r, concerns: c, would_change_my_mind: w } : null; } },
} as const;

export type ReviewInput = {
  ref: string; sym: string; strategy: string; dir: string; plan: Plan & { tp2: number; tp3: number; riskAmt: number }; why: string[]; regime: string;
  chart: unknown; checks: Check[]; newsRisk?: string | null;
};
/** Runs the staged workflow. Never throws, never mutates its input, every stage and failure is returned as a row. */
export async function runDeskWorkflow(inp: ReviewInput, o: { providers: Provider[]; usage: Usage; now: number; deadlineMs?: number; fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void> }): Promise<{ rows: AgentRow[]; verdict: string | null }> {
  const rows: AgentRow[] = [], t0 = Date.now(), total = o.deadlineMs ?? 24_000, facts = JSON.parse(JSON.stringify({ ref: inp.ref, instrument: inp.sym, strategy: inp.strategy, direction: inp.dir, regime: inp.regime, rules_said: inp.why.slice(0, 8), plan: inp.plan, chart: inp.chart, deterministic_checks: inp.checks, news_risk: inp.newsRisk ?? null }));
  rows.push({ agent: "desk-checks", input_summary: `${inp.ref} ${inp.dir} ${inp.strategy}`, output: { ref: inp.ref, authority: "advisory", checks: inp.checks } });
  if (!o.providers.length) return { rows, verdict: null };
  const notes: Record<string, unknown> = {};
  for (const role of ["analyst", "bear", "bull", "judge"] as const) {
    const left = total - (Date.now() - t0); if (left < 2500) { rows.push({ agent: `desk-${role}`, input_summary: inp.ref, output: { ref: inp.ref }, error: "workflow deadline reached" }); break; }
    const r = await decideJSON(ROLES[role].system, JSON.stringify({ facts, notes }), (x) => ROLES[role].validate(x) as unknown, { providers: o.providers, usage: o.usage, now: o.now, deadlineMs: Math.min(left, 9000), timeoutMs: 7000, maxTokens: 380, fetchImpl: o.fetchImpl, sleep: o.sleep });
    if ("errors" in r) { rows.push({ agent: `desk-${role}`, input_summary: inp.ref, output: { ref: inp.ref }, error: r.errors.join("; ").slice(0, 200) }); break; }
    notes[role] = r.value; rows.push({ agent: `desk-${role}`, input_summary: inp.ref, output: { ref: inp.ref, authority: "advisory", ...(r.value as object) }, provider: `${r.provider}/${r.model}`, ms: r.ms });
  }
  const j = notes.judge as { verdict: string } | undefined;
  return { rows, verdict: j?.verdict ?? null };
}
