// AI paper trader (ai_trader.ts): the model may only pick from the menu of valid signals or stand aside; code sizes, gates and manages.
// SYNTHETIC candles (seeded random walk). The decide() stub stands in for a provider.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeries, type Bar } from "../supabase/functions/deskbot-v5/engine.ts";
import { newAiBook, stepAiBook, menuFor, traderFacts, validateChoice, aiBookCfg, type Decide } from "../supabase/functions/deskbot-v5/ai_trader.ts";
import { snapshot } from "../supabase/functions/deskbot-v5/engine.ts";
import { egressViolations } from "../supabase/functions/deskbot-v5/egress.ts";

const M5 = 300_000, T0 = Date.UTC(2026, 0, 1);
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const closes = (seed: number, n: number) => { const r = seeded(seed), c = [30000]; for (let i = 1; i < n; i++) c.push(c[i - 1] * (1 + 0.00003 * Math.sin(i / 900) + (r() - 0.5) * 0.004)); return c; };
const mk = (c: number[]): Bar[] => c.map((x, i) => { const o = i ? c[i - 1] : x, w = x * 0.0015; return { t: T0 + i * M5, o, h: Math.max(o, x) + w, l: Math.min(o, x) - w, c: x, v: 10, ct: T0 + (i + 1) * M5 - 1 }; });
const agg = (b: Bar[], k: number): Bar[] => { const out: Bar[] = []; for (let i = 0; i + k <= b.length; i += k) { const s = b.slice(i, i + k); out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)), c: s[k - 1].c, v: s.reduce((a, x) => a + x.v, 0), ct: s[k - 1].ct }); } return out; };
const m5 = mk(closes(7, 12000)), S = buildSeries({ m5, m15: agg(m5, 3), h1: agg(m5, 12), h4: agg(m5, 48) });
const LOOSE = { MIN_SCORE: 0 };
const freshBook = () => { const b = newAiBook(350, m5[0].t, LOOSE); b.cfg = { ...aiBookCfg(LOOSE) }; return b; };
const menuBar = (() => { const b = freshBook(); for (let i = 3000; i < m5.length - 1; i++) if (menuFor(b, S, i).length) return i; return -1; })();
const step = (book: ReturnType<typeof freshBook>, i: number, decide: Decide) => stepAiBook(book, { S, i, bars: m5.slice(Math.max(0, i - 5), i + 1), fill: { px: m5[i + 1].o, t: m5[i + 1].t }, sym: "BTC", now: m5[i].ct + 1, decide });

test("validateChoice: only a menu index or -1, a confidence in [0,1]; anything else is no decision", () => {
  assert.deepEqual(validateChoice({ pick: 0, confidence: 0.7, reason: "trend" }, 2), { pick: 0, confidence: 0.7, reason: "trend" });
  assert.equal(validateChoice({ pick: -1, confidence: 0.2, reason: "stand aside" }, 2)!.pick, -1);
  for (const bad of [{ pick: 2, confidence: 0.5 }, { pick: 0.5, confidence: 0.5 }, { pick: 0, confidence: 1.5 }, { pick: "0", confidence: "x" }, null, "x"]) assert.equal(validateChoice(bad, 2), null, JSON.stringify(bad));
});

test("menu exists on the synthetic series, and the facts sent to the model carry no account fields", () => {
  assert.ok(menuBar > 0, "a bar with at least one valid signal");
  const book = freshBook(), menu = menuFor(book, S, menuBar), facts = traderFacts(menu, snapshot(S, menuBar), S, "BTC");
  assert.deepEqual(egressViolations(facts), [], "egress guard passes");
  const f = JSON.parse(facts); assert.equal(f.menu.length, menu.length); assert.ok("research" in f.menu[0]); assert.ok(!/equity|riskAmt|qty/i.test(facts));
});

test("pick → an order through the same gates and executor: position with the menu signal's own stop; the AI reason is recorded", async () => {
  const book = freshBook(), menu = menuFor(book, S, menuBar);
  const r = await step(book, menuBar, async () => ({ value: { pick: 0, confidence: 0.8, reason: "test pick" }, by: "stub/model" }));
  assert.equal(r.log!.outcome, "ENTERED"); assert.ok(book.state.pos, "position opened");
  assert.equal(book.state.pos!.strategy, menu[0].strategy); assert.equal(book.state.pos!.dir, menu[0].dir);
  assert.match(book.state.pos!.why[0], /^AI pick 0 \(stub\/model, conf 0.8\): test pick/);
  assert.equal(book.log.length, 1);
});

test("no provider / invalid answer → NO_DECISION, stand aside → NO_TRADE; neither opens a position", async () => {
  const a = freshBook(); const r1 = await step(a, menuBar, async () => ({ value: null, errors: ["no provider usable for feature 'trader'"] }));
  assert.equal(r1.log!.outcome, "NO_DECISION"); assert.equal(a.state.pos, null); assert.match(r1.log!.note!, /no provider/);
  const b = freshBook(); const r2 = await step(b, menuBar, async () => ({ value: { pick: -1, confidence: 0.6, reason: "no edge" }, by: "stub" }));
  assert.equal(r2.log!.outcome, "NO_TRADE"); assert.equal(b.state.pos, null);
});

test("the same bar is decided once (restart / overlapping run): the model is not asked again", async () => {
  const book = freshBook(); let calls = 0;
  const d: Decide = async () => { calls++; return { value: { pick: -1, confidence: 0.5, reason: "x" }, by: "stub" }; };
  await step(book, menuBar, d); await step(book, menuBar, d);
  assert.equal(calls, 1);
});

test("an open AI position is managed by code over later bars and closes into a trade; the model is never asked while in a position", async () => {
  const book = freshBook(); let asked = 0;
  await step(book, menuBar, async () => { asked++; return { value: { pick: 0, confidence: 0.9, reason: "go" }, by: "stub" }; });
  let closed = 0;
  for (let i = menuBar + 1; i < m5.length - 1 && closed === 0; i++) { const r = await step(book, i, async () => { asked++; return { value: { pick: -1, confidence: 0.5, reason: "x" }, by: "stub" }; }); closed += r.trades.length; if (!book.state.pos) break; }
  assert.ok(closed >= 1 || !book.state.pos, "the position was closed by code");
  assert.equal(asked, 1, "no question while the position was open");
});
