// Learning desk: every closed trade is tagged with what went wrong (or right), losses are grouped by cause, and each cause points to
// ONE entry of the lesson ledger: a test that was already run (with its verdict and document) or the next test to run. Nothing here
// changes trading. A lesson changes the system only after a frozen-spec test passes and the owner approves (docs/control/LEARNING_LOOP.md).
// Pure: imports nothing, so it is testable and cannot reach the network or the books.

export type LTrade = {
  id: string; symbol: string; strategy: string; dir: string; r: number; net: number; gross: number | null;
  openT: number; closeT: number; reason: string; regime: string | null; path: string[];
};
export type Cause = "cluster_loss" | "stopped_fast" | "gave_back_after_tp1" | "time_exit_loss" | "range_regime_loss" | "cost_drag" | "trend_failure";
export const CAUSE_TEXT: Record<Cause, string> = {
  cluster_loss: "Lost together with 2+ other books that entered the same direction within 24h (one market move taken as several bets)",
  stopped_fast: "Full stop within 30 minutes of entry",
  gave_back_after_tp1: "Reached the first target, then gave the gain back",
  time_exit_loss: "Closed at max hold with a loss",
  range_regime_loss: "Entered in a ranging (choppy) regime and lost",
  cost_drag: "Profitable before costs, losing after fees and funding",
  trend_failure: "Ordinary stop-out of a trend entry (most trend trades lose; judged by expectancy, not single trades)",
};
export type LessonStatus = "ADOPTED" | "REJECTED" | "NARROW_REJECT" | "QUEUED" | "NO_TEST";
export type Lesson = { cause: Cause; test: string; status: LessonStatus; ref: string; note: string };
/** The lesson ledger. Earlier results are recorded so a rejected idea is not re-tested as if new. */
export const LEDGER: Lesson[] = [
  { cause: "cost_drag", test: "Switch off negative-expectancy short-horizon strategies", status: "ADOPTED", ref: "docs/research/2026-11-10-layer-agreement/RESULTS.md", note: "SWEEP_REV, SESSION_BO, TREND_MTF (+EMA_CROSS on GOLD) off since 2026-11-10" },
  { cause: "cluster_loss", test: "CLUSTER_CAP: same-direction risk budget K=3", status: "NARROW_REJECT", ref: "docs/research/2026-11-24-cluster-cap/RESULTS.md", note: "max DD −58%, net R/DD 2.37→4.19, but net R −25.3% vs −25% limit; next: budget combined with performance sizing (new frozen spec)" },
  { cause: "gave_back_after_tp1", test: "EXIT-D ratchet trail; EXIT-B nearer TP1", status: "REJECTED", ref: "docs/research/2026-11-10-exit-d/RESULTS.md", note: "no significant gain; worse BTC drawdown" },
  { cause: "time_exit_loss", test: "EXIT-C close at half max hold without TP1", status: "REJECTED", ref: "research/2026-10-30-entry-exit", note: "rejected in the entry/exit study" },
  { cause: "stopped_fast", test: "ENTRY_CONFIRM: enter only after one more closed 5m bar holds beyond the trigger", status: "QUEUED", ref: "", note: "untested; related ENTRY-1 (skip far-from-trigger entries) was rejected" },
  { cause: "range_regime_loss", test: "CHOP_SKIP: no entry when the 15m choppiness index is >= 61.8", status: "QUEUED", ref: "", note: "untested; the layer-agreement filter (trend alignment) was rejected, this tests chop instead" },
  { cause: "trend_failure", test: "none", status: "NO_TEST", ref: "docs/research/2026-11-15-oos-coins/RESULTS.md", note: "expected losses of a trend system; the edge is measured over many trades" },
];

const H24 = 24 * 3600_000;
/** Causes of one closed trade. `all` is every trade in the window (for clustering). Winners get no cause. */
export function causesOf(t: LTrade, all: LTrade[]): Cause[] {
  const out: Cause[] = [], holdMin = (t.closeT - t.openT) / 60_000;
  if (t.gross != null && t.gross > 0 && t.net <= 0) out.push("cost_drag");
  if (t.r >= 0) return out;
  const mates = all.filter((u) => u.id !== t.id && u.symbol !== t.symbol && u.dir === t.dir && Math.abs(u.openT - t.openT) <= H24 && u.r < 0);
  if (mates.length >= 2) out.push("cluster_loss");
  if (t.path.length === 1 && t.path[0] === "stop" && holdMin <= 30) out.push("stopped_fast");
  if (t.path[0] === "tp1" && t.r <= 0.05) out.push("gave_back_after_tp1");
  if (t.path[t.path.length - 1] === "time") out.push("time_exit_loss");
  if (t.regime === "RANGE") out.push("range_regime_loss");
  if (!out.length) out.push("trend_failure");
  return out;
}

export type LearningReport = {
  window: { from: string; to: string; trades: number; losses: number; wins: number; netR: number };
  byCause: { cause: Cause; text: string; trades: number; rLost: number; books: string[]; strategies: string[]; lesson: Lesson | null }[];
  focus: (Lesson & { rLost: number; trades: number }) | null;
  ledger: Lesson[];
  note: string;
};
/**
 * Group the losses of ACTIVE strategies by cause (switched-off strategies are history, not lessons for now), order by R lost, and pick
 * the focus: the costliest cause whose next test is QUEUED, else the costliest cause. One trade can carry several causes; R is counted
 * once per cause it carries.
 */
export function learningReport(trades: LTrade[], active: Set<string>, now: number, days = 90): LearningReport {
  const from = now - days * 86_400_000, win = trades.filter((t) => t.closeT >= from && active.has(t.strategy));
  const agg = new Map<Cause, { trades: number; rLost: number; books: Set<string>; strategies: Set<string> }>();
  for (const t of win) for (const c of causesOf(t, win)) {
    if (t.r >= 0 && c !== "cost_drag") continue;
    const a = agg.get(c) ?? { trades: 0, rLost: 0, books: new Set(), strategies: new Set() };
    a.trades++; a.rLost += Math.min(0, t.r); a.books.add(t.symbol); a.strategies.add(t.strategy); agg.set(c, a);
  }
  const lessonOf = (c: Cause) => LEDGER.find((l) => l.cause === c) ?? null;
  const byCause = [...agg.entries()].map(([cause, a]) => ({ cause, text: CAUSE_TEXT[cause], trades: a.trades, rLost: +a.rLost.toFixed(2), books: [...a.books].sort(), strategies: [...a.strategies].sort(), lesson: lessonOf(cause) }))
    .sort((x, y) => x.rLost - y.rLost);
  const pick = byCause.find((c) => c.lesson && (c.lesson.status === "QUEUED" || c.lesson.status === "NARROW_REJECT")) ?? byCause.find((c) => c.lesson && c.lesson.status !== "NO_TEST") ?? null;
  const wins = win.filter((t) => t.r > 0).length;
  return {
    window: { from: new Date(from).toISOString(), to: new Date(now).toISOString(), trades: win.length, losses: win.filter((t) => t.r < 0).length, wins, netR: +win.reduce((s, t) => s + t.r, 0).toFixed(2) },
    byCause, focus: pick && pick.lesson ? { ...pick.lesson, rLost: pick.rLost, trades: pick.trades } : null, ledger: LEDGER,
    note: "Causes are descriptive tags from recorded trade facts. A lesson changes trading only after a frozen-spec test passes and the owner approves.",
  };
}

/** Observation only (CLUSTER_CAP was narrowly rejected): the weight an entry WOULD get under a same-direction budget of K. */
export function clusterWeight(openSameDir: number, K = 3): number { return Math.min(1, K / Math.max(1, openSameDir)); }
