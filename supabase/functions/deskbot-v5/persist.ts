// Persistence for book state and the position manager's work log. Everything here is a PostgREST request built by makeDb(),
// so the same code runs in the edge function and in scripts/sql_test/postgrest.sh against a local PostgREST + PostgreSQL.
//
// Guarantees, stated separately (docs/control/ARCHITECTURE.md, "Work-log persistence"):
//  - State concurrency protection: every book-state write is a compare-and-set on state._rev. A writer whose loaded revision
//    is no longer current gets StateConflict and writes nothing (an expired-lease worker cannot overwrite a newer book).
//  - Durable retention: unconfirmed work-log records stay in state._workOutbox, saved in the same write as the management they
//    describe. There is no cap; nothing is dropped. The backlog is visible (pending count, oldest queued time).
//  - Eventual delivery: each run flushes the outbox in batches; a batch is removed from the outbox only after the insert
//    succeeded, by a scoped RPC that deletes exactly those keys (dbv5_ack_work). It is delivered once the log write path works.
//  - Duplicate suppression: ON CONFLICT (work_key) DO NOTHING against a unique index. Re-sending a delivered record is a no-op.
//    Together these give at-least-once delivery with duplicates suppressed; that is not a claim of exactly-once processing.
import { unrecorded, type WorkRow } from "./worklog.ts";

export type Db = ReturnType<typeof makeDb>;
export function makeDb(base: string, key: string, fetchImpl: typeof fetch = fetch) {
  async function rest(path: string, init: RequestInit = {}) {
    const r = await fetchImpl(`${base}/${path}`, {
      ...init, signal: init.signal ?? AbortSignal.timeout(10000), headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers ?? {}) },
    });
    if (!r.ok) throw new Error(`DB ${path.split("?")[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }
  return {
    rest,
    upsert: (table: string, rows: unknown) => rest(table, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) }),
    insert: (table: string, rows: unknown) => rest(table, { method: "POST", body: JSON.stringify(rows) }),
    select: (q: string) => rest(q, { method: "GET", headers: { Prefer: "" } }),
  };
}

export class StateConflict extends Error { constructor(m: string) { super(m); this.name = "StateConflict"; } }
type Rev = { _rev?: number };
/** Compare-and-set write of one book row. On success st._rev advances; on a stale revision nothing is written. */
export async function saveStateCAS(db: Db, rowId: string, st: Rev & Record<string, unknown>, lastRun?: Record<string, unknown> | null) {
  const prev = typeof st._rev === "number" ? st._rev : null, next = (prev ?? 0) + 1;
  const guard = prev === null ? "state->_rev=is.null" : `state->>_rev=eq.${prev}`;
  const body = { state: { ...st, _rev: next }, ...(lastRun ? { last_run: lastRun } : {}), updated_at: new Date().toISOString() };
  const rows = await db.rest(`dbv5_state?id=eq.${rowId}&${guard}&select=id`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
  if (!Array.isArray(rows) || rows.length !== 1) throw new StateConflict(`state conflict on ${rowId}: revision ${prev ?? "none"} is no longer current (another run advanced the book); nothing written`);
  st._rev = next;
}

type LogRow = { agent: string; input_summary: string; output: unknown; provider?: string | null; ms?: number | null; error?: string | null };
const LOG_COLS = "symbol,agent,input_summary,output,provider,ms,error,work_key";
const keyOf = (r: LogRow) => { const k = (r.output as { key?: unknown } | null)?.key; return typeof k === "string" ? k : null; };
/** Agent work-log insert. Keyed rows: ON CONFLICT (work_key) DO NOTHING. Without the column/index: check-then-insert (safe only while runs do not overlap). */
export async function writeAgentRows(db: Db, sym: string, rows: LogRow[]): Promise<"conflict-safe" | "check-then-insert" | "none"> {
  const batch = unrecorded(rows as { output?: Record<string, unknown> }[], new Set()) as LogRow[];
  if (!batch.length) return "none";
  const body = (rs: LogRow[], withKey: boolean) => JSON.stringify(rs.map((r) => ({ symbol: sym, agent: r.agent, input_summary: r.input_summary, output: r.output, provider: r.provider ?? null, ms: r.ms ?? null, error: r.error ?? null, ...(withKey ? { work_key: keyOf(r) } : {}) })));
  try {
    await db.rest(`dbv5_agent_log?columns=${LOG_COLS}&on_conflict=work_key`, { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: body(batch, true) });
    return "conflict-safe";
  } catch (e) {
    if (!/work_key|ON CONFLICT|unique or exclusion constraint/i.test(String((e as Error).message))) throw e;
    const keys = batch.map(keyOf).filter((k): k is string => !!k), have = new Set<string>();
    if (keys.length) for (const x of (await db.select(`dbv5_agent_log?select=k:output->>key&agent=eq.manager&output->>key=in.(${keys.map((k) => `"${k.replace(/["\\]/g, "")}"`).join(",")})`)) ?? []) have.add(x.k);
    const fresh = unrecorded(batch as { output?: Record<string, unknown> }[], have) as LogRow[];
    if (fresh.length) await db.insert("dbv5_agent_log", JSON.parse(body(fresh, false)));
    return "check-then-insert";
  }
}

/** Remove exactly these keys from a book's outbox in one statement. Touches no other field and does not bump _rev. false = RPC not migrated. */
export async function ackWork(db: Db, rowId: string, keys: string[]): Promise<boolean> {
  try { await db.rest("rpc/dbv5_ack_work", { method: "POST", headers: { Prefer: "" }, body: JSON.stringify({ p_id: rowId, p_keys: keys }) }); return true; }
  catch (e) { if (/dbv5_ack_work|PGRST202|404/.test(String((e as Error).message))) return false; throw e; }
}

export type FlushIO = { insert: (rows: WorkRow[]) => Promise<string>; ack: (keys: string[]) => Promise<boolean> };
export type FlushResult = { delivered: number; pending: number; mode: string | null; needsStateSave: boolean; error: string | null };
/**
 * Deliver the outbox in batches. After each inserted batch, acknowledge exactly its keys (scoped RPC) and drop them from the
 * local copy so a later save cannot resurrect them. If the RPC is missing, the local copy is still trimmed and the caller must
 * persist it with a compare-and-set save. An insert failure stops the flush; everything not yet acknowledged stays pending.
 */
export async function flushOutbox(st: { _workOutbox?: WorkRow[] }, io: FlushIO, batchSize = 100): Promise<FlushResult> {
  let delivered = 0, mode: string | null = null, needsStateSave = false;
  while (st._workOutbox?.length) {
    const batch = st._workOutbox.slice(0, batchSize), keys = batch.map((r) => r.output.key);
    try { mode = await io.insert(batch); } catch (e) { return { delivered, pending: st._workOutbox.length, mode, needsStateSave, error: String((e as Error).message ?? e).slice(0, 200) }; }
    const scoped = await io.ack(keys).catch(() => false);
    if (!scoped) needsStateSave = true;
    const done = new Set(keys); st._workOutbox = st._workOutbox.filter((r) => !done.has(r.output.key)); delivered += batch.length;
  }
  if (st._workOutbox && !st._workOutbox.length) delete st._workOutbox;
  return { delivered, pending: st._workOutbox?.length ?? 0, mode, needsStateSave, error: null };
}

/** Backlog for the status payload: count and oldest queued time (no record contents). */
export const backlog = (st: { _workOutbox?: WorkRow[] } | null | undefined) => {
  const box = st?._workOutbox ?? [], ts = box.map((r) => Number((r.output as Record<string, unknown>).queuedAt)).filter(Number.isFinite);
  return { pending: box.length, oldestQueuedAt: ts.length ? new Date(Math.min(...ts)).toISOString() : null };
};
