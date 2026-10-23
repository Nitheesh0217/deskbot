// ═══════════════════════════════════════════════════════════════════════════
//  DeskBot v5.5 — Supabase Edge Function (24/7, server-side, PAPER ONLY). Multi-book: BTC + GOLD (PAXG)
//    POST  (x-deskbot-key)  {action:"run"}       → one iteration (pg_cron every 5 min, single-leader lease)
//  Runtime needs NO Claude/Anthropic service. Optional AI (Groq/Gemini free tiers) only labels news risk.
//    POST  (x-deskbot-key)  {action:"backtest",days,source,cfg,label} → walk-forward backtest (IS 2/3, OOS 1/3)
//    GET   ?view=status                          → public read-only dashboard bundle
//  There is NO order-placement code in this function or project.
// ═══════════════════════════════════════════════════════════════════════════
import {
  VERSION, CFG, STRATEGIES, buildSeries, snapshot, evaluate, entryGates, openPosition, managePosition,
  initState, unrealized, backtest, summarize, rollDay, dynamicRisk, applyCfg, resolvedCfg, ensureState, markEquity, setMlAsset, traderManage, m1View, type State, type Trade, type Bar,
} from "./engine.ts";
import { candles, candlesRange, candlesRangeBinance, hlContext, fearGreed, orderFlow, SYMBOLS, isSym, type Sym } from "./data.ts";
import { readNews, newsBlocks, type NewsRead } from "./news.ts";
import { providersFromEnv, type Usage } from "./ai.ts";
import { chat, validatePatch, mergeCfg, EDITABLE, type ChatTurn } from "./chat.ts";
import { configIntegrity, serialExecutor } from "./runtime.ts";

// Module config belongs to one request at a time. This is isolate-local; the
// existing database lease still coordinates state writes across edge isolates.
const exclusive = serialExecutor();
const integrityFor = (sym: Sym, cfg: unknown) => configIntegrity(VERSION, sym, cfg, Deno.env.get(`DESKBOT_${sym}_CONFIG_HASH`) ?? "");

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("DESKBOT_CRON_SECRET") ?? "";
const NTFY = Deno.env.get("DESKBOT_NTFY_TOPIC") ?? ""; // optional phone push via ntfy.sh
const NEWS_MODE = Deno.env.get("NEWS_MODE") ?? "shadow";            // off | shadow | gate
const NEWS_EVERY_MIN = +(Deno.env.get("NEWS_EVERY_MIN") ?? 30);
const NEWS_AI = (Deno.env.get("NEWS_AI") ?? "on") !== "off";
const CHAT_KEY = Deno.env.get("DESKBOT_CHAT_KEY") ?? "";
const CHAT_DAILY_CAP = +(Deno.env.get("CHAT_DAILY_CAP") ?? 150);
// Each book is a separate paper account (own equity, position, stats, cfg) in its own dbv5_state row.
// A non-BTC book only runs once its row exists (created deliberately, with a researched cfg).
const BOOKS: Sym[] = (Deno.env.get("DESKBOT_BOOKS") ?? "BTC,GOLD").split(",").map((x) => x.trim()).filter(isSym);
const rowId = (sym: Sym) => (sym === "BTC" ? "main" : sym.toLowerCase());
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-deskbot-key, x-chat-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

// ─── tiny PostgREST client ──────────────────────────────────────────────────
async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init, signal: init.signal ?? AbortSignal.timeout(10000), headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`DB ${path.split("?")[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const upsert = (table: string, rows: unknown) => rest(table, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
const insert = (table: string, rows: unknown) => rest(table, { method: "POST", body: JSON.stringify(rows) });
const select = (q: string) => rest(q, { method: "GET", headers: { Prefer: "" } });

// cron key lives in Supabase Vault; read via a service-role-only RPC (env var overrides if set)
let _key: string | null = null;
async function cronKey(): Promise<string> {
  if (_key) return _key;
  _key = (await rest("rpc/dbv5_cron_key", { method: "POST", headers: { Prefer: "" }, body: "{}" })) ?? "";
  return _key!;
}

async function loadState(sym: Sym = "BTC"): Promise<State | null> {
  const r = await select(`dbv5_state?id=eq.${rowId(sym)}&select=state`); return r?.[0]?.state ?? null;
}
async function saveState(st: State, lastRun: Record<string, unknown>, sym: Sym = "BTC") {
  await rest(`dbv5_state?id=eq.${rowId(sym)}`, { method: "PATCH", body: JSON.stringify({ state: st, last_run: lastRun, updated_at: new Date().toISOString() }) });
}
type Ev = { kind: string; strategy?: string | null; msg: string; data?: unknown; symbol?: Sym };
async function events(evs: Ev[]) { if (evs.length) await insert("dbv5_events", evs.map(e => ({ kind: e.kind, strategy: e.strategy ?? null, msg: e.msg, data: e.data ?? null, symbol: e.symbol ?? "BTC" }))); }
async function saveTrades(trs: Trade[], sym: Sym = "BTC") {
  if (!trs.length) return;
  await upsert("dbv5_trades", trs.map(t => ({
    id: t.id, symbol: sym, strategy: t.strategy, dir: t.dir, entry: t.entry, exit_avg: t.exitAvg, net: t.net, r: t.r, fees: t.fees, funding: t.funding,
    open_t: new Date(t.openT).toISOString(), close_t: new Date(t.closeT).toISOString(), reason: t.reason, data: t,
  })));
}
async function push(title: string, body: string) {
  if (!NTFY) return; try { await fetch(`https://ntfy.sh/${NTFY}`, { method: "POST", headers: { Title: title }, body }); } catch { /* optional */ }
}

// v3 carry-over: start v5 from the cloud v3 equity so the run is continuous
async function carryFromV3(now: number): Promise<State> {
  let eq = 352.56, carried: Record<string, unknown> = { from: "default" };
  try {
    const r = await select("bot_state?id=eq.singleton&select=state,updated_at");
    const s = r?.[0]?.state;
    if (s && typeof s.equity === "number") { eq = +s.equity.toFixed(2); carried = { from: "DeskBot v3 cloud (Supabase bot_state)", v3Equity: s.equity, v3Trades: s.tradeCount, v3StartEquity: s.startEquity, v3ConsecLosses: s.consecutiveLosses, at: r[0].updated_at }; }
  } catch (_) { /* default */ }
  return initState(eq, now, carried);
}

// ─── one live iteration ─────────────────────────────────────────────────────
async function runLocked() {
  const owner = crypto.randomUUID();
  const got = await rest("rpc/dbv5_lease", { method: "POST", headers: { Prefer: "" }, body: JSON.stringify({ owner, seconds: 120 }) });
  if (got !== true) return { ok: true, skipped: "another run holds the lease" };
  try {
    const out: Record<string, unknown> = {};
    for (const sym of BOOKS) {
      try { out[sym] = await runOnce(sym); }
      catch (e) { const msg = `${sym} book: ${(e as Error).message}`.slice(0, 300); out[sym] = { ok: false, error: msg }; try { await events([{ kind: "ERROR", msg, symbol: sym }]); } catch { /* ignore */ } }
    }
    return { ok: true, version: VERSION, books: out };
  } finally { try { await rest("rpc/dbv5_release", { method: "POST", body: JSON.stringify({ owner }) }); } catch { /* lease expires anyway */ } }
}

async function runOnce(sym: Sym = "BTC") {
  const now = Date.now(); const evs: Ev[] = []; const notes: string[] = [];
  const isCrypto = sym !== "GOLD", tag = sym === "BTC" ? "" : `${sym} `;
  let st = await loadState(sym);
  if (!st && sym !== "BTC") return { ok: true, sym, skipped: "book not initialised" };
  if (!st) { st = await carryFromV3(now); evs.push({ kind: "INIT", msg: `DeskBot ${VERSION} initialised at $${st.equity.toFixed(2)} (carried from v3)`, data: st.carried }); }
  ensureState(st); applyCfg(st.cfg); setMlAsset(sym === "GOLD");
  const integrity = await integrityFor(sym, resolvedCfg(st.cfg));

  const [m1v, m5, m15, h1, h4, ctx, fng, flow] = await Promise.all([
    candles("1m", 240, now, "hyperliquid", sym).catch(() => ({ bars: [] as Bar[], source: "hyperliquid" as const })), candles("5m", 400, now, "hyperliquid", sym), candles("15m", 400, now, "hyperliquid", sym), candles("1h", 300, now, "hyperliquid", sym), candles("4h", 700, now, "hyperliquid", sym), hlContext(sym),
    (async () => { if (!isCrypto) return null; const c = (st as State & { _fng?: { v: number; l: string; t: number } })._fng; if (c && now - c.t < 3 * 3600_000) return { value: c.v, label: c.l }; return await fearGreed(); })(), orderFlow(now, sym),
  ]);
  if (fng) (st as State & { _fng?: unknown })._fng = { v: fng.value, l: fng.label, t: now };
  const source = m5.source;

  // 1) manage an open position on the 1m path since the last processed bar
  const closed: Trade[] = [];
  if (st.pos) {
    const since = Math.max(st.lastBarT, st.pos.openT);
    const mins = Math.min(1000, Math.ceil((now - since) / 60_000) + 2);
    const m1 = (await candles("1m", mins, now, "hyperliquid", sym)).bars.filter((b: Bar) => b.ct > since);
    closed.push(...managePosition(st, m1, ctx ? ctx.funding : 0));
    if (m1.length) st.lastBarT = m1[m1.length - 1].ct;
    for (const t of closed) {
      const msg = `${t.strategy} ${t.dir.toUpperCase()} closed ${t.reason} · net $${t.net.toFixed(2)} (${t.r >= 0 ? "+" : ""}${t.r.toFixed(2)}R)`;
      evs.push({ kind: t.net > 0 ? "WIN" : "LOSS", strategy: t.strategy, msg: tag + msg, data: { r: t.r, net: t.net }, symbol: sym });
      await push(`DeskBot ${tag}${t.net > 0 ? "WIN" : "LOSS"}`, `${msg} · Eq $${st.equity.toFixed(2)}`);
    }
    if (st.pos) for (const e of st.pos.exits) if (e.t > since && e.kind !== "stop") evs.push({ kind: e.kind.toUpperCase(), strategy: st.pos.strategy, symbol: sym, msg: `${tag}${e.kind.toUpperCase()} filled @ ${e.px.toFixed(1)} · stop → ${st.pos.stop.toFixed(1)}` });
  } else st.lastBarT = now;

  // 1b) news read (every NEWS_EVERY_MIN). Failure here never stops position management above.
  const sx = st as State & { _news?: NewsRead; _aiUsage?: Usage };
  if (sym === "BTC" && NEWS_MODE !== "off" && (!sx._news || now - sx._news.t >= NEWS_EVERY_MIN * 60_000)) {
    try {
      const prev = sx._news?.risk;
      const nr = await readNews(now, (sx._aiUsage ??= {}), { useAi: NEWS_AI });
      sx._news = nr;
      await insert("dbv5_news", [{ risk: nr.risk, bias: nr.bias, event: nr.event, reason: nr.reason, by: nr.by, rule_risk: nr.ruleRisk, rule_hits: nr.ruleHits, headlines: nr.headlines.slice(0, 8), errors: nr.aiErrors ?? null, mode: NEWS_MODE }]);
      if (nr.risk !== prev) evs.push({ kind: "NEWS", msg: `News risk ${nr.risk} · bias ${nr.bias} · ${nr.reason} (${nr.by}${NEWS_MODE === "shadow" ? ", shadow mode" : ""})` });
      if (nr.risk === "HIGH" && prev !== "HIGH") await push("DeskBot news: HIGH risk", `${nr.event}: ${nr.reason}`);
    } catch (e) { evs.push({ kind: "ERROR", msg: `news layer: ${(e as Error).message}`.slice(0, 200) }); }
  }
  const newsBlock = sym === "BTC" ? newsBlocks(sx._news, NEWS_MODE, now) : null;
  const newsShadow = sym === "BTC" && NEWS_MODE === "shadow" ? newsBlocks(sx._news, "gate", now) : null;

  // 2) evaluate on the newest closed 5m bar (once per bar)
  const S = buildSeries({ m5: m5.bars, m15: m15.bars, h1: h1.bars, h4: h4.bars });
  const i5 = m5.bars.length - 1;
  const snap = snapshot(S, i5, { funding: ctx?.funding ?? null, oi: ctx?.oi ?? null, markPx: ctx?.markPx ?? null, fng: fng?.value ?? null });
  rollDay(st, now);
  markEquity(st, snap.price);
  const m1 = m1View(m1v.bars);
  let traderActs: string[] = [];
  if (st.pos) {
    const r = traderManage(st, snap, S, m1, snap.price, now); traderActs = r.acts;
    for (const a of r.acts) evs.push({ kind: "MANAGE", strategy: st.pos?.strategy ?? r.closed?.strategy ?? null, msg: tag + a, symbol: sym });
    if (r.closed) { closed.push(r.closed); const t = r.closed; evs.push({ kind: t.net > 0 ? "WIN" : "LOSS", strategy: t.strategy, msg: `${tag}${t.strategy} ${t.dir.toUpperCase()} closed by trade manager · net $${t.net.toFixed(2)} (${t.r >= 0 ? "+" : ""}${t.r.toFixed(2)}R)`, symbol: sym }); }
  }
  let action = st.pos ? "HOLD" : "SKIP"; let decision: unknown = null;
  if (snap.T > st.lastEvalT) {
    st.lastEvalT = snap.T;
    const { signals, rejects } = evaluate(snap, st.enabled, S);
    if (flow) for (const sg of signals) { const a = flow.imb24 * (sg.dir === "long" ? 1 : -1); sg.why.push(`Order flow 24h ${a > 0 ? "with" : "against"} trade (${(flow.imb24 * 100).toFixed(1)}%, shadow)`); }
    decision = { signals: signals.map(s => ({ strategy: s.strategy, dir: s.dir, score: s.score, why: s.why })), rejects };
    if (!st.pos) {
      let opened = false;
      if (newsBlock) notes.push(`Entries paused: ${newsBlock}`);
      if (newsShadow && signals.length) notes.push(`(shadow) news filter would pause: ${newsShadow}`);
      const enforce = (Deno.env.get("DESKBOT_ENFORCE_APPROVAL") ?? "off") === "on";
      if (!integrity.approved) notes.push(`${enforce ? "New entries paused" : "Warning (not enforced)"}: ${integrity.reason}`);
      for (const sig of newsBlock || (enforce && !integrity.approved) ? [] : signals) {
        const g = entryGates(st, sig, now);
        if (!g.ok) { notes.push(`${sig.strategy} ${sig.dir} ${sig.score}: ${g.reason}`); continue; }
        const fillRef = ctx?.markPx && Math.abs(ctx.markPx - snap.price) / snap.price < 0.01 ? ctx.markPx : snap.price;
        const p = openPosition(st, sig, fillRef, now);
        if (!p) { notes.push(`${sig.strategy}: price already through stop`); continue; }
        if (sym !== "BTC") p.id = `${sym}-${now}`;
        opened = true; action = `OPEN_${sig.dir.toUpperCase()}`;
        const msg = `${sig.strategy} ${sig.dir.toUpperCase()} @ ${p.entry.toFixed(1)} · stop ${p.stop.toFixed(1)} · TP ${p.tp1.toFixed(0)}/${p.tp2.toFixed(0)}/${p.tp3.toFixed(0)} · risk $${p.riskAmt.toFixed(2)} · score ${sig.score}`;
        evs.push({ kind: "OPEN", strategy: sig.strategy, msg: tag + msg, data: { why: sig.why, regime: sig.regime, qty: p.originalQty, flow }, symbol: sym });
        await push(`DeskBot ${tag}${action}`, msg);
        break;
      }
      if (!opened) {
        const top = rejects.filter(r => !/Waits for 15m close/.test(r.reason)).slice(0, 4).map(r => `${r.strategy}: ${r.reason}`);
        evs.push({ kind: "SKIP", msg: tag + (notes[0] ?? top[0] ?? "No setup"), data: { notes, top, regime: snap.regime }, symbol: sym });
      }
    }
  }
  if (closed.length) await saveTrades(closed, sym);

  const upnl = unrealized(st.pos, snap.price);
  const market = {
    price: snap.price, mark: ctx?.markPx ?? null, funding: ctx?.funding ?? null, oi: ctx?.oi ?? null, fng: fng?.value ?? null, fngLabel: fng?.label ?? null,
    regime: snap.regime, st5: snap.st5, st15: snap.st15, st1h: snap.st1h, st4h: snap.st4h, chop5: +snap.chop5.toFixed(1), chop15: +snap.chop15.toFixed(1),
    rsi15: +snap.rsi15.toFixed(1), rsi1h: +snap.rsi1h.toFixed(1), vwap: +snap.vwap.toFixed(1), vwapDev: +snap.vwapDev.toFixed(2), atr5: +snap.atr5.toFixed(1), atr15: +snap.atr15.toFixed(1),
    poc: +snap.poc.toFixed(1), asian: snap.asian, ema20: +snap.ema20.toFixed(1), ema50: +snap.ema50.toFixed(1), barT: snap.T,
    st1m: m1?.st ?? null, bos1m: m1?.bos ?? null, flow4: flow?.imb4 ?? null, flow24: flow?.imb24 ?? null,
    ema50D: snap.i1d >= 0 && isFinite(S.ema50D[snap.i1d]) ? +S.ema50D[snap.i1d].toFixed(1) : null,
  };
  const nw = sx._news;
  const news = nw ? { t: nw.t, risk: nw.risk, bias: nw.bias, event: nw.event, reason: nw.reason, by: nw.by, mode: NEWS_MODE, top: nw.headlines.slice(0, 5).map((h) => ({ src: h.src, title: h.title, t: h.t })), errors: nw.aiErrors ?? [] } : null;
  const ai = { providers: providersFromEnv().map((p) => p.name), usage: sx._aiUsage ?? {} };
  const lastRun = { ts: new Date(now).toISOString(), sym, action, trader: { acts: traderActs, plan: st.pos?.plan ?? [] }, source, integrity, news, ai, upnl: +upnl.toFixed(2), market, decision, risk: dynamicRisk(st.equity), ms: Date.now() - now };
  st.version = VERSION;
  await saveState(st, lastRun, sym);
  await upsert("dbv5_equity", [{ symbol: sym, ts: new Date(now).toISOString(), equity: +st.equity.toFixed(4), upnl: +upnl.toFixed(4), price: snap.price }]);
  await events(evs);
  return { ok: true, sym, version: VERSION, integrity, action, equity: +st.equity.toFixed(2), upnl: +upnl.toFixed(2), pos: st.pos ? { strategy: st.pos.strategy, dir: st.pos.dir, entry: st.pos.entry, stop: st.pos.stop } : null, closed: closed.length, source, news: news ? { risk: news.risk, by: news.by } : null, ms: Date.now() - now };
}

// ─── backtest (walk-forward; in-sample = first 2/3, out-of-sample = last 1/3) ──
type BtOpts = { sym?: Sym; endDaysAgo?: number; days?: number; source?: "hyperliquid" | "binance"; cfg?: Partial<typeof CFG>; label?: string; save?: boolean; only?: string; combinedOnly?: boolean };
async function runBacktest(o: BtOpts) {
  const source = o.source ?? "hyperliquid";
  const days = Math.min(source === "binance" ? 365 : 17, Math.max(3, +(o.days ?? 16)));
  const end = Date.now() - Math.min(2500, Math.max(0, +(o.endDaysAgo ?? 0))) * 86400_000, warm = 300 * 300_000, start5 = end - days * 86400_000 - warm;
  const sym: Sym = o.sym ?? "BTC";
  const get = (tf: string, a: number, b: number) => (source === "binance" ? candlesRangeBinance : candlesRange)(tf, a, b, sym);
  const [m5, m15, h1, h4] = await Promise.all([
    get("5m", start5, end), get("15m", start5 - 30 * 86400_000, end), get("1h", start5 - 40 * 86400_000, end), get("4h", start5 - 120 * 86400_000, end),
  ]);
  if (m5.length < 2000) throw new Error(`${sym}: only ${m5.length} 5m bars from ${source}`);
  applyCfg(); setMlAsset(sym === "GOLD"); const t0 = Date.now(); const frames = { m5, m15, h1, h4 }; const cfg = o.cfg ?? {};
  const fingerprint = await configIntegrity(VERSION, sym, resolvedCfg(cfg), "");
  const only = STRATEGIES.find(x => x === o.only);
  const all = backtest(frames, { startEquity: 1000, cfg, only });
  const cut = all.from! + (all.to - all.from!) * 2 / 3;
  const per: Record<string, unknown> = {};
  for (const id of (only ? [only] : o.combinedOnly ? [] : STRATEGIES)) {
    const r = only ? all : backtest(frames, { startEquity: 1000, only: id, cfg });
    per[id] = { ...summarize(r.trades, 1000), maxDD: r.state.maxDD, inSample: summarize(r.trades.filter(t => t.openT < cut), 1000).all, outSample: summarize(r.trades.filter(t => t.openT >= cut), 1000).all, signals: r.signalsSeen[id] ?? 0 };
  }
  const unseenFrom = Date.parse("2026-09-01T00:00:00Z");
  const res = {
    version: VERSION, sym, configHash: fingerprint.hash, drawdownBasis: "sampled marked equity at bar closes", label: o.label ?? "default", source, cfg, from: new Date(all.from ?? start5).toISOString(), to: new Date(all.to).toISOString(), splitAt: new Date(cut).toISOString(), bars5m: m5.length,
    combined: { ...summarize(all.trades, 1000), maxDD: all.state.maxDD }, combinedIn: summarize(all.trades.filter(t => t.openT < cut), 1000).all, combinedOut: summarize(all.trades.filter(t => t.openT >= cut), 1000).all,
    unseenSep2026: summarize(all.trades.filter(t => t.openT >= unseenFrom), 1000).all,
    perStrategy: per, curve: all.curve.filter((_, i) => i % Math.max(1, Math.round(days / 4)) === 0),
    trades: all.trades.slice(-80).map(t => ({ s: t.strategy, d: t.dir, r: +t.r.toFixed(2), net: +t.net.toFixed(2), o: t.openT, c: t.closeT, why: t.reason })),
    assumptions: `${source === "binance" ? "Binance spot " + SYMBOLS[sym].bn : "Hyperliquid " + SYMBOLS[sym].hl + " perp"} candles. Start $1000. Entries at next 5m open, taker ${CFG.TAKER_FEE * 100}% + ${CFG.SLIPPAGE * 100}% slippage; TPs maker ${CFG.MAKER_FEE * 100}%; funding ${CFG.BT_FUNDING_PER_HOUR * 100}%/h charged as cost. Stop-first on ambiguous bars. Funding/F&G context neutral (no history).`,
    cpuMs: Date.now() - t0,
  };
  if (o.save !== false) {
    await insert("dbv5_backtests", [{ days, results: res }]);
    await events([{ kind: "BACKTEST", msg: `Backtest ${sym} ${res.label} ${days}d (${source}): ${res.combined.all.n} trades, ${res.combined.all.expR.toFixed(2)}R avg, $1000→$${res.combined.endEquity.toFixed(0)}` }]);
  }
  return res;
}

// ─── public status bundle for the dashboard ─────────────────────────────────
async function status() {
  const [s, ev, tr, eq, bt] = await Promise.all([
    select("dbv5_state?id=eq.main&select=state,last_run,updated_at"),
    select("dbv5_events?select=ts,kind,strategy,msg,data,symbol&order=id.desc&limit=60"),
    select("dbv5_trades?select=id,symbol,strategy,dir,entry,exit_avg,net,r,fees,funding,open_t,close_t,reason&order=close_t.desc&limit=100"),
    select(`dbv5_equity?select=ts,equity,upnl,price&symbol=eq.BTC&ts=gte.${new Date(Date.now() - 14 * 86400_000).toISOString()}&order=ts.asc`),
    select("dbv5_backtests?select=ran_at,days,results&results->>label=like.LIVE_CONFIG*&order=id.desc&limit=1"),
  ]);
  const st = s?.[0]?.state ?? null;
  const config = resolvedCfg(st?.cfg);
  const integrity = await integrityFor("BTC", config);
  if (st) { delete st._aiUsage; }
  const books: Record<string, unknown> = {};
  for (const sym of BOOKS.filter((b) => b !== "BTC")) {
    const [r, eqb] = await Promise.all([
      select(`dbv5_state?id=eq.${rowId(sym)}&select=state,last_run,updated_at`),
      select(`dbv5_equity?select=ts,equity,upnl,price&symbol=eq.${sym}&ts=gte.${new Date(Date.now() - 14 * 86400_000).toISOString()}&order=ts.asc`),
    ]);
    const c = (eqb ?? []).filter((_: unknown, i: number, a: unknown[]) => a.length < 400 || i % Math.ceil(a.length / 400) === 0 || i === a.length - 1);
    books[sym] = r?.[0] ? { name: SYMBOLS[sym].name, hl: SYMBOLS[sym].hl, integrity: await integrityFor(sym, resolvedCfg(r[0].state?.cfg)), state: r[0].state, lastRun: r[0].last_run, updated: r[0].updated_at, curve: c } : { name: SYMBOLS[sym].name, hl: SYMBOLS[sym].hl, state: null };
  }
  const curve = (eq ?? []).filter((_: unknown, i: number, a: unknown[]) => a.length < 600 || i % Math.ceil(a.length / 600) === 0 || i === a.length - 1);
  return { version: VERSION, mode: "PAPER", now: new Date().toISOString(), updated: s?.[0]?.updated_at ?? null, integrity, state: st, lastRun: s?.[0]?.last_run ?? null, events: ev, trades: tr, curve, books, backtest: bt?.[0] ?? null, config, chat: { enabled: !!CHAT_KEY, ai: providersFromEnv().map((p) => p.name) } };
}

// ─── AI assistant (owner only; password = DESKBOT_CHAT_KEY secret) ─────────
const chatUsage: Usage = {};
async function chatContext() {
  const [s, tr, bt, nw] = await Promise.all([
    select("dbv5_state?id=eq.main&select=state,last_run,updated_at"),
    select("dbv5_trades?select=symbol,strategy,dir,entry,exit_avg,net,r,reason,open_t,close_t&order=close_t.desc&limit=20"),
    select("dbv5_backtests?select=ran_at,results->label,results->combined->all,results->combined->maxDD,results->combined->endEquity,results->from,results->to&order=id.desc&limit=4"),
    select("dbv5_news?select=ts,risk,bias,reason,by&order=id.desc&limit=3"),
  ]);
  const others = await select("dbv5_state?id=neq.main&select=id,state->equity,state->startEquity,state->pos,state->stats->all,state->cfg,last_run->action,last_run->market->price");
  const st = s?.[0]?.state ?? {}, lr = s?.[0]?.last_run ?? {};
  return {
    version: VERSION, mode: "PAPER", updated: s?.[0]?.updated_at,
    equity: st.equity, startEquity: st.startEquity, maxDD: st.maxDD, openPosition: st.pos ? { strategy: st.pos.strategy, dir: st.pos.dir, entry: st.pos.entry, stop: st.pos.stop, tp1: st.pos.tp1, tp2: st.pos.tp2, tp3: st.pos.tp3, tp1Done: st.pos.tp1Done } : null,
    stats: st.stats, enabled: st.enabled, circuitBreaker: st.cb, liveConfig: st.cfg ?? {},
    market: lr.market, lastAction: lr.action, lastDecision: lr.decision, news: lr.news,
    recentTrades: tr, recentBacktests: bt, newsHistory: nw, editableKeys: Object.keys(EDITABLE),
    note: "All fields above describe the BTC book. Other paper books (gold via PAXG) are in otherBooks. Chat proposals only change the BTC book.",
    otherBooks: others,
  };
}
async function chatRoute(body: Record<string, unknown>) {
  const now = Date.now();
  if (body.action === "chat") {
    const today = new Date(now).toISOString().slice(0, 10);
    const used = await select(`dbv5_events?select=id&kind=eq.CHAT&ts=gte.${today}T00:00:00Z&limit=${CHAT_DAILY_CAP + 1}`);
    if ((used?.length ?? 0) >= CHAT_DAILY_CAP) return { ok: false, error: "cap", reply: `Daily chat limit (${CHAT_DAILY_CAP}) reached. Resets at 00:00 UTC.` };
    const msg = String(body.message ?? "").trim(); if (!msg) return { ok: false, error: "empty" };
    const hist = (Array.isArray(body.history) ? body.history : []).filter((h: ChatTurn) => h && (h.role === "user" || h.role === "assistant")) as ChatTurn[];
    const r = await chat(msg, hist, await chatContext(), chatUsage, now);
    await events([{ kind: "CHAT", msg: `Q: ${msg.slice(0, 140)}`, data: { ok: r.ok, by: (r as { by?: string }).by ?? null, proposal: (r as { proposal?: unknown }).proposal ?? null } }]);
    return r;
  }
  if (body.action === "chat_backtest") {
    const v = validatePatch(body.patch); if (!v.ok) return { ok: false, errors: v.errors };
    const s = await select("dbv5_state?id=eq.main&select=state"); const live = s?.[0]?.state?.cfg ?? {};
    const days = Math.min(365, Math.max(30, +(body.days ?? 180)));
    const cand = await runBacktest({ source: "binance", days, cfg: mergeCfg(live, v.patch) as Partial<typeof CFG>, combinedOnly: true, label: `CHAT_TEST ${new Date(now).toISOString().slice(0, 16)}` });
    const base = await runBacktest({ source: "binance", days, cfg: live as Partial<typeof CFG>, combinedOnly: true, label: `CHAT_BASE ${new Date(now).toISOString().slice(0, 16)}`, save: false });
    const pick = (r: typeof cand) => ({ trades: r.combined.all.n, expR: r.combined.all.expR, pf: r.combined.all.pf, endEquity: r.combined.endEquity, maxDD: r.combined.maxDD, outOfSample: r.combinedOut });
    return { ok: true, days, from: cand.from, to: cand.to, current: pick(base), proposed: pick(cand) };
  }
  if (body.action === "chat_apply" || body.action === "chat_undo") {
    const owner = "chat-" + crypto.randomUUID();
    let got = false;
    for (let i = 0; i < 10 && !got; i++) { got = await rest("rpc/dbv5_lease", { method: "POST", headers: { Prefer: "" }, body: JSON.stringify({ owner, seconds: 30 }) }) === true; if (!got) await new Promise((r) => setTimeout(r, 2000)); }
    if (!got) return { ok: false, error: "busy", reply: "The bot is mid-run; try again in a few seconds." };
    try {
      const st = await loadState(); if (!st) return { ok: false, error: "no_state" };
      const sx = st as State & { cfgHistory?: { t: number; cfg: unknown; note: string }[] };
      sx.cfgHistory ??= [];
      let msg: string;
      if (body.action === "chat_apply") {
        const v = validatePatch(body.patch); if (!v.ok) return { ok: false, errors: v.errors };
        sx.cfgHistory.push({ t: now, cfg: st.cfg ?? {}, note: String(body.why ?? "chat apply").slice(0, 200) }); sx.cfgHistory = sx.cfgHistory.slice(-10);
        st.cfg = mergeCfg(st.cfg as Record<string, unknown> ?? {}, v.patch) as State["cfg"];
        msg = `Owner applied AI proposal: ${JSON.stringify(v.patch)}${body.why ? " — " + String(body.why).slice(0, 160) : ""}`;
      } else {
        const prev = sx.cfgHistory.pop(); if (!prev) return { ok: false, error: "nothing_to_undo" };
        st.cfg = prev.cfg as State["cfg"]; msg = `Owner undid last config change (back to ${new Date(prev.t).toISOString().slice(0, 16)} UTC)`;
      }
      await rest("dbv5_state?id=eq.main", { method: "PATCH", body: JSON.stringify({ state: st }) });
      await events([{ kind: "CONFIG", msg }]);
      return { ok: true, cfg: st.cfg, history: sx.cfgHistory.length };
    } finally { try { await rest("rpc/dbv5_release", { method: "POST", body: JSON.stringify({ owner }) }); } catch { /* expires */ } }
  }
  return { ok: false, error: "unknown action" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const json = (b: unknown, code = 200) => new Response(JSON.stringify(b), { status: code, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  try {
    if (req.method === "GET") return json(await status());
    if (req.headers.get("x-chat-key") !== null) {
      if (!CHAT_KEY || req.headers.get("x-chat-key") !== CHAT_KEY) return json({ ok: false, error: "bad_password" }, 401);
      const body = await req.json().catch(() => ({}));
      return json(await exclusive(() => chatRoute(body)));
    }
    const expected = SECRET || await cronKey();
    if (!expected || req.headers.get("x-deskbot-key") !== expected) return json({ ok: false, error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.action === "backtest") return json(await exclusive(() => runBacktest({ sym: isSym(body.sym) ? body.sym : "BTC", endDaysAgo: body.endDaysAgo, days: body.days, source: body.source, cfg: body.cfg, label: body.label, save: body.save, only: body.only, combinedOnly: body.combinedOnly })));
    return json(await exclusive(() => runLocked()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try { await events([{ kind: "ERROR", msg: msg.slice(0, 300) }]); } catch { /* ignore */ }
    return json({ ok: false, error: msg }, 500);
  }
});
