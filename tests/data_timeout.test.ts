// Network deadlines cover the BODY read, not only the headers: a response whose json() never resolves must not hang a run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeout, candles, hlContext } from "../supabase/functions/deskbot-v5/data.ts";

// fetch answers 200 at once, then the body stalls forever (and ignores the abort signal, the worst case)
const stalledBody = (calls: string[]) => (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  calls.push(String(input)); assert.ok(init.signal, "every request carries the deadline's abort signal");
  return { ok: true, status: 200, json: () => new Promise(() => {}), text: () => new Promise(() => {}) } as unknown as Response;
}) as typeof fetch;

test("withTimeout: a body read that never resolves is cut off at the deadline and the request is aborted", async () => {
  let signal!: AbortSignal; const t0 = Date.now();
  await assert.rejects(withTimeout(async (s) => { signal = s; return await new Promise<never>(() => {}); }, 40), /timed out after 40 ms/);
  assert.ok(Date.now() - t0 < 2000); assert.equal(signal.aborted, true);
  assert.equal(await withTimeout(async () => 7, 40), 7, "a prompt result passes through");
});

test("candle and context reads are bounded through the body (fake fetch whose json() never resolves)", async (t) => {
  const pF = globalThis.fetch, calls: string[] = [];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = stalledBody(calls);
  try {
    const ctx = hlContext("BTC"), bars = candles("5m", 100, Date.now(), "hyperliquid", "BTC").then(() => "resolved", (e: Error) => e.message);
    for (let i = 0; i < 4; i++) { await new Promise((r) => setImmediate(r)); t.mock.timers.tick(8000); }   // HL deadline, then the Binance fallback's
    assert.equal(await ctx, null, "context read gives up (null) instead of hanging");
    assert.match(await bars, /timed out after 8000 ms/, "the Binance fallback's stalled body is bounded too");
    assert.ok(calls.some((u) => u.includes("hyperliquid")) && calls.some((u) => u.includes("binance")));
  } finally { globalThis.fetch = pF; }
});
