// Through the real edge handler: one run must leave per-strategy coverage in the saved state and in lastRun, and must not change trading outputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initState, applyCfg, STRATEGIES, type State } from "../supabase/functions/deskbot-v5/engine.ts";

test("a run records WHY each strategy did or did not trade, for all 11 strategies, in state and lastRun", async () => {
  const env: Record<string, string> = { SUPABASE_URL: "https://deskbot.test", SUPABASE_SERVICE_ROLE_KEY: "test-only", DESKBOT_CRON_SECRET: "test-only", NEWS_MODE: "off", DESKBOT_BOOKS: "BTC", AGENT_AI: "off" };
  let handler!: (req: Request) => Promise<Response>; const pD = (globalThis as any).Deno, pF = globalThis.fetch;
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => { handler = h; } };
  const now = Date.now(); applyCfg(); let state: State = initState(350, now - 3_600_000); state.cfg = { RISK_SCALE: { D_THRUST: 1, HTF_TREND: 1, SWEEP_REV: 1, TREND_MTF: 1, D_BEARTRAP: 1, SESSION_BO: 1, VWAP_REVERT: 1 } } as never;
  let lastRun: any = null; const json = (x: unknown) => new Response(x == null ? "" : JSON.stringify(x), { status: 200 });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input), body = init.body ? JSON.parse(String(init.body)) : null;
    if (url.startsWith("https://deskbot.test/rest/v1/")) {
      const path = url.split("/rest/v1/")[1];
      if (init.method !== "GET") { if (path === "rpc/dbv5_lease") return json(true); if (path.startsWith("dbv5_state?") && body.state) { state = structuredClone(body.state); lastRun = body.last_run; } return json(null); }
      return path.startsWith("dbv5_state?") ? json([{ state: structuredClone(state), updated_at: new Date(now).toISOString() }]) : json([]);
    }
    if (url.includes("hyperliquid")) {
      if (body.type === "metaAndAssetCtxs") return json([{ universe: [{ name: "BTC" }] }, [{ funding: "0", openInterest: "1", markPx: "85" }]]);
      const { interval } = body.req, ms = ({ "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3600_000, "4h": 14400_000 } as Record<string, number>)[interval], end = Math.floor(now / ms) * ms;
      return json(Array.from({ length: interval === "4h" ? 700 : 400 }, (_, i) => ({ t: end - (400 - i) * ms - (interval === "4h" ? 300 * ms : 0), o: "85", h: "86", l: "84", c: "85", v: "10" })));
    }
    if (url.includes("alternative.me")) return json({ data: [{ value: "50", value_classification: "Neutral" }] });
    if (url.includes("binance.vision")) return json([]);
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    await import("../supabase/functions/deskbot-v5/index.ts?cov");
    const r = await (await handler(new Request("https://edge.test", { method: "POST", headers: { "x-deskbot-key": "test-only", "Content-Type": "application/json" }, body: '{"action":"run"}' }))).json();
    assert.equal(r.books.BTC.ok, true);
    assert.deepEqual(Object.keys(state.cov!).sort(), [...STRATEGIES].sort(), "counters for every strategy, including opt-in ones that are off");
    assert.equal(state.covMeta!.evalBars, 1); assert.equal(lastRun.coverage.length, 11);
    const code = (id: string) => lastRun.coverage.find((c: any) => c.id === id).code;
    assert.equal(code("HTF_SWEEP"), "DISABLED"); assert.equal(code("SSR"), "DISABLED"); assert.equal(state.cov!.SSR.disabledBars, 1);
    const live = lastRun.coverage.filter((c: any) => c.code !== "DISABLED"); assert.equal(live.length, 7);
    for (const c of live) assert.ok(["NOT_DUE", "NO_SETUP", "GATE_REJECTED", "INSUFFICIENT_DATA"].includes(c.code), `${c.id} ${c.code}`);
    assert.equal(state.stats.all.n, 0, "zero closed trades while every enabled strategy was evaluated");
    assert.ok(state.cov!.TREND_MTF.completed + state.cov!.TREND_MTF.skippedData >= 1 && state.cov!.TREND_MTF.due === 1);
  } finally { globalThis.fetch = pF; (globalThis as any).Deno = pD; applyCfg(); }
});
