// Research harness: replays a fixed, hashed 5-minute dataset through the repo's engine (supabase/functions/deskbot-v5/engine.ts).
// Every invocation, including refusals, is appended to out/RUN_LOG.jsonl. No network access; paper only.
//   npx tsx research/2026-10-28-profit-improvement/harness/run.ts --sym BTC --period A --variant BASE [--tag t] [--costmult 1] [--startMs N --endMs N]
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { backtest, type Bar } from "../../../supabase/functions/deskbot-v5/engine.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(ROOT, "..", "..");
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const arg = (k: string, d?: string) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DAY = 86_400_000, TF5 = 300_000;
// Fixed periods (UTC, [start, end)). C ends where live paper trading began (2026-10-22 00:00).
const C_END = 1792627200000;
export const PERIODS: Record<string, [number, number]> = {
  A: [C_END - 1095 * DAY, C_END - 730 * DAY],
  B: [C_END - 730 * DAY, C_END - 365 * DAY],
  C: [C_END - 365 * DAY, C_END],
};
const WARM_DAYS = 130;

const log = (o: Record<string, unknown>) => { mkdirSync(join(ROOT, "out"), { recursive: true }); appendFileSync(join(ROOT, "out", "RUN_LOG.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...o }) + "\n"); };
const sym = arg("sym")!, period = arg("period")!, variant = arg("variant")!, tag = arg("tag", "")!, costmult = +(arg("costmult", "1")!);
const repeatReason = arg("repeat-reason", "")!;
const base = { sym, period, variant, tag, costmult };
const refuse = (why: string): never => { log({ ...base, status: "refused", why }); console.error("REFUSED:", why); process.exit(3); };

// --- integrity: pinned inputs
const engineSrc = readFileSync(join(REPO, "supabase/functions/deskbot-v5/engine.ts"));
const engineSha = sha(engineSrc);
const sums = Object.fromEntries(readFileSync(join(ROOT, "data/SHA256SUMS"), "utf8").trim().split("\n").map((l) => { const [h, f] = l.split(/\s+/); return [f, h]; }));
const variants = JSON.parse(readFileSync(join(ROOT, "variants.json"), "utf8"));
const live = JSON.parse(readFileSync(join(ROOT, "data/live_cfg_2026-10-28.json"), "utf8"));
const book = sym === "BTC" ? live.books.BTC : sym === "PAXG" ? live.books.GOLD : null;
if (!book) refuse("unknown sym (use BTC or PAXG)");
if (!(variant in variants)) refuse("unknown variant " + variant);
const customWindow = arg("startMs") && arg("endMs");
if (!customWindow && !(period in PERIODS)) refuse("unknown period");
if (customWindow && period !== "FIDELITY" && +arg("endMs")! > C_END) refuse("custom windows past 2026-10-22 are FIDELITY-only");

// --- governance: variants and the holdout need a frozen spec; the holdout runs once per (sym, variant, costmult)
const freezePath = join(ROOT, "FREEZE.json");
let freezeSha = "";
const needsFreeze = variant !== "BASE" || period === "C";
if (needsFreeze) {
  if (!existsSync(freezePath)) refuse("FREEZE.json missing: challengers and the holdout cannot run before the specification is frozen");
  const fz = JSON.parse(readFileSync(freezePath, "utf8"));
  for (const [f, h] of Object.entries(fz.files as Record<string, string>)) if (sha(readFileSync(join(ROOT, f))) !== h) refuse(`frozen file changed after freeze: ${f}`);
  if (fz.engineSha256 !== engineSha) refuse("engine.ts differs from the frozen engine");
  freezeSha = sha(readFileSync(freezePath));
}
if (period === "C") {
  if (process.env.HOLDOUT_ONCE !== "1") refuse("holdout requires HOLDOUT_ONCE=1");
  const ledgerPath = join(ROOT, "out", "holdout_ledger.json");
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : {};
  const key = `${sym}|${variant}|${costmult}`;
  if (ledger[key] && !repeatReason) refuse(`holdout already used for ${key} at ${ledger[key]}; a repeat needs --repeat-reason and is logged`);
  ledger[key] = new Date().toISOString(); writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1));
}

// --- data
const file = sym === "BTC" ? "kline5_BTC.csv" : "kline5_PAXG.csv";
const csvText = gunzipSync(readFileSync(join(ROOT, "data", file + ".gz"))).toString("utf8");
if (sha(csvText) !== sums[file]) refuse(`dataset hash mismatch for ${file}`);
let rows = csvText.trim().split("\n");
const lwFile = file.replace(".csv", "_live_window.csv");
if (customWindow && +arg("endMs")! > C_END) {   // exposed live week: allowed only for the fidelity replay, never for evaluation periods
  if (period !== "FIDELITY") refuse("data after 2026-10-22 may only be used with --period FIDELITY");
  const lw = readFileSync(join(ROOT, "data", lwFile), "utf8"); if (sha(lw) !== sums[lwFile]) refuse("live-window hash mismatch");
  rows = rows.concat(lw.trim().split("\n"));
}
const m5all: Bar[] = new Array(rows.length);
for (let i = 0; i < rows.length; i++) { const p = rows[i].split(","); const t = +p[0]; m5all[i] = { t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5], ct: t + TF5 - 1 }; }
function agg(m5: Bar[], tf: number): Bar[] {
  const per = tf / TF5, out: Bar[] = []; let i = 0;
  while (i < m5.length) {
    const k = Math.floor(m5[i].t / tf) * tf; let j = i, h = -Infinity, l = Infinity, v = 0, c = 0, n = 0; const o = m5[i].o;
    while (j < m5.length && Math.floor(m5[j].t / tf) * tf === k) { h = Math.max(h, m5[j].h); l = Math.min(l, m5[j].l); c = m5[j].c; v += m5[j].v; n++; j++; }
    if (n === per) out.push({ t: k, o, h, l, c, v, ct: k + tf - 1 });
    i = j;
  }
  return out;
}
const [start, end] = customWindow ? [+arg("startMs")!, +arg("endMs")!] : PERIODS[period];
const m5 = m5all.filter((b) => b.t >= start - WARM_DAYS * DAY && b.t < end);
const warmBars = m5.filter((b) => b.t < start).length;
const frames = { m5, m15: agg(m5, 15 * 60_000), h1: agg(m5, 3_600_000), h4: agg(m5, 14_400_000) };

// --- config: live book cfg + variant overlay (+ optional cost multiplier applied identically to every variant)
const cfg: Record<string, unknown> = { ...book.cfg, ...variants[variant] };
if (costmult !== 1) Object.assign(cfg, { TAKER_FEE: 0.00045 * costmult, MAKER_FEE: 0.00015 * costmult, SLIPPAGE: 0.0002 * costmult });
const cfgSha = sha(JSON.stringify(cfg, Object.keys(cfg).sort()));

const t0 = Date.now();
const startEq = arg("startEquity") ? +arg("startEquity")! : book.startEquity;
const r = backtest(frames, { startEquity: startEq, cfg: cfg as never, warmupBars: warmBars });
const trades = r.trades.map((t) => ({
  id: t.id, s: t.strategy, d: t.dir === "long" ? 1 : -1, e: t.entry, x: t.exitAvg, o: t.openT, c: t.closeT, n: t.net, r: t.r, k: t.riskAmt, f: t.fees, u: t.funding, g: t.gross,
  q: t.originalQty, sc: t.score, rg: t.regime, rs: t.reason, ex: t.exits.map((x) => [x.kind, x.px, x.qty, x.fee]),
}));
const curve = r.curve.filter((_, i) => i % 24 === 0);
const runId = `${variant}_${sym}_${customWindow ? "W" + start : period}_cm${costmult}_${Date.now()}`;
const out = {
  meta: { runId, sym, period, variant, tag, costmult, startMs: start, endMs: end, warmBars, bars5m: m5.length, startEquity: startEq, endEquity: r.state.equity, maxDD: r.state.maxDD,
    engineSha256: engineSha, gitHead: (() => { try { return execSync("git rev-parse HEAD", { cwd: REPO }).toString().trim(); } catch { return ""; } })(), datasetSha256: sums[file], cfgSha256: cfgSha, freezeSha256: freezeSha, cpuMs: Date.now() - t0, repeatReason },
  cfg, signalsSeen: r.signalsSeen, trades, curve,
};
writeFileSync(join(ROOT, "out", "runs", runId + ".json"), JSON.stringify(out));
const netR = trades.reduce((a, t) => a + t.r, 0), net = trades.reduce((a, t) => a + t.n, 0);
log({ ...base, status: "ok", runId, trades: trades.length, netR: +netR.toFixed(3), net: +net.toFixed(2), endEquity: +r.state.equity.toFixed(2), maxDD: +r.state.maxDD.toFixed(4), cfgSha256: cfgSha, engineSha256: engineSha, outputSha256: sha(JSON.stringify(out.trades)), repeatReason: repeatReason || undefined });
console.log(`${runId}: ${trades.length} trades, net ${net.toFixed(2)} (${netR.toFixed(2)}R), endEq ${r.state.equity.toFixed(2)}, maxDD ${(r.state.maxDD * 100).toFixed(1)}%, ${Date.now() - t0}ms`);
