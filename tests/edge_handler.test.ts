import { test } from "node:test";
import assert from "node:assert/strict";
import { initState, openPosition, applyCfg, CFG, type State } from "../supabase/functions/deskbot-v5/engine.ts";

test("edge run keeps managing an open position while unapproved entries are paused; GET is read-only", async () => {
  const env: Record<string, string> = { SUPABASE_URL: "https://deskbot.test", SUPABASE_SERVICE_ROLE_KEY: "test-only", DESKBOT_CRON_SECRET: "test-only", NEWS_MODE: "off", DESKBOT_BOOKS: "BTC" };
  let handler!: (req: Request) => Promise<Response>;
  const previousDeno = (globalThis as any).Deno, previousFetch = globalThis.fetch;
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: (h: typeof handler) => { handler = h; } };
  const now = Date.now(); applyCfg();
  let state: State = initState(1000, now - 600_000);
  const pos = openPosition(state, { strategy: "TREND_MTF", dir: "long", entryRef: 100, stop: 90, score: 90, why: [], regime: "TREND", barT: now - 600_000 }, 100, now - 600_000)!;
  let writes = 0, savedTrades: any[] = [];
  const json = (x: unknown) => new Response(x == null ? "" : JSON.stringify(x), { status: 200 });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input), body = init.body ? JSON.parse(String(init.body)) : null;
    if (url.startsWith("https://deskbot.test/rest/v1/")) {
      const path = url.split("/rest/v1/")[1];
      if (init.method !== "GET") {
        writes++;
        if (path === "rpc/dbv5_lease") return json(true);
        if (path.startsWith("dbv5_state?") && body.state) state = structuredClone(body.state);
        if (path === "dbv5_trades") savedTrades = body;
        return json(null);
      }
      if (path.startsWith("dbv5_state?")) return json([{ state: structuredClone(state), updated_at: new Date(now).toISOString() }]);
      return json([]);
    }
    if (url.includes("hyperliquid")) {
      if (body.type === "metaAndAssetCtxs") return json([{ universe: [{ name: "BTC" }] }, [{ funding: "0", openInterest: "1", markPx: "85" }]]);
      const { interval } = body.req;
      const ms = ({ "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3600_000, "4h": 14400_000 } as Record<string, number>)[interval];
      const end = Math.floor(now / ms) * ms;
      return json(Array.from({ length: interval === "4h" ? 700 : 400 }, (_, i) => ({ t: end - (400 - i) * ms - (interval === "4h" ? 300 * ms : 0), o: "85", h: "86", l: "84", c: "85", v: "10" })));
    }
    if (url.includes("alternative.me")) return json({ data: [{ value: "50", value_classification: "Neutral" }] });
    if (url.includes("binance.vision")) return json([]); // optional order flow
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    await import("../supabase/functions/deskbot-v5/index.ts");
    const r = await handler(new Request("https://edge.test", { method: "POST", headers: { "x-deskbot-key": "test-only", "Content-Type": "application/json" }, body: '{"action":"run"}' }));
    const result = await r.json();
    assert.equal(r.status, 200);
    assert.equal(result.books.BTC.integrity.approved, false);
    assert.equal(result.books.BTC.closed, 1);
    assert.equal(state.pos, null);
    assert.equal(savedTrades[0].id, pos.id);
    assert.ok(savedTrades[0].net < 0);
    const before = writes;
    CFG.MIN_SCORE = 93;
    const status = await (await handler(new Request("https://edge.test"))).json();
    assert.equal(status.integrity.approved, false);
    assert.equal(CFG.MIN_SCORE, 93);
    assert.equal(writes, before);
  } finally {
    globalThis.fetch = previousFetch; (globalThis as any).Deno = previousDeno; applyCfg();
  }
});
