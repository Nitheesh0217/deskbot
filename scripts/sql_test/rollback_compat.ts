// Rollback compatibility over real PostgREST with BOTH migrations applied: the exact scanner requests of
//   (a) plain v24 (3e25392)            -> expected to FAIL (its 3-column conflict target no longer exists)
//   (b) the rollback artifact           -> expected to work, write book rows only, and read the book lane only
// Request strings are extracted from each artifact's index.ts, not retyped. Run by postgrest.sh ROLLBACK=1.
import { readFileSync } from "node:fs";
import { makeDb } from "../../supabase/functions/deskbot-v5/persist.ts";
const [base, jwt, v24Path, compatPath] = process.argv.slice(2); const db = makeDb(base, jwt);
let fails = 0; const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " · " + d : ""}`); if (!ok) fails++; };
const reqs = (src: string) => ({ insert: src.match(/rest\("(dbv5_scan_signals\?on_conflict=[^"]+)"/)![1], record: src.match(/select\("(dbv5_scan_signals\?select=sym,strategy,dir,bar_t,entry,stop,tp1,status,r_net,exit_t,score[^"]*)"\)/)![1] });
const v24 = reqs(readFileSync(v24Path, "utf8")), compat = reqs(readFileSync(compatPath, "utf8"));
console.log(`v24 insert: ${v24.insert}\ncompat insert: ${compat.insert}\ncompat record: ${compat.record}`);
const sig = { sym: "BTC", strategy: "SSR", dir: "long", bar_t: 9001, entry: 100, stop: 99, tp1: 101, r_dist: 1, cost_r: 0.1, max_hold_h: 8, score: 1, why: ["x"], checked_t: 9001 };   // v24 sends no lane field
await db.insert("dbv5_scan_signals", [{ ...sig, lane: "shadow", cfg_id: "SHADOW-1:bbbb0000", status: "tp1", r_net: 0.9 }]);   // a shadow record already exists for this bar
const post = (path: string) => db.rest(path, { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify([sig]) });
let v24err = ""; try { await post(v24.insert); } catch (e) { v24err = String((e as Error).message); }
check("plain v24 setup insert fails after the lane migration (why a plain rollback is incomplete)", /42P10|ON CONFLICT|unique or exclusion/i.test(v24err), v24err.slice(0, 110));
await post(compat.insert); await post(compat.insert);
const rows = await db.select("dbv5_scan_signals?select=lane,cfg_id,status&bar_t=eq.9001&order=lane");
check("artifact insert writes one book row beside the existing shadow row; the shadow record is untouched", rows.length === 2 && rows[0].lane === "book" && rows[0].cfg_id === null && rows[1].lane === "shadow" && rows[1].status === "tp1", JSON.stringify(rows));
const rec = await db.select(compat.record);
check("artifact market-record query returns book rows only", rec.length >= 1 && rec.every((r: any) => r.bar_t !== 9001 || r.status === "open"), `${rec.length} row(s)`);
const shadowStill = await db.select("dbv5_scan_signals?select=id&lane=eq.shadow"); check("no shadow record is discarded", shadowStill.length >= 1);
process.exit(fails ? 1 : 0);
