import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preTradeChecks, postTradeReview, runDeskWorkflow, ROLES, type ReviewInput } from "../supabase/functions/deskbot-v5/desk.ts";
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
const good: Record<string, unknown> = {
  analyst: { summary: "Sweep of the 20-bar low with a rejection wick in a range regime.", key_facts: ["swept low", "range regime"], risks: ["cost share"] },
  bear: { case: "Costs are a large share of the stop distance and the regime is a range.", strongest_point: "cost share" },
  bull: { case: "Clean sweep with rejection and nearby support.", strongest_point: "rejection wick" },
  judge: { verdict: "agree", reason: "Rules satisfied; costs noted.", concerns: ["cost share"], would_change_my_mind: "A high-impact news event." },
};
const roleOf = (sys: string) => (["analyst", "bear", "bull", "judge"] as const).find((r) => sys.includes(ROLES[r].system.slice(0, 40)))!;
function mockFetch(over: Partial<Record<string, unknown>> = {}, status = 200) {
  const seen: { role: string; user: any }[] = [];
  const f = async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body)), role = roleOf(b.messages[0].content); seen.push({ role, user: JSON.parse(b.messages[1].content) });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(over[role] ?? good[role]) } }] }), { status });
  };
  return { f: f as never, seen };
}
const deepFreeze = <T,>(o: T): T => { if (o && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); } return o; };

test("workflow: checks row plus analyst, bear, bull, judge; later roles see earlier notes; everything is advisory and the input is untouched", async () => {
  const m = mockFetch(), inp = deepFreeze(input()), usage = {};
  const r = await runDeskWorkflow(inp, { providers: [provider], usage, now: Date.now(), fetchImpl: m.f });
  assert.deepEqual(r.rows.map((x) => x.agent), ["desk-checks", "desk-analyst", "desk-bear", "desk-bull", "desk-judge"]); assert.equal(r.verdict, "agree");
  assert.deepEqual(m.seen.map((s) => s.role), ["analyst", "bear", "bull", "judge"]);
  assert.deepEqual(Object.keys(m.seen[3].user.notes), ["analyst", "bear", "bull"], "the judge sees all three notes");
  assert.ok(r.rows.every((x) => !x.error) && r.rows.every((x) => (x.output as any).authority === "advisory" && (x.output as any).ref === "V5-1"));
  assert.equal((usage as any).groq.calls, 4, "four counted provider calls");
});

test("workflow: no provider means only the deterministic checks row; failures stop the chain and are recorded, never thrown", async () => {
  const none = await runDeskWorkflow(input(), { providers: [], usage: {}, now: Date.now() }); assert.deepEqual(none.rows.map((x) => x.agent), ["desk-checks"]); assert.equal(none.verdict, null);
  const down = mockFetch({}, 500), r = await runDeskWorkflow(input(), { providers: [provider], usage: {}, now: Date.now(), fetchImpl: down.f, sleep: async () => {} });
  assert.equal(r.verdict, null); assert.ok(r.rows[1].agent === "desk-analyst" && r.rows[1].error, "stage failure recorded"); assert.equal(r.rows.length, 2, "chain stops after the first failure");
  const auth = mockFetch({}, 401); const a = await runDeskWorkflow(input(), { providers: [provider], usage: {}, now: Date.now(), fetchImpl: auth.f }); assert.match(a.rows[1].error!, /401/);
});

test("workflow: output that states a probability, a price target, a URL or breaks the schema is rejected", async () => {
  for (const bad of [
    { judge: { ...(good.judge as object), reason: "There is a 70% chance this works." } },
    { judge: { ...(good.judge as object), reason: "Price will reach 90000 soon." } },
    { judge: { ...(good.judge as object), reason: "See https://x.example for more" } },
    { judge: { verdict: "buy", reason: "x", concerns: [], would_change_my_mind: "y" } },
    { judge: { ...(good.judge as object), concerns: "not a list" } },
  ]) { const m = mockFetch(bad), r = await runDeskWorkflow(input(), { providers: [provider], usage: {}, now: Date.now(), fetchImpl: m.f }); assert.equal(r.verdict, null, JSON.stringify(bad).slice(0, 60)); assert.match(r.rows.at(-1)!.error!, /invalid output/); assert.equal(r.rows.at(-1)!.agent, "desk-judge"); }
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
  assert.ok(!/wf\.verdict/.test(idx) && !/verdict/.test(idx.slice(idx.indexOf("Desk review layer"), idx.indexOf("Desk review layer") + 2600)), "the verdict is never read by trading logic");
  assert.ok(idx.indexOf("await events(evs)") < idx.indexOf("runDeskWorkflow("), "state and ledger are saved before any LLM call");
});
