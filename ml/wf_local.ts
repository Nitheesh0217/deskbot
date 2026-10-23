// Local walk-forward on a 5m CSV (timestamp,open,high,low,close,volume[,taker_buy]). usage: npx tsx ml/wf_local.ts <csv> <SYM> [cfg.json]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { mineSetups, walkForward, whereMoney, stats } from "../supabase/functions/deskbot-v5/research.ts";
import type { Bar } from "../supabase/functions/deskbot-v5/engine.ts";
const [, , src, sym = "BTC", cfgPath] = process.argv;
const cfg = cfgPath ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
const lines = readFileSync(src, "utf8").trim().split("\n"); lines.shift();
const m5: Bar[] = lines.map((ln) => { const [ts, o, h, l, c, v] = ln.split(","); const t = Date.parse(ts); return { t, o: +o, h: +h, l: +l, c: +c, v: +v, ct: t + 299_999 }; });
const agg = (tf: number) => { const out: Bar[] = []; let cur: Bar | null = null, key = -1; for (const x of m5) { const k = Math.floor(x.t / tf); if (k !== key) { if (cur) out.push(cur); key = k; cur = { t: k * tf, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v, ct: (k + 1) * tf - 1 }; } else if (cur) { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v += x.v; } } if (cur) out.push(cur); return out; };
const t = Date.now();
const setups = mineSetups({ m5, m15: agg(9e5), h1: agg(36e5), h4: agg(144e5) }, cfg);
console.error(`${sym}: ${setups.length} setups in ${((Date.now() - t) / 1000).toFixed(0)}s`);
const rows = setups.map((s) => ({ ...s, sym }));
mkdirSync("ml/data", { recursive: true }); writeFileSync(`ml/data/setups_${sym}.json`, JSON.stringify(rows));
const years = [...new Set(rows.map((r) => new Date(r.t).getUTCFullYear()))].sort().slice(1);
console.log(JSON.stringify({ total: stats(rows), wf: walkForward(rows, years), money: whereMoney(rows) }, null, 1));
