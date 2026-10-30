// Ack-vs-stale-writer race over real PostgREST (application code from persist.ts):
//   B reads revision N with pending X; A inserts X and acknowledges it; B saves its loaded copy with guard N.
// Prints whether X reappears in the stored outbox, and what B's save kept. Run by scripts/sql_test/postgrest.sh RACE=1.
import { makeDb, saveStateCAS, writeAgentRows, ackWork, StateConflict } from "../../supabase/functions/deskbot-v5/persist.ts";
import type { WorkRow } from "../../supabase/functions/deskbot-v5/worklog.ts";
const [base, jwt] = process.argv.slice(2); const db = makeDb(base, jwt);
const row = (k: string): WorkRow => ({ agent: "manager", input_summary: k, output: { key: k, ref: "V5-9", action: "manage", queuedAt: 1 } as never });
const load = async () => (await db.select("dbv5_state?id=eq.race&select=state"))[0].state;
let fails = 0; const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " · " + d : ""}`); if (!ok) fails++; };
await db.insert("dbv5_state", [{ id: "race", state: { _rev: 5, equity: 340, pos: { id: "V5-9", stop: 110 }, _workOutbox: [row("X")] } }]);
const B: any = await load();                                       // B reads revision 5 containing X
await writeAgentRows(db, "BTC", [row("X")]); await ackWork(db, "race", ["X"]);   // A delivers and acknowledges X
B.equity = 341.2; B.pos.stop = 105; B._workOutbox = [...B._workOutbox, row("Y")];  // B's own legitimate work + new pending Y
await saveStateCAS(db, "race", B);                                // B saves its loaded copy with guard _rev=5
const after: any = await load(), keys = (after._workOutbox ?? []).map((r: WorkRow) => r.output.key);
console.log(`stored outbox after B's save: [${keys.join(",")}] · equity ${after.equity} · stop ${after.pos.stop} · rev ${after._rev}`);
check("X does not reappear after B's stale-copy save", !keys.includes("X"));
check("B's equity, stop and newer pending Y are kept", after.equity === 341.2 && after.pos.stop === 105 && keys.includes("Y"));
check("X is in the log exactly once", (await db.select("dbv5_agent_log?select=id&work_key=eq.X")).length === 1);
// retries and conflicts: A's insert and ack retried; a third writer with a stale revision is rejected
await writeAgentRows(db, "BTC", [row("X")]); await ackWork(db, "race", ["X"]);
check("A's retried insert + ack change nothing", (await db.select("dbv5_agent_log?select=id&work_key=eq.X")).length === 1 && (await load())._rev === after._rev);
const C: any = { ...(await load()), _rev: 5, equity: 1 }; let conflict = false; try { await saveStateCAS(db, "race", C); } catch (e) { conflict = e instanceof StateConflict; }
check("a writer holding an older revision still gets StateConflict", conflict && (await load()).equity === 341.2);
// concurrent interleavings: B's stale save and A's insert+ack run in parallel with random delays; X must never stay
let resurrected = 0, lostY = 0;
for (let i = 0; i < 30; i++) {
  const id = `race${i}`, kx = `X${i}`, ky = `Y${i}`;
  await db.insert("dbv5_state", [{ id, state: { _rev: 1, equity: 340, _workOutbox: [row(kx)] } }]);
  const Bi: any = (await db.select(`dbv5_state?id=eq.${id}&select=state`))[0].state; Bi.equity = 341; Bi._workOutbox = [...Bi._workOutbox, row(ky)];
  const wait = () => new Promise((r) => setTimeout(r, Math.random() * 15));
  await Promise.all([(async () => { await wait(); await writeAgentRows(db, "BTC", [row(kx)]); await wait(); await ackWork(db, id, [kx]); })(), (async () => { await wait(); await saveStateCAS(db, id, Bi); })()]);
  const ks = ((await db.select(`dbv5_state?id=eq.${id}&select=state`))[0].state._workOutbox ?? []).map((r: WorkRow) => r.output.key);
  if (ks.includes(kx)) resurrected++; if (!ks.includes(ky)) lostY++;
}
check("30 concurrent interleavings: a delivered record never stays, the newer pending record always does", resurrected === 0 && lostY === 0, `resurrected=${resurrected} lostY=${lostY}`);
process.exit(fails ? 1 : 0);
