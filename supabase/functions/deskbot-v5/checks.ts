// DeskBot v5 — observe-only safety / observability checks (paper only). Every function here is PURE and its output is recorded and
// shown; nothing here gates an entry, changes sizing, stops, targets, fees, risk limits or strategy logic.
// Portions adapted from Superior-Trade/trading-terminal (Apache-2.0, Copyright 2026 Superior Trade), modified for DeskBot.
//   - LIQ_BUFFER and the degenerate-stop threshold: lib/plan-sizing.ts
//   - the range diagnostic (Kaufman efficiency + alternating quartile touches): lib/market-context.ts
import type { Bar, Position } from "./engine.ts";
import type { HlCtx } from "./data.ts";

/** Liquidation must sit at least this many stop distances away (trading-terminal plan-sizing LIQ_BUFFER). */
export const LIQ_BUFFER = 3;
/** A stop closer than this fraction of entry is treated as degenerate (0.05%). */
export const DEGENERATE_STOP = 0.0005;
/** Exchange minimum order value in USD (Hyperliquid: $10). */
export const MIN_NOTIONAL_USD = 10;

export type HlView = { szDecimals: number | null; maxLeverage: number | null; delisted: boolean | null; oraclePx: number | null; premium: number | null; fundingAprPct: number | null; oi: number | null };
/** `lastRun.market.hl`: null fields when unknown (request failed or coin missing). */
export function hlView(ctx: HlCtx | null): HlView {
  const n = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : x);
  if (!ctx) return { szDecimals: null, maxLeverage: null, delisted: null, oraclePx: null, premium: null, fundingAprPct: null, oi: null };
  return { szDecimals: n(ctx.szDecimals), maxLeverage: n(ctx.maxLeverage), delisted: ctx.delisted ?? null, oraclePx: n(ctx.oraclePx), premium: n(ctx.premium), fundingAprPct: n(ctx.fundingAprPct), oi: n(ctx.oi) };
}

export type PositionChecks = {
  impliedLeverage: number; liqBufferX: number | null; liqOk: boolean; notionalUsd: number; minNotionalOk: boolean;
  qtyRepresentable: boolean | null; degenerateStop: boolean; ok: boolean; notes: string[];
};
/**
 * Checks for an OPEN paper position. null when flat.
 *  impliedLeverage = notional / equity, notional = remainingQty x price.
 *  Liquidation distance (fraction of price) is APPROXIMATED as for an isolated position margined with the whole equity:
 *  liqDist ~ 1 / impliedLeverage, minus Hyperliquid's maintenance margin rate 1 / (2 x maxLeverage) when maxLeverage is known.
 *  Funding, fees and the exchange's exact margin tiers are ignored; it is an order-of-magnitude check, not a liquidation price.
 *  liqBufferX = liqDist / stopDist, where stopDist = |price - current stop| / price (null when the stop sits at the price).
 *  degenerateStop uses the ORIGINAL stop (stop0) against entry, so a later move to breakeven is not flagged.
 *  qtyRepresentable: remainingQty rounded to szDecimals is > 0 and within 1% of the unrounded quantity (null when szDecimals unknown).
 */
export function positionChecks(pos: Position | null, equity: number, price: number, hl: Pick<HlView, "szDecimals" | "maxLeverage"> | null): PositionChecks | null {
  if (!pos) return null;
  const notes: string[] = [];
  const notionalUsd = pos.remainingQty * price;
  const impliedLeverage = equity > 0 ? notionalUsd / equity : Infinity;
  const mmr = hl?.maxLeverage && hl.maxLeverage > 0 ? 1 / (2 * hl.maxLeverage) : 0;
  const liqDist = impliedLeverage > 0 ? Math.max(0, 1 / impliedLeverage - mmr) : Infinity;
  const stopDist = price > 0 ? Math.abs(price - pos.stop) / price : 0;
  const liqBufferX = stopDist > 0 && Number.isFinite(liqDist) ? liqDist / stopDist : null;
  const liqOk = liqBufferX == null ? Number.isFinite(liqDist) ? liqDist > 0 : true : liqBufferX >= LIQ_BUFFER;
  const minNotionalOk = notionalUsd >= MIN_NOTIONAL_USD;
  let qtyRepresentable: boolean | null = null;
  if (hl?.szDecimals != null && Number.isFinite(hl.szDecimals)) {
    const f = 10 ** hl.szDecimals, q = pos.remainingQty, rounded = Math.round(q * f) / f;
    qtyRepresentable = rounded > 0 && q > 0 && Math.abs(rounded - q) / q <= 0.01;
  }
  const degenerateStop = Math.abs(pos.entry - pos.stop0) < DEGENERATE_STOP * pos.entry;
  if (!liqOk) notes.push(`Approximate liquidation is ${liqBufferX == null ? "at or inside" : `${liqBufferX.toFixed(2)}x`} the stop distance (wants >= ${LIQ_BUFFER}x)`);
  if (!minNotionalOk) notes.push(`Notional $${notionalUsd.toFixed(2)} is below the $${MIN_NOTIONAL_USD} exchange minimum`);
  if (qtyRepresentable === false) notes.push(`Quantity ${pos.remainingQty} does not round cleanly to ${hl?.szDecimals} size decimals`);
  if (qtyRepresentable === null) notes.push("Size decimals unknown: quantity representability not checked");
  if (degenerateStop) notes.push(`Original stop is within ${(DEGENERATE_STOP * 100).toFixed(2)}% of entry`);
  notes.push("Liquidation distance is approximate: 1/leverage minus maintenance margin; paper only, observe-only");
  const r = (x: number, d = 4) => (Number.isFinite(x) ? +x.toFixed(d) : x);
  return {
    impliedLeverage: r(impliedLeverage), liqBufferX: liqBufferX == null ? null : r(liqBufferX, 2), liqOk, notionalUsd: r(notionalUsd, 2), minNotionalOk,
    qtyRepresentable, degenerateStop, ok: liqOk && minNotionalOk && qtyRepresentable !== false && !degenerateStop, notes,
  };
}

export type RangeDiag = { efficiency: number; touches: number; isRange: boolean };
/**
 * Range diagnostic over the last 120 CLOSED 1h bars (needs at least 40, else null).
 *  efficiency = |close_last - close_first| / sum |close_i - close_{i-1}| (Kaufman efficiency ratio; low = choppy).
 *  touches = alternating visits to the top / bottom quartile of the window's high-low range (a bar whose high reaches the top
 *  quartile counts as "top", else one whose low reaches the bottom quartile counts as "bottom"; only a change of side counts).
 *  isRange = efficiency < 0.25 && touches >= 4. Observe-only: never fed into the regime or any gate.
 */
export function rangeDiag(h1Bars: Bar[], now = Infinity): RangeDiag | null {
  const w = h1Bars.filter((b) => b.ct < now).slice(-120);
  if (w.length < 40) return null;
  const hi = Math.max(...w.map((b) => b.h)), lo = Math.min(...w.map((b) => b.l));
  const net = Math.abs(w[w.length - 1].c - w[0].c);
  let path = 0; for (let i = 1; i < w.length; i++) path += Math.abs(w[i].c - w[i - 1].c);
  const efficiency = path > 0 ? net / path : 1;
  const topQ = hi - (hi - lo) * 0.25, botQ = lo + (hi - lo) * 0.25;
  let touches = 0, last: "top" | "bot" | null = null;
  for (const b of w) {
    const z = b.h >= topQ ? "top" : b.l <= botQ ? "bot" : null;
    if (z && z !== last) { touches++; last = z; }
  }
  return { efficiency: +efficiency.toFixed(4), touches, isRange: efficiency < 0.25 && touches >= 4 };
}

export type IntentCheck = { ok: boolean; mismatches: { field: string; planned: unknown; opened: unknown }[] };
/** Intent fidelity: the opened position must equal the recorded decision plan (dir, originalQty, stop0, tp1-3). */
export function intentCheck(plan: Record<string, unknown> | null | undefined, pos: Position | null): IntentCheck {
  const mismatches: IntentCheck["mismatches"] = [];
  if (!plan) return { ok: false, mismatches: [{ field: "plan", planned: null, opened: pos ? pos.id : null }] };
  if (!pos) return { ok: false, mismatches: [{ field: "position", planned: "open", opened: null }] };
  const close = (a: unknown, b: unknown) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (plan.dir !== pos.dir) mismatches.push({ field: "dir", planned: plan.dir, opened: pos.dir });
  for (const k of ["originalQty", "stop0", "tp1", "tp2", "tp3"] as const) if (!close(plan[k], pos[k])) mismatches.push({ field: k, planned: plan[k] ?? null, opened: pos[k] });
  return { ok: mismatches.length === 0, mismatches };
}
