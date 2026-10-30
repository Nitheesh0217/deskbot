// PR #19 corrective revision (review of 33af114): regression tests written before the fixes. SYNTHETIC fixtures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { build } = createRequire(import.meta.url)("../web/tower-model.js");

const now = Date.UTC(2026, 9, 30, 0, 10), iso = (ms: number) => new Date(now - ms).toISOString();
const lastRun = (o: Record<string, unknown> = {}) => ({ ts: iso(3 * 60e3), action: "SKIP", source: "hyperliquid", market: { price: 80000, funding: 0.00001, oi: 5 }, ai: { providers: [] }, desk: { chart: { bias: "long", trend: {}, zones: { summary: "2 zones" } } }, decision: { signals: [], rejects: [] }, news: { t: now - 10 * 60e3, risk: "high", by: "rules", reason: "x" }, ...o });
const state = (lr: Record<string, unknown> = lastRun(), o: Record<string, unknown> = {}) => ({ state: { equity: 340, startEquity: 350, cb: {}, day: {}, ...o }, last_run: lr, integrity: { hash: "abc", approved: false } });
const okMarkets = [{ sym: "BTC", ok: true, barT: now - 9 * 60e3, setups: [] }];
const scan = (o: Record<string, unknown> = {}) => ({ ts: iso(8 * 60e3), ms: 2100, markets: okMarkets, deriv: [{ currency: "BTC", dvol: { last: 37 }, options: { putCallOI: 0.6 }, futures: [{ instrument: "BTC-PERPETUAL", mark: 1 }], errors: [] }], work: { calls: { new: 1, scored: 2, open: 3 }, tracker: { new: 1, resolved: 0, open: 2 }, errors: [] }, ...o });
const S = (input: Record<string, unknown>) => build({ state: state(), agents: [], trades: [], curve: [], strategies: [], ...input }, now).staff;

test("1. scan timestamps are validated: missing, invalid or future never yields RUNNING; an empty scan is not coverage; stale output stays visible", () => {
  for (const ts of [undefined, "not a date", new Date(now + 60 * 60e3).toISOString()]) { const s = S({ scan: scan({ ts }) }); assert.notEqual(s.scanner.state, "RUNNING", String(ts)); assert.notEqual(s.caller.state, "RUNNING"); assert.notEqual(s.options.state, "RUNNING"); }
  const empty = S({ scan: scan({ markets: [] }) }); assert.equal(empty.scanner.state, "ERROR"); assert.match(empty.scanner.facts.blocker, /0 markets/);
  const old = S({ scan: scan({ ts: iso(3 * 3600e3) }) }); assert.equal(old.scanner.state, "ERROR"); assert.match(old.scanner.facts.lastOutput, /1 markets/, "stale output kept as last output");
});

test("2. caller/tracker need their own valid telemetry; a failed or unobserved subworker does not inherit the scan's success time", () => {
  const none = S({ scan: scan({ work: { errors: [] } }) }); assert.equal(none.caller.state, "UNKNOWN"); assert.equal(none.tracker.state, "UNKNOWN"); assert.equal(none.caller.facts.lastSuccess, null);
  const bad = S({ scan: scan({ work: { calls: { new: "x" }, tracker: null, errors: [] } }) }); assert.equal(bad.caller.state, "UNKNOWN"); assert.equal(bad.tracker.state, "UNKNOWN");
  const failed = S({ scan: scan({ work: { calls: { new: 0, scored: 0, open: 0 }, tracker: { new: 0, resolved: 0, open: 0 }, errors: ["calls insert: DB 500"] } }) });
  assert.equal(failed.caller.state, "ERROR"); assert.equal(failed.caller.facts.lastSuccess, null); assert.equal(failed.tracker.state, "RUNNING"); assert.ok(failed.tracker.facts.lastSuccess);
});

test("3. Opal: no telemetry, total failure and partial results are distinct; empty arrays are not RUNNING", () => {
  assert.equal(S({ scan: scan({ deriv: [] }) }).options.state, "UNKNOWN");
  assert.equal(S({ scan: scan({ deriv: undefined }) }).options.state, "UNKNOWN");
  assert.equal(S({ scan: scan({ deriv: [{ currency: "BTC", options: null, futures: [], dvol: null, errors: [] }] }) }).options.state, "ERROR", "nothing usable");
  assert.equal(S({ scan: scan({ deriv: [{ currency: "BTC", futures: [], errors: [] }, { currency: "ETH", dvol: { last: 50 }, futures: [], errors: [] }] }) }).options.state, "DEGRADED");
  assert.equal(S({ scan: scan() }).options.state, "RUNNING");
});

test("4. assistant: malformed chat.ai renders UNKNOWN without throwing; provider names prove configuration, not connectivity", () => {
  for (const ai of [null, undefined, "groq", 5, {}]) { const s = S({ chat: { enabled: true, ai } }); assert.equal(s.assistant.state, "UNKNOWN", String(ai)); }
  const cfg = S({ chat: { enabled: true, ai: ["groq"] } }).assistant; assert.notEqual(cfg.state, "RUNNING"); assert.match(cfg.line, /connectivity unverified/);
});

test("5. freshness applies to every seat: historical output never proves current execution; health is separate from the output", () => {
  const staleRun = lastRun({ ts: iso(3 * 3600e3) });
  const s = S({ state: state(staleRun), agents: [{ agent: "desk-postmortem", ts: iso(5 * 86400e3), input_summary: "V5-1", output: { flags: [] } }], bt: { label: "LIVE", ran_at: iso(9 * 86400e3), a: { n: 10, expR: 0.1 } }, experiment: { started: true, arms: [] } });
  for (const id of ["feed", "deriv", "chart", "zones", "scout", "pm", "cro", "exec", "auditor", "news"]) assert.equal(s[id].state, "UNKNOWN", `${id} with a stale run`);
  assert.notEqual(s.postmortem.state, "RUNNING", "a 5-day-old review is not current work"); assert.notEqual(s.evaluator.state, "RUNNING", "a 9-day-old backtest is not current work");
  assert.ok(s.postmortem.facts.lastOutput, "old output kept");
  const f = S({});   // fresh run
  assert.equal(f.news.state, "RUNNING", "a high news risk is an output, not a worker error"); assert.match(f.news.line, /HIGH/);
  assert.equal(f.config.state, "RUNNING", "unapproved config is a finding about the config, not a broken auditor"); assert.match(f.config.line, /not approved/);
  assert.equal(S({ state: state(lastRun({ news: { t: now - 3 * 3600e3, risk: "low" } })) }).news.state, "DEGRADED", "news read 3 h old with a fresh run");
  assert.notEqual(f.steward.state, "RUNNING", "Stella has no backend worker"); assert.match(f.steward.facts.blocker, /no backend/);
  const flat = S({}).manager; assert.equal(flat.facts.lastAttempt, null, "no position, so no management attempt");
});

test("Theo: a work-log backlog older than 30 min is DEGRADED with the count; a young backlog is not", () => {
  const old = S({ work: { backlog: { BTC: { pending: 260, oldestQueuedAt: new Date(now - 2 * 3600e3).toISOString() } } } }).manager;
  assert.equal(old.state, "DEGRADED"); assert.match(old.facts.blocker, /260 record\(s\) pending for 120 min \(kept, not lost\)/);
  assert.notEqual(S({ work: { backlog: { BTC: { pending: 3, oldestQueuedAt: new Date(now - 60e3).toISOString() } } } }).manager.state, "DEGRADED");
});
