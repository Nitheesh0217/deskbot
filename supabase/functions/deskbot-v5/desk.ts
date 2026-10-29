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

// ─── Agentic desk flow (TradingAgents structure, Apache-2.0, TauricResearch/TradingAgents v0.7.1; adapted, not copied) ──────────
// 1 analysts (deterministic here: facts from the runner's own data, so they cost nothing and cannot hallucinate)
// 2 bull <-> bear debate (DEBATE_ROUNDS) -> 3 research manager rating -> 4 trader proposal
// 5 aggressive / conservative / neutral risk debate (RISK_ROUNDS) -> 6 portfolio manager final 5-tier rating, with lessons from past trades.
// LLM stages are optional (free providers via ai.ts), strictly validated, capped; a missing/failed provider changes nothing.
const BAD = /(\b\d{1,3}(\.\d+)?\s?%\s*(chance|probab|likel|odds|confiden))|(\b(will|should) (reach|hit|go to|rise to|fall to)\b)|(\btarget (price )?of\b)|https?:\/\//i;
const str = (x: unknown, max: number): string | null => (typeof x === "string" && x.trim().length > 0 && x.length <= max * 2 && !BAD.test(x) ? x.trim().slice(0, max) : null);
const list = (x: unknown, n: number, max: number): string[] | null => (Array.isArray(x) && x.length <= n * 2 ? (x.map((v) => str(v, max)).filter(Boolean).slice(0, n) as string[]) : null);
const RULES = "Use ONLY the facts in the JSON you are given (analyst reports, the rules' plan, checks, lessons, earlier notes). Do not invent numbers, news, prices or probabilities. Never state a chance, odds or a price target. You are advisory only on a PAPER account: you cannot trade, size or change anything. Reply with one JSON object and nothing else.";
export const RATINGS = ["Buy", "Overweight", "Hold", "Underweight", "Sell"] as const;
export type Rating = (typeof RATINGS)[number];
const rating = (x: unknown): Rating | null => (RATINGS as readonly string[]).includes(String(x)) ? (x as Rating) : null;
const speech = (x: any) => { const a = str(x?.argument, 420), p = str(x?.strongest_point, 160); return a && p ? { argument: a, strongest_point: p } : null; };
const SPEECH = `Schema: {"argument":"<=420 chars, answer the previous speaker directly","strongest_point":"<=160 chars"}`;
export const ROLES = {
  bull: { system: `You are the Bull Researcher. Argue FOR the bot's proposed trade, answering the bear's last point if there is one. ${RULES} ${SPEECH}`, validate: speech },
  bear: { system: `You are the Bear Researcher. Argue AGAINST the bot's proposed trade, answering the bull's last point. ${RULES} ${SPEECH}`, validate: speech },
  research: { system: `You are the Research Manager. Judge the bull/bear debate on evidence, not on who spoke last, and rate the instrument for the proposed horizon. ${RULES} Schema: {"rating":"Buy|Overweight|Hold|Underweight|Sell","rationale":"<=300 chars","stronger_side":"bull|bear|balanced"}`,
    validate: (x: any) => { const r = rating(x?.rating), t = str(x?.rationale, 300), s = ["bull", "bear", "balanced"].includes(x?.stronger_side) ? x.stronger_side as string : null; return r && t && s ? { rating: r, rationale: t, stronger_side: s } : null; } },
  trader: { system: `You are the Trader. Given the research manager's plan and the rules' entry, stop and targets, say whether executing this exact paper trade is sensible as planned. ${RULES} Schema: {"action":"take|pass","reason":"<=240 chars","execution_note":"<=160 chars"}`,
    validate: (x: any) => { const a = ["take", "pass"].includes(x?.action) ? x.action as string : null, r = str(x?.reason, 240), e = str(x?.execution_note, 160); return a && r && e ? { action: a, reason: r, execution_note: e } : null; } },
  aggressive: { system: `You are the Aggressive Risk Analyst. Defend taking the risk where the reward justifies it; answer the other risk analysts. ${RULES} ${SPEECH}`, validate: speech },
  conservative: { system: `You are the Conservative Risk Analyst. Protect capital: stress costs, stop placement, crowding and what can go wrong; answer the others. ${RULES} ${SPEECH}`, validate: speech },
  neutral: { system: `You are the Neutral Risk Analyst. Weigh both risk views and say where each overreaches. ${RULES} ${SPEECH}`, validate: speech },
  pm: { system: `You are the Portfolio Manager. Synthesise the risk debate, the trader's proposal and the lessons from past trades, then deliver the final rating for this instrument. Conflict alone is not a reason to Hold; Hold only when evidence is balanced or too thin. ${RULES} Schema: {"rating":"Buy|Overweight|Hold|Underweight|Sell","executive_summary":"<=240 chars","thesis":"<=300 chars","would_change_my_mind":"<=160 chars"}`,
    validate: (x: any) => { const r = rating(x?.rating), e = str(x?.executive_summary, 240), t = str(x?.thesis, 300), w = str(x?.would_change_my_mind, 160); return r && e && t && w ? { rating: r, executive_summary: e, thesis: t, would_change_my_mind: w } : null; } },
} as const;
export type RoleId = keyof typeof ROLES;

/** Map a 5-tier instrument rating onto the bot's proposed direction: keep, skip or abstain (Hold). */
export function ratingStance(r: Rating | null | undefined, dir: string): "keep" | "skip" | "abstain" {
  if (!r || r === "Hold") return "abstain";
  const bullish = r === "Buy" || r === "Overweight";
  return (dir === "long") === bullish ? "keep" : "skip";
}

export type AnalystInput = {
  price: number; regime: string; bias?: string | null; trend?: Record<string, number | null>; rsi15?: number; rsi1h?: number; chop15?: number; vwapDev?: number; atr15?: number;
  support?: { px: number; name: string } | null; resistance?: { px: number; name: string } | null;
  funding?: number | null; oi?: number | null; fng?: number | null; flow24?: number | null;
  newsRisk?: string | null; newsReason?: string | null; headlines?: string[];
};
/** Deterministic analyst team (TradingAgents' market / sentiment / news / fundamentals seats; for perps "fundamentals" becomes positioning). */
export function analystReports(a: AnalystInput) {
  const f = (x: number | null | undefined, d = 2) => (typeof x === "number" && Number.isFinite(x) ? +x.toFixed(d) : null);
  const tr = a.trend ?? {}, up = Object.values(tr).filter((v) => v === 1).length, dn = Object.values(tr).filter((v) => v === -1).length;
  return {
    market: { price: f(a.price, a.price > 1000 ? 0 : 2), regime: a.regime, bias: a.bias ?? null, supertrend_up_frames: up, supertrend_down_frames: dn, rsi15: f(a.rsi15, 1), rsi1h: f(a.rsi1h, 1), chop15: f(a.chop15, 1), vwap_dev_sigma: f(a.vwapDev, 2),
      nearest_support: a.support ? { px: f(a.support.px, 2), name: a.support.name } : null, nearest_resistance: a.resistance ? { px: f(a.resistance.px, 2), name: a.resistance.name } : null },
    sentiment: { fear_greed: a.fng ?? null, order_flow_24h_imbalance: f(a.flow24, 4) },
    positioning: { funding_per_interval: f(a.funding, 6), open_interest: f(a.oi, 0) },
    news: { risk: a.newsRisk ?? null, reason: a.newsReason ?? null, headlines: (a.headlines ?? []).slice(0, 5).map((h) => String(h).slice(0, 140)) },
  };
}

export type ReviewInput = {
  ref: string; sym: string; strategy: string; dir: string; plan: Plan & { tp2: number; tp3: number; riskAmt: number }; why: string[]; regime: string;
  chart: unknown; checks: Check[]; newsRisk?: string | null; analysts?: ReturnType<typeof analystReports>; lessons?: string[];
};
export type FlowOpts = { providers: Provider[]; usage: Usage; now: number; deadlineMs?: number; debateRounds?: number; riskRounds?: number; fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void> };
/** Runs the staged workflow. Never throws, never mutates its input, every stage and failure is returned as a row. */
export async function runDeskWorkflow(inp: ReviewInput, o: FlowOpts): Promise<{ rows: AgentRow[]; verdict: string | null; rating: Rating | null; stance: "keep" | "skip" | "abstain" }> {
  const rows: AgentRow[] = [], t0 = Date.now(), total = o.deadlineMs ?? 75_000;
  const facts = JSON.parse(JSON.stringify({ ref: inp.ref, instrument: inp.sym, strategy: inp.strategy, direction: inp.dir, regime: inp.regime, rules_said: inp.why.slice(0, 8), plan: inp.plan,
    analyst_reports: inp.analysts ?? null, chart: inp.chart, deterministic_checks: inp.checks, news_risk: inp.newsRisk ?? null, lessons_from_past_trades: (inp.lessons ?? []).slice(0, 6) }));
  rows.push({ agent: "desk-checks", input_summary: `${inp.ref} ${inp.dir} ${inp.strategy}`, output: { ref: inp.ref, authority: "advisory", checks: inp.checks } });
  if (inp.analysts) rows.push({ agent: "desk-analysts", input_summary: `${inp.ref} market/sentiment/positioning/news`, output: { ref: inp.ref, authority: "advisory", ...inp.analysts } });
  if (!o.providers.length) return { rows, verdict: null, rating: null, stance: "abstain" };
  const notes: { role: string; out: unknown }[] = [];
  const stage = async (role: RoleId, agent: string): Promise<any | null> => {
    const left = total - (Date.now() - t0);
    if (left < 2500) { rows.push({ agent, input_summary: inp.ref, output: { ref: inp.ref }, error: "workflow deadline reached" }); return null; }
    const r = await decideJSON(ROLES[role].system, JSON.stringify({ facts, debate_so_far: notes }), (x) => ROLES[role].validate(x) as unknown,
      { providers: o.providers, usage: o.usage, now: o.now, deadlineMs: Math.min(left, 9000), timeoutMs: 7000, maxTokens: 420, fetchImpl: o.fetchImpl, sleep: o.sleep });
    if ("errors" in r) { rows.push({ agent, input_summary: inp.ref, output: { ref: inp.ref }, error: r.errors.join("; ").slice(0, 200) }); return null; }
    notes.push({ role: agent.replace("desk-", ""), out: r.value });
    rows.push({ agent, input_summary: inp.ref, output: { ref: inp.ref, authority: "advisory", ...(r.value as object) }, provider: `${r.provider}/${r.model}`, ms: r.ms });
    return r.value;
  };
  const done = (pm: any | null) => {
    const rt = pm ? (pm.rating as Rating) : null, stance = ratingStance(rt, inp.dir);
    const last = rows[rows.length - 1];
    if (pm && last?.agent === "desk-pm") last.output = { ...last.output, direction: inp.dir, stance };   // the mapping FILTER-1 scores, stored with the rating
    return { rows, verdict: rt, rating: rt, stance };
  };
  for (let i = 0; i < Math.max(1, o.debateRounds ?? 1); i++) { if (!(await stage("bull", "desk-bull"))) return done(null); if (!(await stage("bear", "desk-bear"))) return done(null); }
  if (!(await stage("research", "desk-research"))) return done(null);
  if (!(await stage("trader", "desk-trader"))) return done(null);
  for (let i = 0; i < Math.max(1, o.riskRounds ?? 1); i++) for (const [role, agent] of [["aggressive", "desk-risk-aggressive"], ["conservative", "desk-risk-conservative"], ["neutral", "desk-risk-neutral"]] as const) if (!(await stage(role, agent))) return done(null);
  return done(await stage("pm", "desk-pm"));
}

/** Deterministic lessons from recent closed trades of the same strategy (newest first). Facts only, no interpretation. */
export function lessonsFrom(trades: { strategy?: string; dir?: string; r?: number | null; reason?: string | null; close_t?: string }[]): string[] {
  const ts = (Array.isArray(trades) ? trades : []).filter((t) => typeof t.r === "number" && Number.isFinite(t.r)).slice(0, 8);
  if (!ts.length) return [];
  const sum = ts.reduce((a, t) => a + (t.r as number), 0), wins = ts.filter((t) => (t.r as number) > 0).length;
  return [`last ${ts.length} closed ${ts[0].strategy ?? ""} trades: ${wins} won, total ${sum.toFixed(2)}R`,
    ...ts.slice(0, 5).map((t) => `${String(t.close_t ?? "").slice(0, 10)} ${t.dir ?? "?"}: ${(t.r as number).toFixed(2)}R (${String(t.reason ?? "closed").slice(0, 30)})`)];
}
