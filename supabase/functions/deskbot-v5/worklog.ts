// Theo (position manager) work log. Pure and observational: it describes what the management phase of a run did to the open
// position. It never changes a position, a price or a P&L number.
//
// Identity (stable on a retry of the same run, distinct for separate actions):
//   exits / target fills   <pos>:target_fill|exit:<kind>:<bar t>        the exit's own bar time from the 1m path
//   trade-manager actions  <pos>:manage:<5m bar T>:<seq>:<kind>:<hash>  each announced action, in order, from traderManage's acts
//   unannounced changes    <pos>:<field>_change:<5m bar T>:<from>-><to> net change of a field no announced action explains
//   close                  <pos>:close:final
//   failure                <pos>:failure:<last processed bar>
// Completeness: announced trade-manager actions and every exit are recorded individually. The trade manager also moves TP2/TP3
// silently; such moves (and any other unexplained field change) are visible only as one NET change per run, and are flagged
// attributed:false. Intermediate values inside one run that no announced action exposes are not reconstructed.
import type { Trade } from "./engine.ts";

type Exit = { kind: string; px: number; qty: number; pnl?: number; fee?: number; t: number };
export type PosLite = { id: string; strategy: string; dir: string; stop: number; stop0: number; tp1: number; tp2: number; tp3: number; exits: Exit[]; plan?: { t: number; msg: string }[] };
export type WorkRow = { agent: "manager"; input_summary: string; output: Record<string, unknown> & { key: string }; error?: string };
export type ManageCtx = { snapT: number | null; acts: string[] };

const fx = (x: number) => (Number.isFinite(x) ? +x.toPrecision(10) : x);
export const workKey = (posId: string, action: string, id: string | number) => `${posId}:${action}:${id}`;
/** FNV-1a, 32-bit hex: a short stable fingerprint of an action's text for its identity. */
export const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
/** What an announced trade-manager message did (traderManage's own wording). */
export const actKind = (m: string) => /^Stop tightened|stop to breakeven/i.test(m) ? "stop" : /^TP1 /.test(m) ? "tp1" : /closing$/i.test(m) ? "close_request" : "other";

/** Material management actions of one run. before = position at run start; after = position after management (or null when closed). */
export function managerRows(sym: string, before: PosLite | null, after: PosLite | null, closed: Trade[], decisionId: (posId: string) => string, ctx: ManageCtx = { snapT: null, acts: [] }): WorkRow[] {
  if (!before) return [];   // nothing was being managed; opening a position is not a management action
  const P = before.id, now = after && after.id === P ? after : null, done = closed.find((t) => t.id === P) ?? null;
  const base = { ref: P, decisionId: decisionId(P), symbol: sym, strategy: before.strategy, dir: before.dir, authority: "deterministic" };
  const rows: WorkRow[] = [];
  const row = (action: string, keyId: string | number, summary: string, extra: Record<string, unknown>) =>
    rows.push({ agent: "manager", input_summary: `${P} ${summary}`.slice(0, 200), output: { ...base, action, key: workKey(P, action, keyId), ...extra } });
  // 1) exits on the 1m path, each with its own bar time; a stop moved by the exit rule is part of that fill
  const seen = new Set(before.exits.map((e) => `${e.kind}:${e.t}`));
  const exits = ((done?.exits ?? now?.exits ?? []) as Exit[]).filter((e) => !seen.has(`${e.kind}:${e.t}`));
  for (const e of exits) row(e.kind.startsWith("tp") ? "target_fill" : "exit", `${e.kind}:${e.t}`, `${e.kind.toUpperCase()} @ ${fx(e.px)}`, { kind: e.kind, px: fx(e.px), qty: fx(e.qty), pnl: e.pnl == null ? null : fx(e.pnl), barT: e.t });
  // 2) every announced trade-manager action, in order, keyed by the 5m bar it was evaluated on
  const T = ctx.snapT ?? "nobar";
  ctx.acts.forEach((m, i) => { const k = actKind(m); row("manage", `${T}:${i}:${k}:${fnv(m)}`, m, { kind: k, message: m, barT: ctx.snapT, seq: i, attributed: true }); });
  // 3) net field changes nothing above explains (the exit rule's stop move after TP fills; silent TP2/TP3 moves)
  if (now) {
    const ruleStop = exits.some((e) => e.kind.startsWith("tp")), annStop = ctx.acts.some((m) => actKind(m) === "stop"), annTp1 = ctx.acts.some((m) => actKind(m) === "tp1");
    const net = (field: "stop" | "tp1" | "tp2" | "tp3", explained: boolean, why: string) => {
      if (now[field] === before[field] || explained) return;
      row(`${field}_change`, `${T}:${fx(before[field])}->${fx(now[field])}`, `${field.toUpperCase()} ${fx(before[field])} → ${fx(now[field])} (net, ${why})`, { field, from: fx(before[field]), to: fx(now[field]), barT: ctx.snapT, attributed: false, note: why });
    };
    net("stop", annStop, ruleStop ? "exit rule after a target fill" : "no announced action");
    net("tp1", annTp1, "no announced action");
    net("tp2", false, "trade manager adjusts TP2 without announcing it");
    net("tp3", false, "trade manager adjusts TP3 without announcing it");
  }
  if (done) row("close", "final", `closed ${done.reason}`, { reason: done.reason, net: fx(done.net), r: fx(done.r), closeT: done.closeT });
  return rows;
}

/** A management phase that threw. One record per position and last processed bar, so a stuck retry is not repeated. */
export function managerFailure(sym: string, pos: PosLite, lastBarT: number, err: unknown, decisionId: (posId: string) => string): WorkRow {
  const msg = String((err as Error)?.message ?? err).slice(0, 200);
  return { agent: "manager", input_summary: `${pos.id} management failed`, error: msg, output: { ref: pos.id, decisionId: decisionId(pos.id), symbol: sym, action: "failure", key: workKey(pos.id, "failure", lastBarT), lastBarT, authority: "deterministic" } };
}

export const snapshotPos = (p: PosLite | null | undefined): PosLite | null => (p ? JSON.parse(JSON.stringify({ id: p.id, strategy: p.strategy, dir: p.dir, stop: p.stop, stop0: p.stop0, tp1: p.tp1, tp2: p.tp2, tp3: p.tp3, exits: p.exits, plan: p.plan ?? [] })) : null);

/** Keep only rows whose key is not already recorded and not repeated in the batch (rows without a key always pass). */
export const unrecorded = <R extends { output?: Record<string, unknown> }>(rows: R[], existing: Set<string>) => {
  const inBatch = new Set<string>();
  return rows.filter((r) => { const k = r.output?.key; if (typeof k !== "string") return true; if (existing.has(k) || inBatch.has(k)) return false; inBatch.add(k); return true; });
};
/** The outbox kept inside the book state: rows not yet confirmed in the work log, newest last, bounded. */
export const OUTBOX_MAX = 200;
export const mergeOutbox = (box: WorkRow[] | undefined, add: WorkRow[]) => unrecorded([...(box ?? []), ...add], new Set()).slice(-OUTBOX_MAX) as WorkRow[];
