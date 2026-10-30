// PR #19 release corrections: no silent loss of unconfirmed work-log records; stale acknowledgements cannot overwrite state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeOutbox, type WorkRow } from "../supabase/functions/deskbot-v5/worklog.ts";
import { flushOutbox, saveStateCAS, StateConflict, backlog, type Db } from "../supabase/functions/deskbot-v5/persist.ts";

const row = (k: string, t = 0): WorkRow => ({ agent: "manager", input_summary: k, output: { key: k, ref: "V5-1", action: "manage", queuedAt: t } as never });

// In-memory book row + work log with the SAME semantics as the SQL: CAS on state._rev; ack removes exactly the listed keys;
// the log suppresses duplicate keys. scripts/sql_test/postgrest.sh checks these semantics against real PostgREST + PostgreSQL.
function store(state: Record<string, unknown>) {
  const db = { state: structuredClone(state) as any, log: new Map<string, number>(), insertFails: false };
  const rest = async (path: string, init: RequestInit = {}) => {
    if (path.startsWith("dbv5_state?") && init.method === "PATCH") {
      const m = path.match(/state->>_rev=eq\.(\d+)/), want = m ? +m[1] : (path.includes("state->_rev=is.null") ? null : -1), cur = typeof db.state._rev === "number" ? db.state._rev : null;
      if (want !== cur) return [];
      const b = JSON.parse(String(init.body)); db.state = b.state; return [{ id: "main" }];
    }
    throw new Error("unexpected " + path);
  };
  const io = (who: string) => ({
    insert: async (rows: WorkRow[]) => { if (db.insertFails) throw new Error(`log down (${who})`); for (const r of rows) db.log.set(r.output.key, (db.log.get(r.output.key) ?? 0) + (db.log.has(r.output.key) ? 0 : 1)); return "conflict-safe"; },
    ack: async (keys: string[]) => { const k = new Set(keys); if (db.state._workOutbox) db.state._workOutbox = db.state._workOutbox.filter((r: WorkRow) => !k.has(r.output.key)); return true; },
  });
  return { db, io, dbClient: { rest } as unknown as Db };
}

test("more than 200 pending records during an outage are all retained (no cap), then all delivered exactly once each on recovery", async () => {
  let box: WorkRow[] | undefined;
  for (let i = 0; i < 260; i++) box = mergeOutbox(box, [row(`k${i}`, 1000 + i)]);   // 260 distinct management records accumulate
  box = mergeOutbox(box, [row("k5"), row("k5")]);                                     // repeats do not grow it
  assert.equal(box!.length, 260, "nothing dropped");
  const { db, io } = store({ _rev: 1 }); const st: any = { _workOutbox: box };
  db.insertFails = true; const down = await flushOutbox(st, io("A"), 100);
  assert.equal(down.pending, 260); assert.match(String(down.error), /log down/); assert.equal(db.log.size, 0);
  assert.deepEqual(backlog(st), { pending: 260, oldestQueuedAt: new Date(1000).toISOString() });
  db.insertFails = false; const up = await flushOutbox(st, io("A"), 100);
  assert.equal(up.delivered, 260); assert.equal(up.pending, 0); assert.equal(st._workOutbox, undefined);
  assert.equal(db.log.size, 260); for (let i = 0; i < 260; i++) assert.equal(db.log.get(`k${i}`), 1, `k${i} once`);
});

test("an insert failure part-way keeps every unacknowledged record; the next flush delivers only those", async () => {
  const { db, io } = store({ _rev: 1 }); const st: any = { _workOutbox: Array.from({ length: 250 }, (_, i) => row(`p${i}`)) };
  let calls = 0; const flaky = { ...io("A"), insert: async (rows: WorkRow[]) => { if (++calls === 2) throw new Error("timeout"); return io("A").insert(rows); } };
  const r = await flushOutbox(st, flaky, 100); assert.equal(r.delivered, 100); assert.equal(r.pending, 150);
  await flushOutbox(st, io("A"), 100); assert.equal(db.log.size, 250);
});

test("stale acknowledgement: A saves an outbox and stalls, B advances the book, A acks: B's position, equity and newer pending records survive; A's later save is rejected", async () => {
  const { db, io, dbClient } = store({ _rev: 7, equity: 340, pos: { id: "V5-1", stop: 110 } });
  // A: loads rev 7, manages, saves its outbox (a1, a2) -> rev 8, then stalls before flushing
  const A: any = structuredClone(db.state); A.pos.stop = 105; A._workOutbox = [row("a1"), row("a2")];
  await saveStateCAS(dbClient, "main", A);
  // B (lease expired, A still alive): loads rev 8, a TP fill changes equity and the stop, adds b1, saves -> rev 9
  const B: any = structuredClone(db.state); B.equity = 342.5; B.pos.stop = 100; B._workOutbox = mergeOutbox(B._workOutbox, [row("b1")]);
  db.insertFails = true; await saveStateCAS(dbClient, "main", B); await flushOutbox(B, io("B")); db.insertFails = false;   // B's log write fails: a1, a2, b1 pending
  // A resumes: delivers and acknowledges a1, a2 only
  const r = await flushOutbox(A, io("A")); assert.equal(r.delivered, 2); assert.equal(r.needsStateSave, false);
  assert.equal(db.state.equity, 342.5); assert.equal(db.state.pos.stop, 100); assert.equal(db.state._rev, 9, "the ack did not rewrite or re-version the state");
  assert.deepEqual(db.state._workOutbox.map((x: WorkRow) => x.output.key), ["b1"], "B's newer pending record survives; A's acknowledged ones are gone");
  // any later save by A (e.g. provider counters) is a stale compare-and-set and writes nothing
  A.equity = 1; await assert.rejects(saveStateCAS(dbClient, "main", A), StateConflict);
  assert.equal(db.state.equity, 342.5); assert.equal(db.state._rev, 9);
  // B's next flush delivers b1 (and harmlessly re-sends a1/a2, suppressed) — nothing lost, nothing duplicated
  await flushOutbox(B, io("B")); assert.deepEqual([...db.log.keys()].sort(), ["a1", "a2", "b1"]); assert.ok([...db.log.values()].every((n) => n === 1));
});

test("CAS: first write of a legacy state (no _rev) uses the null guard; a stale writer cannot overwrite", async () => {
  const { db, dbClient } = store({ equity: 1 });
  const x: any = structuredClone(db.state); x.equity = 2; await saveStateCAS(dbClient, "main", x); assert.equal(db.state._rev, 1);
  const stale: any = { equity: 9 }; await assert.rejects(saveStateCAS(dbClient, "main", stale), StateConflict); assert.equal(db.state.equity, 2);
});

test("bounded recovery: a 1,200-record backlog with slow writes is drained over several runs within the per-run budget; nothing is lost", async () => {
  const { db, io } = store({ _rev: 1 }); const st: any = { _workOutbox: Array.from({ length: 1200 }, (_, i) => row(`b${i}`)) };
  let t = 0; const clock = () => t, slow = { ...io("A"), insert: async (rows: WorkRow[]) => { t += 1500; return io("A").insert(rows); } };   // each batch takes 1.5 s
  const runs: any[] = [];
  while (st._workOutbox?.length && runs.length < 20) { t = 0; runs.push(await flushOutbox(st, slow, 100, { maxBatches: 5, maxMs: 4000, clock })); }
  assert.ok(runs.every((r) => r.batches <= 3 && r.ms <= 4000 + 1500), "each run stops at the time budget (3 batches of 1.5 s)"); assert.ok(runs[0].budgetExhausted);
  assert.equal(runs.length, 4, "1,200 records at 300 per run"); assert.equal(db.log.size, 1200); assert.ok([...db.log.values()].every((n) => n === 1));
  const fast = { _workOutbox: Array.from({ length: 1200 }, (_, i) => row(`f${i}`)) } as any; const r = await flushOutbox(fast, io("A"), 100, { maxBatches: 5, maxMs: 4000 });
  assert.equal(r.delivered, 500); assert.equal(r.pending, 700); assert.equal(r.budgetExhausted, true, "batch budget limits a fast run too");
});

test("bounded recovery with failing writes: a failure stops the run immediately, keeps everything unacknowledged, and the next run resumes", async () => {
  const { db, io } = store({ _rev: 1 }); const st: any = { _workOutbox: Array.from({ length: 700 }, (_, i) => row(`c${i}`)) };
  let n = 0; const flaky = { ...io("A"), insert: async (rows: WorkRow[]) => { if (++n % 3 === 0) throw new Error("503"); return io("A").insert(rows); } };
  const results: any[] = []; for (let i = 0; i < 12 && st._workOutbox?.length; i++) results.push(await flushOutbox(st, flaky, 100, { maxBatches: 5, maxMs: 4000 }));
  assert.ok(results.some((r) => r.error === "503" && !r.budgetExhausted)); assert.equal(st._workOutbox, undefined); assert.equal(db.log.size, 700);
});
