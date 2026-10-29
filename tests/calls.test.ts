// CALL-1: a frozen, rule-based directional call per market, scored 4 hours later.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "../supabase/functions/deskbot-v5/engine.ts";
import { marketCall, CALL_HORIZON_H } from "../supabase/functions/deskbot-v5/scan.ts";
import { scoreCall, callRecord } from "../supabase/functions/deskbot-v5/track.ts";

const s = (o = {}) => ({ T: 1000, price: 100, atr15: 2, st15: 1, st1h: 1, st4h: 1, vwapDev: 0, rsi15: 55, ...o });
test("call rule: a fired setup decides; otherwise >=3 trend/VWAP votes; cautions never flip the call", () => {
  assert.equal(CALL_HORIZON_H, 4);
  assert.deepEqual([marketCall(s(), [], null).lean, marketCall(s(), [], null).votes, marketCall(s(), [], null).source], ["LONG", 3, "trend vote"]);
  assert.equal(marketCall(s({ st4h: -1 }), [], null).lean, "NONE");
  assert.equal(marketCall(s({ st15: -1, st1h: -1, st4h: -1, vwapDev: -1 }), [], null).votes, -4);
  assert.equal(marketCall(s({ st15: -1, st1h: -1, st4h: 1, vwapDev: -1 }), [], null).lean, "NONE", "-2 is no call"); assert.equal(marketCall(s({ st15: -1, st1h: -1, st4h: 0, vwapDev: -1 }), [], null).lean, "SHORT");
  const set = marketCall(s(), [{ dir: "short", score: 0.4 }, { dir: "long", score: 0.2 }], null); assert.deepEqual([set.lean, set.source], ["SHORT", "rules setup"]);
  const hot = marketCall(s({ rsi15: 80 }), [], 0.0002); assert.equal(hot.lean, "LONG"); assert.deepEqual(hot.cautions, ["RSI15 80: stretched up", "longs crowded (funding)"]);
});

const bar = (ct: number, c: number): Bar => ({ t: ct - 299_999, o: c, h: c, l: c, c, v: 1, ct });
test("scoring: the close of the first bar at or after t + 4h; open until it exists; SHORT is right when price falls", () => {
  const t = 1_000_000, H = 4 * 3600_000, call = { id: 7, sym: "BTC", t, horizon_h: 4, lean: "LONG" as const, px: 100, atr: 2 };
  assert.equal(scoreCall(call, [bar(t + H - 1, 105)]), null);
  assert.deepEqual(scoreCall(call, [bar(t + H - 1, 105), bar(t + H + 299_999, 103), bar(t + H + 600_000, 90)]), { id: 7, px_end: 103, end_t: t + H + 299_999, move_pct: 3, move_atr: 1.5, hit: true });
  assert.equal(scoreCall({ ...call, lean: "SHORT" }, [bar(t + H, 98)])!.hit, true);
  assert.equal(scoreCall({ ...call, lean: "SHORT" }, [bar(t + H, 100)])!.hit, false, "no move is not right");
});

test("call record: hit rate and mean move per market, verdict only after 30 scored calls", () => {
  const rows = [...Array.from({ length: 40 }, (_, i) => ({ sym: "ETH", lean: "LONG", status: "scored", hit: i % 3 !== 0, move_atr: i % 3 ? 0.8 : -0.5, move_pct: 0.4 })), { sym: "BTC", lean: "SHORT", status: "open", hit: null, move_atr: null, move_pct: null }];
  const r = Object.fromEntries(callRecord(rows).map((x: any) => [x.sym, x]));
  assert.equal(r.ETH.scored, 40); assert.equal(r.ETH.hitRate, 65); assert.equal(r.ETH.verdict, "CALLS AHEAD OF MARKET");
  assert.equal(r.BTC.open, 1); assert.equal(r.BTC.verdict, "collecting (0/30)"); assert.equal(r.BTC.hitRate, null);
});
