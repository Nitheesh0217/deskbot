import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { build, ROSTER, FLOORS, WORKFLOW, RESEARCH } = createRequire(import.meta.url)("../web/tower-model.js");
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
  assert.equal(empty.staff.chart.line, "not reported"); assert.equal(empty.staff.feed.line, "not reported"); assert.equal(empty.staff.steward.line, "not reported"); assert.equal(empty.growth.now, null); assert.equal(empty.growth.pct, null);
  const m = build({ state: { state, last_run: lastRun }, agents: [], trades: [], curve: [], strategies: [] }, now);
  assert.match(m.staff.chart.line, /BULL/); assert.match(m.staff.feed.line, /81,000/); assert.match(m.staff.scout.line, /1 candidate\(s\) passed the rules · 2 rejection/);
  assert.equal(m.action, "SKIP");
});
test("AI roles are advisory and read 'no provider' rather than inventing a verdict; real rows appear verbatim", () => {
  const none = build({ state: { state, last_run: lastRun }, agents: [], trades: [], curve: [], strategies: [] }, now);
  assert.equal(none.staff.judge.status, "off"); assert.match(none.staff.judge.line, /no AI provider/);
  const waiting = build({ state: { state, last_run: lastRun }, agents: [], trades: [], curve: [], strategies: [], aiProviders: ["groq"] }, now);
  assert.equal(waiting.staff.judge.status, "idle", "a configured provider with nothing to review is idle, not off");
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
  assert.equal(m.staff.cro.status, "alert"); assert.match(m.staff.cro.line, /^VETO/);
  const all = m.desks.flatMap((d: any) => d.strategies);
  assert.equal(all.find((t: any) => t.id === "SSR").status, "off"); assert.equal(all.find((t: any) => t.id === "HTF_TREND").position, true);
});

test("eight numbered departments, nine workflow steps each owned by a real roster member, research desks labelled as hypotheses", () => {
  assert.deepEqual(FLOORS.map((f: any) => f.n), [8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(WORKFLOW.length, 9); for (const [id] of WORKFLOW) assert.ok(ROSTER[id], id);
  assert.equal(RESEARCH.length, 5); assert.ok(RESEARCH.every((r: any) => r.question && r.inputs));
  const m = build({ state: { state, last_run: lastRun }, agents: [], trades: [], curve: [], strategies: [{ id: "HTF_TREND", name: "4H", state: "RUNNING" }, { id: "VWAP_REVERT", name: "V", state: "DISABLED" }] }, now);
  assert.deepEqual(m.desks.map((d: any) => d.family), ["Trend", "Breakout", "Reversal", "Mean reversion"]);
  assert.equal(m.desks[1].strategies[0].signal.strategy, "HTF_TREND", "the candidate is shown on its own desk");
  assert.equal(m.workflow[5].out, "SKIP", "allocator step reports the reported action");
  assert.equal(m.staff.researcher.status, "off", "offline research is never shown as part of the live loop");
});
test("evidence steward fails loudly: stale run, missing feed or a decision-record failure turn it to alert", () => {
  const ok = build({ state: { state, last_run: lastRun, integrity: { hash: "abc" } }, agents: [], trades: [], curve: [], strategies: [] }, now);
  assert.equal(ok.staff.steward.status, "working");
  const stale = build({ state: { state, last_run: { ...lastRun, ts: iso(3600e3) }, integrity: { hash: "abc" } }, agents: [], trades: [], curve: [], strategies: [] }, now);
  assert.equal(stale.staff.steward.status, "alert"); assert.match(stale.staff.steward.line, /last run within 12 min/);
  const prov = build({ state: { state, last_run: { ...lastRun, provenanceError: "entry rejected" }, integrity: { hash: "abc" } }, agents: [], trades: [], curve: [], strategies: [] }, now);
  assert.equal(prov.staff.steward.status, "alert"); assert.equal(prov.staff.auditor.status, "alert");
});
test("allocator says WAIT when there is no candidate; the experiment officer reports the table state truthfully", () => {
  const m = build({ state: { state, last_run: { ...lastRun, decision: { signals: [], rejects: [] } } }, agents: [], trades: [], curve: [], strategies: [], experiment: null }, now);
  assert.match(m.staff.pm.line, /^WAIT/); assert.match(m.staff.experiment.line, /not live yet/);
  const live = build({ state: { state, last_run: lastRun }, agents: [], trades: [], curve: [], strategies: [], experiment: { started: "x", arms: [{ arm: "rules", decided: 3, result: "INSUFFICIENT_DATA" }] } }, now);
  assert.match(live.staff.experiment.line, /rules: 3 decided · INSUFFICIENT_DATA/);
});

test("catalyst analyst shows the next high-impact calendar event as display-only context", () => {
  const m = build({ state: { state, last_run: lastRun }, agents: [], trades: [], curve: [], strategies: [], calendarNext: { label: "USD CPI m/m in 2h 5m", forecast: "0.3%" } }, now);
  assert.match(m.staff.news.line, /next high-impact: USD CPI m\/m in 2h 5m/); assert.ok(m.staff.news.detail.some((d: string) => /does not gate trades/.test(d)));
});
