// DeskBot v5 — configuration guard (pure). Checks a RESOLVED book configuration against named rules and returns every violation
// as { rule, msg }. It rejects or reports; it never rewrites a value. Run on each book every run and recorded as lastRun.cfgGuard
// (observe-only for books: a violation does not pause or change the book).
// Portions adapted from Superior-Trade/trading-terminal (Apache-2.0, Copyright 2026 Superior Trade), modified for DeskBot.
//   - the "pure validator returning named-rule errors; reject, never silently rewrite" shape: lib/freqtrade-guard.ts
import { CFG_DEFAULTS, OPT_IN, STRATEGIES } from "./engine.ts";

export type Violation = { rule: string; msg: string };
export type CfgGuard = { ok: boolean; violations: Violation[]; info: Violation[] };
export const GUARD_MAX_LEVERAGE = 5;
export const GUARD_MAX_COST = 0.01;   // a fee or slippage of 1% or more per side is treated as a typo

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function guardCfg(resolved: unknown): CfgGuard {
  const violations: Violation[] = [], info: Violation[] = [];
  const v = (rule: string, msg: string) => violations.push({ rule, msg });
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) return { ok: false, violations: [{ rule: "CFG_OBJECT", msg: "configuration must be an object" }], info };
  const c = resolved as Record<string, unknown>;
  // RISK_SCALE: every value in [0, 1]; opt-in strategies above 0 are reported (informational)
  const rs = c.RISK_SCALE;
  if (rs && typeof rs === "object" && !Array.isArray(rs)) {
    for (const [s, x] of Object.entries(rs as Record<string, unknown>)) {
      if (!isNum(x) || x < 0 || x > 1) v("RISK_SCALE_RANGE", `RISK_SCALE.${s} = ${JSON.stringify(x)} is outside [0, 1]`);
      if (!(STRATEGIES as string[]).includes(s)) v("RISK_SCALE_UNKNOWN_STRATEGY", `RISK_SCALE.${s}: unknown strategy`);
    }
    for (const s of OPT_IN) { const x = (rs as Record<string, unknown>)[s]; if (isNum(x) && x > 0) info.push({ rule: "OPT_IN_ENABLED", msg: `opt-in strategy ${s} is enabled (RISK_SCALE ${x})` }); }
  } else v("RISK_SCALE_RANGE", "RISK_SCALE must be an object keyed by strategy");
  // leverage cap
  if (!isNum(c.MAX_LEVERAGE) || c.MAX_LEVERAGE <= 0 || c.MAX_LEVERAGE > GUARD_MAX_LEVERAGE) v("MAX_LEVERAGE_CAP", `MAX_LEVERAGE = ${JSON.stringify(c.MAX_LEVERAGE)} must be in (0, ${GUARD_MAX_LEVERAGE}]`);
  // targets per strategy: 0 < tp1 <= tp2 <= tp3, maxHoldH > 0
  const tg = c.TARGETS;
  if (tg && typeof tg === "object" && !Array.isArray(tg)) {
    for (const [s, t] of Object.entries(tg as Record<string, unknown>)) {
      const o = (t ?? {}) as Record<string, unknown>;
      if (![o.tp1, o.tp2, o.tp3].every((x) => isNum(x) && x > 0)) v("TARGETS_POSITIVE", `TARGETS.${s}: tp1, tp2, tp3 must all be > 0`);
      else if (!((o.tp1 as number) <= (o.tp2 as number) && (o.tp2 as number) <= (o.tp3 as number))) v("TARGETS_ORDER", `TARGETS.${s}: needs tp1 <= tp2 <= tp3 (got ${o.tp1}/${o.tp2}/${o.tp3})`);
      if (!isNum(o.maxHoldH) || o.maxHoldH <= 0) v("MAX_HOLD_POSITIVE", `TARGETS.${s}.maxHoldH = ${JSON.stringify(o.maxHoldH)} must be > 0`);
    }
  } else v("TARGETS_POSITIVE", "TARGETS must be an object keyed by strategy");
  // costs: 0 <= x < 1%
  for (const k of ["TAKER_FEE", "MAKER_FEE", "SLIPPAGE"] as const) {
    const x = c[k]; if (!isNum(x) || x < 0 || x >= GUARD_MAX_COST) v("COST_RANGE", `${k} = ${JSON.stringify(x)} must be >= 0 and < ${GUARD_MAX_COST * 100}%`);
  }
  // unknown top-level keys (a typo in a book override survives resolvedCfg as an extra key)
  const known = new Set(Object.keys(CFG_DEFAULTS));
  for (const k of Object.keys(c)) if (!known.has(k)) v("UNKNOWN_KEY", `unknown configuration key ${k}`);
  return { ok: violations.length === 0, violations, info };
}
