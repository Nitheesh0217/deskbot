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
import { runDesk, deskChart, type AgentRow } from "./agents.ts";
import { preTradeChecks, postTradeReview, runDeskWorkflow, analystReports, lessonsFrom } from "./desk.ts";
import { verdictsFor, filterReport } from "./experiment.ts";
import { catchUp } from "./catchup.ts";
import { managerRows, managerFailure, snapshotPos, workKey, mergeOutbox, type WorkRow } from "./worklog.ts";
import { makeDb, saveStateCAS, writeAgentRows as writeLog, ackWork, flushOutbox, backlog } from "./persist.ts";
import { scanMarket, rankScan, derivatives, SCAN_NOTE, CALL_HORIZON_H } from "./scan.ts";
import { signalsOverBars, resolve, trackRecord, scoreCall, callRecord, PRIORITY, PROMOTION, type NewSignal, type OpenSignal, type Resolution, type OpenCall, type CallScore } from "./track.ts";
import { captureDecision, pickEntry, decisionIdFor } from "./provenance.ts";
import { recordCoverage, dispositions, boundaryFlags } from "./coverage.ts";
import type { StrategyTrace } from "./engine.ts";

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
const AGENT_AI = (Deno.env.get("AGENT_AI") ?? "shadow") !== "off";   // optional free-LLM stages of the desk review (advisory, never blocks)
const CATCHUP_MODE = Deno.env.get("CATCHUP") ?? "on";   // on | shadow | off: re-check boundary bars skipped by a late run (catchup.ts)
const DESK_WORKFLOW = (Deno.env.get("DESK_WORKFLOW") ?? "shadow") !== "off";
const DEBATE_ROUNDS = Math.min(3, Math.max(1, +(Deno.env.get("DEBATE_ROUNDS") ?? 1) || 1));   // bull/bear rounds (TradingAgents max_debate_rounds)
const RISK_ROUNDS = Math.min(2, Math.max(1, +(Deno.env.get("RISK_ROUNDS") ?? 1) || 1));       // aggressive/conservative/neutral rounds   // deterministic pre-trade checks + post-trade reviews + optional LLM roles; advisory only
const EXPERIMENT_ID = Deno.env.get("DESKBOT_EXPERIMENT_ID") ?? "baseline-paper";
const CHAT_KEY = Deno.env.get("DESKBOT_CHAT_KEY") ?? "";
const CHAT_DAILY_CAP = +(Deno.env.get("CHAT_DAILY_CAP") ?? 150);
// Each book is a separate paper account (own equity, position, stats, cfg) in its own dbv5_state row.
// A non-BTC book only runs once its row exists (created deliberately, with a researched cfg).
const BOOKS: Sym[] = (Deno.env.get("DESKBOT_BOOKS") ?? "BTC,GOLD").split(",").map((x) => x.trim()).filter(isSym);
const rowId = (sym: Sym) => (sym === "BTC" ? "main" : sym.toLowerCase());
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-deskbot-key, x-chat-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

// ─── PostgREST client and persistence (persist.ts; the same requests are tested against a local PostgREST) ───
const db = makeDb(`${SB}/rest/v1`, KEY, (u, i) => fetch(u, i));
const { rest, upsert, insert, select } = db;
const writeAgentRows = (sym: string, rows: Parameters<typeof writeLog>[2]) => writeLog(db, sym, rows);

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
// every book-state write is a compare-and-set on state._rev (persist.ts): a run whose loaded revision is no longer current
// (e.g. an expired-lease worker) gets StateConflict and writes nothing
async function saveState(st: State, lastRun: Record<string, unknown> | null, sym: Sym = "BTC") {
  await saveStateCAS(db, rowId(sym), st as unknown as Record<string, unknown>, lastRun);
}
type Ev = { kind: string; strategy?: string | null; msg: string; data?: unknown; symbol?: Sym };
async function events(evs: Ev[]) { if (evs.length) await insert("dbv5_events", evs.map(e => ({ kind: e.kind, strategy: e.strategy ?? null, msg: e.msg, data: e.data ?? null, symbol: e.symbol ?? "BTC" }))); }
async function saveTrades(trs: Trade[], sym: Sym = "BTC") {
  if (!trs.length) return;
  await upsert("dbv5_trades", trs.map(t => ({
    id: t.id, symbol: sym, strategy: t.strategy, dir: t.dir, entry: t.entry, exit_avg: t.exitAvg, net: t.net, r: t.r, fees: t.fees, funding: t.funding,
    open_t: new Date(t.openT).toISOString(), close_t: new Date(t.closeT).toISOString(), reason: t.reason, data: { ...t, decisionId: decisionIdFor(t.id) },
  })));
}
// Immutable decision evidence: one atomic RPC writes the record and its input bars. Failure aborts the run BEFORE state is saved,
// so a paper entry can never persist without its decision. (A decision row without a persisted position is possible after a later
// failure; it is flagged as an orphan by the verifier rather than updated or deleted.)
async function recordDecision(c: Awaited<ReturnType<typeof captureDecision>>) {
  const ok = await rest("rpc/dbv5_record_decision", { method: "POST", headers: { Prefer: "" }, body: JSON.stringify({ d: { id: c.record.decisionId, sym: c.record.sym, ts: c.record.decidedAt, record: c.record, record_sha256: c.recordSha256 }, inputs: c.inputs.map((r) => ({ decision_id: r.decisionId, tf: r.tf, source: r.source, bars: r.bars, bars_sha256: r.barsSha256 })) }) });
  if (ok !== true && ok !== false) throw new Error("decision record not acknowledged");
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

  // actual receipt time of each input (ms), kept for the decision record; unknown stays undefined
  const rx: { m5?: number; m15?: number; h1?: number; h4?: number; ctx?: number; fng?: number; flow?: number; fngCached?: boolean } = {};
  const stamp = <T,>(k: "m5" | "m15" | "h1" | "h4" | "ctx" | "flow", p: Promise<T>) => p.then((v) => { rx[k] = Date.now(); return v; });
  const [m1v, m5, m15, h1, h4, ctx, fng, flow] = await Promise.all([
    candles("1m", 240, now, "hyperliquid", sym).catch(() => ({ bars: [] as Bar[], source: "hyperliquid" as const })), stamp("m5", candles("5m", 400, now, "hyperliquid", sym)), stamp("m15", candles("15m", 400, now, "hyperliquid", sym)), stamp("h1", candles("1h", 300, now, "hyperliquid", sym)), stamp("h4", candles("4h", 700, now, "hyperliquid", sym)), stamp("ctx", hlContext(sym)),
    (async () => { if (!isCrypto) return null; const c = (st as State & { _fng?: { v: number; l: string; t: number } })._fng; if (c && now - c.t < 3 * 3600_000) { rx.fng = c.t; rx.fngCached = true; return { value: c.v, label: c.l }; } const r = await fearGreed(); rx.fng = Date.now(); rx.fngCached = false; return r; })(), stamp("flow", orderFlow(now, sym)),
  ]);
  if (fng) (st as State & { _fng?: unknown })._fng = { v: fng.value, l: fng.label, t: now };
  const source = m5.source;

  // 1) manage an open position on the 1m path since the last processed bar
  const closed: Trade[] = [];
  const posBefore = snapshotPos(st.pos);   // Theo's work log compares against this (worklog.ts); observational only
  if (st.pos) try {
    const since = Math.max(st.lastBarT, st.pos.openT);
    const mins = Math.min(1000, Math.ceil((now - since) / 60_000) + 2);
    const m1 = (await candles("1m", mins, now, "hyperliquid", sym)).bars.filter((b: Bar) => b.ct > since);
    closed.push(...managePosition(st, m1, ctx ? ctx.funding : 0));
    if (m1.length) st.lastBarT = m1[m1.length - 1].ct;
    for (const t of closed) {
      const msg = `${t.strategy} ${t.dir.toUpperCase()} closed ${t.reason} · net $${t.net.toFixed(2)} (${t.r >= 0 ? "+" : ""}${t.r.toFixed(2)}R)`;
      evs.push({ kind: t.net > 0 ? "WIN" : "LOSS", strategy: t.strategy, msg: tag + msg, data: { r: t.r, net: t.net, decisionId: decisionIdFor(t.id), work: workKey(t.id, "close", "final") }, symbol: sym });
      await push(`DeskBot ${tag}${t.net > 0 ? "WIN" : "LOSS"}`, `${msg} · Eq $${st.equity.toFixed(2)}`);
    }
    if (st.pos) for (const e of st.pos.exits) if (e.t > since && e.kind !== "stop") evs.push({ kind: e.kind.toUpperCase(), strategy: st.pos.strategy, symbol: sym, msg: `${tag}${e.kind.toUpperCase()} filled @ ${e.px.toFixed(1)} · stop → ${st.pos.stop.toFixed(1)}`, data: { decisionId: decisionIdFor(st.pos.id), px: e.px, qty: e.qty, stop: st.pos.stop, work: workKey(st.pos.id, e.kind.startsWith("tp") ? "target_fill" : "exit", `${e.kind}:${e.t}`) } });
  } catch (e) {
    // record the failure once per position and stuck bar, then fail the run exactly as before
    if (posBefore) await writeAgentRows(sym, [managerFailure(sym, posBefore, st.lastBarT, e, decisionIdFor)]).catch(() => {});   // best effort; the run's ERROR event is the primary record
    throw e;
  }
  else st.lastBarT = now;

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
    for (const a of r.acts) evs.push({ kind: "MANAGE", strategy: st.pos?.strategy ?? r.closed?.strategy ?? null, msg: tag + a, symbol: sym, data: { decisionId: decisionIdFor((st.pos?.id ?? r.closed?.id)!), stop: st.pos?.stop ?? null } });
    if (r.closed) { closed.push(r.closed); const t = r.closed; evs.push({ kind: t.net > 0 ? "WIN" : "LOSS", strategy: t.strategy, msg: `${tag}${t.strategy} ${t.dir.toUpperCase()} closed by trade manager · net $${t.net.toFixed(2)} (${t.r >= 0 ? "+" : ""}${t.r.toFixed(2)}R)`, data: { r: t.r, net: t.net, decisionId: decisionIdFor(t.id), work: workKey(t.id, "close", "final") }, symbol: sym }); }
  }
  let action = st.pos ? "HOLD" : "SKIP"; let decision: unknown = null;
  let deskSignals: Awaited<ReturnType<typeof evaluate>>["signals"] = []; let deskRejects: Awaited<ReturnType<typeof evaluate>>["rejects"] = [];
  let provenanceError: string | null = null;
  let opened: { strategy: string; dir: string; entry: number; stop: number; reentry?: boolean; why: string[] } | null = null;
  let covNow: unknown = null;
  let catchup: unknown = null;
  if (snap.T > st.lastEvalT) {
    const hadPos = !!st.pos, gateCopy = JSON.parse(JSON.stringify(st)) as State, trace: StrategyTrace[] = [];
    const prevEvalT = st.lastEvalT;
    st.lastEvalT = snap.T;
    const stBeforeEval = JSON.parse(JSON.stringify(st)) as State;
    const { signals, rejects } = evaluate(snap, st.enabled, S, st, trace); deskSignals = signals; deskRejects = rejects;
    // Missed-bar catch-up: only when flat (one position per book) and only when the live bar produced nothing. Same gates apply below.
    if (CATCHUP_MODE !== "off" && !st.pos) {
      const cu = catchUp(S, i5, prevEvalT, st, st.enabled, { funding: ctx?.funding ?? null, oi: ctx?.oi ?? null, markPx: ctx?.markPx ?? null, fng: fng?.value ?? null });
      for (const m of cu.missed) evs.push({ kind: "MISSED", strategy: m.strategy, symbol: sym, msg: `${tag}${m.strategy} ${m.dir.toUpperCase()} setup on the ${new Date(m.T + 1).toISOString().slice(11, 16)} UTC close was missed by a late run: ${m.reason}`, data: { barT: m.T, score: m.score } });
      if (cu.candidates.length && CATCHUP_MODE === "shadow") for (const c of cu.candidates) evs.push({ kind: "MISSED", strategy: c.strategy, symbol: sym, msg: `${tag}${c.strategy} ${c.dir.toUpperCase()} catch-up still valid (shadow mode, not entered)`, data: { barT: c.barT } });
      if (cu.candidates.length && CATCHUP_MODE === "on" && !signals.length) signals.push(...cu.candidates);
      catchup = { mode: CATCHUP_MODE, scanned: cu.scanned, boundaryBars: cu.boundaryBars, valid: cu.candidates.map((c) => c.strategy), missed: cu.missed.length };
    }
    if (flow) for (const sg of signals) { const a = flow.imb24 * (sg.dir === "long" ? 1 : -1); sg.why.push(`Order flow 24h ${a > 0 ? "with" : "against"} trade (${(flow.imb24 * 100).toFixed(1)}%, shadow)`); }
    decision = { signals: signals.map(s => ({ strategy: s.strategy, dir: s.dir, score: s.score, why: s.why })), rejects };
    if (!st.pos) {
      if (newsBlock) notes.push(`Entries paused: ${newsBlock}`);
      if (newsShadow && signals.length) notes.push(`(shadow) news filter would pause: ${newsShadow}`);
      const enforce = (Deno.env.get("DESKBOT_ENFORCE_APPROVAL") ?? "off") === "on";
      if (!integrity.approved) notes.push(`${enforce ? "New entries paused" : "Warning (not enforced)"}: ${integrity.reason}`);
      const refFor = () => (ctx?.markPx && Math.abs(ctx.markPx - snap.price) / snap.price < 0.01 ? ctx.markPx : snap.price);
      const stateBefore = stBeforeEval;
      // Pre-entry boundary: the entry is tried on a COPY of the state. Management results already applied to `st` (closed trades, equity,
      // events) are untouched whatever happens here. Only when the decision evidence is durably recorded is the copy adopted.
      const trial = JSON.parse(JSON.stringify(st)) as State;
      let picked = newsBlock || (enforce && !integrity.approved) ? null : pickEntry(trial, signals, now, refFor, notes);
      if (picked) {
        const { sig, p, fillRef } = picked;
        if (sym !== "BTC") p.id = `${sym}-${now}`;
        try {
          await recordDecision(await captureDecision({
            sym, now, experimentId: EXPERIMENT_ID, frames: { m5: { ...m5, receivedAtMs: rx.m5 ?? null }, m15: { ...m15, receivedAtMs: rx.m15 ?? null }, h1: { ...h1, receivedAtMs: rx.h1 ?? null }, h4: { ...h4, receivedAtMs: rx.h4 ?? null } }, snapT: snap.T,
            external: { ctx: ctx ? { funding: ctx.funding ?? null, oi: ctx.oi ?? null, markPx: ctx.markPx ?? null } : null, markPxUsed: fillRef, fng: fng?.value ?? null, flow: flow ?? null },
            externalReceivedAtMs: { ctx: rx.ctx ?? null, fng: rx.fng ?? null, fngCached: rx.fngCached, flow: rx.flow ?? null },
            stateBefore, cfgResolved: resolvedCfg(st.cfg), integrity, signals, rejects, gateNotes: notes, newsBlock, chosen: sig, fillRef, position: p, equityBefore: stateBefore.equity, approvalEnforced: enforce, catchUpFromT: sig.why.some((w) => w.startsWith("CATCH-UP:")) ? prevEvalT : null,
          }));
          for (const k of Object.keys(st)) delete (st as unknown as Record<string, unknown>)[k];
          Object.assign(st, trial);
        } catch (e) {
          // Fail closed for the REPLACEMENT entry only: no position, no OPEN event; the run (and any closure above) still persists, and the failure is visible.
          const msg = `entry rejected, decision evidence not recorded: ${(e as Error).message}`.slice(0, 300);
          provenanceError = msg; notes.push(msg); evs.push({ kind: "ERROR", strategy: sig.strategy, msg: tag + msg, data: { provenance: true }, symbol: sym }); picked = null;
        }
      }
      if (picked) {
        const { sig, p } = picked;
        opened = { strategy: sig.strategy, dir: sig.dir, entry: p.entry, stop: p.stop, reentry: !!sig.reentry, why: sig.why }; action = `OPEN_${sig.dir.toUpperCase()}`;
        const msg = `${sig.strategy} ${sig.dir.toUpperCase()} @ ${p.entry.toFixed(1)} · stop ${p.stop.toFixed(1)} · TP ${p.tp1.toFixed(0)}/${p.tp2.toFixed(0)}/${p.tp3.toFixed(0)} · risk $${p.riskAmt.toFixed(2)} · score ${sig.score}`;
        evs.push({ kind: "OPEN", strategy: sig.strategy, msg: tag + msg, data: { why: sig.why, regime: sig.regime, qty: p.originalQty, flow, decisionId: decisionIdFor(p.id) }, symbol: sym });
        await push(`DeskBot ${tag}${action}`, msg);
      }
      if (!opened) {
        const top = rejects.filter(r => !/Waits for 15m close/.test(r.reason)).slice(0, 4).map(r => `${r.strategy}: ${r.reason}`);
        evs.push({ kind: "SKIP", msg: tag + (notes.find((n) => !n.startsWith("Warning")) ?? top[0] ?? "No setup"), data: { notes, top, regime: snap.regime }, symbol: sym });
      }
    }
    // Strategy coverage (observability only): why each strategy did or did not trade on this bar. Must never break a run.
    try {
      const enf = (Deno.env.get("DESKBOT_ENFORCE_APPROVAL") ?? "off") === "on";
      const globalBlock = newsBlock ? `Entries paused: ${newsBlock}` : enf && !integrity.approved ? `New entries paused: ${integrity.reason}` : null;
      covNow = recordCoverage(st, { T: snap.T, now, trace, boundary: boundaryFlags(snap.T, { "15m": snap.new15, "1h": snap.new1h, "4h": snap.new4h, "1d": snap.i1d >= 0 && S.d1[snap.i1d].ct === snap.T }), disp: dispositions(signals, { hadPos, opened: opened ? { strategy: opened.strategy as StrategyTrace["id"], dir: opened.dir } : null, globalBlock, gateState: gateCopy, now }) });
    } catch (e) { notes.push(`coverage: ${(e as Error).message}`.slice(0, 120)); }
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
  // desk agents: chart read + validator/risk/re-entry views, persisted to dbv5_agent_log (never allowed to break a run)
  const desk = runDesk({ snap, S, m1, st, signals: deskSignals, rejects: deskRejects, traderActs, opened, closedNow: closed.length, ms: Date.now() - now });
  const rows: AgentRow[] = [...desk.rows];
  // Theo's records go into an outbox inside the book state, so they persist in the SAME write as the management they describe;
  // they are removed only after the work log confirms them (flushWork below), so a failed log write is retried next run.
  const wx = st as State & { _workOutbox?: WorkRow[] };
  wx._workOutbox = mergeOutbox(wx._workOutbox, managerRows(sym, posBefore, snapshotPos(st.pos), closed, decisionIdFor, { snapT: posBefore ? snap.T : null, acts: traderActs }));
  if (!wx._workOutbox.length) delete wx._workOutbox;
  const ai = { providers: providersFromEnv().map((p) => p.name), usage: sx._aiUsage ?? {} };
  const lastRun = { ts: new Date(now).toISOString(), sym, action, trader: { acts: traderActs, plan: st.pos?.plan ?? [] }, source, integrity, news, ai, upnl: +upnl.toFixed(2), market, decision, risk: dynamicRisk(st.equity), desk: desk.summary, coverage: covNow, catchup, provenanceError, ms: Date.now() - now };
  st.version = VERSION;
  await saveState(st, lastRun, sym);
  await upsert("dbv5_equity", [{ symbol: sym, ts: new Date(now).toISOString(), equity: +st.equity.toFixed(4), upnl: +upnl.toFixed(4), price: snap.price }]);
  await events(evs);
  // flush Theo's outbox (persist.ts flushOutbox): batches of conflict-safe inserts, each acknowledged by a scoped RPC that removes
  // exactly its keys. Pending records are never dropped; a failure is an ERROR event and the rest stays for the next run.
  if (wx._workOutbox?.length) {
    try {
      const f = await flushOutbox(wx, { insert: (rs) => writeAgentRows(sym, rs), ack: (keys) => ackWork(db, rowId(sym), keys) });
      if (f.error) await events([{ kind: "ERROR", msg: `${tag}work log write failed; ${f.pending} record(s) pending (${f.delivered} delivered this run): ${f.error}`.slice(0, 280), symbol: sym }]);
      if (f.needsStateSave) await saveState(st, lastRun, sym);   // RPC not migrated: persist the trimmed outbox by compare-and-set
      if (f.mode === "check-then-insert") notes.push("work log: work_key column missing; deduplicated by check-then-insert");
    } catch (e) {
      try { await events([{ kind: "ERROR", msg: `${tag}work log flush: ${(e as Error).message}`.slice(0, 280), symbol: sym }]); } catch { /* the outbox is still saved */ }
    }
  }
  // Desk review layer (advisory). Runs AFTER state and ledger are saved so slow or failing providers can never cost a persisted trade.
  // Post-trade reviews are deterministic and free; the LLM roles run only for a trade opened this run and only when a provider is configured.
  if (DESK_WORKFLOW) {
    try {
      for (const t of closed) rows.push({ agent: "desk-postmortem", input_summary: `${t.id} ${t.strategy} ${t.dir}`, output: { ref: t.id, authority: "advisory", ...postTradeReview({ ...t, why: t.why }) } });
      const p = opened ? st.pos : null;
      if (p) {
        const checks = preTradeChecks({ plan: { dir: p.dir, entry: p.entry, stop0: p.stop0, tp1: p.tp1, maxHoldH: p.maxHoldH, strategy: p.strategy }, atr15: snap.atr15, hour: snap.hour, funding: ctx?.funding ?? null, costs: { taker: CFG.TAKER_FEE, slippage: CFG.SLIPPAGE }, newsRisk: sx._news?.risk ?? null, levels: desk.chart.levels });
        const usageBefore = JSON.stringify(sx._aiUsage ?? {});
        const analysts = analystReports({ price: snap.price, regime: snap.regime, bias: desk.chart.bias ?? null, trend: { "5m": snap.st5, "15m": snap.st15, "1h": snap.st1h, "4h": snap.st4h }, rsi15: snap.rsi15, rsi1h: snap.rsi1h, chop15: snap.chop15, vwapDev: snap.vwapDev, atr15: snap.atr15,
          support: desk.chart.support ?? null, resistance: desk.chart.resistance ?? null, funding: ctx?.funding ?? null, oi: ctx?.oi ?? null, fng: fng?.value ?? null, flow24: flow?.imb24 ?? null,
          newsRisk: sx._news?.risk ?? null, newsReason: sx._news?.reason ?? null, headlines: (sx._news?.headlines ?? []).map((h) => h.title) });
        // memory: the last closed trades of this strategy on this book (TradingAgents' reflection memory, kept deterministic)
        let lessons: string[] = [];
        try { lessons = lessonsFrom(await select(`dbv5_trades?select=strategy,dir,r,reason,close_t&symbol=eq.${sym}&strategy=eq.${encodeURIComponent(p.strategy)}&order=close_t.desc&limit=8`)); } catch { /* memory is optional */ }
        const wf = await runDeskWorkflow({ ref: p.id, sym, strategy: p.strategy, dir: p.dir, regime: p.regime, why: p.why, newsRisk: sx._news?.risk ?? null, chart: deskChart(desk.chart), checks, analysts, lessons,
          plan: { dir: p.dir, entry: p.entry, stop0: p.stop0, tp1: p.tp1, tp2: p.tp2, tp3: p.tp3, maxHoldH: p.maxHoldH, strategy: p.strategy, riskAmt: p.riskAmt } },
          { providers: AGENT_AI ? providersFromEnv() : [], usage: (sx._aiUsage ??= {}), now, debateRounds: DEBATE_ROUNDS, riskRounds: RISK_ROUNDS });
        rows.push(...wf.rows);
        // FILTER-1 shadow verdicts: recorded now, before this trade has an outcome. Append-only; a failure here is visible and changes nothing else.
        try { await insert("dbv5_filter_verdicts", verdictsFor(p.id, sym, p.strategy, checks, wf.rows)); } catch (e) { notes.push(`filter verdicts: ${(e as Error).message}`.slice(0, 120)); }
        // persist the provider call counters (daily caps) after the LLM stages; compare-and-set like every other write
        if (JSON.stringify(sx._aiUsage ?? {}) !== usageBefore) await saveState(st, lastRun, sym).catch(async (e) => { await events([{ kind: "ERROR", msg: `${tag}provider counters not saved: ${(e as Error).message}`.slice(0, 280), symbol: sym }]).catch(() => {}); });
      }
    } catch (e) { notes.push(`desk review: ${(e as Error).message}`.slice(0, 120)); }
  }
  if (rows.length) { try { await writeAgentRows(sym, rows); } catch (e) { try { await events([{ kind: "ERROR", msg: `${tag}agent log write failed: ${(e as Error).message}`.slice(0, 280), symbol: sym }]); } catch { /* ignore */ } } }
  return { ok: true, sym, version: VERSION, integrity, action, equity: +st.equity.toFixed(2), upnl: +upnl.toFixed(2), pos: st.pos ? { strategy: st.pos.strategy, dir: st.pos.dir, entry: st.pos.entry, stop: st.pos.stop, tp1: st.pos.tp1 } : null, trader: traderActs, closed: closed.length, source, news: news ? { risk: news.risk, by: news.by } : null, provenanceError, ms: Date.now() - now };
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
    assumptions: `${source === "binance" ? "Binance spot " + SYMBOLS[sym].bn : "Hyperliquid " + SYMBOLS[sym].hl + " perp"} candles. Start $1000. Entries at next 5m open, taker ${CFG.TAKER_FEE * 100}% + ${CFG.SLIPPAGE * 100}% slippage; TPs maker ${CFG.MAKER_FEE * 100}%; funding ${CFG.BT_FUNDING_PER_HOUR * 100}%/h charged as cost. Moved stop first on ambiguous bars.`,
    cpuMs: Date.now() - t0,
  };
  if (o.save !== false) {
    await insert("dbv5_backtests", [{ days, results: res }]);
    await events([{ kind: "BACKTEST", symbol: sym, msg: `Backtest ${sym} ${res.label} ${days}d (${source}): ${res.combined.all.n} trades, ${res.combined.all.expR.toFixed(2)}R avg, $1000→$${res.combined.endEquity.toFixed(0)}` }]);
  }
  return res;
}

// FILTER-1 report from the append-only verdict table and the trades those entries became. null until the table exists.
async function experimentStatus() {
  try {
    const vs = await select("dbv5_filter_verdicts?select=ref,arm,sym,strategy,take,verdict,detail,provider,ms,recorded_at&order=recorded_at.asc&limit=5000");
    if (!vs?.length) return { experiment: "FILTER-1", started: false, baseline: { n: 0 }, arms: [] };
    const tr = await select(`dbv5_trades?select=id,symbol,strategy,r,net,close_t&close_t=gte.${encodeURIComponent(vs[0].recorded_at)}&limit=5000`);
    return { started: vs[0].recorded_at, open: vs.filter((v: { ref: string }) => !(tr ?? []).some((t: { id: string }) => t.id === v.ref)).length / 2, ...filterReport(tr ?? [], vs) };
  } catch { return null; }
}

// ─── public status bundle for the dashboard ─────────────────────────────────
// ─── multi-market scan (read-only; every 15 min by pg_cron). Runs the bot's own rules on each market with a fresh state. ──
async function runScan() {
  const now = Date.now(), t0 = now;
  const cfgOf = async (sym: Sym) => (await select(`dbv5_state?id=eq.${rowId(sym)}&select=state->cfg`).catch(() => []))?.[0]?.cfg ?? undefined;
  const [btcCfg, goldCfg] = await Promise.all([cfgOf("BTC"), cfgOf("GOLD")]);
  const syms = (Object.keys(SYMBOLS) as Sym[]).sort((a, b) => (PRIORITY[a] ?? 3) - (PRIORITY[b] ?? 3)), markets: unknown[] = [];
  // forward tracking (track.ts): best-effort; a failure here is reported and never stops the scan
  const trackErrors: string[] = [];
  const open: OpenSignal[] = await select("dbv5_scan_signals?status=eq.open&select=id,sym,strategy,dir,bar_t,entry,stop,tp1,r_dist,cost_r,max_hold_h,checked_t&order=id.asc&limit=2000").catch((e) => { trackErrors.push(String((e as Error).message).slice(0, 120)); return []; });
  const openCalls: OpenCall[] = await select("dbv5_calls?status=eq.open&select=id,sym,t,horizon_h,lean,px,atr&limit=500").catch((e) => { trackErrors.push(`calls: ${(e as Error).message}`.slice(0, 120)); return []; });
  const fresh: NewSignal[] = [], updates: Resolution[] = [], newCalls: Record<string, unknown>[] = [], scored: CallScore[] = [];
  try {
    for (let k = 0; k < syms.length; k += 3) {   // three markets at a time keeps Hyperliquid request weight low
      markets.push(...await Promise.all(syms.slice(k, k + 3).map(async (sym) => {
        try {
          const [m5, m15, h1, h4, ctx] = await Promise.all([candles("5m", 400, now, "hyperliquid", sym), candles("15m", 400, now, "hyperliquid", sym), candles("1h", 300, now, "hyperliquid", sym), candles("4h", 700, now, "hyperliquid", sym), hlContext(sym).catch(() => null)]);
          const frames = { m5: m5.bars, m15: m15.bars, h1: h1.bars, h4: h4.bars };
          applyCfg(sym === "GOLD" ? goldCfg : btcCfg); setMlAsset(sym === "GOLD");
          const row = scanMarket(sym, frames, ctx, now);
          try {
            // CALL-1: score this market's open call once its horizon has passed; open a new one only when none is open
            const mine = openCalls.filter((c) => c.sym === sym); for (const c of mine) { const sc = scoreCall(c, m5.bars); if (sc) scored.push(sc); }
            const c = (row as { call?: { lean: string; votes: number; source: string; cautions: string[]; t: number; px: number; atr: number } }).call;
            if (c && c.lean !== "NONE" && mine.every((x) => scored.some((y) => y.id === x.id))) newCalls.push({ sym, t: c.t, horizon_h: CALL_HORIZON_H, lean: c.lean, votes: c.votes, source: c.source, cautions: c.cautions, px: c.px, atr: c.atr });
          } catch (e) { trackErrors.push(`${sym} call: ${(e as Error).message}`.slice(0, 120)); }
          try { fresh.push(...signalsOverBars(sym, frames)); for (const o of open.filter((x) => x.sym === sym)) { const u = resolve(o, m5.bars); if (u.status !== "open" || u.checked_t !== o.checked_t) updates.push(u); } }
          catch (e) { trackErrors.push(`${sym}: ${(e as Error).message}`.slice(0, 120)); }
          return { ...row, name: SYMBOLS[sym].name, book: PRIORITY[sym] === 1, priority: PRIORITY[sym] ?? 3, source: m5.source };
        } catch (e) { return { sym, ok: false, error: (e as Error).message.slice(0, 120), priority: PRIORITY[sym] ?? 3 }; }
      })));
    }
  } finally { applyCfg(); setMlAsset(false); }
  if (fresh.length) await rest("dbv5_scan_signals?on_conflict=sym,strategy,bar_t", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(fresh.map((x) => ({ ...x, checked_t: x.bar_t }))) }).catch((e) => trackErrors.push(`insert: ${(e as Error).message}`.slice(0, 120)));
  for (const u of updates) {
    const body = u.status === "open" ? { checked_t: u.checked_t } : { status: u.status, checked_t: u.checked_t, exit_t: u.exit_t, exit_px: u.exit_px, r_gross: u.r_gross, r_net: u.r_net, resolved_at: new Date().toISOString() };
    await rest(`dbv5_scan_signals?id=eq.${u.id}&status=eq.open`, { method: "PATCH", body: JSON.stringify(body) }).catch((e) => trackErrors.push(`update ${u.id}: ${(e as Error).message}`.slice(0, 120)));
  }
  for (const sc of scored) await rest(`dbv5_calls?id=eq.${sc.id}&status=eq.open`, { method: "PATCH", body: JSON.stringify({ status: "scored", px_end: sc.px_end, end_t: sc.end_t, move_pct: sc.move_pct, move_atr: sc.move_atr, hit: sc.hit, scored_at: new Date().toISOString() }) }).catch((e) => trackErrors.push(`call ${sc.id}: ${(e as Error).message}`.slice(0, 120)));
  if (newCalls.length) await rest("dbv5_calls?on_conflict=sym,t", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(newCalls) }).catch((e) => trackErrors.push(`calls insert: ${(e as Error).message}`.slice(0, 120)));
  const deriv = await Promise.all((["BTC", "ETH"] as const).map((c) => derivatives(c, now).catch((e) => ({ currency: c, errors: [(e as Error).message.slice(0, 80)] }))));
  const row = { markets: rankScan(markets as never), deriv, note: SCAN_NOTE, ms: Date.now() - t0 };
  // per-worker telemetry for the tower (call maker / setup tracker / options reader); additive column, older schema tolerated
  const work = { calls: { new: newCalls.length, scored: scored.length, open: openCalls.length }, tracker: { new: fresh.length, resolved: updates.filter((u) => u.status !== "open").length, open: open.length }, errors: trackErrors, derivErrors: deriv.flatMap((d) => ((d as { errors?: string[] }).errors ?? []).map((x) => `${(d as { currency: string }).currency}: ${x}`)) };
  await insert("dbv5_scans", [{ ...row, work }]).catch(async (e) => { if (!/work/.test(String((e as Error).message))) throw e; await insert("dbv5_scans", [row]); });
  return { ok: true, markets: markets.length, setups: (row.markets as { setups?: unknown[] }[]).reduce((a, m) => a + (m.setups?.length ?? 0), 0), calls: { new: newCalls.length, scored: scored.length }, tracked: { new: fresh.length, resolved: updates.filter((u) => u.status !== "open").length, open: open.length, errors: trackErrors }, ms: row.ms };
}

// forward record per market for the status payload (null until the table exists)
async function trackStatus() {
  try {
    const rows = await select("dbv5_scan_signals?select=sym,strategy,dir,bar_t,entry,stop,tp1,status,r_net,exit_t,score&order=id.desc&limit=5000");
    const calls = await select("dbv5_calls?select=sym,t,lean,votes,source,cautions,px,status,hit,move_pct,move_atr&order=id.desc&limit=5000").catch(() => []);
    return { markets: trackRecord(rows ?? []), recent: (rows ?? []).slice(0, 25), promotion: PROMOTION.rule, calls: callRecord(calls ?? []), recentCalls: (calls ?? []).slice(0, 40) };
  } catch { return null; }
}

async function status() {
  const [s, ev, tr, eq, bt, agents] = await Promise.all([
    select("dbv5_state?id=eq.main&select=state,last_run,updated_at"),
    select("dbv5_events?select=ts,kind,strategy,msg,data,symbol&order=id.desc&limit=60"),
    select("dbv5_trades?select=id,symbol,strategy,dir,entry,exit_avg,net,r,fees,funding,open_t,close_t,reason&order=close_t.desc&limit=100"),
    select(`dbv5_equity?select=ts,equity,upnl,price&symbol=eq.BTC&ts=gte.${new Date(Date.now() - 14 * 86400_000).toISOString()}&order=ts.asc`),
    select("dbv5_backtests?select=ran_at,days,results&results->>label=like.LIVE_CONFIG*&order=id.desc&limit=1"),
    select("dbv5_agent_log?select=ts,symbol,agent,input_summary,output,provider,error&order=id.desc&limit=200").catch(() => []),
  ]);
  const [scanRows, track] = await Promise.all([select("dbv5_scans?select=ts,markets,deriv,note,ms,work&order=id.desc&limit=1").catch(() => select("dbv5_scans?select=ts,markets,deriv,note,ms&order=id.desc&limit=1")).catch(() => []), trackStatus()]);
  const scan = scanRows?.[0] ?? null;
  const flushFails = await select(`dbv5_events?select=ts,symbol,msg&kind=eq.ERROR&msg=ilike.*work%20log*&ts=gte.${new Date(Date.now() - 86400_000).toISOString()}&order=id.desc&limit=50`).catch(() => null);
  const st = s?.[0]?.state ?? null;
  const experiment = await experimentStatus();
  const config = resolvedCfg(st?.cfg);
  const integrity = await integrityFor("BTC", config);
  const workBacklog: Record<string, unknown> = { BTC: backlog(st) };
  if (st) { delete st._aiUsage; delete st._workOutbox; }
  const books: Record<string, unknown> = {};
  for (const sym of BOOKS.filter((b) => b !== "BTC")) {
    const [r, eqb] = await Promise.all([
      select(`dbv5_state?id=eq.${rowId(sym)}&select=state,last_run,updated_at`),
      select(`dbv5_equity?select=ts,equity,upnl,price&symbol=eq.${sym}&ts=gte.${new Date(Date.now() - 14 * 86400_000).toISOString()}&order=ts.asc`),
    ]);
    const c = (eqb ?? []).filter((_: unknown, i: number, a: unknown[]) => a.length < 400 || i % Math.ceil(a.length / 400) === 0 || i === a.length - 1);
    books[sym] = r?.[0] ? { name: SYMBOLS[sym].name, hl: SYMBOLS[sym].hl, integrity: await integrityFor(sym, resolvedCfg(r[0].state?.cfg)), state: (({ _workOutbox, _aiUsage, ...rest }) => rest)(r[0].state ?? {}), work: backlog(r[0].state), lastRun: r[0].last_run, updated: r[0].updated_at, curve: c } : { name: SYMBOLS[sym].name, hl: SYMBOLS[sym].hl, state: null };
  }
  for (const [k, b] of Object.entries(books)) if ((b as { work?: unknown }).work) workBacklog[k] = (b as { work?: unknown }).work;
  const curve = (eq ?? []).filter((_: unknown, i: number, a: unknown[]) => a.length < 600 || i % Math.ceil(a.length / 600) === 0 || i === a.length - 1);
  return { version: VERSION, mode: "PAPER", now: new Date().toISOString(), updated: s?.[0]?.updated_at ?? null, integrity, state: st, lastRun: s?.[0]?.last_run ?? null, events: ev, agents: agents ?? [], trades: tr, curve, books, backtest: bt?.[0] ?? null, experiment, config, scan, track, work: { backlog: workBacklog, flushFailures24h: Array.isArray(flushFails) ? flushFails.length : null, lastFlushFailure: Array.isArray(flushFails) && flushFails[0] ? flushFails[0] : null }, chat: { enabled: !!CHAT_KEY, ai: providersFromEnv().map((p) => p.name) }, ai: { providers: providersFromEnv().map((p) => p.name), agentAi: AGENT_AI, deskWorkflow: DESK_WORKFLOW, newsAi: NEWS_AI, newsMode: NEWS_MODE } };
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
      await saveState(st, null, "BTC");   // compare-and-set: a run that advanced the book since loadState wins; the owner retries
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
    if (body.action === "scan") return json(await exclusive(() => runScan()));
    if (body.action === "backtest") return json(await exclusive(() => runBacktest({ sym: isSym(body.sym) ? body.sym : "BTC", endDaysAgo: body.endDaysAgo, days: body.days, source: body.source, cfg: body.cfg, label: body.label, save: body.save, only: body.only, combinedOnly: body.combinedOnly })));
    return json(await exclusive(() => runLocked()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try { await events([{ kind: "ERROR", msg: msg.slice(0, 300) }]); } catch { /* ignore */ }
    return json({ ok: false, error: msg }, 500);
  }
});
