// Outbound payload minimisation: every external AI path is driven with realistic account data in its inputs, the SERIALIZED request
// bodies are captured, and none may carry an account key or the account values themselves (equity, risk dollars, quantities, $ P&L).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDeskWorkflow, preTradeChecks, analystReports } from "../supabase/functions/deskbot-v5/desk.ts";
import { aiReview } from "../supabase/functions/deskbot-v5/agents.ts";
import { chat } from "../supabase/functions/deskbot-v5/chat.ts";
import { readNews } from "../supabase/functions/deskbot-v5/news.ts";
import { decideJSON, type Provider } from "../supabase/functions/deskbot-v5/ai.ts";
import { egressViolations, committeeFacts, chatFacts, pushClose, pushOpen, ACCOUNT_KEYS } from "../supabase/functions/deskbot-v5/egress.ts";

// the screenshot trade and its book (stored values)
const EQUITY = 342.59566503742155, RISK = 6.851913300748431, QTY = 0.002940028069314983, NET = -5.007823760318088;
const pos = { id: "V5-1793318461202", strategy: "HTF_TREND", dir: "short", entry: 77822.4324, stop: 80065.92995554466, stop0: 80065.92995554466, tp1: 74457.18606668302, tp2: 71091.93973336603, tp3: 64361.44706673206,
  tp1Done: false, tp2Done: false, maxHoldH: 504, originalQty: QTY, remainingQty: QTY, closedQty: 0, riskAmt: RISK, equityBefore: EQUITY };
const secretValues = [String(EQUITY).slice(0, 7), String(RISK).slice(0, 6), String(QTY).slice(0, 8), "0.00294", "6.85", "342.5", String(NET).slice(0, 6), "gsk_test", "sk-live"];
const provider: Provider = { name: "gemini", url: "https://llm.test/v1/chat", model: "m", key: "gsk_test_key", dailyCap: 100 };

function capture(reply: (system: string) => unknown) {
  const bodies: string[] = [];
  const f = async (_u: string, init: RequestInit) => {
    const raw = String(init.body); bodies.push(raw);
    const b = JSON.parse(raw); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(b.messages[0].content)) } }] }), { status: 200 });
  };
  return { bodies, f };
}
function assertClean(bodies: string[], label: string) {
  assert.ok(bodies.length > 0, `${label}: at least one outbound request`);
  for (const raw of bodies) {
    const b = JSON.parse(raw), text = b.messages.map((m: { content: string }) => m.content).join("\n");
    assert.deepEqual(egressViolations(text), [], `${label}: no account keys in the prompt`);
    for (const v of secretValues) assert.ok(!text.includes(v), `${label}: value ${v} must not leave the system`);
    assert.deepEqual(Object.keys(b).sort(), ["max_tokens", "messages", "model", "response_format", "temperature"].filter((k) => k in b).sort(), `${label}: only the chat-completion fields`);
  }
}

test("guard: every account key is detected; market fields with similar names are not", () => {
  for (const k of ACCOUNT_KEYS) assert.deepEqual(egressViolations(JSON.stringify({ [k]: 1 })), [k]);
  assert.deepEqual(egressViolations(JSON.stringify({ funding_per_interval: 0.0001, open_interest: 5, TAKER_FEE: 0.00045, risk_pct_of_price: 2.88, account_data: "withheld" })), []);
});

test("decideJSON refuses a request that still carries account fields, without calling any provider", async () => {
  let calls = 0;
  const r = await decideJSON("s", JSON.stringify({ plan: { riskAmt: RISK } }), (x) => x, { providers: [provider], usage: {}, now: Date.now(), fetchImpl: (async () => { calls++; return new Response("{}"); }) as never });
  assert.equal(calls, 0); assert.equal(r.value, null); assert.match((r as { errors: string[] }).errors[0], /egress blocked.*riskAmt/);
});

test("committee: plan goes out in price / % / R; no size, risk dollars or equity in any of the stage requests", async () => {
  const checks = preTradeChecks({ plan: { dir: "short", entry: pos.entry, stop0: pos.stop0, tp1: pos.tp1, maxHoldH: 504, strategy: pos.strategy }, atr15: 300, hour: 0, funding: 0.00001, costs: { taker: 0.00045, slippage: 0.0002 } });
  const analysts = analystReports({ price: 77300, regime: "TREND", trend: { "4h": -1 }, funding: 0.00001, oi: 30000, fng: 68, flow24: -0.026, headlines: ["Bitcoin slides"] });
  const facts = committeeFacts({ ref: pos.id, sym: "BTC", strategy: pos.strategy, dir: pos.dir, regime: "TREND", why: ["4H close beyond 55-bar low"], plan: pos, analysts, chart: { bias: "bear" }, checks });
  assert.equal(facts.plan.tp1_r, 1.5); assert.equal(facts.plan.tp3_r, 6); assert.equal(facts.plan.risk_pct_of_price, 2.883); assert.match(facts.account_data, /withheld/);
  const { bodies, f } = capture((sys) => /Bull/.test(sys) || /Bear/.test(sys) ? { argument: "Trend and breakout agree on the 4H.", strongest_point: "trend" } : { rating: "Hold", rationale: "Balanced.", stronger_side: "balanced", executive_summary: "Balanced.", thesis: "Balanced.", would_change_my_mind: "A close back above the trigger.", proposal: "Hold", stance: "neutral", argument: "x", strongest_point: "y", plan: "hold" });
  await runDeskWorkflow({ ref: pos.id, sym: "BTC", strategy: pos.strategy, dir: pos.dir, regime: "TREND", why: ["4H close beyond 55-bar low"], chart: { bias: "bear" }, checks, analysts, lessons: ["last 2 closed HTF_TREND trades: 1 won, total 0.50R"],
    plan: { dir: "short", entry: pos.entry, stop0: pos.stop0, tp1: pos.tp1, tp2: pos.tp2, tp3: pos.tp3, maxHoldH: 504, strategy: pos.strategy, riskAmt: RISK } },
    { providers: [provider], usage: {}, now: Date.now(), fetchImpl: f as never, sleep: async () => {} });
  assertClean(bodies, "committee");
});

test("shadow AI review: trade levels and rule text only", async () => {
  const { bodies, f } = capture(() => ({ verdict: "unsure", reason: "thin" }));
  const g = globalThis.fetch; (globalThis as any).fetch = f;
  try { await aiReview({ ...(pos as any), reentry: false, why: [] }, ["4H close beyond 55-bar low"], { bias: "bear", regime: "TREND", trend: {}, support: null, resistance: null, levels: [] } as never, { providers: [provider], usage: {}, now: Date.now() }); }
  finally { (globalThis as any).fetch = g; }
  assertClean(bodies, "aiReview");
});

test("owner chat: the context is the allowlisted view; equity, $ P&L and quantities are withheld and the reply says so", async () => {
  const raw = { version: "5.9.0", updated: "2026-10-30T04:41:01Z",
    state: { equity: EQUITY, startEquity: 352.56, markedEquity: EQUITY, maxDD: 0.0577, peak: 358.6, pos, enabled: { HTF_TREND: true }, cfg: { EXIT_MODE: "HOLD" }, cb: { trips: 1, consec: 0, cooldownUntil: 0 },
      stats: { all: { n: 20, net: -9.96, sumR: -1.316, wins: 10, losses: 10, grossWin: 39.8, grossLoss: 49.8 }, by: { SWEEP_REV: { n: 15, net: NET, sumR: -0.836, wins: 8, losses: 7, grossWin: 30.9, grossLoss: 35.9 } } } },
    lastRun: { market: { price: 77300, funding: 0.00001, oi: 30000 }, action: "HOLD", decision: { signals: [], rejects: [] }, news: { risk: "LOW" }, upnl: 1.53 },
    trades: [{ symbol: "BTC", strategy: "SWEEP_REV", dir: "long", entry: 80000, exit_avg: 79800, net: NET, r: -0.4, reason: "STOP", open_t: "a", close_t: "b" }],
    backtests: [{ ran_at: "x", label: "y", all: { n: 10, net: 12.3, sumR: 2.1 }, maxDD: 0.08, endEquity: 1012.3 }], news: [], editableKeys: ["EXIT_MODE"],
    others: [{ id: "gold", pos: { ...pos, id: "GOLD-1", originalQty: 0.17 }, all: { n: 15, net: -31, sumR: -9.2 }, cfg: {}, action: "HOLD", price: 4000 }] };
  const ctx = chatFacts(raw);
  assert.deepEqual(egressViolations(JSON.stringify(ctx)), []); assert.equal(ctx.stats.byStrategy.SWEEP_REV!.expR, -0.056); assert.equal(ctx.drawdownFromPeakPct, 5.77);
  const { bodies, f } = capture(() => ({ reply: "In R terms the book is at -1.32R over 20 trades.", proposal: null }));
  const keep = { ...process.env }, g = globalThis.fetch; process.env.GEMINI_API_KEY = "gsk_test_key"; (globalThis as any).fetch = f;
  try {
    const r = await chat("How is the book doing?", [{ role: "assistant", content: "Hello" }], ctx, {}, Date.now());
    assert.equal((r as any).accountData, "withheld");
  } finally { (globalThis as any).fetch = g; for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, keep); }
  assertClean(bodies, "chat");
});

test("news classification sends headlines only", async () => {
  const RSS = `<rss><channel><item><title>Bitcoin slides as exchange hack rattles markets</title><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
  const bodies: string[] = [];
  const f = async (u: string, init: RequestInit) => { if (u.includes("llm.test") || init?.method === "POST") { bodies.push(String(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: '{"risk":"ELEVATED","btc_bias":"bear","event_type":"other","reason":"hack"}' } }] })); } return new Response(RSS, { status: 200 }); };
  const keep = { ...process.env }; process.env.GEMINI_API_KEY = "gsk_test_key";
  try { await readNews(Date.now(), {}, { useAi: true, fetchImpl: f as never }); } finally { for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, keep); }
  assertClean(bodies, "news");
});

test("provider errors and fallbacks carry no prompt text; push notifications carry R, never dollars or equity", async () => {
  const r = await decideJSON("SYSTEM-SECRET-PROMPT", "user facts", (x) => x, { providers: [provider, { ...provider, name: "groq" }], usage: {}, now: Date.now(), fetchImpl: (async () => new Response("upstream says: user facts", { status: 500 })) as never, sleep: async () => {} });
  const errs = (r as { errors: string[] }).errors.join(" | "); assert.ok(!/SYSTEM-SECRET|user facts/.test(errs), errs);
  const close = pushClose("GOLD ", { strategy: "EMA_CROSS", dir: "long", reason: "STOP", r: -1.02 }), open = pushOpen("", { strategy: "HTF_TREND", dir: "short", score: 81 }, pos);
  for (const m of [close, open]) { assert.ok(!/\$|Eq |equity|risk \$/i.test(m), m); for (const v of secretValues) assert.ok(!m.includes(v), m); }
  assert.match(close, /-1\.02R/);
});
