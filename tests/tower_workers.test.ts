// Truthful worker states in the tower: runtime evidence only; waiting is healthy, missing telemetry is UNKNOWN,
// missing AI credentials are BLOCKED with the exact reason. All inputs below are synthetic test fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { build, STATES, nextAt, ROSTER } = createRequire(import.meta.url)("../web/tower-model.js");

const now = Date.UTC(2026, 9, 30, 0, 10), iso = (ms: number) => new Date(now - ms).toISOString();
const state = (o: Record<string, unknown> = {}) => ({ state: { equity: 340, startEquity: 350, cb: {}, day: {}, ...o }, last_run: { ts: iso(3 * 60e3), action: "SKIP", source: "hyperliquid", market: { price: 80000 }, ai: { providers: [] } } });
const scan = (o: Record<string, unknown> = {}) => ({ ts: iso(8 * 60e3), ms: 2100, markets: [{ sym: "BTC", ok: true, barT: now - 9 * 60e3, setups: [] }, { sym: "ETH", ok: true, barT: now - 9 * 60e3, setups: [{ dir: "long" }] }], deriv: [{ currency: "BTC", dvol: { last: 37 }, options: { putCallOI: 0.6 }, futures: [], errors: [] }], work: { calls: { new: 1, scored: 2, open: 3 }, tracker: { new: 1, resolved: 0, open: 2 }, errors: [] }, ...o });
const staffOf = (input: Record<string, unknown>) => build({ state: state(), agents: [], trades: [], curve: [], strategies: [], ...input }, now).staff;

test("every displayed seat has a state from the fixed vocabulary; the five new desks exist", () => {
  const s = staffOf({ scan: scan(), track: { calls: [], markets: [] }, chat: { enabled: true, ai: [] }, aiProviders: [] });
  for (const id of ["scanner", "caller", "tracker", "options", "assistant"]) assert.ok(ROSTER[id] && s[id], id);
  assert.equal(Object.keys(s).length, Object.keys(ROSTER).length);
  for (const [id, e] of Object.entries(s) as any) assert.ok(STATES.includes(e.state), `${id}: ${e.state}`);
});

test("missing AI credentials: every AI seat and the assistant are BLOCKED with the precise reason; switched off is DISABLED", () => {
  const s = staffOf({ aiProviders: [], chat: { enabled: true, ai: [] } });
  for (const id of ["bull", "bear", "judge", "trader", "riskdebate", "cio", "assistant"]) { assert.equal(s[id].state, "BLOCKED", id); assert.match(s[id].facts.blocker, /missing credentials: no AI provider secret set \(GROQ_API_KEY/); }
  const off = staffOf({ aiProviders: ["groq"], ai: { providers: ["groq"], agentAi: false, deskWorkflow: true } });
  assert.equal(off.bull.state, "DISABLED");
  const ready = staffOf({ aiProviders: ["groq"], ai: { providers: ["groq"], agentAi: true, deskWorkflow: true }, chat: { enabled: true, ai: ["groq"] } });
  assert.equal(ready.cio.state, "UNKNOWN", "a provider name proves configuration only"); assert.match(ready.cio.facts.blocker, /connectivity unverified/); assert.equal(ready.assistant.state, "UNKNOWN");
  const proven = staffOf({ aiProviders: ["groq"], ai: { providers: ["groq"], agentAi: true, deskWorkflow: true }, agents: [{ agent: "desk-pm", ts: new Date(now - 3 * 86400e3).toISOString(), output: { rating: "Hold" } }] });
  assert.equal(proven.cio.state, "WAITING", "a past successful call and no new entry: healthy and waiting for its trigger");
  assert.equal(staffOf({ chat: { enabled: false, ai: [] } }).assistant.state, "DISABLED");
});

test("scan workers: fresh scan RUNNING with facts; late DEGRADED; very late ERROR; absent UNKNOWN; old build without telemetry UNKNOWN", () => {
  const s = staffOf({ scan: scan(), track: { calls: [{ scored: 2, open: 3 }], markets: [{ resolved: 0, open: 2 }] } });
  assert.equal(s.scanner.state, "RUNNING"); assert.equal(s.scanner.facts.durationMs, 2100); assert.equal(s.scanner.facts.next, nextAt([7, 22, 37, 52], now)); assert.match(s.scanner.facts.freshness, /9 min old/);
  assert.equal(s.caller.state, "RUNNING"); assert.match(s.caller.line, /3 open · 2 scored/); assert.equal(s.tracker.state, "RUNNING"); assert.equal(s.options.state, "RUNNING");
  assert.equal(s.scanner.facts.lastAttempt, null, "attempts are not recorded per worker; shown as not recorded rather than invented");
  assert.equal(staffOf({ scan: scan({ ts: iso(25 * 60e3) }) }).scanner.state, "DEGRADED");
  assert.equal(staffOf({ scan: scan({ ts: iso(50 * 60e3) }) }).caller.state, "ERROR");
  assert.equal(staffOf({}).scanner.state, "UNKNOWN");
  const old = staffOf({ scan: scan({ work: undefined }) }); assert.equal(old.caller.state, "UNKNOWN"); assert.match(old.caller.facts.blocker, /no per-worker telemetry/);
  const bad = staffOf({ scan: scan({ work: { calls: {}, tracker: {}, errors: ["calls insert: DB 500", "ETH: boom"] } }) }); assert.equal(bad.caller.state, "ERROR"); assert.equal(bad.tracker.state, "ERROR");
  assert.equal(staffOf({ scan: scan({ deriv: [{ currency: "BTC", errors: ["deribit 503"] }] }) }).options.state, "ERROR");
  assert.equal(staffOf({ scan: scan({ markets: [{ sym: "BTC", ok: true, setups: [] }, { sym: "SUI", ok: false, error: "x" }] }) }).scanner.state, "DEGRADED");
});

test("Theo: his keyed work-log rows; flat and fresh is WAITING; stale run is UNKNOWN; a fresh failure is ERROR; other book's rows ignored", () => {
  const row = (o: Record<string, unknown>) => ({ agent: "manager", ts: iso(2 * 60e3), input_summary: "V5-1 TP1 @ 90", output: { symbol: "BTC", action: "target_fill", ref: "V5-1", key: "V5-1:target_fill:tp1:1" }, ...o });
  assert.equal(staffOf({}).manager.state, "WAITING");
  const acted = staffOf({ agents: [row({})] }).manager; assert.equal(acted.state, "RUNNING"); assert.match(acted.line, /last action: V5-1 TP1/);
  assert.equal(staffOf({ agents: [row({ error: "candles 503", input_summary: "V5-1 management failed" })] }).manager.state, "ERROR");
  assert.equal(staffOf({ agents: [row({ output: { symbol: "GOLD", action: "close" } })] }).manager.state, "WAITING", "gold rows do not count for the BTC book");
  const stale = build({ state: { ...state(), last_run: { ...state().last_run, ts: iso(40 * 60e3) } }, agents: [] }, now).staff.manager; assert.equal(stale.state, "UNKNOWN");
});

test("next run helper: minute lists in UTC", () => {
  assert.equal(new Date(nextAt([7, 22, 37, 52], Date.UTC(2026, 0, 1, 10, 7, 30))).toISOString(), "2026-01-01T10:22:00.000Z");
  assert.equal(new Date(nextAt([7, 22, 37, 52], Date.UTC(2026, 0, 1, 10, 53))).toISOString(), "2026-01-01T11:07:00.000Z");
});
