// Shift report: every floor of the tower gets a measurable target, its actual status from live facts, and what it NEEDS to do better
// (the "ask every employee what they need" view). Plus the owner's goal board: $10,000 a month / $1,000 a night tracked against the
// paper record and against what the measured edge can produce at the current size.
// The goal is tracked, never used to set risk: sizing changes only from measured edge (docs/control/LEARNING_LOOP.md).
// Pure: imports nothing.

export type BookFact = {
  sym: string; mode: "paper" | "shadow"; equity: number; start: number; open: boolean; openDir: string | null;
  lastRunMs: number | null; trades30d: number; r30d: number; tradesAll: number; rAll: number; riskPerTradeUsd: number; strategy: string;
};
export type ShiftFacts = {
  now: number; books: BookFact[]; netMonth: number; net24h: number; upnl: number;
  learning: { focusTest: string | null; focusStatus: string | null; losses90d: number; queued: number } | null;
  aiTraderProviders: string[]; marketCtxLastHour: number; newsProviders: string[];
  goal?: { monthUsd: number; nightUsd: number };
};
export type Floor = { n: number; id: string; name: string; target: string; actual: string; status: "ON_TARGET" | "BEHIND" | "BLOCKED"; needs: string[] };
export type ShiftReport = {
  at: string;
  goal: { monthUsd: number; nightUsd: number; perDayNeeded: number; daysLeft: number; netMonth: number; net24h: number; upnl: number; capital: number;
    projectedMonthUsd: number; projectionBasis: string; gapMonthUsd: number; sizeMultipleNeeded: number | null; note: string };
  floors: Floor[]; topNeeds: string[];
};

const EXP_R = 0.1;            // measured HTF_TREND expectancy after costs, R per trade (docs/research/2026-11-15-oos-coins)
const TRADES_PER_MONTH = 2.4; // HTF_TREND trades per coin per month in the 3-year studies (~29 a year)
const STALE_MS = 15 * 60_000;

export function shiftReport(f: ShiftFacts): ShiftReport {
  const goal = f.goal ?? { monthUsd: 10_000, nightUsd: 1_000 };
  const d = new Date(f.now), dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(), daysLeft = dim - d.getUTCDate() + 1;
  const paper = f.books.filter((b) => b.mode === "paper"), capital = paper.reduce((s, b) => s + b.equity, 0);
  const projected = paper.reduce((s, b) => s + TRADES_PER_MONTH * EXP_R * b.riskPerTradeUsd, 0);
  const left = goal.monthUsd - f.netMonth, perDay = Math.max(0, left) / Math.max(1, daysLeft);
  const floors: Floor[] = [];
  const fl = (n: number, id: string, name: string, target: string, actual: string, needs: string[], blocked = false): void => {
    floors.push({ n, id, name, target, actual, status: blocked ? "BLOCKED" : needs.length ? "BEHIND" : "ON_TARGET", needs });
  };

  // 1 data: every book ran on fresh data
  const stale = f.books.filter((b) => b.lastRunMs == null || f.now - b.lastRunMs > (b.open ? STALE_MS : 4.5 * 3600_000));
  fl(1, "data", "Data infrastructure", "Every book with a position checked within 15 min; flat books within their 4h slot", `${f.books.length - stale.length}/${f.books.length} books current`,
    stale.length ? [`Fresh data for ${stale.map((b) => b.sym).join(", ")} (check the run log)`] : []);
  // 2 intel: market context recorded; news AI
  fl(2, "intel", "Market intelligence", "Funding / OI / premium recorded every run; news read by an AI provider", `${f.marketCtxLastHour} market-context rows in the last hour; news AI: ${f.newsProviders.length ? f.newsProviders.join(", ") : "none"}`,
    [...(f.marketCtxLastHour > 0 ? [] : ["Market-context recording (table dbv5_market_ctx) is silent"]), ...(f.newsProviders.length ? [] : ["A free AI key accepted for 'news' (GROQ_API_KEY + AI_DATA_USE_ACCEPTED=groq:news)"])]);
  // 3 research: one frozen-spec test a week
  const q = f.learning?.queued ?? 0;
  fl(3, "research", "Quantitative research", "One frozen-spec test per week on the costliest lesson", `${q} queued test(s)${f.learning?.focusTest ? `; focus: ${f.learning.focusTest}` : ""}`,
    [...(q ? ["Owner approval for the weekly research session (runs the queued test, opens a PR, never merges)"] : []), "Long daily history for stocks/indices/commodities (a market-data API key; stooq.com refuses this cloud)"]);
  // 4 strategy desks: each paper book trades and keeps a non-negative edge
  const needs4: string[] = [];
  const quiet = paper.filter((b) => b.trades30d === 0 && !b.open), losing = paper.filter((b) => b.tradesAll >= 10 && b.rAll / b.tradesAll < 0);
  if (quiet.length > paper.length / 2) needs4.push(`More independent signals: ${quiet.length}/${paper.length} books had no trade in 30 days (trend systems wait for trends; more uncorrelated markets add trades)`);
  for (const b of losing) needs4.push(`${b.sym}: ${(b.rAll / b.tradesAll).toFixed(2)}R/trade over ${b.tradesAll} trades: review in the learning desk`);
  const t30 = paper.reduce((s, b) => s + b.trades30d, 0), r30 = paper.reduce((s, b) => s + b.r30d, 0);
  fl(4, "desks", "Strategy desks", `≥ +${EXP_R}R per trade after costs over ≥ 30 trades per strategy`, `${t30} trades in 30 days, ${r30 >= 0 ? "+" : ""}${r30.toFixed(2)}R`, needs4);
  // 5 portfolio: same-direction exposure
  const longs = paper.filter((b) => b.open && b.openDir === "long").length, shorts = paper.filter((b) => b.open && b.openDir === "short").length;
  fl(5, "portfolio", "Portfolio management", "≤ 3 same-direction crypto positions at once (observation; CLUSTER_CAP narrowly rejected)", `${longs} long, ${shorts} short open`,
    Math.max(longs, shorts) > 3 ? [`${Math.max(longs, shorts)} positions in one direction: one market move is several bets (sizing step will address this)`] : []);
  // 6 risk: drawdown from start
  const worst = paper.map((b) => ({ sym: b.sym, dd: b.start > 0 ? (b.start - b.equity) / b.start : 0 })).sort((a, b) => b.dd - a.dd)[0];
  fl(6, "risk", "Risk management", "No book more than 15% below its start; size never raised by a profit target", worst ? `worst: ${worst.sym} ${(worst.dd * 100).toFixed(1)}% ${worst.dd >= 0 ? "below" : "above"} start` : "no books",
    worst && worst.dd > 0.15 ? [`${worst.sym} is ${(worst.dd * 100).toFixed(1)}% down: keep at minimum size until the learning desk finds the cause`] : []);
  // 7 execution: paper fills; real money is not built
  fl(7, "execution", "Execution", "Paper fills at modelled prices and costs; real money only after a proven edge and approval", `paper only; AI trader provider: ${f.aiTraderProviders.length ? f.aiTraderProviders.join(", ") : "none"}`,
    [...(f.aiTraderProviders.length ? [] : ["AI trader: a free key accepted for 'trader' (GROQ_API_KEY + AI_DATA_USE_ACCEPTED=groq:trader)"]), "Real money: a broker adapter with exchange-held stops, owner-held trade-only keys and separate approval (not built)"], false);
  // 8 ops & review: every loss tagged; focus
  fl(8, "ops", "Operations & review", "Every loss tagged by cause; the costliest cause has a test queued or done", f.learning ? `${f.learning.losses90d} losses tagged (90 days); focus: ${f.learning.focusTest ?? "none"} (${f.learning.focusStatus ?? "-"})` : "learning report unavailable",
    f.learning ? [] : ["Learning report (status.learning) failed: check the run log"]);

  const topNeeds = [...new Set(floors.flatMap((x) => x.needs))].slice(0, 6);
  return {
    at: new Date(f.now).toISOString(),
    goal: {
      monthUsd: goal.monthUsd, nightUsd: goal.nightUsd, perDayNeeded: +perDay.toFixed(2), daysLeft, netMonth: +f.netMonth.toFixed(2), net24h: +f.net24h.toFixed(2), upnl: +f.upnl.toFixed(2), capital: +capital.toFixed(2),
      projectedMonthUsd: +projected.toFixed(2), projectionBasis: `${paper.length} paper books × ${TRADES_PER_MONTH} trades/month × +${EXP_R}R × each book's current $ risk per trade (3-year research averages)`,
      gapMonthUsd: +(goal.monthUsd - projected).toFixed(2), sizeMultipleNeeded: projected > 0 ? +(goal.monthUsd / projected).toFixed(0) : null,
      note: "The goal is tracked, not used to set size. Profit grows by adding proven edge, uncorrelated markets and capital, and by sizing up only as the live record earns it.",
    },
    floors, topNeeds,
  };
}
