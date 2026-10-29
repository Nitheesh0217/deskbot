// DeskBot v5.8 — the trading desk, as named agents. PAPER ONLY.
//
// Every agent below is deterministic code that runs inside the same 5-minute cron call as the rest of the bot, so the whole desk
// is online 24/7 on Supabase with no laptop, browser tab or Claude session. Each agent has one job and leaves a row in
// dbv5_agent_log so you can see what it saw and decided:
//   chart      reads 1m/5m/15m/1h/4h and lists the support/resistance levels the bot respects (drawn on the dashboard chart)
//   signals    the 11 strategies; which fired, which were rejected and why
//   validator  second opinion on each signal: room to the next opposing level, higher-timeframe conflict
//   risk       stop placement (candle body, not wick), targets, position risk
//   reentry    re-takes a setup after a losing stop-out when price reclaims the level and the trend still agrees
//   manager    the position manager's actions (worklog.ts, written by index.ts with idempotency keys)
//   ai-review  OPTIONAL free-LLM second opinion on a trade that was just taken. Shadow only: it is logged, it never blocks,
//              sizes, opens or closes anything (same guardrail as the news layer).
import {
  CFG, chartRead, validateSignal, type Snap, type Series, type Signal, type Reject, type State, type M1View, type ChartRead,
} from "./engine.ts";
import { decideJSON, type Provider, type Usage } from "./ai.ts";
import { zonesOf, type Bar as ZBar } from "./zones.ts";

export type AgentRow = { agent: string; input_summary: string; output: Record<string, unknown>; provider?: string | null; ms?: number; error?: string | null };

const px = (x: number) => +x.toFixed(x > 1000 ? 1 : 3);

/** Compact chart read for lastRun / dashboard overlay. */
export function deskChart(c: ChartRead) {
  return {
    bias: c.bias, regime: c.regime, trend: c.trend,
    support: c.support ? { px: px(c.support.px), name: c.support.name, atr: +c.support.distAtr.toFixed(2) } : null,
    resistance: c.resistance ? { px: px(c.resistance.px), name: c.resistance.name, atr: +c.resistance.distAtr.toFixed(2) } : null,
    levels: c.levels.slice(0, 10).map((l) => ({ px: px(l.px), name: l.name, side: l.side, blocks: l.blocks })),
  };
}

/** Price-structure zones (FVG, IFVG, order blocks, value, premium/discount, structure) per timeframe. Reaction areas by fixed rules, not forecasts. Never throws. */
export function deskZones(S: Series) {
  const one = (b: ZBar[]) => {
    try {
      const r = zonesOf(b.slice(-400));
      return { atr: px(r.atr), trend: r.trend, range: r.range ? { hi: px(r.range.hi), lo: px(r.range.lo), eq: px(r.range.eq), zone: r.range.zone } : null, value: r.value ? { poc: px(r.value.poc), vah: px(r.value.vah), val: px(r.value.val) } : null,
        zones: r.zones.slice(0, 8).map((z) => ({ kind: z.kind, side: z.side, top: px(z.top), bot: px(z.bot), t0: z.t0, touched: z.touched, filled: z.filled })),
        structure: r.structure.map((e) => ({ kind: e.kind, side: e.side, px: px(e.px), t: e.t })), pools: r.pools.map((p) => ({ kind: p.kind, px: px(p.px), swept: p.swept })) };
    } catch { return null; }
  };
  return { m15: one(S.f.m15), h1: one(S.f.h1), h4: one(S.f.h4) };
}

export type DeskInput = {
  snap: Snap; S: Series; m1: M1View; st: State; signals: Signal[]; rejects: Reject[]; traderActs: string[];
  opened?: { strategy: string; dir: string; entry: number; stop: number; reentry?: boolean } | null; closedNow?: number; ms: number;
};

/** Runs the chart + validator views for the dashboard and returns the rows worth persisting this run. */
export function runDesk(a: DeskInput): { rows: AgentRow[]; chart: ChartRead; summary: Record<string, unknown> } {
  const { snap, S, m1, st, signals, rejects } = a;
  const chart = chartRead(snap, S, m1), rows: AgentRow[] = [];
  const meaningful = signals.length > 0 || a.traderActs.length > 0 || !!a.opened || !!a.closedNow || !!st.reentry;
  if (snap.new15) rows.push({ agent: "chart", input_summary: `1m/5m/15m/1h/4h @ ${px(snap.price)}`, output: deskChart(chart), ms: a.ms });
  if (signals.length) {
    rows.push({ agent: "signals", input_summary: `${signals.length} signal(s) passed strategy rules`, output: { signals: signals.map((s) => ({ strategy: s.strategy, dir: s.dir, score: s.score, reentry: !!s.reentry, why: s.why })), topRejects: rejects.filter((r) => !/Waits for|switched off/.test(r.reason)).slice(0, 5) } });
    // validator votes are computed even when VALIDATOR.on is false so you can see what it WOULD do
    rows.push({ agent: "validator", input_summary: `validator ${CFG.VALIDATOR.on ? "ENFORCING" : "advisory (off)"}`, output: { enforcing: CFG.VALIDATOR.on, verdicts: signals.map((s) => { const v = validateSignal(snap, S, s); return { strategy: s.strategy, dir: s.dir, ok: v.ok, roomR: v.roomR === null ? null : +v.roomR.toFixed(2), votes: v.votes }; }) } });
    rows.push({ agent: "risk", input_summary: `body-stop ${CFG.BODY_SL.on ? "ON" : "off"}`, output: { plans: signals.map((s) => { const R = Math.abs(snap.price - s.stop), T = CFG.TARGETS[s.strategy]; return { strategy: s.strategy, dir: s.dir, stop: px(s.stop), stopPct: +(R / snap.price * 100).toFixed(3), bodyStop: !!s.bodyStop, tp1: px(snap.price + (s.dir === "long" ? 1 : -1) * T.tp1 * R), tp3: px(snap.price + (s.dir === "long" ? 1 : -1) * T.tp3 * R) }; }) } });
  }
  if (st.reentry || a.opened?.reentry) rows.push({ agent: "reentry", input_summary: CFG.REENTRY.on ? "armed after a stop-out" : "inactive (REENTRY off)", output: { enabled: CFG.REENTRY.on, armed: st.reentry ?? null, openedReentry: !!a.opened?.reentry } });
  // the manager's work log (stop / target / exit / close / failure records) is built in worklog.ts from the position itself
  if (a.opened) rows.push({ agent: "decision", input_summary: `OPEN ${a.opened.dir.toUpperCase()} ${a.opened.strategy}${a.opened.reentry ? " (re-entry)" : ""}`, output: a.opened });
  const summary = { chart: { ...deskChart(chart), zones: deskZones(S) }, body: CFG.BODY_SL.on, reentry: CFG.REENTRY.on ? { armed: st.reentry ?? null } : null, validator: CFG.VALIDATOR.on, meaningful };
  return { rows: meaningful || snap.new15 ? rows : [], chart, summary };
}

// ─── optional AI second opinion (shadow only) ───────────────────────────────────────────────────
const VERDICTS = ["agree", "disagree", "unsure"] as const;
export async function aiReview(
  opened: NonNullable<DeskInput["opened"]>, why: string[], chart: ChartRead,
  opts: { providers: Provider[]; usage: Usage; now: number },
): Promise<AgentRow | null> {
  if (!opts.providers.length) return null;
  const system = "You are a skeptical trading-desk reviewer for a PAPER trading bot. You get a structured chart read and a trade the rules just took. Judge only from the data given. Reply with JSON {\"verdict\":\"agree|disagree|unsure\",\"reason\":\"<=160 chars\"}. Never give financial advice.";
  const user = JSON.stringify({ trade: opened, rulesSaid: why.slice(0, 8), chart: deskChart(chart) });
  const r = await decideJSON(system, user, (x) => {
    const o = x as { verdict?: string; reason?: string } | null;
    return o && VERDICTS.includes(o.verdict as typeof VERDICTS[number]) && typeof o.reason === "string" ? { verdict: o.verdict as string, reason: o.reason.slice(0, 200) } : null;
  }, { providers: opts.providers, usage: opts.usage, now: opts.now, deadlineMs: 9000, timeoutMs: 6000, maxTokens: 160 });
  if (r.value === null) return { agent: "ai-review", input_summary: `${opened.dir} ${opened.strategy}`, output: {}, error: r.errors.join("; ").slice(0, 200) };
  return { agent: "ai-review", input_summary: `${opened.dir} ${opened.strategy}`, output: { ...r.value, shadow: true }, provider: `${r.provider}/${r.model}`, ms: r.ms };
}
