// Shift report (shift.ts): every floor gets a target, an actual and its needs; the owner's goal is tracked against the record and the
// measured edge, and never sets size.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shiftReport, type BookFact, type ShiftFacts } from "../supabase/functions/deskbot-v5/shift.ts";

const NOW = Date.UTC(2026, 10, 24, 0, 5);
const book = (o: Partial<BookFact>): BookFact => ({ sym: "BTC", mode: "paper", equity: 350, start: 350, open: false, openDir: null, lastRunMs: NOW - 60_000, trades30d: 0, r30d: 0, tradesAll: 0, rAll: 0, riskPerTradeUsd: 7, strategy: "HTF_TREND", ...o });
const facts = (o: Partial<ShiftFacts> = {}): ShiftFacts => ({ now: NOW, books: [book({})], netMonth: 0, net24h: 0, upnl: 0, learning: { focusTest: "CLUSTER_CAP", focusStatus: "NARROW_REJECT", losses90d: 5, queued: 2 }, aiTraderProviders: [], marketCtxLastHour: 24, newsProviders: [], ...o });

test("goal board: $10k month / $1k night tracked; projection from measured edge and current $ risk; size multiple shown, not applied", () => {
  const r = shiftReport(facts({ books: [book({ riskPerTradeUsd: 7 }), book({ sym: "ETH", riskPerTradeUsd: 7 }), book({ sym: "SPX", mode: "shadow", riskPerTradeUsd: 7 })], netMonth: 25.29, net24h: -3.5 }));
  assert.equal(r.goal.monthUsd, 10_000); assert.equal(r.goal.nightUsd, 1_000);
  assert.equal(r.goal.daysLeft, 7, "Nov 24..30"); assert.equal(r.goal.perDayNeeded, +((10_000 - 25.29) / 7).toFixed(2));
  assert.equal(r.goal.capital, 700, "paper books only"); assert.equal(r.goal.projectedMonthUsd, 2 * 2.4 * 0.1 * 7);
  assert.equal(r.goal.sizeMultipleNeeded, Math.round(10_000 / (2 * 2.4 * 0.1 * 7)));
  assert.match(r.goal.note, /not used to set size/);
});

test("floors: eight floors, each with a target and an actual; needs make a floor BEHIND, a healthy floor is ON_TARGET", () => {
  const r = shiftReport(facts({ newsProviders: ["groq"], aiTraderProviders: ["groq"] }));
  assert.deepEqual(r.floors.map((f) => f.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const f of r.floors) { assert.ok(f.target.length > 10, f.id); assert.ok(f.actual.length > 3, f.id); }
  assert.equal(r.floors.find((f) => f.id === "data")!.status, "ON_TARGET");
  assert.equal(r.floors.find((f) => f.id === "intel")!.status, "ON_TARGET");
  assert.equal(r.floors.find((f) => f.id === "research")!.status, "BEHIND", "it needs the weekly session and long stock history");
});

test("needs come from facts: stale data, silent desks, losing books, crowded direction, deep drawdown, missing AI keys", () => {
  const books = [
    book({ sym: "BTC", open: true, openDir: "short", lastRunMs: NOW - 40 * 60_000 }),
    ...["DOGE", "XMR", "ADA", "ZEC"].map((s) => book({ sym: s, open: true, openDir: "short" })),
    book({ sym: "GOLD", equity: 280, start: 350, tradesAll: 25, rAll: -11.3 }),
    book({ sym: "SOL" }), book({ sym: "AVAX" }),
  ];
  const r = shiftReport(facts({ books, marketCtxLastHour: 0 }));
  const needs = (id: string) => r.floors.find((f) => f.id === id)!.needs.join(" | ");
  assert.match(needs("data"), /BTC/, "BTC holds a position and has not run for 40 min");
  assert.match(needs("intel"), /silent/); assert.match(needs("intel"), /news/);
  assert.match(needs("desks"), /GOLD: -0\.45R\/trade over 25 trades/);
  assert.match(needs("portfolio"), /5 positions in one direction/);
  assert.match(needs("risk"), /GOLD is 20\.0% down/);
  assert.match(needs("execution"), /AI trader/); assert.match(needs("execution"), /broker adapter/);
  assert.ok(r.topNeeds.length > 0 && r.topNeeds.length <= 6);
});
