// Theo (position manager) work log. Pure and observational: it compares the open position before and after the
// management phase of a run and describes what changed. It never changes a position, a price or a P&L number.
// Each record carries an idempotency key derived from the position id and the event identity (exit kind + bar time,
// new stop / target value, close). index.ts writes a record only if no work-log row with that key exists yet, so a
// retried or catch-up run cannot record the same management action twice.
import type { Trade } from "./engine.ts";

type Exit = { kind: string; px: number; qty: number; pnl?: number; fee?: number; t: number };
export type PosLite = { id: string; strategy: string; dir: string; stop: number; stop0: number; tp1: number; tp2: number; tp3: number; exits: Exit[]; plan?: { t: number; msg: string }[] };
export type WorkRow = { agent: "manager"; input_summary: string; output: Record<string, unknown>; error?: string };

const fx = (x: number) => (Number.isFinite(x) ? +x.toPrecision(10) : x);
export const workKey = (posId: string, action: string, id: string | number) => `${posId}:${action}:${id}`;

/** Material management actions between two snapshots of the same position (or its close). */
export function managerRows(sym: string, before: PosLite | null, after: PosLite | null, closed: Trade[], decisionId: (posId: string) => string): WorkRow[] {
  if (!before) return [];   // nothing was being managed; opening a position is not a management action
  const P = before.id, now = after && after.id === P ? after : null, done = closed.find((t) => t.id === P) ?? null;
  const seen = new Set(before.exits.map((e) => `${e.kind}:${e.t}`));
  const exits = ((done?.exits ?? now?.exits ?? []) as Exit[]).filter((e) => !seen.has(`${e.kind}:${e.t}`));
  const oldPlan = new Set((before.plan ?? []).map((x) => `${x.t}:${x.msg}`)), reasons = (now?.plan ?? []).filter((x) => !oldPlan.has(`${x.t}:${x.msg}`)).map((x) => x.msg);
  const base = { ref: P, decisionId: decisionId(P), symbol: sym, strategy: before.strategy, dir: before.dir, authority: "deterministic" };
  const rows: WorkRow[] = [];
  const row = (action: string, keyId: string | number, summary: string, extra: Record<string, unknown>) =>
    rows.push({ agent: "manager", input_summary: `${P} ${summary}`.slice(0, 200), output: { ...base, action, key: workKey(P, action, keyId), ...extra } });
  for (const e of exits) row(e.kind.startsWith("tp") ? "target_fill" : "exit", `${e.kind}:${e.t}`, `${e.kind.toUpperCase()} @ ${fx(e.px)}`, { kind: e.kind, px: fx(e.px), qty: fx(e.qty), pnl: e.pnl == null ? null : fx(e.pnl), barT: e.t });
  if (now && now.stop !== before.stop) row("stop_adjust", fx(now.stop), `stop ${fx(before.stop)} → ${fx(now.stop)}`, { from: fx(before.stop), to: fx(now.stop), stop0: fx(before.stop0), reasons: reasons.filter((m) => /stop|breakeven/i.test(m)), rule: reasons.some((m) => /stop|breakeven/i.test(m)) ? "trade manager" : "exit rule (stop moved after a target fill)" });
  if (now) for (const k of ["tp1", "tp2", "tp3"] as const) if (now[k] !== before[k]) row("target_adjust", `${k}:${fx(now[k])}`, `${k.toUpperCase()} ${fx(before[k])} → ${fx(now[k])}`, { target: k, from: fx(before[k]), to: fx(now[k]), reasons: reasons.filter((m) => m.startsWith(k.toUpperCase())) });
  if (done) row("close", "final", `closed ${done.reason}`, { reason: done.reason, net: fx(done.net), r: fx(done.r), closeT: done.closeT, reasons });
  return rows;
}

/** A management phase that threw. One record per position and last processed bar, so a stuck retry is not repeated. */
export function managerFailure(sym: string, pos: PosLite, lastBarT: number, err: unknown, decisionId: (posId: string) => string): WorkRow {
  const msg = String((err as Error)?.message ?? err).slice(0, 200);
  return { agent: "manager", input_summary: `${pos.id} management failed`, error: msg, output: { ref: pos.id, decisionId: decisionId(pos.id), symbol: sym, action: "failure", key: workKey(pos.id, "failure", lastBarT), lastBarT, authority: "deterministic" } };
}

export const snapshotPos = (p: PosLite | null | undefined): PosLite | null => (p ? JSON.parse(JSON.stringify({ id: p.id, strategy: p.strategy, dir: p.dir, stop: p.stop, stop0: p.stop0, tp1: p.tp1, tp2: p.tp2, tp3: p.tp3, exits: p.exits, plan: p.plan ?? [] })) : null);

/** Keep only rows whose key is not already recorded (rows without a key always pass). */
export const unrecorded = <R extends { output?: Record<string, unknown> }>(rows: R[], existing: Set<string>) =>
  rows.filter((r) => { const k = r.output?.key; return typeof k !== "string" || !existing.has(k); });
