// AI trader: an AI agent that PLACES ORDERS in its own PAPER book (row `ai_btc`, simulated equity, separate from every rule-based book).
// Design (borrowed patterns, no code copied: beebots "choose from a menu of valid moves", jev-trader "HOLD when the model misses its
// deadline", warrenduffer "model ranks, code sizes"):
//   * Code builds a MENU of the signals that are valid on this closed bar (the same strategies, stops and targets as the rule books).
//   * The model may pick ONE menu item or NO_TRADE. It cannot invent a price, a stop, a target or a size.
//   * Code then applies the same entry gates (daily loss, cooldown, spacing), sizing and fills as the rule books, and manages the
//     position with the same executor. The model is never asked about an open position: exits are code only.
//   * No provider usable for feature "trader", a timeout or an invalid answer → NO_TRADE (recorded, never a fallback trade).
//   * Facts are allowlisted (egress.ts guard): market state and research expectancy only; no equity, balances, sizes or dollar P&L.
// Paper only. Nothing here can reach a broker.
import {
  CFG, STRATEGIES, OPT_IN, applyCfg, snapshot, idxAt, evaluate, entryGates, openPosition, managePosition, traderManage, markEquity, initState, ensureState,
  type Series, type Bar, type State, type Trade, type Signal, type StrategyId,
} from "./engine.ts";
import { decideJSON, type Provider, type Usage } from "./ai.ts";

export const AI_BOOK_ROW = "ai_btc";
export const AI_SPEC_VERSION = "AI-TRADER-1";
/** Research expectancy shown to the model (R per trade after costs, 3y BTC, isolated lanes; docs/research/2026-11-1x). Facts, not advice. */
export const RESEARCH_EXP_R: Partial<Record<StrategyId, { expR: number | null; trades: number; note: string }>> = {
  HTF_TREND: { expR: 0.064, trades: 87, note: "positive on 6/6 coins; decayed on BTC since 2025" },
  D_BEARTRAP: { expR: 0.16, trades: 19, note: "small sample" },
  D_THRUST: { expR: 0.40, trades: 8, note: "very small sample" },
  TREND_MTF: { expR: -0.058, trades: 105, note: "negative after costs; off in the rule book" },
  SWEEP_REV: { expR: -0.341, trades: 1518, note: "negative after costs; off in the rule book" },
  SESSION_BO: { expR: -0.247, trades: 470, note: "negative after costs; off in the rule book" },
  VWAP_REVERT: { expR: null, trades: 0, note: "no trade in 3 years" },
};
/** The AI book's config: every non-opt-in strategy can appear on the menu (at the rule book's settings); opt-in strategies stay off. */
export function aiBookCfg(base: Record<string, unknown>): Record<string, unknown> {
  return { ...base, RISK_SCALE: Object.fromEntries(STRATEGIES.map((s) => [s, OPT_IN.includes(s) ? 0 : 1])), PROBATION_MIN_TRADES: 1e9, DISABLE_MIN_TRADES: 1e9 };
}

export type AiChoice = { pick: number; confidence: number; reason: string };
export type AiDecisionLog = {
  t: number; barT: number; menu: { strategy: StrategyId; dir: string; score: number }[]; choice: AiChoice | null; by: string;
  outcome: "ENTERED" | "NO_TRADE" | "GATED" | "NO_DECISION"; note?: string; posId?: string;
};
export type AiBook = { state: State; cfg: Record<string, unknown>; lastBarT: number | null; log: AiDecisionLog[]; specVersion: string; simulated: { startEquity: number; note: string } };
export type Decide = (facts: string) => Promise<{ value: AiChoice; by: string } | { value: null; errors: string[] }>;

export function newAiBook(startEquity: number, t0: number, baseCfg: Record<string, unknown>): AiBook {
  const st = ensureState(initState(startEquity, t0)); for (const s of STRATEGIES) st.enabled[s] = !OPT_IN.includes(s);
  return { state: st, cfg: aiBookCfg(baseCfg), lastBarT: null, log: [], specVersion: AI_SPEC_VERSION, simulated: { startEquity, note: "SIMULATED capital; not real money; never added to real wealth" } };
}

function withCfg<T>(cfg: Record<string, unknown>, fn: () => T): T {
  const saved = JSON.parse(JSON.stringify(CFG)); applyCfg(cfg as never);
  try { return fn(); } finally { Object.assign(CFG, saved); }
}

/** Allowlisted facts for the model: the menu and market state. No account fields (egress guard enforces it again before sending). */
export function traderFacts(menu: Signal[], snap: ReturnType<typeof snapshot>, S: Series, sym: string): string {
  const k = snap.i1d, e = k >= 0 ? S.ema50D[k] : NaN, dc = k >= 0 ? S.d1[k].c : NaN;
  const pct = (a: number, b: number) => +(((a - b) / b) * 100).toFixed(2);
  return JSON.stringify({
    instrument: sym, barCloseUtc: new Date(snap.T + 1).toISOString(), price: +snap.price.toPrecision(6),
    market: {
      superTrend: { m15: snap.st15, h1: snap.st1h, h4: snap.st4h }, dailyCloseVsEma50Pct: isFinite(e) ? pct(dc, e) : null, regime: snap.regime,
      chop15: +snap.chop15.toFixed(1), rsi1h: +snap.rsi1h.toFixed(1), atr4hPct: +((snap.atr4h / snap.price) * 100).toFixed(2), vwapDevSd: +snap.vwapDev.toFixed(2),
      fundingPerHourPct: snap.funding == null ? null : +(snap.funding * 100).toFixed(5), fearGreed: snap.fng ?? null,
    },
    menu: menu.map((m, i) => ({
      pick: i, strategy: m.strategy, dir: m.dir, score: Math.round(m.score), stopDistPct: +((Math.abs(m.entryRef - m.stop) / m.entryRef) * 100).toFixed(2),
      research: RESEARCH_EXP_R[m.strategy] ?? { expR: null, trades: 0, note: "no research" }, why: m.why.slice(0, 5),
    })),
  });
}
export const TRADER_SYSTEM = [
  "You are the trader of a PAPER trading book. Choose at most one option from the menu, or none.",
  "Answer with JSON only: {\"pick\": <menu index or -1 for no trade>, \"confidence\": <0..1>, \"reason\": \"<one sentence>\"}.",
  "Each option already has its stop, targets and size set by code; you cannot change them. Exits are handled by code.",
  "The research field is the strategy's measured expectancy in R per trade after costs over 3 years. Negative means it lost money.",
  "Standing aside (-1) is a valid and often correct answer. Do not trade just to be active.",
].join(" ");
export function validateChoice(x: unknown, menuLen: number): AiChoice | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>, pick = Number(o.pick), conf = Number(o.confidence);
  if (!Number.isInteger(pick) || pick < -1 || pick >= menuLen) return null;
  if (!(conf >= 0 && conf <= 1)) return null;
  return { pick, confidence: +conf.toFixed(2), reason: String(o.reason ?? "").slice(0, 240) };
}

/** The menu: every signal valid on this closed bar under the AI book's config (same evaluator as the rule books). */
export function menuFor(book: AiBook, S: Series, i: number): Signal[] {
  return withCfg(book.cfg, () => evaluate(snapshot(S, i), book.state.enabled, S, book.state).signals);
}

export type AiStepInput = { S: Series; i: number; bars: Bar[]; fill: { px: number; t: number } | null; sym: string; now: number; decide: Decide; snapCtx?: { funding?: number | null; fng?: number | null } };
/**
 * One run for the AI book: manage the open position over every closed 5m bar since the last run (code only), then, when flat and a
 * menu exists on the newest closed bar, ask the model once and place the chosen order through the same gates and executor.
 */
export async function stepAiBook(book: AiBook, a: AiStepInput): Promise<{ trades: Trade[]; entered: string | null; log: AiDecisionLog | null }> {
  const st = book.state, trades: Trade[] = [];
  const fresh = a.bars.filter((b) => book.lastBarT == null || b.ct > book.lastBarT);
  withCfg(book.cfg, () => {
    for (const b of fresh) {
      if (st.pos) trades.push(...managePosition(st, [b], a.snapCtx?.funding ?? null));
      if (st.pos && CFG.TRADER) { const j = idxAt(a.S.f.m5, b.ct); if (j >= 0) { const sn = snapshot(a.S, j), r = traderManage(st, sn, a.S, { st: sn.st5, bos: sn.st5, c: b.c }, b.c, b.ct); if (r.closed) trades.push(r.closed); } }
      markEquity(st, b.c);
    }
  });
  const newest = a.bars[a.bars.length - 1];
  const decided = book.lastBarT != null && newest && newest.ct <= book.lastBarT;   // this bar was already decided (restart / overlap)
  if (newest) book.lastBarT = Math.max(book.lastBarT ?? 0, newest.ct);
  if (st.pos || !a.fill || decided) return { trades, entered: null, log: null };
  const menu = menuFor(book, a.S, a.i);
  if (!menu.length) return { trades, entered: null, log: null };
  const snap = { ...snapshot(a.S, a.i, { funding: a.snapCtx?.funding ?? null, fng: a.snapCtx?.fng ?? null }) };
  const entry: AiDecisionLog = { t: a.now, barT: newest.ct, menu: menu.map((m) => ({ strategy: m.strategy, dir: m.dir, score: Math.round(m.score) })), choice: null, by: "none", outcome: "NO_DECISION" };
  const r = await a.decide(traderFacts(menu, snap, a.S, a.sym));
  if (r.value === null) { entry.note = (r.errors.join("; ") || "no answer").slice(0, 200); return push(book, entry, trades, null); }
  entry.choice = r.value; entry.by = r.by;
  if (r.value.pick < 0) { entry.outcome = "NO_TRADE"; return push(book, entry, trades, null); }
  const sig = menu[r.value.pick];
  const placed = withCfg(book.cfg, () => {
    const g = entryGates(st, sig, newest.ct); if (!g.ok) return { gated: g.reason ?? "gated" } as const;
    const p = openPosition(st, sig, a.fill!.px, a.fill!.t); if (!p) return { gated: "size or stop rejected by the executor" } as const;
    p.id = `AI-${a.sym}-${a.now}`; (p.why ??= []).unshift(`AI pick ${r.value!.pick} (${r.by}, conf ${r.value!.confidence}): ${r.value!.reason}`.slice(0, 200));
    return { id: p.id } as const;
  });
  if ("gated" in placed) { entry.outcome = "GATED"; entry.note = String(placed.gated).slice(0, 160); return push(book, entry, trades, null); }
  entry.outcome = "ENTERED"; entry.posId = placed.id;
  return push(book, entry, trades, placed.id);
}
function push(book: AiBook, e: AiDecisionLog, trades: Trade[], entered: string | null) {
  book.log = [...book.log, e].slice(-50);
  return { trades, entered, log: e };
}

/** The only AI call site of the trader: the allowlisted facts from traderFacts(), validated against the menu. */
export function aiDecider(providers: Provider[], usage: Usage, now: number): Decide {
  return async (facts) => {
    if (!providers.length) return { value: null, errors: ["no provider usable for feature 'trader' (needs a key, reviewed terms and AI_DATA_USE_ACCEPTED <provider>:trader)"] };
    const n = (JSON.parse(facts).menu as unknown[]).length;
    const d = await decideJSON(TRADER_SYSTEM, facts, (x) => validateChoice(x, n), { providers, usage, now, deadlineMs: 25000, maxTokens: 200 });
    return d.value === null ? { value: null, errors: d.errors } : { value: d.value, by: `${d.provider}/${d.model}` };
  };
}
