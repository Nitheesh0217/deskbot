import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { build, ROSTER, FLOORS } = createRequire(import.meta.url)("../web/tower-model.js");
const now = Date.parse("2026-10-29T12:00:00Z"), iso = (ms: number) => new Date(now - ms).toISOString();
const state = { equity: 340, startEquity: 350, cb: { cooldownUntil: 0, consec: 1 }, pos: null, stats: { all: { n: 3 } } };
const lastRun = { ts: iso(60e3), action: "SKIP", source: "hyperliquid", market: { price: 81000, funding: 0.0001 }, desk: { chart: { bias: "bull", trend: { m5: 1, h4: -1 } } }, decision: { signals: [{ strategy: "HTF_TREND", dir: "long", score: 80 }], rejects: [{}, {}] }, upnl: 0 };

test("every roster member sits on a real floor and appears in the model", () => {
  const m = build({ state: { state, last_run: lastRun }, agents: [], trades: [], curve: [], strategies: [], book: "BTC" }, now);
  const ids = new Set(FLOORS.map((f: any) => f.id));
  for (const [id, r] of Object.entries(ROSTER) as any) { assert.ok(ids.has(r[3]), id); assert.ok(m.staff[id], id); }
});
test("lines are copied from reported fields; absent fields say not reported, never an invented value", () => {
  const empty = build({ state: { state: {}, last_run: {} }, agents: [], trades: [], curve: [], strategies: [] }, now);
  assert.equal(empty.staff.chart.line, "not reported"); assert.equal(empty.staff.feed.line, "not reported"); assert.equal(empty.growth.now, null); assert.equal(empty.growth.pct, null);
  const m = build({ state: { state, last_run: lastRun }, agents: [], trades: [], curve: [], strategies: [] }, now);
  assert.match(m.staff.chart.line, /BULL/); assert.match(m.staff.feed.line, /81,000/); assert.match(m.staff.scout.line, /1 setup\(s\) passed the rules, 2 rejection/);
  assert.equal(m.action, "SKIP");
});
test("AI roles are advisory and read 'no provider' rather than inventing a verdict; real rows appear verbatim", () => {
  const none = build({ state: { state, last_run: lastRun }, agents: [], trades: [], curve: [], strategies: [] }, now);
  assert.equal(none.staff.judge.status, "off"); assert.match(none.staff.judge.line, /no AI provider/);
  const withRows = build({ state: { state, last_run: lastRun }, agents: [{ agent: "desk-judge", ts: iso(30e3), input_summary: "x", output: { verdict: "disagree", reason: "Costs." } }], trades: [], curve: [], strategies: [] }, now);
  assert.equal(withRows.staff.judge.line, "disagree: Costs."); assert.equal(withRows.staff.judge.status, "working");
  assert.ok(Object.values(withRows.staff).filter((s: any) => /AI/.test(s.kind)).length >= 4);
});
test("growth is the account's own number: start, now, percent, including a loss", () => {
  const m = build({ state: { state, last_run: { ...lastRun, upnl: 0 } }, agents: [], trades: [], curve: [{ equity: 350 }, { equity: 340 }], strategies: [] }, now);
  assert.equal(m.growth.now, 340); assert.ok(m.growth.pct < 0); assert.deepEqual(m.growth.points, [350, 340]);
});
test("breaker active raises an alert; disabled strategies are off; the open position's desk is marked", () => {
  const m = build({ state: { state: { ...state, cb: { cooldownUntil: now + 3600e3, consec: 3 }, pos: { strategy: "HTF_TREND", dir: "long", stop: 1, plan: [] } }, last_run: lastRun }, agents: [], trades: [], curve: [],
    strategies: [{ id: "HTF_TREND", name: "t", state: "RUNNING", reason: "" }, { id: "SSR", name: "s", state: "DISABLED", reason: "" }] }, now);
  assert.equal(m.staff.cro.status, "alert");
  assert.equal(m.traders.find((t: any) => t.id === "SSR").status, "off"); assert.equal(m.traders.find((t: any) => t.id === "HTF_TREND").position, true);
});
