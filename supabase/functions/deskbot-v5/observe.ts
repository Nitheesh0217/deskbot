// Observability only (status endpoint / lastRun): per-timeframe data freshness and per-strategy decision receipts.
// Nothing here is read by entry, exit, sizing or risk logic, and nothing is fetched: both are derived from values the run already holds.
import type { Bar } from "./engine.ts";
import type { Code } from "./coverage.ts";

export type Tf = "m5" | "m15" | "h1" | "h4";
export type FrameInfo = { source: string; lastClosedBarT: number | null; receivedAtMs: number | null; bars: number; gaps: number };
const TF_MS: Record<Tf, number> = { m5: 300_000, m15: 900_000, h1: 3_600_000, h4: 14_400_000 };
/** Missing bars inside a frame (consecutive opens further apart than one bar). Observe-only data check (jsystemtrader-style validity); it gates nothing. */
export const gapCount = (b: Bar[], ms: number) => { let n = 0; for (let i = 1; i < b.length; i++) { const d = b[i].t - b[i - 1].t; if (d > ms) n += Math.round(d / ms) - 1; } return n; };

/** One entry per evaluation frame: feed, close time (ms) of the newest closed bar, receipt time, bar count. Unknown stays null. */
export function frameInfo(frames: Record<Tf, { bars: Bar[]; source: string }>, rx: Partial<Record<Tf, number>>): Record<Tf, FrameInfo> {
  const one = (k: Tf): FrameInfo => {
    const b = frames[k].bars, last = b.length ? b[b.length - 1] : null;
    return { source: frames[k].source, lastClosedBarT: last && Number.isFinite(last.ct) ? last.ct : null, receivedAtMs: rx[k] ?? null, bars: b.length, gaps: gapCount(b, TF_MS[k]) };
  };
  return { m5: one("m5"), m15: one("m15"), h1: one("h1"), h4: one("h4") };
}

export type Outcome = "EXECUTED" | "WAIT" | "GATE_REJECTED" | "NOT_DUE" | "DISABLED" | "NO_SETUP" | "SHADOW_SIGNAL";
/** `code` is the coverage code, present only when it is not the same word as the outcome (e.g. NOT_SELECTED shown as WAIT). */
export type Receipt = { strategy: string; outcome: Outcome; code?: string; reason: string; barT: number };

const REASON_MAX = 90;
const cut = (s: string) => (s.length > REASON_MAX ? s.slice(0, REASON_MAX - 1) + "…" : s);

/**
 * Coverage dispositions of the newest evaluated bar -> compact receipts. EXECUTED requires BOTH the coverage code ENTERED and
 * `opened` (the position this run actually opened) naming the same strategy; anything else is never reported as executed.
 */
export function receiptsFor(cov: { id: string; code: Code; reason: string }[] | null, a: { barT: number; opened: { strategy: string } | null; shadow?: { strategy: string; barT: number }[] }): Receipt[] | null {
  if (!Array.isArray(cov)) return null;
  const out: Receipt[] = [];
  for (const c of cov) {
    let outcome: Outcome;
    switch (c.code) {
      case "ENTERED": outcome = a.opened && a.opened.strategy === c.id ? "EXECUTED" : "GATE_REJECTED"; break;
      case "NOT_DUE": case "DISABLED": case "NO_SETUP": case "GATE_REJECTED": outcome = c.code; break;
      case "PORTFOLIO_BLOCKED": outcome = /^Position already open/.test(c.reason) ? "WAIT" : "GATE_REJECTED"; break;
      default: outcome = "WAIT";   // NOT_SELECTED, INSUFFICIENT_DATA, ERROR: the code field keeps which one
    }
    const r: Receipt = { strategy: c.id, outcome, reason: cut(outcome === "GATE_REJECTED" && c.code === "ENTERED" ? "Entry not opened this run" : c.reason), barT: a.barT };
    if (c.code !== outcome && !(c.code === "ENTERED" && outcome === "EXECUTED")) r.code = c.code;
    out.push(r);
  }
  for (const s of a.shadow ?? []) out.push({ strategy: s.strategy, outcome: "SHADOW_SIGNAL", reason: "Catch-up setup still valid (shadow mode, not entered)", barT: s.barT });
  return out;
}
