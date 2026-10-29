// Dashboard scanner/committee model: the trading state is derived from existing controls; committees group rows by trade.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { tradingState, committees, STAGES } = createRequire(import.meta.url)("../web/scanner.js");

const now = Date.UTC(2026, 9, 29, 18), lr = { ts: new Date(now - 4 * 60e3).toISOString() }, cfg = { DAILY_LOSS_LIMIT: 0.05, MAX_TRADES_PER_DAY: 6 };
const st = (o: Record<string, unknown> = {}) => ({ equity: 340, markedEquity: 340, cb: { cooldownUntil: 0 }, day: { startEquity: 340, trades: 1 }, enabled: { A: true }, ...o });

test("trading state: ACTIVE when every control allows entries, REDUCING when one blocks them, HALTED when the book is not running", () => {
  assert.equal(tradingState(st(), cfg, lr, now).state, "ACTIVE");
  assert.match(tradingState(st({ cb: { cooldownUntil: now + 3600e3 } }), cfg, lr, now).reasons[0], /circuit-breaker cooldown until 19:00 UTC/);
  assert.equal(tradingState(st({ markedEquity: 320 }), cfg, lr, now).reasons[0], "daily loss limit hit");
  assert.equal(tradingState(st({ day: { startEquity: 340, trades: 6 } }), cfg, lr, now).reasons[0], "daily trade cap reached");
  assert.equal(tradingState(st({ enabled: { A: false, B: false } }), cfg, lr, now).state, "REDUCING");
  assert.match(tradingState(st(), cfg, { ts: new Date(now - 40 * 60e3).toISOString() }, now).reasons[0], /no run for 40 min/);
  assert.equal(tradingState(null, cfg, lr, now).state, "HALTED");
  assert.equal(tradingState(st(), cfg, { ...lr, integrity: { ok: false } }, now).state, "HALTED");
});

test("committees group rows by trade ref, newest trade first, stages in the order they ran", () => {
  const rows = [   // newest first, as the status endpoint returns them
    { agent: "desk-pm", ts: "2026-10-29T17:02:00Z", symbol: "BTC", output: { ref: "B", rating: "Buy" } },
    { agent: "desk-bull", ts: "2026-10-29T17:01:00Z", symbol: "BTC", output: { ref: "B" } },
    { agent: "chart", ts: "2026-10-29T17:00:30Z", output: { ref: "B" } },
    { agent: "desk-checks", ts: "2026-10-29T17:00:00Z", symbol: "BTC", output: { ref: "B" } },
    { agent: "desk-checks", ts: "2026-10-28T10:00:00Z", symbol: "GOLD", output: { ref: "A" } },
  ];
  const c = committees(rows);
  assert.deepEqual(c.map((x: any) => x.ref), ["B", "A"]); assert.deepEqual(c[0].rows.map((r: any) => r.agent), ["desk-checks", "desk-bull", "desk-pm"], "non-committee agents are excluded");
  assert.equal(STAGES.at(-1)[0], "desk-pm");
});
