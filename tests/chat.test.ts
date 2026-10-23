import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePatch, mergeCfg, validateChat } from "../supabase/functions/deskbot-v5/chat.ts";

test("valid patch passes and merges per-strategy maps", () => {
  const v = validatePatch({ RISK_SCALE: { TREND_MTF: 0.25 }, REGIME_GATE: { HTF_TREND: 0.02 }, EXIT_MODE: "HOLD" });
  assert.ok(v.ok);
  const m = mergeCfg({ RISK_SCALE: { HTF_TREND: 1, TREND_MTF: 0.5 }, REGIME_GATE: { HTF_TREND: 0.03, D_BEARTRAP: 0.03 } }, (v as any).patch) as any;
  assert.deepEqual(m.RISK_SCALE, { HTF_TREND: 1, TREND_MTF: 0.25 }); assert.equal(m.REGIME_GATE.HTF_TREND, 0.02); assert.equal(m.REGIME_GATE.D_BEARTRAP, 0.03);
});
test("null removes a regime gate", () => {
  const v = validatePatch({ REGIME_GATE: { TREND_MTF: null } }); assert.ok(v.ok);
  assert.deepEqual((mergeCfg({ REGIME_GATE: { TREND_MTF: 0.03, HTF_TREND: 0.03 } }, (v as any).patch) as any).REGIME_GATE, { HTF_TREND: 0.03 });
});
test("risk limits and unknown keys are rejected", () => {
  for (const bad of [{ MAX_LEVERAGE: 20 }, { DAILY_LOSS_LIMIT: 0.5 }, { RISK_SCALE: { HTF_TREND: 3 } }, { RISK_SCALE: { FAKE: 1 } }, { MIN_SCORE: 10 }, { EXIT_MODE: "YOLO" }, { TAKER_FEE: 0 }, "x", null, {}])
    assert.equal(validatePatch(bad).ok, false, JSON.stringify(bad));
});
test("chat output: bad proposal is dropped, reply kept", () => {
  const r = validateChat({ reply: "ok", proposal: { patch: { MAX_LEVERAGE: 50 }, why: "more money" } });
  assert.equal(r?.reply, "ok"); assert.equal(r?.proposal, null); assert.ok(r?.proposalErrors?.length);
  assert.equal(validateChat({ reply: "" }), null);
});
