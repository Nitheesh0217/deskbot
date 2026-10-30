// What may leave DeskBot for third parties (AI providers, the optional ntfy push relay). Advisory roles get ALLOWLISTED payloads built
// here: prices, percentages, ATR distances, original-risk R, counts, rule text and public market data. Account information stays in
// deterministic local code: equity and balances, dollar P&L, risk dollars, position quantities, account/wallet identifiers and secrets.
// Removing those keys does not make a payload anonymous (prices + timing can still describe a strategy); it keeps account size and
// exposure out of third-party logs. decideJSON() refuses any request whose text still carries an account key (last line of defence).
// Imports nothing: it cannot reach the engine, the state or the network.

/** JSON keys that must never appear in an outbound request body (exact key, case-insensitive). */
export const ACCOUNT_KEYS = [
  "equity", "startEquity", "markedEquity", "equityBefore", "endEquity", "peak", "balance", "balances", "cash", "margin", "withdrawable", "accountValue",
  "riskAmt", "risk_amt", "riskAmtFormula", "qty", "originalQty", "remainingQty", "closedQty", "qtyUncapped", "size", "szi", "notional",
  "net", "pnl", "upnl", "realizedPnl", "unrealizedPnl", "grossWin", "grossLoss", "fees", "fee", "entryFee",
  "account", "accountId", "account_id", "wallet", "address", "user", "email", "apiKey", "api_key", "token", "secret", "password", "authorization",
] as const;
const KEY_RE = new RegExp(`"(${ACCOUNT_KEYS.join("|")})"\\s*:`, "gi");

/** Account keys found in an outbound text (system + user message). Empty = allowed. */
export function egressViolations(text: string): string[] {
  const out = new Set<string>(); for (const m of String(text).matchAll(KEY_RE)) out.add(m[1]); return [...out];
}

export const WITHHELD = "account data withheld from external assistants (equity, balances, dollar P&L, risk dollars, quantities, identifiers)";

const num = (x: unknown, d = 2) => (typeof x === "number" && Number.isFinite(x) ? +x.toFixed(d) : null);
const px = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? +x.toPrecision(8) : null);
const str = (x: unknown, n = 160) => (typeof x === "string" ? x.slice(0, n) : null);

type PlanIn = { dir: string; entry: number; stop0: number; tp1: number; tp2?: number; tp3?: number; maxHoldH?: number; strategy: string };
/** A trade plan in price / percent / R terms only (no size, no risk dollars). */
export function planFacts(p: PlanIn) {
  const R = Math.abs(p.entry - p.stop0), d = p.dir === "long" ? 1 : -1, r = (x?: number) => (typeof x === "number" && R > 0 ? num(((x - p.entry) * d) / R, 2) : null);
  return { strategy: p.strategy, dir: p.dir, entry: px(p.entry), stop: px(p.stop0), risk_pct_of_price: num((R / p.entry) * 100, 3),
    tp1: px(p.tp1), tp1_r: r(p.tp1), tp2: px(p.tp2), tp2_r: r(p.tp2), tp3: px(p.tp3), tp3_r: r(p.tp3), max_hold_h: p.maxHoldH ?? null };
}

/** Desk committee facts (desk.ts runDeskWorkflow). Every field is listed; nothing is passed through by reference. */
export function committeeFacts(inp: { ref: string; sym: string; strategy: string; dir: string; regime: string; why: string[]; plan: PlanIn; analysts?: unknown; chart: unknown; checks: { id: string; level: string; text: string; value?: number }[]; newsRisk?: string | null; lessons?: string[] }) {
  return {
    ref: inp.ref, instrument: inp.sym, strategy: inp.strategy, direction: inp.dir, regime: inp.regime, rules_said: inp.why.slice(0, 8).map((w) => str(w)),
    plan: planFacts(inp.plan), analyst_reports: inp.analysts ?? null, chart: inp.chart,
    deterministic_checks: inp.checks.map((c) => ({ id: c.id, level: c.level, text: str(c.text, 200), value: num(c.value, 4) })),
    news_risk: inp.newsRisk ?? null, lessons_from_past_trades: (inp.lessons ?? []).slice(0, 6).map((l) => str(l, 200)), account_data: WITHHELD,
  };
}

/** Shadow AI review of a trade the rules just opened (agents.ts aiReview). */
export function reviewFacts(o: { strategy: string; dir: string; entry: number; stop: number; reentry?: boolean }, why: string[], chart: unknown) {
  return { trade: { strategy: o.strategy, dir: o.dir, entry: px(o.entry), stop: px(o.stop), reentry: !!o.reentry }, rulesSaid: why.slice(0, 8).map((w) => str(w)), chart, account_data: WITHHELD };
}

type Stat = { n?: number; sumR?: number; wins?: number; losses?: number };
const statR = (s: Stat | undefined) => (s ? { n: s.n ?? 0, sumR: num(s.sumR, 2), expR: s.n ? num((s.sumR ?? 0) / s.n, 3) : null, wins: s.wins ?? 0, losses: s.losses ?? 0 } : null);
const posFacts = (p: any) => (p ? { strategy: p.strategy, dir: p.dir, entry: px(p.entry), stop: px(p.stop), stop0: px(p.stop0), tp1: px(p.tp1), tp2: px(p.tp2), tp3: px(p.tp3), tp1Done: !!p.tp1Done, tp2Done: !!p.tp2Done } : null);

/** Owner chat context (chat.ts). Built from raw rows; only R, counts, prices, percentages, config and public market data survive. */
export function chatFacts(raw: { version: string; updated?: string; state: any; lastRun: any; trades: any[]; backtests: any[]; news: any[]; others: any[]; editableKeys: string[] }) {
  const st = raw.state ?? {}, lr = raw.lastRun ?? {};
  const byStrat = Object.fromEntries(Object.keys(st.stats?.by ?? {}).map((s) => [s, statR(st.stats.by[s])]).filter(([, v]) => v && (v as any).n > 0));
  return {
    version: raw.version, mode: "PAPER", updated: raw.updated ?? null, account_data: WITHHELD,
    drawdownFromPeakPct: num((st.maxDD ?? 0) * 100, 2), openPosition: posFacts(st.pos),
    stats: { all: statR(st.stats?.all), byStrategy: byStrat }, enabled: st.enabled ?? {}, circuitBreaker: st.cb ? { trips: st.cb.trips ?? 0, consec: st.cb.consec ?? 0, cooldownUntil: st.cb.cooldownUntil ?? null } : null,
    liveConfig: st.cfg ?? {}, market: lr.market ?? null, lastAction: lr.action ?? null, lastDecision: lr.decision ?? null, news: lr.news ?? null,
    recentTrades: (raw.trades ?? []).map((t) => ({ symbol: t.symbol, strategy: t.strategy, dir: t.dir, entry: px(t.entry), exit_avg: px(t.exit_avg), r: num(t.r, 2), reason: str(t.reason, 40), open_t: t.open_t, close_t: t.close_t })),
    recentBacktests: (raw.backtests ?? []).map((b) => ({ ran_at: b.ran_at, label: b.label ?? null, from: b.from ?? null, to: b.to ?? null, trades: b.all?.n ?? null, sumR: num(b.all?.sumR, 2), expR: b.all?.n ? num((b.all.sumR ?? 0) / b.all.n, 3) : null, maxDDpct: num((b.maxDD ?? 0) * 100, 2) })),
    newsHistory: raw.news ?? [], editableKeys: raw.editableKeys,
    note: "All fields above describe the BTC book. Other paper books (gold via PAXG) are in otherBooks. Chat proposals only change the BTC book. Dollar amounts, equity and position sizes are not available to you; answer in R and percent, and say so when asked for them.",
    otherBooks: (raw.others ?? []).map((o) => ({ id: o.id, openPosition: posFacts(o.pos), stats: statR(o.all), liveConfig: o.cfg ?? {}, lastAction: o.action ?? null, price: px(o.price) })),
  };
}

/** Push-notification text (ntfy.sh is a public relay): R and prices only. */
export const pushClose = (tag: string, t: { strategy: string; dir: string; reason: string; r: number }) => `${tag}${t.strategy} ${t.dir.toUpperCase()} closed ${t.reason} (${t.r >= 0 ? "+" : ""}${t.r.toFixed(2)}R)`;
export const pushOpen = (tag: string, s: { strategy: string; dir: string; score: number }, p: { entry: number; stop: number; tp1: number; tp2: number; tp3: number }) =>
  `${tag}${s.strategy} ${s.dir.toUpperCase()} @ ${p.entry.toFixed(1)} · stop ${p.stop.toFixed(1)} · TP ${p.tp1.toFixed(0)}/${p.tp2.toFixed(0)}/${p.tp3.toFixed(0)} · score ${s.score}`;
