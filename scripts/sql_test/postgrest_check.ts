// Drives the application's own persistence code (persist.ts) over HTTP against a local PostgREST + PostgreSQL with the
// W2 migration applied. Run by scripts/sql_test/postgrest.sh. Prints one line per check; exits non-zero on any failure.
import { makeDb, saveStateCAS, writeAgentRows, ackWork, flushOutbox, StateConflict } from "../../supabase/functions/deskbot-v5/persist.ts";
import type { WorkRow } from "../../supabase/functions/deskbot-v5/worklog.ts";

const [base, jwt] = process.argv.slice(2);
const db = makeDb(base, jwt);
let fails = 0; const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " · " + detail : ""}`); if (!ok) fails++; };
const row = (k: string): WorkRow => ({ agent: "manager", input_summary: k, output: { key: k, ref: "V5-1", action: "manage", queuedAt: 1 } as never });
const count = async (k: string) => (await db.select(`dbv5_agent_log?select=id&work_key=eq.${encodeURIComponent(k)}`)).length;

// 1) conflict-safe insert: the real request (?columns=...&on_conflict=work_key, Prefer: resolution=ignore-duplicates)
const m1 = await writeAgentRows(db, "BTC", [row("V5-1:close:final"), row("V5-1:manage:1:0:stop:abcd1234")]);
const m2 = await writeAgentRows(db, "BTC", [row("V5-1:close:final")]);
check("insert uses the conflict-safe path", m1 === "conflict-safe" && m2 === "conflict-safe", `${m1}/${m2}`);
check("a repeated key is suppressed", (await count("V5-1:close:final")) === 1);
await Promise.all(Array.from({ length: 12 }, () => writeAgentRows(db, "BTC", [row("V5-1:exit:stop:99")])));
check("12 concurrent requests with one key leave one row", (await count("V5-1:exit:stop:99")) === 1);
await db.insert("dbv5_agent_log", [{ agent: "chart", output: {} }, { agent: "chart", output: {} }]);
check("unkeyed rows (other agents) are unaffected", (await db.select("dbv5_agent_log?select=id&agent=eq.chart")).length === 2);

// 2) compare-and-set state writes (the real PATCH with the state->>_rev / state->_rev=is.null filter)
await db.insert("dbv5_state", [{ id: "main", state: { equity: 100 } }]);
const a: any = { equity: 101 }; await saveStateCAS(db, "main", a, { action: "HOLD" });
check("legacy row (no _rev) accepts the first CAS write", a._rev === 1);
const stale: any = { equity: 999, _rev: 0 }; let conflict = false; try { await saveStateCAS(db, "main", stale); } catch (e) { conflict = e instanceof StateConflict; }
const cur = (await db.select("dbv5_state?id=eq.main&select=state"))[0].state;
check("a stale writer gets StateConflict and writes nothing", conflict && cur.equity === 101 && cur._rev === 1);
const racers = Array.from({ length: 10 }, (_, i) => ({ equity: 200 + i, _rev: 1 } as any));
const res = await Promise.allSettled(racers.map((r) => saveStateCAS(db, "main", r)));
const won = res.filter((r) => r.status === "fulfilled").length, after = (await db.select("dbv5_state?id=eq.main&select=state"))[0].state;
check("10 concurrent writers from one revision: exactly one wins", won === 1 && after._rev === 2, `won=${won} rev=${after._rev}`);

// 3) scoped acknowledgement RPC: removes exactly the given keys, keeps everything else and the revision
const B: any = { ...after, equity: 342.5, pos: { stop: 100 }, _workOutbox: [row("a1"), row("a2"), row("b1")] };
await saveStateCAS(db, "main", B);
const ok = await ackWork(db, "main", ["a1", "a2"]);
const acked = (await db.select("dbv5_state?id=eq.main&select=state"))[0].state;
check("ack RPC is reachable through PostgREST", ok === true);
check("ack removes only the listed keys and keeps equity, position and _rev", acked._workOutbox.map((r: WorkRow) => r.output.key).join() === "b1" && acked.equity === 342.5 && acked.pos.stop === 100 && acked._rev === B._rev);

// 4) end-to-end flush with the real io
const st: any = { _workOutbox: Array.from({ length: 230 }, (_, i) => row(`flush:${i}`)) };
const f = await flushOutbox(st, { insert: (rs) => writeAgentRows(db, "BTC", rs), ack: async () => true }, 100);
let all = true; for (let i = 0; i < 230; i++) if ((await count(`flush:${i}`)) !== 1) all = false;
check("flush delivers 230 records in batches, each exactly once in the table", f.delivered === 230 && f.pending === 0 && all);

// 5) scanner setups: the lane-aware insert request (track.ts signalInsertRequest) — both lanes kept for one strategy and bar
try {
  const { signalInsertRequest } = await import("../../supabase/functions/deskbot-v5/track.ts");
  const sig = (lane: "book" | "shadow") => ({ lane, cfg_id: lane === "book" ? "book:aaaa0000" : "SHADOW-1:bbbb0000", sym: "BTC", strategy: "SSR", dir: "long" as const, bar_t: 777, entry: 100, stop: 99, tp1: 101, r_dist: 1, cost_r: 0.1, max_hold_h: 8, score: 1, why: ["x"] });
  for (let i = 0; i < 2; i++) { const q = signalInsertRequest([sig("book"), sig("shadow")], true); await db.rest(q.path, q.init); }
  const got = await db.select("dbv5_scan_signals?select=lane,cfg_id&bar_t=eq.777&order=lane");
  check("lane-aware setup insert: book and shadow rows coexist, repeats suppressed", got.length === 2 && got[0].lane === "book" && got[1].lane === "shadow" && got[1].cfg_id === "SHADOW-1:bbbb0000", JSON.stringify(got));
} catch (e) { check("lane-aware setup insert", false, String((e as Error).message).slice(0, 160)); }

console.log(fails ? `${fails} check(s) failed` : "all checks passed");
process.exit(fails ? 1 : 0);
