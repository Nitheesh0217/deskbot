import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preTradeChecks, postTradeReview, runDeskWorkflow, ROLES, analystReports, lessonsFrom, ratingStance, type ReviewInput } from "../supabase/functions/deskbot-v5/desk.ts";
import type { Provider } from "../supabase/functions/deskbot-v5/ai.ts";

const base = { plan: { dir: "long" as const, entry: 100, stop0: 99, tp1: 101.5, maxHoldH: 16, strategy: "SWEEP_REV" }, atr15: 1, hour: 12, funding: 0, costs: { taker: 0.00045, slippage: 0.0002 } };
const ids = (c: { id: string }[]) => c.map((x) => x.id);

test("pre-trade checks are deterministic facts; each fires on its own condition; none is a veto", () => {
  assert.deepEqual(ids(preTradeChecks(base)), ["round_trip_cost"]);                       // a normal plan: cost shown as information
  const thin = preTradeChecks({ ...base, plan: { ...base.plan, stop0: 99.9, entry: 100 }, atr15: 1 });
  assert.ok(ids(thin).includes("stop_inside_noise") && thin.find((c) => c.id === "round_trip_cost")!.level === "warn", "tiny stop: inside noise and cost-heavy");
  assert.ok(ids(preTradeChecks({ ...base, atr15: 0.2 })).includes("stop_wide"));
  assert.ok(ids(preTradeChecks({ ...base, plan: { ...base.plan, tp1: 100.5 } })).includes("tp1_under_1r"));
  assert.ok(ids(preTradeChecks({ ...base, hour: 3 })).includes("thin_session"));
  assert.ok(ids(preTradeChecks({ ...base, funding: 0.0001 })).includes("funding_drag"), "long paying funding for 16h");
  assert.ok(!ids(preTradeChecks({ ...base, funding: -0.0001 })).includes("funding_drag"), "long RECEIVING funding is not a drag");
  assert.ok(ids(preTradeChecks({ ...base, newsRisk: "HIGH" })).includes("news_high"));
  const lv = [{ px: 100.6, name: "Asian high", side: "resistance" as const, blocks: true }, { px: 103, name: "far", side: "resistance" as const, blocks: true }, { px: 99.5, name: "support", side: "support" as const, blocks: true }];
  const room = preTradeChecks({ ...base, levels: lv }).find((c) => c.id === "room_to_opposing_level")!; assert.equal(room.value, 0.6);
  assert.equal(preTradeChecks({ ...base, plan: { ...base.plan, stop0: 100 } })[0].id, "plan", "degenerate plan is reported, not divided by zero");
  for (const c of preTradeChecks({ ...base, hour: 3, funding: 0.0001, newsRisk: "HIGH", levels: lv })) assert.ok(["info", "warn"].includes(c.level), "levels are only info or warn, never block");
});

test("post-trade review separates thesis, execution and outcome and flags process facts, not blame", () => {
  const t = { id: "V5-1", strategy: "SWEEP_REV", dir: "long", gross: 2, fees: 1.4, funding: 0.2, net: 0.4, r: 0.02, openT: 0, closeT: 20 * 60_000, reason: "TP1→STOP", exits: [{ kind: "tp1" }, { kind: "stop" }], why: ["Swept 20-bar low"] };
  const r = postTradeReview(t); assert.ok(r.flags.includes("gave_back_after_first_target") && r.flags.includes("costs_over_half_of_gross"));
  assert.deepEqual(postTradeReview({ ...t, gross: -3, net: -4.6, r: -1, exits: [{ kind: "stop" }], reason: "STOP" }).flags.sort(), ["lost_before_costs", "stopped_within_30_min"]);
  assert.ok(postTradeReview({ ...t, gross: 1, fees: 1.5, net: -0.7, r: -0.1 }).flags.includes("won_before_costs_lost_after"));
  assert.match(r.separation.outcome, /after costs/); assert.deepEqual(r.separation.recordedThesis, ["Swept 20-bar low"]); assert.match(r.note, /does not show/);
});

const provider: Provider = { name: "groq", url: "https://llm.test/v1/chat", model: "m", key: "k", dailyCap: 100 };
const input = (): ReviewInput => ({ ref: "V5-1", sym: "BTC", strategy: "SWEEP_REV", dir: "long", regime: "RANGE", why: ["Swept 20-bar low"], newsRisk: "LOW", chart: { bias: "mixed" }, checks: preTradeChecks(base), plan: { ...base.plan, tp2: 103, tp3: 104, riskAmt: 7 } });
const sp = (a: string, p: string) => ({ argument: a, strongest_point: p });
const good: Record<string, unknown> = {
  bull: sp("Clean sweep of the 20-bar low with a rejection wick near support.", "rejection wick"),
  bear: sp("Costs are a large share of the stop distance and the regime is a range.", "cost share"),
  research: { rating: "Overweight", rationale: "Setup is clean; cost share is the main weakness.", stronger_side: "bull" },
  trader: { action: "take", reason: "Plan matches the rules and stop sits beyond the swept low.", execution_note: "Market entry already filled." },
  aggressive: sp("Reward to TP1 covers costs; the sweep is the edge.", "TP1 over 1R"),
  conservative: sp("Range regime and cost share argue for caution.", "cost share"),
  neutral: sp("Both views hold; size is already capped by the rules.", "rules cap size"),
  pm: { rating: "Overweight", executive_summary: "Keep the paper trade as planned.", thesis: "Sweep with rejection; costs acknowledged.", would_change_my_mind: "A high-impact news event." },
};
const ORDER = ["bull", "bear", "research", "trader", "aggressive", "conservative", "neutral", "pm"] as const;
const roleOf = (sys: string) => ORDER.find((r) => sys.includes(ROLES[r].system.slice(0, 40)))!;
function mockFetch(over: Partial<Record<string, unknown>> = {}, status = 200) {
  const seen: { role: string; user: any }[] = [];
  const f = async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body)), role = roleOf(b.messages[0].content); seen.push({ role, user: JSON.parse(b.messages[1].content) });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(over[role] ?? good[role]) } }] }), { status });
  };
  return { f: f as never, seen };
}
const deepFreeze = <T,>(o: T): T => { if (o && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); } return o; };
const AGENTS = ["desk-checks", "desk-analysts", "desk-bull", "desk-bear", "desk-research", "desk-trader", "desk-risk-aggressive", "desk-risk-conservative", "desk-risk-neutral", "desk-pm"];

test("agentic flow: analysts, bull/bear debate, research manager, trader, three-way risk debate, portfolio manager; each stage sees the earlier ones", async () => {
  const m = mockFetch(), inp = deepFreeze({ ...input(), analysts: analystReports({ price: 100, regime: "RANGE", trend: { "15m": 1, "1h": -1 }, rsi15: 41.234 }), lessons: ["last 2 closed SWEEP_REV trades: 1 won, total 0.50R"] }), usage = {};
  const r = await runDeskWorkflow(inp, { providers: [provider], usage, now: Date.now(), fetchImpl: m.f });
  assert.deepEqual(r.rows.map((x) => x.agent), AGENTS); assert.equal(r.rating, "Overweight"); assert.equal(r.stance, "keep");
  assert.deepEqual(m.seen.map((s) => s.role), [...ORDER]);
  assert.deepEqual(m.seen[7].user.debate_so_far.map((n: any) => n.role), ["bull", "bear", "research", "trader", "risk-aggressive", "risk-conservative", "risk-neutral"], "the PM sees the whole debate");
  assert.equal(m.seen[0].user.facts.analyst_reports.market.rsi15, 41.2); assert.deepEqual(m.seen[0].user.facts.lessons_from_past_trades, inp.lessons);
  const pm = r.rows.at(-1)!.output as any; assert.equal(pm.stance, "keep"); assert.equal(pm.direction, "long");
  assert.ok(r.rows.every((x) => !x.error) && r.rows.every((x) => (x.output as any).authority === "advisory" && (x.output as any).ref === "V5-1"));
  assert.equal((usage as any).groq.calls, 8, "eight counted provider calls");
  const two = mockFetch(); await runDeskWorkflow(input(), { providers: [provider], usage: {}, now: Date.now(), fetchImpl: two.f, debateRounds: 2, riskRounds: 2 }); assert.equal(two.seen.length, 4 + 2 + 6 + 1, "debate and risk rounds repeat their speakers");
});

test("rating maps onto direction: long Buy/Overweight keep, short Underweight/Sell keep, Hold or nothing abstains", () => {
  assert.equal(ratingStance("Buy", "long"), "keep"); assert.equal(ratingStance("Sell", "long"), "skip"); assert.equal(ratingStance("Underweight", "short"), "keep");
  assert.equal(ratingStance("Overweight", "short"), "skip"); assert.equal(ratingStance("Hold", "long"), "abstain"); assert.equal(ratingStance(null, "short"), "abstain");
});

test("memory lessons are facts from closed trades only", () => {
  assert.deepEqual(lessonsFrom([]), []);
  const l = lessonsFrom([{ strategy: "S", dir: "long", r: 1.5, reason: "TP1→TP2", close_t: "2026-10-28T10:00:00Z" }, { strategy: "S", dir: "short", r: -1, reason: "STOP", close_t: "2026-10-27T10:00:00Z" }, { strategy: "S", r: null }]);
  assert.equal(l[0], "last 2 closed S trades: 1 won, total 0.50R"); assert.equal(l[2], "2026-10-27 short: -1.00R (STOP)");
});

test("workflow: no provider means only deterministic rows; failures stop the chain and are recorded, never thrown", async () => {
  const none = await runDeskWorkflow({ ...input(), analysts: analystReports({ price: 1, regime: "TREND" }) }, { providers: [], usage: {}, now: Date.now() });
  assert.deepEqual(none.rows.map((x) => x.agent), ["desk-checks", "desk-analysts"]); assert.equal(none.verdict, null); assert.equal(none.stance, "abstain");
  const down = mockFetch({}, 500), r = await runDeskWorkflow(input(), { providers: [provider], usage: {}, now: Date.now(), fetchImpl: down.f, sleep: async () => {} });
  assert.equal(r.verdict, null); assert.ok(r.rows[1].agent === "desk-bull" && r.rows[1].error, "stage failure recorded"); assert.equal(r.rows.length, 2, "chain stops after the first failure");
  const auth = mockFetch({}, 401); const a = await runDeskWorkflow(input(), { providers: [provider], usage: {}, now: Date.now(), fetchImpl: auth.f }); assert.match(a.rows[1].error!, /401/);
});

test("workflow: output that states a probability, a price target, a URL or breaks the schema is rejected", async () => {
  for (const bad of [
    { pm: { ...(good.pm as object), thesis: "There is a 70% chance this works." } },
    { pm: { ...(good.pm as object), thesis: "Price will reach 90000 soon." } },
    { pm: { ...(good.pm as object), thesis: "See https://x.example for more" } },
    { pm: { ...(good.pm as object), rating: "Strong Buy" } },
    { pm: { rating: "Buy" } },
  ]) { const m = mockFetch(bad), r = await runDeskWorkflow(input(), { providers: [provider], usage: {}, now: Date.now(), fetchImpl: m.f }); assert.equal(r.verdict, null, JSON.stringify(bad).slice(0, 60)); assert.match(r.rows.at(-1)!.error!, /invalid output/); assert.equal(r.rows.at(-1)!.agent, "desk-pm"); }
  const t = mockFetch({ trader: { action: "buy", reason: "x", execution_note: "y" } }), rt = await runDeskWorkflow(input(), { providers: [provider], usage: {}, now: Date.now(), fetchImpl: t.f }); assert.equal(rt.rows.at(-1)!.agent, "desk-trader");
});

test("workflow: respects the total deadline and the provider daily cap", async () => {
  const m = mockFetch(); const slowUsage = { groq: { day: new Date().toISOString().slice(0, 10), calls: 100, fails: 0, coolUntil: 0 } };
  const capped = await runDeskWorkflow(input(), { providers: [provider], usage: slowUsage, now: Date.now(), fetchImpl: m.f }); assert.equal(m.seen.length, 0, "no call past the daily cap"); assert.match(capped.rows[1].error!, /daily cap/);
  const dl = await runDeskWorkflow(input(), { providers: [provider], usage: {}, now: Date.now(), fetchImpl: mockFetch().f, deadlineMs: 2000 }); assert.match(dl.rows[1].error!, /deadline/);
});

test("authority: the desk module imports nothing that can trade, and the run loop uses its output only as log rows", () => {
  const src = readFileSync(new URL("../supabase/functions/deskbot-v5/desk.ts", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^import .* from "(.+)";/gm)].map((m) => m[1]); assert.deepEqual(imports, ["./ai.ts", "./agents.ts"]);
  assert.ok(!/engine\.ts/.test(src), "no engine import: it cannot call openPosition, entryGates, managePosition or change CFG");
  const idx = readFileSync(new URL("../supabase/functions/deskbot-v5/index.ts", import.meta.url), "utf8");
  // the only use of a verdict is one append-only shadow record (FILTER-1); remove that exact line and nothing else may mention it
  const shadow = 'try { await insert("dbv5_filter_verdicts", verdictsFor(p.id, sym, p.strategy, checks, wf.rows)); }';
  assert.equal(idx.split(shadow).length, 2, "exactly one shadow-verdict write");
  const block = idx.slice(idx.indexOf("Desk review layer"), idx.indexOf("Desk review layer") + 2900).replace(/^.*dbv5_filter_verdicts.*$/m, "").replace(/^.*FILTER-1 shadow verdicts.*$/m, "");
  assert.ok(!/wf\.verdict/.test(idx) && !/verdict/.test(block), "the verdict is never read by trading logic");
  const exp = readFileSync(new URL("../supabase/functions/deskbot-v5/experiment.ts", import.meta.url), "utf8");
  assert.deepEqual([...exp.matchAll(/^import (.*) from "(.+)";/gm)].map((m) => [m[1].startsWith("type "), m[2]]), [[true, "./desk.ts"]], "experiment.ts imports types only");
  assert.ok(idx.indexOf("await events(evs)") < idx.indexOf("runDeskWorkflow("), "state and ledger are saved before any LLM call");
});
