const SNAP = {state:{},events:[],trades:[],agents:[],curve:[],bt:null};
const PROJECT = "xevymbzgpcsdhygswxlk";

const STRAT_X = [
  { id: "D_BEARTRAP", name: "Daily bear trap", desc: "A red engulfing day inside an uptrend, then a day that dips below its low and closes back above. Buys the reclaim, one 2R target. Long only.",
    ref: { when: "22 Oct 2026, v5.1 research (docs/ML_REPORT.md)", text: "Only when price is 3%+ above the daily EMA50. Research P5: PF 1.20 on daily data 2017–2026.", noteSaysOff: false }, rate: { BTC: 0.55, GOLD: 0.25 } },
  { id: "D_THRUST", name: "Daily thrust pullback", desc: "A daily candle more than 2× its average range in an uptrend, then the first 1-hour dip to the EMA20 within 72 hours. Long only.",
    ref: { when: "your research P1 (undated in the repo)", text: "PF 4.5 but only 27 trades; rare.", noteSaysOff: false }, rate: { BTC: 0.30, GOLD: 0.25 } },
  { id: "HTF_TREND", name: "4H trend breakout", desc: "A 4-hour close beyond the 55-bar high or low with 4H SuperTrend and EMA50 agreeing. Wide ATR stop, runs to 6R.",
    ref: { when: "22 Oct 2026, v5.1 research", text: "Trades only with the daily regime (3%+ beyond EMA50D). 2023–26: PF 1.28, +0.16R per trade.", noteSaysOff: false }, rate: { BTC: 7.0, GOLD: 6.9 } },
  { id: "TREND_MTF", name: "MTF SuperTrend (v3 + v4)", desc: "The v3 core: 5-minute SuperTrend flip with 15m and 1h aligned, plus v4's 4H bias, chop and EMA gates. Not before 07:00 UTC.",
    ref: { when: "22 Oct 2026, v5.1 research", text: "Regime-gated, minimum stop floor. 2023–26: +0.09R per trade, measured at half size (the live scale today may differ).", noteSaysOff: false }, rate: { BTC: 4.3, GOLD: 3.5 } },
  { id: "SWEEP_REV", name: "Liquidity sweep reversal", desc: "15m wick through a recent high or low that closes back inside. The pattern your old signal indicator traded.",
    ref: { when: "22 Oct 2026, v5.1 research", text: "Switched off in v5.1: 6,090 setups 2023–26 gave +0.21R before costs and −0.33R after. The stop is tight for the fees.", noteSaysOff: true }, rate: { BTC: 134.6, GOLD: 130.1 } },
  { id: "VWAP_REVERT", name: "VWAP snap-back", desc: "Only in ranging markets: price stretched 2σ from the daily VWAP with RSI at an extreme and a reversal candle.",
    ref: { when: "22 Oct 2026, v5.1 research", text: "Switched off in v5.1: too few signals and negative after costs. A 3-year scan on 29 Oct 2026 found zero setups on both books (its conditions are close to mutually exclusive).", noteSaysOff: true }, rate: { BTC: 0, GOLD: 0 } },
  { id: "SESSION_BO", name: "Session breakout", desc: "London open breaking the Asian range, or New York open breaking London's, on a 15m close with real volume.",
    ref: { when: "22 Oct 2026, v5.1 research", text: "Switched off in v5.1: lost after costs in all four years 2023–26 (−0.19R per trade even with the regime gate).", noteSaysOff: true }, rate: { BTC: 18.6, GOLD: 11.5 } },
  { id: "HTF_SWEEP", name: "4H failed breakout", desc: "A bar trades through the 4H 55-bar high or low and closes back inside with a rejection wick. Opt-in.",
    ref: { when: "no validation recorded", text: "Paper experiment; no research result is stored for it.", noteSaysOff: true }, rate: { BTC: 6.3, GOLD: 6.6 }, optInRate: true },
  { id: "EMA_CROSS", name: "EMA20/50 cross", desc: "EMA20 crossing EMA50 on 15m closes (your chart idea). Opt-in.",
    ref: { when: "23 Oct 2026 (CHANGELOG)", text: "Switched on for PAXG at 25% size as a paper experiment; near break-even on BTC research, untested on gold.", noteSaysOff: false }, rate: { BTC: 56.6, GOLD: 62.9 }, optInRate: true },
  { id: "SSR", name: "Session sweep reversal (SSR)", desc: "STRATEGY.md v1.4: 4H bias, sweep of the Asian range in London 03–05 or NY 08–11 ET, 15m reclaim plus structure shift, 3R. Opt-in.",
    ref: { when: "no live validation recorded", text: "Ported from your strategy document; opt-in.", noteSaysOff: true }, rate: { BTC: 0.7, GOLD: 0.2 }, optInRate: true },
  { id: "EMA_PB", name: "XAU pullback (EMA_PB)", desc: "Your saved gold pullback strategy: M15 EMA50/200 trend, 5m pullback to EMA20, 08:00–11:30 ET weekdays. Opt-in.",
    ref: { when: "no live validation recorded", text: "Ported from 'XAU Pullback v1'; opt-in.", noteSaysOff: true }, rate: { BTC: 53.4, GOLD: 44.1 }, optInRate: true },
];
const STRATS = globalThis.DeskBotModel.strategies.map((s) => Object.assign({}, s, STRAT_X.find((x) => x.id === s.id) || {}));

const $ = (id) => document.getElementById(id);
const fmt$ = (v) => !Number.isFinite(v) ? "—" : (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPx = (v) => v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("en-US",{minimumFractionDigits:BOOK==="GOLD"?2:0,maximumFractionDigits:BOOK==="GOLD"?2:0});
const sgnR = (r) => (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toFixed(2) + "R";
const pct = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(d) + "%";
function ago(ts) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (!Number.isFinite(s)) return "timestamp unknown";
  if (s < 0) return "future timestamp";
  if (s < 90) return Math.round(s) + "s ago"; if (s < 5400) return Math.round(s / 60) + "m ago";
  if (s < 172800) return Math.round(s / 3600) + "h ago"; return Math.round(s / 86400) + "d ago";
}
function when(ts) { const d = new Date(ts); return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nameOf = (id) => (STRATS.find((s) => s.id === id) || { name: id || "System" }).name;

let DATA = SNAP, LIVE = false, RAW = null;
let BOOK = (() => { try { return localStorage.getItem("deskbot_book") || "BTC"; } catch (e) { return "BTC"; } })();
const BOOK_META = { BTC: { coin: "BTC", bn: "BTCUSDT", tv: "BINANCE:BTCUSDT", label: "BTC" }, GOLD: { coin: "PAXG", bn: "PAXGUSDT", tv: "BINANCE:PAXGUSDT", label: "PAXG" } };

function sparkPath(vals, w, h, pad = 4) {
  if (!vals.length) return "";
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  return vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * w},${(h - pad - ((v - lo) / span) * (h - 2 * pad)).toFixed(1)}`).join(" ");
}

function renderDesk() {
  const S = DATA.state || {}, st = S.state || {}, lr = S.last_run || {}, m = lr.market || {};
  const integrity = S.integrity || lr.integrity;
  $("integrityBanner").hidden = !integrity || integrity.approved;
  $("integrityBanner").textContent = integrity && !integrity.approved
    ? `Config fingerprint unapproved. Entry enforcement is not reported; inspect System & research.` : "";
  const account = globalThis.DeskBotModel.account(st, lr), available = account.available;
  const eq = +st.equity || 0, start = Number.isFinite(st.startEquity) && st.startEquity > 0 ? st.startEquity : null, upnl = +lr.upnl || 0;
  $("metricNet").textContent = account.net == null ? "—" : fmt$(account.net);
  $("metricNet").className = "num " + (account.net > 0 ? "up" : account.net < 0 ? "down" : "");
  $("metricUnrealized").textContent = account.upnl == null ? "—" : fmt$(account.upnl);
  $("metricUnrealized").className = "num " + (account.upnl > 0 ? "up" : account.upnl < 0 ? "down" : "");
  $("metricRisk").textContent = account.risk == null ? "—" : fmt$(account.risk);
  $("metricState").textContent = account.status;
  $("metricStateNote").textContent = !LIVE ? "Disconnected / waiting for data" : "Paper execution · no funded orders";
  $("deskInstrument").textContent = available ? (BOOK === "GOLD" ? "PAXG / USD · Gold proxy, not XAUUSD" : "BTC / USD · Paper book") : "Instrument status not loaded";
  $("deskSource").textContent = lr.source ? "Reported feed: " + lr.source : "Feed not reported";
  $("deskClock").textContent = Number.isFinite(Date.parse(S.updated_at)) ? "Updated " + new Date(S.updated_at).toISOString().slice(11,19) + " UTC" : "No update timestamp";
  $("eq").textContent = available ? fmt$(eq + upnl) : "—";
  const ch = eq + upnl - start, base = S.carried && S.carried.v3StartEquity ? +S.carried.v3StartEquity : null;
  $("eqd").innerHTML = `<span class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "+" : "−"}${fmt$(Math.abs(ch)).replace("$", "$")} (${pct(start ? ch / start : 0, 2)})</span> <span class="faint">since ${BOOK === "GOLD" ? "gold book start" : "v5 start"}</span>` +
    (base ? `<br><span class="faint">v3 began at $${base.toFixed(0)} · ${pct((eq + upnl) / base - 1, 1)} all-time</span>` : "");
  $("runAction").textContent = (lr.action || "—").replace("_", " ");
  const all = (st.stats && st.stats.all) || { n: 0, wins: 0, sumR: 0 };
  if (available && start == null) $("eqd").textContent = "Starting equity is not reported; account return is unavailable.";
  if (available && account.upnl == null) $("eqd").textContent = "Reported balance only; unrealized P&L is unavailable.";
  if (!available) $("eqd").textContent = "Waiting for the paper account. No demonstration balances are shown.";
  $("kTrades").textContent = available ? all.n : "—";
  $("kWr").textContent = all.n ? Math.round((all.wins / all.n) * 100) + "%" : "—";
  $("kR").innerHTML = all.n ? `<span class="${all.sumR >= 0 ? "up" : "down"}">${sgnR(all.sumR / all.n)}</span>` : "—";
  $("kDd").textContent = available && Number.isFinite(st.maxDD) ? (st.maxDD * 100).toFixed(1) + "%" : "—";

  const vals = (DATA.curve || []).map((p) => +p.equity);
  $("curveCoverage").textContent = vals.length > 1 ? vals.length + " returned observations" : "No series available";
  const sp = $("spark");
  if (vals.length > 1) {
    const pts = sparkPath(vals, 300, 64);
    const up = vals[vals.length - 1] >= vals[0];
    sp.innerHTML = `<polyline points="0,64 ${pts} 300,64" fill="${up ? "var(--up-soft)" : "var(--down-soft)"}" stroke="none"/>` +
      `<polyline points="${pts}" fill="none" stroke="${up ? "var(--up)" : "var(--down)"}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`;
  } else sp.innerHTML = "";

  // header
  $("hdrPx").textContent = m.price ? "$" + fmtPx(m.mark || m.price) : "—";
  const age = S.updated_at ? (Date.now() - new Date(S.updated_at).getTime()) / 60000 : 999;
  $("hdrDot").className = "dot " + (LIVE ? (age >= 0 && age < 12 ? "live" : "stale") : "");
  $("hdrAge").textContent = S.updated_at ? (LIVE ? "bot " : "snapshot · ") + ago(S.updated_at) : "no data";

  // position
  const p = st.pos, pc = $("posCard");
  if (p) {
    const d = p.dir === "long" ? 1 : -1, px = m.price || p.entry, R = Math.abs(p.entry - p.stop0);
    const prog = (lvl) => Math.max(0, Math.min(1, ((px - p.entry) * d) / Math.abs(lvl - p.entry)));
    const rung = (t, lvl, done, cls = "") => `<div class="rung ${done ? "hit" : ""} ${cls}"><span class="t">${t}</span><span class="track"><i style="width:${(done ? 100 : prog(lvl) * 100).toFixed(0)}%"></i></span><span>${fmtPx(lvl)}</span></div>`;
    const u = +lr.upnl || 0;
    pc.innerHTML = `<div class="pos-head"><span class="side ${p.dir}">${p.dir.toUpperCase()}</span><h2>${esc(nameOf(p.strategy))}</h2><span class="num ${u >= 0 ? "up" : "down"}" style="margin-left:auto;font-weight:600">${u >= 0 ? "+" : "−"}${fmt$(Math.abs(u))}</span></div>
      <div class="setup-svg" style="margin-top:10px">${DeskSetup.setupSVG(p, zonePal(), fmtPx)}</div>
      <div class="grid2" style="margin-top:10px"><div><div class="k">Entry</div><div class="v">${fmtPx(p.entry)}</div></div><div><div class="k">Risk</div><div class="v">${fmt$(p.riskAmt)} · ${fmtPx(R)} pts</div></div>
      <div><div class="k">Size</div><div class="v">${(+p.remainingQty).toFixed(5)} ${BOOK === "GOLD" ? "PAXG units (modeled)" : "BTC"}</div></div><div><div class="k">Opened</div><div class="v">${ago(p.openT)}</div></div></div>
      <div class="ladder">${rung("TP3", p.tp3, p.tp3Done)}${rung("TP2", p.tp2, p.tp2Done)}${rung("TP1", p.tp1, p.tp1Done)}
      <div class="rung stop"><span class="t">Stop</span><span class="track"><i style="width:${p.stop !== p.stop0 ? 100 : 0}%"></i></span><span>${fmtPx(p.stop)}${p.stop !== p.stop0 ? " (moved)" : ""}</span></div></div>
      <p class="note" style="margin-top:10px">${(p.why || []).map(esc).join(" · ")}</p>
      <div class="note" style="margin-top:10px"><b>Trade manager</b>${(p.plan && p.plan.length) ? p.plan.slice().reverse().map((x) => `<div>${new Date(x.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${esc(x.msg)}</div>`).join("") : `<div class="muted">Watching 1m/5m/1H structure — no adjustment needed yet.</div>`}</div>`;
  } else {
    const on = STRATS.filter((s) => stratView(s.id, st).state !== "DISABLED").length;
    pc.innerHTML = `<div class="flat"><span class="radar" aria-hidden="true"></span><div><h2>${available ? "No open paper position" : "Account data unavailable"}</h2><p class="note">${available ? on + " of " + STRATS.length + " strategies configured on." : "Connect to the public runner to load current state."} Each waits for its own timeframe and setup. Paper runner checks approximately every 5 minutes${st.cb && st.cb.cooldownUntil > Date.now() ? ` · <span class="down">circuit breaker until ${new Date(st.cb.cooldownUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>` : ""}.</p></div></div>`;
  }

  // market
  $("regime").textContent = m.regime || "—";
  const tf = [["1M", m.st1m], ["5M", m.st5], ["15M", m.st15], ["1H", m.st1h], ["4H", m.st4h]];
  $("tf").innerHTML = tf.map(([k, v]) => `<div class="${v === 1 ? "bull" : v === -1 ? "bear" : ""}"><div class="k">${k}</div><div class="v">${v === 1 ? "▲ Up" : v === -1 ? "▼ Down" : "—"}</div></div>`).join("");
  const fund = m.funding != null ? (m.funding * 100).toFixed(4) + "%/h" : "—";
  const cells = [
    ["Distance from daily EMA50", m.ema50D && m.price ? pct((m.price-m.ema50D)/m.price,1) + " · qualification is strategy-specific" : "—", ""],
    ["Order flow 24h / 4h", m.flow24 != null ? `${m.flow24 >= 0 ? "Buyers" : "Sellers"} ${pct(m.flow24, 1)} · ${pct(m.flow4, 1)}` : "—", m.flow24 > 0.02 ? "up" : m.flow24 < -0.02 ? "down" : ""],
    ["Funding (Hyperliquid)", fund, m.funding > 0.00002 ? "down" : m.funding < 0 ? "up" : ""],
    ["Fear & Greed", m.fng != null ? `${m.fng} · ${m.fngLabel || ""}` : "—", ""],
    ["vs daily VWAP", m.vwapDev != null ? (m.vwapDev >= 0 ? "+" : "−") + Math.abs(m.vwapDev).toFixed(2) + "σ" : "—", ""],
    ["RSI 15m / 1h", m.rsi15 != null ? `${(+m.rsi15).toFixed(0)} / ${(+m.rsi1h).toFixed(0)}` : "—", ""],
    ["ATR 5m / 15m", m.atr5 != null ? `$${fmtPx(m.atr5)} / $${fmtPx(m.atr15)}` : "—", ""],
    ["Open interest", m.oi != null ? Math.round(m.oi).toLocaleString() + (BOOK === "GOLD" ? " PAXG" : " BTC") : "—", ""],
  ];
  $("mkt").innerHTML = cells.map(([k, v, c]) => `<div><div class="k">${k}</div><div class="v ${c}">${esc(v)}</div></div>`).join("");

  const dec = lr.decision || { rejects: [], signals: [] };
  const rows = [];
  (dec.signals || []).forEach((s) => rows.push(`<div><span class="s">${esc(s.strategy)}</span><span class="up">Signal ${esc(s.dir)} · score ${s.score}</span></div>`));
  const seen = new Set();
  (dec.rejects || []).forEach((r) => { if (seen.has(r.strategy)) return; seen.add(r.strategy); rows.push(`<div><span class="s">${esc(r.strategy)}</span><span class="muted">${esc(r.reason)}</span></div>`); });
  $("why").innerHTML = rows.join("") || `<p class="note">Waiting for the next check.</p>`;
  renderAgents(lr);
  renderOperations();
}
function renderAgents(lr) {
  const d = (lr && lr.desk) || null, box = $("deskBody");
  if (!d) { box.innerHTML = `<p class="note">The desk reports after the next cloud check (v5.8).</p>`; return; }
  const c = d.chart || {}, tr = c.trend || {}, arrow = (v) => (v === 1 ? "▲" : v === -1 ? "▼" : "·");
  const chip = (name, on) => `<span class="chip" style="margin-right:6px;opacity:${on ? 1 : 0.55}">${name} ${on ? "ON" : "off"}</span>`;
  const lv = (x) => (x ? `${esc(x.name)} $${fmtPx(x.px)} <span class="faint">(${x.atr} ATR)</span>` : "—");
  const ago2 = (ts) => ago(ts);
  box.innerHTML =
    `<div style="margin:8px 0">${chip("Body stop", d.body)}${chip("Re-entry", !!d.reentry)}${chip("Validator", d.validator)}</div>` +
    `<div class="grid2"><div><div class="k">Chart agent · bias</div><div class="v ${c.bias === "bull" ? "up" : c.bias === "bear" ? "down" : ""}">${esc((c.bias || "—").toUpperCase())} · 1m${arrow(tr.m1)} 5m${arrow(tr.m5)} 15m${arrow(tr.m15)} 1h${arrow(tr.h1)} 4h${arrow(tr.h4)}</div></div>` +
    `<div><div class="k">Nearest support</div><div class="v">${lv(c.support)}</div></div><div><div class="k">Nearest resistance</div><div class="v">${lv(c.resistance)}</div></div>` +
    `<div><div class="k">Re-entry</div><div class="v">${d.reentry && d.reentry.armed ? `armed · reclaim $${fmtPx(d.reentry.armed.level)}` : "not armed"}</div></div></div>` +
    `<div class="note" style="margin-top:10px"><b>Recent agent activity</b>${(DATA.agents || []).filter((a) => a.agent !== "chart").slice(0, 8).map((a) => `<div>${esc(ago2(a.ts))} · <b>${esc(a.agent)}</b> · ${esc(a.input_summary || "")}${a.output && a.output.verdict ? ` — ${esc(a.output.verdict)}: ${esc(a.output.reason || "")}` : ""}${a.error ? ` <span class="down">${esc(a.error)}</span>` : ""}</div>`).join("") || `<div class="muted">No signals or adjustments yet. Agents log when they have something to say.</div>`}</div>`;
}

const OPT_IN = ["HTF_SWEEP", "EMA_CROSS", "SSR", "EMA_PB"], DEFAULT_SCALE = { D_BEARTRAP: 1, D_THRUST: 1, HTF_TREND: 1, TREND_MTF: 1, SWEEP_REV: 1, VWAP_REVERT: 1, SESSION_BO: 1, HTF_SWEEP: 0, EMA_CROSS: 0, SSR: 0, EMA_PB: 0 };
function stratView(id, st) {
  // same resolution as the engine: an override RISK_SCALE replaces the default object, so a missing key means "undefined" (opt-in strategies stay off)
  const cfg = st.cfg || {}, own = cfg.RISK_SCALE && Object.prototype.hasOwnProperty.call(cfg.RISK_SCALE, id), rs = own ? cfg.RISK_SCALE[id] : cfg.RISK_SCALE ? undefined : DEFAULT_SCALE[id];
  return DeskCoverage.viewStrategy({ id, cfg, riskScale: rs, optIn: OPT_IN.includes(id), enabledFlag: (st.enabled || {})[id], cov: (st.cov || {})[id], stat: (st.stats && st.stats.by || {})[id], probationMin: 10, now: Date.now() });
}
const OPST = { RUNNING: ["running", "Running"], WAITING_FOR_BAR: ["waiting", "Waiting for first bar"], DISABLED: ["disabled", "Disabled"], DATA_BLOCKED: ["blocked", "Data blocked"], ERROR: ["error", "Error"], NO_EVALUATION_YET: ["nodata", "No evaluation data yet"] };
function renderOperations() {
  const S=DATA.state||{}, st=S.state||{}, lr=S.last_run||{};
  const available=globalThis.DeskBotModel.finite(st.equity);
  const op=globalThis.DeskBotModel.operations(st,lr,DATA.agents,available);
  $("pulseStrategies").textContent=op.enabled ?? "—";
  $("pulseStrategyNote").textContent=op.registered+" registered strategies · selected book";
  $("pulseAgents").textContent=op.observedRoles ?? "—";
  $("pulseAgentNote").textContent=op.roles.length+" instrumented roles · "+(op.providerCount==null?"AI status unknown":op.providerCount+" AI providers reported");
  $("pulseSetups").textContent=op.qualified ?? "—";
  $("pulseSetupNote").textContent=op.reported==null?"No strategy-level snapshot":op.reported+" strategy records in latest check";
  const age=Date.now()-Date.parse(S.updated_at),recent=LIVE&&Number.isFinite(age)&&age>=0&&age<=12*60000;
  $("pulseFreshness").textContent=!available?"Waiting for account evidence":!LIVE?"Disconnected · saved observation":recent?"Recent public status · approximately 5-minute runner":"Stale or invalid timestamp · inspect System";
  $("pulseOutcome").textContent=op.traded==null?"Profit attribution unavailable":op.positive+" of "+op.traded+" strategies with closed trades are net positive · paper only";
  $("agentCoverage").textContent=op.roles.length+" instrumented roles · "+(op.observedRoles??"—")+" seen in logs";
  $("agentGrid").innerHTML=op.roles.map((role,i)=>`<article class="agent-tile"><div class="agent-top"><span class="agent-avatar" aria-hidden="true">${String(i+1).padStart(2,"0")}</span><span class="chip">${esc(role.kind)}</span></div><h3>${esc(role.name)}</h3><p>${esc(role.description)}</p><div class="agent-status">${esc(role.status)}</div><small>${role.record?"Last returned log: "+esc(ago(role.record.ts)):"No log in returned history"}</small>${role.record?.error?'<small class="down">Last returned log includes an error</small>':""}</article>`).join("");
  renderSetupRadar(op);
}
function renderSetupRadar(operations) {
  const S=DATA.state||{},st=S.state||{},lr=S.last_run||{};
  const op=operations||globalThis.DeskBotModel.operations(st,lr,DATA.agents,globalThis.DeskBotModel.finite(st.equity));
  const query=($("setupSearch").value||"").toLowerCase(),family=$("setupFamily").value;
  const rows=op.rows.filter(r=>(family==="all"||r.family===family)&&[r.name,r.id,r.family,r.cadence,r.status.reason].join(" ").toLowerCase().includes(query));
  $("radarCoverage").textContent=rows.length+" of "+op.registered+" setup types";
  $("setupList").innerHTML=rows.map(r=>{
    const direction=r.signal?.dir==="long"?"UP setup":r.signal?.dir==="short"?"DOWN setup":"WAIT";
    const hasOutcomes=Number.isFinite(r.stats?.n)&&r.stats.n>0&&Number.isFinite(r.stats.net);
    return `<article class="setup-tile" data-state="${esc(r.status.state)}"><span class="setup-symbol" aria-hidden="true">${r.family==="Trend"?"↗":r.family==="Breakout"?"⌁":r.family==="Reversal"?"↶":"≈"}</span><div><h3>${esc(r.name)}</h3><p>${esc(r.family)} · ${esc(r.cadence)}</p><p>${esc(r.status.reason)}</p></div><div class="setup-state"><strong class="${r.signal?.dir==="long"?"up":r.signal?.dir==="short"?"down":""}">${r.status.enabled===false?"DISABLED":esc(direction)}</strong><span>${hasOutcomes?fmt$(r.stats.net)+" net paper":"No closed outcomes"}</span></div></article>`;
  }).join("")||'<p class="note">No setup types match this search. Try another family or clear the search.</p>';
}

const TOWER_CAL = { at: 0, next: null };
function renderTower() {
  if (!globalThis.TowerView) return;
  const S = DATA.state || {}, st = S.state || {};
  const strategies = STRATS.map((s) => { const v = stratView(s.id, st), c = v.cov; return { id: s.id, name: s.name, state: OPST[v.state] ? OPST[v.state][1].toUpperCase() : v.state, reason: v.state === "DISABLED" ? (v.offReason || "") : c ? ((c.lastDueCode || c.lastCode || "") + " " + (c.lastDueReason || c.lastReason || "")).trim() : "no evaluation counters yet" }; });
  if (globalThis.DeskMarkets && !$("v-tower").hidden && Date.now() - TOWER_CAL.at > 10 * 60e3) { TOWER_CAL.at = Date.now(); globalThis.DeskMarkets.nextHighImpact().then((e) => { TOWER_CAL.next = e; renderTower(); }).catch(() => {}); }
  globalThis.TowerView.render({ calendarNext: TOWER_CAL.next, state: S, agents: DATA.agents || [], trades: DATA.trades || [], curve: DATA.curve || [], strategies, book: BOOK, bt: DATA.bt || null,
    experiment: RAW ? (RAW.experiment === undefined ? null : RAW.experiment) : null, config: BOOK === "BTC" && RAW ? RAW.config || null : null, aiProviders: RAW && RAW.chat ? RAW.chat.ai || [] : null });
}
let strategyFilter = "all";
function renderStrategies() {
  const S = DATA.state || {}, st = S.state || {}, lr = S.last_run || {}, hasCov = !!(st.cov && Object.keys(st.cov).length), by = (st.stats && st.stats.by) || {};
  const trades = (DATA.trades || []).slice().sort((a, b) => new Date(a.close_t) - new Date(b.close_t));
  const views = STRATS.map((s) => stratView(s.id, st)), on = views.filter((v) => v.state !== "DISABLED").length;
  $("strategyCount").textContent = `${STRATS.length} registered · ${on} on for ${BOOK === "GOLD" ? "gold (PAXG)" : "BTC"}`;
  const meta = st.covMeta;
  $("stratNote").innerHTML = (hasCov ? `Evaluation counters since <b>${esc(new Date(Math.min(...Object.values(st.cov).map((c) => c.since))).toISOString().slice(0, 16).replace("T", " "))} UTC</b>${meta ? ` · bars evaluated ${meta.evalBars} · boundary bars missed ${meta.missedBars} · bars missing from the feed ${Object.values(meta.missingDue || {}).reduce((a, b) => a + b, 0)}` : ""}.`
    : `<b>No evaluation counters in this data yet.</b> They start when the coverage update is deployed; the states below come from configuration only and do not prove a strategy ran.`) +
    ` Every number here is <b>PAPER</b> (simulated fills at live prices), not funded trading. <b>Operational state</b> says whether the strategy is being evaluated; <b>sizing</b> is separate. Zero closed trades does not mean it was not evaluated.`;
  const q = ($("strategySearch").value || "").toLowerCase();
  $("stratList").innerHTML = STRATS.map((s, k) => ({ s, k })).filter(({ s, k }) => (s.name + " " + s.id).toLowerCase().includes(q) && (strategyFilter === "all" || (strategyFilter === "enabled" ? views[k].state !== "DISABLED" : views[k].state === "DISABLED"))).map(({ s, k }) => {
    const v = views[k], c = v.cov, x = by[s.id] || { n: 0, sumR: 0, net: 0 }, mine = trades.filter((t) => t.strategy === s.id);
    const [cls, label] = OPST[v.state], openNow = st.pos && st.pos.strategy === s.id;
    // costs and drawdown from the closed trades loaded on this page (the last 100 of the book), labelled as such
    let cum = 0, pk = 0, dd = 0; mine.forEach((t) => { cum += +t.r; pk = Math.max(pk, cum); dd = Math.max(dd, pk - cum); });
    const fees = mine.reduce((a, t) => a + (+t.fees || 0), 0), fund = mine.reduce((a, t) => a + (+t.funding || 0), 0);
    const cadTxt = { "5m": "every 5m bar", "15m": "15m close", "1h": "1H close", "4h": "4H close", "1d": "daily close (00:00 UTC)" }[v.cadence];
    const sizeTxt = v.state === "DISABLED" ? "none (disabled)" : `${(v.riskScale ?? 1)}× scale${v.probation ? " · probation: half size" : ""}${(v.riskScale ?? 1) >= 1 && !v.probation ? " (full)" : ""}`;
    const hhmm = (T) => new Date(T + 1).toISOString().slice(11, 16) + " UTC";
    const evalTxt = c && c.lastDueT != null ? `${ago(c.lastDueT + 1)} · data to ${hhmm(c.lastDueT)}` : c && c.lastEvalT != null ? `no due bar yet (last bar ${hhmm(c.lastEvalT)})` : "no data";
    const nextTxt = v.nextDueT != null ? `next due bar closes ${hhmm(v.nextDueT)}` : "";
    const reasonTop = c ? Object.entries(c.reasons || {}).sort((a, b) => b[1] - a[1]).slice(0, 5) : [];
    const rate = s.rate && s.rate[BOOK === "GOLD" ? "GOLD" : "BTC"];
    const mismatch = s.ref.noteSaysOff && v.state !== "DISABLED" ? `<div class="refnote warn">The note above says this strategy was switched off. The current effective configuration has it <b>on</b> (${esc(sizeTxt)}), so the research result described may not describe what is running now.</div>` : (!s.ref.noteSaysOff && v.state === "DISABLED" ? `<div class="refnote warn">Disabled now (${esc(v.offReason || "")}), although the research note describes it as active.</div>` : "");
    const ver = `Engine v${esc((RAW && RAW.version) || "?")} · config ${esc(String(((S.integrity || {}).hash) || "unknown").slice(0, 8))} · fingerprint ${((S.integrity || {}).approved) ? "approved for this paper experiment" : "not approved"} · financial validation: none`;
    return `<article class="strat" data-strategy="${s.id}"><div class="strat-h"><h3>${esc(s.name)}</h3><span class="paper">PAPER</span><span class="opst ${cls}">${label}</span></div>
      <p>${esc(s.desc)}</p>
      <div class="kv"><div><div class="k">Fires on</div><div class="v">${esc(cadTxt)}</div></div><div><div class="k">Sizing (separate)</div><div class="v">${esc(sizeTxt)}</div></div>
        <div><div class="k">Last due evaluation</div><div class="v">${esc(evalTxt)}${nextTxt && v.state !== "DISABLED" ? `<br><span class="faint">${esc(nextTxt)}</span>` : ""}</div></div><div><div class="k">Position now</div><div class="v">${openNow ? `<b class="${st.pos.dir === "long" ? "up" : "down"}">${esc(st.pos.dir)} open</b>` : "none"}</div></div></div>
      ${c ? `<div class="counts" aria-label="Evaluation counters"><span>due <b>${c.due}</b></span><span>completed <b>${c.completed}</b></span>${c.windowClosed ? `<span>outside its session window <b>${c.windowClosed}</b></span>` : ""}<span>valid setups <b>${c.setups}</b></span><span>rejected by gates <b>${c.gateRejected}</b></span><span>blocked by portfolio <b>${c.portfolioBlocked}</b></span><span>displaced <b>${c.notSelected}</b></span><span>entered <b>${c.entered}</b></span>${c.skippedData ? `<span>data-blocked <b>${c.skippedData}</b></span>` : ""}${c.failed ? `<span>errors <b>${c.failed}</b></span>` : ""}</div>
        <div class="reason" title="result of the latest due evaluation"><b>${esc(c.lastDueCode || c.lastCode || "")}</b> · ${esc(c.lastDueReason || c.lastReason || "")}</div>
        ${reasonTop.length ? `<details><summary>Most common reasons since counters began</summary><ul>${reasonTop.map(([k2, n]) => `<li>${n}× ${esc(k2)}</li>`).join("")}</ul></details>` : ""}`
        : v.state === "DISABLED" ? `<div class="reason"><b>DISABLED</b> · ${esc(v.offReason || "")}</div>` : `<div class="reason">No evaluation counters yet.</div>`}
      <div class="stats3"><div><div class="k">Closed trades</div><div class="v">${x.n}</div></div>
      <div><div class="k">Net R · $ (paper)</div><div class="v ${x.n ? (x.sumR >= 0 ? "up" : "down") : ""}">${x.n ? sgnR(x.sumR) + " · " + (x.net >= 0 ? "+" : "−") + fmt$(Math.abs(x.net)) : "—"}</div></div>
      <div><div class="k">Costs · max DD</div><div class="v">${mine.length ? fmt$(fees + fund) + " · −" + dd.toFixed(1) + "R" : "—"}</div></div></div>
      ${mine.length ? `<div class="refnote">Costs and drawdown cover the ${mine.length} closed trade(s) loaded here (${esc(when(mine[0].close_t))} to ${esc(when(mine[mine.length - 1].close_t))}).</div>` : ""}
      ${rate != null ? `<div class="refnote">Historical frequency: about ${rate} valid setups per 30 days (3-year scan, 29 Oct 2026, engine 5.8.0, Binance spot candles${s.optInRate ? ", opt-in strategies scanned with all gates open" : ", this book's live gates"}); ${rate === 0 ? "none in 3 years" : `at that average rate a week with none happens about ${Math.round(100 * Math.exp(-rate * 7 / 30))}% of the time (setups cluster, so this is rough)`}.</div>` : ""}
      <div class="refnote"><b>Research reference</b> (${esc(s.ref.when)}): ${esc(s.ref.text)}</div>${mismatch}
      <div class="refnote">${ver}</div></article>`;
  }).join("") || `<div class="card note">No strategies match this filter.</div>`;
}

function renderTrades() {
  const q = ($("tradeSearch")?.value || "").toLowerCase();
  const t = (DATA.trades || []).filter(x=>(x.strategy+" "+x.reason+" "+x.dir).toLowerCase().includes(q));
  $("trades").innerHTML = t.length ? t.map((x) => `<div class="li"><div class="a"><span class="side ${x.dir}" style="margin-right:6px">${x.dir.toUpperCase()}</span>${esc(nameOf(x.strategy))}</div>
    <div class="b ${x.net >= 0 ? "up" : "down"}">${x.net >= 0 ? "+" : "−"}${fmt$(Math.abs(+x.net))} · ${sgnR(+x.r)}</div>
    <div class="c">${fmtPx(+x.entry)} → ${fmtPx(+x.exit_avg)} · ${esc(x.reason)} · ${when(x.close_t)}</div></div>`).join("")
    : `<div class="li"><div class="a">No matching closed paper trades</div><div class="c">This view uses the returned public history for the selected book. No sample trades are inserted.</div></div>`;
}

const KIND = { OPEN: "up", WIN: "up", LOSS: "down", ERROR: "down", TP1: "up", TP2: "up", TP3: "up" };
function renderEvents() {
  const e = DATA.events || [];
  $("events").innerHTML = e.length ? e.map((x) => `<div class="li"><div class="a ${KIND[x.kind] || ""}" style="font-family:var(--f-mono);font-size:12px;letter-spacing:.06em">${esc(x.kind)}${x.strategy ? " · " + esc(x.strategy) : ""}</div><div class="b faint" style="font-weight:500">${ago(x.ts)}</div><div class="c">${esc(x.msg)}</div></div>`).join("")
    : `<div class="li"><div class="a">No activity yet</div></div>`;
}

function renderSystem() {
  const evidence = globalThis.DeskBotEvidence.summarize(RAW, Date.now(), LIVE);
  $("evidenceMode").textContent = evidence.mode + " · Observations, not a forecast or execution authorization.";
  $("evidenceRows").innerHTML = evidence.rows.map((r) => `<div class="li"><div class="a">${esc(r.instrument)}</div><div class="b">${r.fresh ? "Recent timestamps" : "STALE / UNKNOWN"}</div><div class="c">Last run UTC: ${esc(r.runAt)} · ${esc(r.approval)} · AI: ${esc(r.ai)}</div></div>`).join("");
  $("evidenceIssues").innerHTML = evidence.issues.map((s) => `<li>${esc(s)}</li>`).join("");
  const b = DATA.bt, S = DATA.state || {}, lr = S.last_run || {};
  if (!b) { $("btSub").textContent = "No instrument-matched saved validation was returned for this book."; $("btChart").innerHTML = ""; $("btTable").innerHTML = ""; }
  $("honest").textContent = "Research is separate from forward paper results. A saved backtest does not validate the current configuration. Review the exact source, instrument, period and costs before drawing conclusions.";
  if (b && b.curve) {
    const c = b.curve, W = 340, H = 170, L = 38, Rr = 6, T = 10, B = 22;
    const ys = c.map((p) => p[1]), lo = Math.min(...ys, 1000), hi = Math.max(...ys, 1000);
    const pad = (hi - lo) * 0.1 || 10, y0 = lo - pad, y1 = hi + pad;
    const X = (i) => L + (i / (c.length - 1)) * (W - L - Rr), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    const ticks = [y0 + (y1 - y0) * 0.1, (y0 + y1) / 2, y1 - (y1 - y0) * 0.1].map((v) => Math.round(v));
    const pts = c.map((p, i) => `${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
    const last = c[c.length - 1][1];
    const fmtD = (t) => { const d = new Date(t); return d.toLocaleDateString(undefined, { month: "short" }) + " ’" + String(d.getFullYear()).slice(2); };
    $("btChart").innerHTML = ticks.map((v) => `<line x1="${L}" x2="${W - Rr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="10" fill="var(--fg-3)" font-family="IBM Plex Mono, monospace">$${v}</text>`).join("") +
      `<line x1="${L}" x2="${W - Rr}" y1="${Y(1000)}" y2="${Y(1000)}" stroke="var(--fg-3)" stroke-dasharray="3 3" stroke-width="1"/>` +
      `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.8"/>` +
      `<circle cx="${X(c.length - 1)}" cy="${Y(last)}" r="3.2" fill="var(--accent)"/>` +
      `<text x="${L}" y="${H - 5}" font-size="10" fill="var(--fg-3)" font-family="IBM Plex Mono, monospace">${fmtD(c[0][0])}</text><text x="${W - Rr}" y="${H - 5}" text-anchor="end" font-size="10" fill="var(--fg-3)" font-family="IBM Plex Mono, monospace">${fmtD(c[c.length - 1][0])}</text>`;
    const a = b.a || {};
    $("btSub").innerHTML = `Same engine, $1,000 start, past year of BTC (${new Date(b.f).toLocaleDateString()} – ${new Date(b.t).toLocaleDateString()}). <b class="num">${a.n} trades</b>, ${Math.round((a.wr || 0) * 100)}% wins, <b class="num ${a.expR >= 0 ? "up" : "down"}">${sgnR(a.expR || 0)}</b> avg, ends at <b class="num">${fmt$(+b.eq)}</b>, max drawdown ${(b.mdd * 100).toFixed(1)}%.`;
    const by = b.by || {};
    $("btTable").innerHTML = `<tr><th>Strategy</th><th>Trades</th><th>Avg R</th><th>Net</th></tr>` + Object.entries(by).sort((x, y) => y[1].n - x[1].n).map(([k, v]) =>
      `<tr><td style="text-align:left">${esc(nameOf(k))}</td><td>${v.n}</td><td class="${v.expR >= 0 ? "up" : "down"}">${sgnR(v.expR)}</td><td class="${v.net >= 0 ? "up" : "down"}">${v.net >= 0 ? "+" : "−"}${fmt$(Math.abs(v.net))}</td></tr>`).join("");
  }
  const st = S.state || {};
  $("riskNow").textContent = Number.isFinite(lr.risk) ? (lr.risk * 100).toFixed(1) + "%" : "Not reported";
  const sys = [
    ["Runs on", "Supabase, every 5 min"],
    ["Last check", S.updated_at ? ago(S.updated_at) : "—"],
    ["Data source", lr.source === "binance" ? "Binance spot (fallback)" : lr.source === "hyperliquid" ? "Hyperliquid reported feed" : "Not reported"],
    ["Check took", lr.ms != null ? lr.ms + " ms" : "—"],
    ["Engine", st.version ? "v" + st.version : "Not reported"],
    ["Configuration", globalThis.DeskBotEvidence.configLabel(S.integrity)],
    ["Config fingerprint", S.integrity ? S.integrity.hash : "—"],
    ["Drawdown basis", st.markedEquity != null ? "Sampled marked equity (since upgrade)" : "Legacy realized equity"],
    ["Circuit breaker", st.cb && st.cb.cooldownUntil > Date.now() ? "Cooling down" : `${(st.cb && st.cb.consec) || 0} of 3 losses`],
  ];
  $("sys").innerHTML = sys.map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join("");
}

function renderAll() { document.querySelectorAll(".bookName").forEach((e) => { e.textContent = BOOK === "GOLD" ? "PAXG" : "BTC"; }); renderDesk(); renderStrategies(); renderTrades(); renderEvents(); renderSystem(); renderTower(); renderScanner(); }

// scanner, committee and the trading-state pill (scanner.js)
function renderScanner() {
  const S = globalThis.DeskScanner; if (!S) return;
  const now = Date.now();
  S.renderScan($("scanBody"), RAW && RAW.scan, now, RAW && RAW.track);
  S.renderCommittee($("committeeBody"), RAW && RAW.agents, RAW && RAW.chat && RAW.chat.ai);
  if (!RAW) { S.renderState($("tradeState"), { state: "HALTED", reasons: ["account status not loaded"] }); return; }
  const g = RAW.books && RAW.books.GOLD, gold = BOOK === "GOLD";
  const st = gold ? g && g.state : RAW.state, lr = gold ? g && g.lastRun : RAW.lastRun, cfg = Object.assign({}, RAW.config || {}, (gold && st && st.cfg) || {});
  S.renderState($("tradeState"), S.tradingState(st, cfg, lr, now));
}

// tabs
const VIEWS = ["desk", "tower", "markets", "scanner", "committee", "chart", "strategies", "trades", "activity", "system"];
const PAGE_META = {
  markets:["Markets terminal","Clocks, sessions, crypto, macro, the economic calendar and news around the bot\u2019s two books. Context only; the bot does not read it."],
  scanner:["Market scanner","The bot\u2019s own rules run on every Hyperliquid market every 15 minutes, with options and futures context from Deribit. Setups are rules firing, not predictions."],
  committee:["Investment committee","Each new paper entry reviewed by an analyst team, a bull/bear debate, a research manager, a trader, a three-way risk debate and a portfolio manager. Advisory only."],
  tower:["The trading tower","Every agent on its floor, what it reported, and how each check is handed from desk to desk."],
  desk:["Your desk. A clearer perspective.","Follow the evidence, explore different setups, and keep every paper result in view."],
  chart:["Chart workspace","Market structure and the paper runner’s reported levels. Observations are not forecasts."],
  strategies:["Strategy monitor","See what is configured, what was reported, and what has actually traded."],
  trades:["Trade journal","Review net outcomes and the execution path behind each closed paper trade."],
  activity:["Activity stream","The latest returned events from the paper runner, with source timestamps."],
  system:["System & research","Keep operational health, configuration identity and historical evidence separate."]
};
function show(v) {
  if (!VIEWS.includes(v)) v = "desk";
  $("pageTitle").textContent = PAGE_META[v][0]; $("pageSubtitle").textContent = PAGE_META[v][1];
  $("pageCrumb").textContent = PAGE_META[v][0];
  history.replaceState(null,"", "#"+v);
  VIEWS.forEach((x) => { $("v-" + x).hidden = x !== v; });
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.v === v)));
  try { localStorage.setItem("db5tab", v); } catch (e) {}
  window.scrollTo(0, 0);
  document.dispatchEvent(new CustomEvent("desk:view",{detail:{view:v}}));
  if (v === "chart") setTimeout(() => chartShow(), 0);
}
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => show(b.dataset.v)));

// ── Chart: TradingView Lightweight Charts (Apache-2.0) + the bot's real levels ──
const CH = { lib: null, chart: null, series: {}, tf: "1h", mode: "bot", timer: null, tvLoaded: false, request: 0, prims: [], zlines: [], layers: { focus: true, trade: true, FVG: true, IFVG: true, OB: true, value: true, pd: true, structure: false, liq: false } };
try { Object.assign(CH.layers, JSON.parse(localStorage.getItem("deskbot.layers") || "{}")); } catch (_) { /* storage optional */ }
document.querySelectorAll("#layers input").forEach((i) => { i.checked = !!CH.layers[i.dataset.layer]; i.addEventListener("change", () => { CH.layers[i.dataset.layer] = i.checked; try { localStorage.setItem("deskbot.layers", JSON.stringify(CH.layers)); } catch (_) { /* optional */ } chartDraw(); }); });
const zonePal = () => ({ bull: "#4fd1c5", bear: "#d46bd6", obBull: "#5aa9e6", obBear: "#f2a93b", sl: cssVar("--down"), tp: cssVar("--up"), slText: cssVar("--down"), tpText: cssVar("--up"), fg: cssVar("--fg"), muted: cssVar("--fg-3") });
const TFMS = { "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888"; }
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); const timer=setTimeout(()=>{s.remove();rej(new Error("Script timed out"));},15000); s.src = src; s.onload = ()=>{clearTimeout(timer);res();}; s.onerror = () => {clearTimeout(timer);rej(new Error("load " + src));}; document.head.appendChild(s); }); }
async function getBars(tf, n, book = BOOK) {
  const end = Date.now(), start = end - (n + 2) * TFMS[tf];
  try {
    const r = await fetch("https://api.hyperliquid.xyz/info", { signal: AbortSignal.timeout(12000), method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin: (BOOK_META[book] || BOOK_META.BTC).coin, interval: tf, startTime: start, endTime: end } }) });
    if (!r.ok) throw 0; const j = await r.json(); if (!Array.isArray(j) || !j.length) throw 0;
    return { src: "Hyperliquid", bars: j.map((k) => ({ t: +k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c })) };
  } catch (e) {
    const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${(BOOK_META[book] || BOOK_META.BTC).bn}&interval=${tf}&limit=${Math.min(n, 1000)}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error("no candle source reachable"); const j = await r.json();
    return { src: "Binance", bars: j.map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] })) };
  }
}
function emaArr(bars, p) { const out = new Array(bars.length).fill(NaN); if (bars.length < p) return out; let e = 0; for (let i = 0; i < p; i++) e += bars[i].c; e /= p; out[p - 1] = e; const k = 2 / (p + 1); for (let i = p; i < bars.length; i++) { e = bars[i].c * k + e * (1 - k); out[i] = e; } return out; }
function donchianPrior(bars, n) { const i = bars.length - 1; if (i < n) return null; let h = -Infinity, l = Infinity; for (let j = i - n; j < i; j++) { h = Math.max(h, bars[j].h); l = Math.min(l, bars[j].l); } return { hi: h, lo: l }; }
const sec = (ms) => Math.floor(ms / 1000);

async function chartShow() {
  if (CH.mode === "tv") return showTV();
  $("lwBox").hidden = false; $("tvBox").hidden = true;
  try {
    if (!CH.lib) { await loadScript("./vendor/lightweight-charts-4.2.0.js"); CH.lib = window.LightweightCharts; }
  } catch (e) { $("lwMsg").textContent = "Couldn't load the chart library here. Open the live dashboard to see the chart."; return; }
  if (!CH.chart) {
    const box = $("lwBox");
    CH.chart = CH.lib.createChart(box, { height: box.clientHeight, localization: { locale: "en-US" }, layout: { background: { color: cssVar("--panel") }, textColor: cssVar("--fg-2"), fontFamily: "IBM Plex Mono, monospace" },
      grid: { vertLines: { color: cssVar("--line") }, horzLines: { color: cssVar("--line") } }, rightPriceScale: { borderColor: cssVar("--line-2") },
      timeScale: { borderColor: cssVar("--line-2"), timeVisible: true, secondsVisible: false }, crosshair: { mode: 0 } });
    new ResizeObserver(() => CH.chart.applyOptions({ width: box.clientWidth, height: box.clientHeight })).observe(box);
    CH.series.c = CH.chart.addCandlestickSeries({ upColor: cssVar("--up"), downColor: cssVar("--down"), wickUpColor: cssVar("--up"), wickDownColor: cssVar("--down"), borderVisible: false });
    CH.series.e20 = CH.chart.addLineSeries({ color: "#4fd1c5", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    CH.series.e50 = CH.chart.addLineSeries({ color: "#b48ef0", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    CH.series.eD = CH.chart.addLineSeries({ autoscaleInfoProvider: () => null, color: cssVar("--accent"), lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    CH.series.gU = CH.chart.addLineSeries({ autoscaleInfoProvider: () => null, color: cssVar("--up"), lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    CH.series.gD = CH.chart.addLineSeries({ autoscaleInfoProvider: () => null, color: cssVar("--down"), lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
  }
  CH.fit = null;
  if (!CH.autoTf && ((((DATA.state || {}).state || {}).pos))) { CH.autoTf = true; CH.tf = "15m"; document.querySelectorAll("#tfSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.tf === "15m"))); }
  await chartDraw();
  clearInterval(CH.timer); CH.timer = setInterval(() => { if (!document.hidden && CH.mode === "bot" && !$("v-chart").hidden) chartDraw(); }, 60000);
}

// ── indicator panes + hover legend (indicators.js, ported from OpenTerminal, MIT). Display only. ──
const IND = { on: { VOL: true, SMA20: false, SMA50: false, SMA200: false, VWAP: false, BOLL: false, RSI: false, MACD: false }, s: {}, last: null };
try { Object.assign(IND.on, JSON.parse(localStorage.getItem("deskbot.ind") || "{}")); } catch (_) { /* storage optional */ }
document.querySelectorAll("#indSeg button").forEach((b) => { b.setAttribute("aria-pressed", String(!!IND.on[b.dataset.ind])); b.addEventListener("click", () => {
  IND.on[b.dataset.ind] = !IND.on[b.dataset.ind]; b.setAttribute("aria-pressed", String(IND.on[b.dataset.ind])); try { localStorage.setItem("deskbot.ind", JSON.stringify(IND.on)); } catch (_) { /* optional */ }
  if (IND.last) drawIndicators(IND.last); }); });
const IND_STYLE = { SMA20: "#e3c14d", SMA50: "#5aa9e6", SMA200: "#d46bd6", VWAP: "#f2a93b", BOLL: "#8a9bb0" };
function drawIndicators(b) {
  if (!CH.chart || !globalThis.DeskIndicators) return; IND.last = b;
  const I = globalThis.DeskIndicators, c = b.map((x) => ({ time: sec(x.t), open: x.o, high: x.h, low: x.l, close: x.c, volume: +x.v || 0 }));
  const want = (k, make) => { if (IND.on[k] && !IND.s[k]) IND.s[k] = make(); if (!IND.on[k] && IND.s[k]) { [].concat(IND.s[k]).forEach((s) => CH.chart.removeSeries(s)); delete IND.s[k]; } return IND.s[k]; };
  const line = (color, opts = {}) => CH.chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...opts });
  const osc = ["RSI", "MACD"].filter((k) => IND.on[k]), paneH = 0.15, mainBottom = 0.04 + paneH * osc.length;
  CH.series.c.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: mainBottom + (IND.on.VOL ? 0.1 : 0) } });
  const v = want("VOL", () => CH.chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }));
  if (v) { CH.chart.priceScale("vol").applyOptions({ scaleMargins: { top: 1 - mainBottom - 0.12, bottom: mainBottom } }); v.setData(c.map((x) => ({ time: x.time, value: x.volume, color: x.close >= x.open ? "rgba(63,207,142,.35)" : "rgba(240,97,109,.35)" }))); }
  for (const [k, p] of [["SMA20", 20], ["SMA50", 50], ["SMA200", 200]]) { const s = want(k, () => line(IND_STYLE[k])); s && s.setData(I.sma(c, p)); }
  const vw = want("VWAP", () => line(IND_STYLE.VWAP, { lineStyle: 2 })); vw && vw.setData(I.vwap(c));
  const bb = want("BOLL", () => [line(IND_STYLE.BOLL), line(IND_STYLE.BOLL, { lineStyle: 2 }), line(IND_STYLE.BOLL)]); if (bb) { const r = I.bollinger(c); bb[0].setData(r.upper); bb[1].setData(r.middle); bb[2].setData(r.lower); }
  const pane = (k) => { const i = osc.indexOf(k); return { top: 1 - paneH * (osc.length - i) + 0.01, bottom: paneH * (osc.length - i - 1) }; };
  const rs = want("RSI", () => [line("#b48ef0", { priceScaleId: "rsi", lineWidth: 1.5 }), line("#67778a", { priceScaleId: "rsi", lineStyle: 2 }), line("#67778a", { priceScaleId: "rsi", lineStyle: 2 })]);
  if (rs) { CH.chart.priceScale("rsi").applyOptions({ scaleMargins: pane("RSI") }); const r = I.rsi(c); rs[0].setData(r); rs[1].setData(r.map((p) => ({ time: p.time, value: 70 }))); rs[2].setData(r.map((p) => ({ time: p.time, value: 30 }))); }
  const md = want("MACD", () => [CH.chart.addHistogramSeries({ priceScaleId: "macd", priceLineVisible: false, lastValueVisible: false }), line("#5aa9e6", { priceScaleId: "macd" }), line("#f2a93b", { priceScaleId: "macd" })]);
  if (md) { CH.chart.priceScale("macd").applyOptions({ scaleMargins: pane("MACD") }); const r = I.macd(c); md[0].setData(r.histogram.map((p) => ({ ...p, color: p.value >= 0 ? "rgba(63,207,142,.55)" : "rgba(240,97,109,.55)" }))); md[1].setData(r.macd); md[2].setData(r.signal); }
  if (!IND.hover) { IND.hover = true; CH.chart.subscribeCrosshairMove((p) => hoverLegend(p)); }
  hoverLegend(null);
}
function hoverLegend(p) {
  const el = $("hoverLegend"); if (!el || !IND.last) return;
  const bar = p && p.seriesData ? p.seriesData.get(CH.series.c) : null, src = IND.last, lastBar = src[src.length - 1];
  const o = bar ? bar : { open: lastBar.o, high: lastBar.h, low: lastBar.l, close: lastBar.c };
  const val = (s) => { if (!s) return null; const d = p && p.seriesData ? p.seriesData.get(s) : null; return d && isFinite(d.value) ? d.value : null; };
  const vol = p && p.time != null ? (src.find((x) => sec(x.t) === p.time) || {}).v : lastBar.v;
  const parts = [`O <b>${fmtPx(o.open)}</b>`, `H <b>${fmtPx(o.high)}</b>`, `L <b>${fmtPx(o.low)}</b>`, `C <b class="${o.close >= o.open ? "up" : "down"}">${fmtPx(o.close)}</b>`];
  if (vol != null) parts.push(`Vol <b>${(+vol).toLocaleString("en-US", { maximumFractionDigits: 1 })}</b>`);
  for (const k of ["SMA20", "SMA50", "SMA200", "VWAP"]) { const x = val(IND.s[k]); if (x != null) parts.push(`<span style="color:${IND_STYLE[k]}">${k}</span> <b>${fmtPx(x)}</b>`); }
  if (IND.s.RSI) { const x = val(IND.s.RSI[0]); if (x != null) parts.push(`<span style="color:#b48ef0">RSI</span> <b>${x.toFixed(1)}</b>`); }
  if (IND.s.MACD) { const x = val(IND.s.MACD[1]), y = val(IND.s.MACD[2]); if (x != null) parts.push(`MACD <b>${x.toFixed(2)}</b>${y != null ? ` sig <b>${y.toFixed(2)}</b>` : ""}`); }
  el.innerHTML = parts.join(" &nbsp;");
}

async function chartDraw() {
  const tf = CH.tf, book = BOOK, request = ++CH.request;
  try {
    const [main, day, h4] = await Promise.all([getBars(tf, tf === "1d" ? 400 : 500, book), getBars("1d", 200, book), getBars("4h", 120, book)]);
    if (request !== CH.request || book !== BOOK || tf !== CH.tf) return;
    $("lwMsg").hidden = true;
    const b = main.bars;
    CH.series.c.setData(b.map((x) => ({ time: sec(x.t), open: x.o, high: x.h, low: x.l, close: x.c })));
    drawIndicators(b);
    const e20 = emaArr(b, 20), e50 = emaArr(b, 50);
    CH.series.e20.setData(b.map((x, i) => ({ time: sec(x.t), value: e20[i] })).filter((p) => isFinite(p.value)));
    CH.series.e50.setData(b.map((x, i) => ({ time: sec(x.t), value: e50[i] })).filter((p) => isFinite(p.value)));
    // daily EMA50 (closed daily bars only, like the engine) stepped onto this timeframe
    const dClosed = day.bars.filter((x) => x.t + 864e5 <= Date.now()), eDarr = emaArr(dClosed, 50);
    const dayVal = (t) => { let v = NaN; for (let i = 0; i < dClosed.length; i++) { if (dClosed[i].t + 864e5 <= t) v = eDarr[i]; else break; } return v; };
    const eD = b.map((x) => ({ time: sec(x.t), value: dayVal(x.t + TFMS[tf]) })).filter((p) => isFinite(p.value));
    CH.series.eD.setData(eD); CH.series.gU.setData(eD.map((p) => ({ time: p.time, value: p.value / 0.97 }))); CH.series.gD.setData(eD.map((p) => ({ time: p.time, value: p.value / 1.03 })));
    // price lines: position + 4H Donchian 55 (closed 4H bars) + Asian range
    (CH.lines || []).forEach((l) => CH.series.c.removePriceLine(l)); CH.lines = [];
    const PL = (price, color, title, style = 0, w = 1) => { if (isFinite(price)) CH.lines.push(CH.series.c.createPriceLine({ price, color, lineWidth: w, lineStyle: style, axisLabelVisible: true, title })); };
    const S = (DATA.state || {}), st = S.state || {}, m = (S.last_run || {}).market || {}, p = st.pos;
    const h4c = h4.bars.filter((x) => x.t + 144e5 <= Date.now()), dc = donchianPrior(h4c.concat([{ h: NaN, l: NaN }]), 55);
    const last = b[b.length - 1].c, eDnow = eD.length ? eD[eD.length - 1].value : m.ema50D;
    const legend = [];
    if (dc) { PL(dc.hi, "#5aa9e6", "4H 55-bar high", 1); PL(dc.lo, "#5aa9e6", "4H 55-bar low", 1); }
    if (m.asian && tf !== "1d" && tf !== "4h") { PL(m.asian.hi, cssVar("--fg-3"), "Asian high", 3); PL(m.asian.lo, cssVar("--fg-3"), "Asian low", 3); }
    const dl = (((S.last_run || {}).desk || {}).chart || {}).levels || [];
    dl.filter((x) => x.blocks && Math.abs(x.px - b[b.length - 1].c) / b[b.length - 1].c < 0.04).forEach((x) => PL(x.px, x.side === "support" ? cssVar("--up") : cssVar("--down"), "agent: " + x.name, 2));
    if (p) { PL(p.entry, cssVar("--fg"), `${p.dir.toUpperCase()} entry`, 0, 2); PL(p.stop, cssVar("--down"), "Stop", 0, 2);
      [["tp1", "TP1"], ["tp2", "TP2"], ["tp3", "TP3"]].forEach(([k, t]) => PL(p[k], cssVar("--up"), t + (p[k + "Done"] ? " ✓" : ""), p[k + "Done"] ? 2 : 0)); }
    // markers: closed trades + open entry
    const times = b.map((x) => sec(x.t));
    const snapT = (ts) => { let lo = 0, hi = times.length - 1, a = -1; while (lo <= hi) { const md = (lo + hi) >> 1; if (times[md] <= ts) { a = md; lo = md + 1; } else hi = md - 1; } return a < 0 ? null : times[a]; };
    const mk = [];
    (DATA.trades || []).forEach((t) => { const o = sec(Date.parse(t.open_t)), c = sec(Date.parse(t.close_t)), L = t.dir === "long";
      mk.push({ time: snapT(o), position: L ? "belowBar" : "aboveBar", color: L ? cssVar("--up") : cssVar("--down"), shape: L ? "arrowUp" : "arrowDown", text: `${t.strategy}` });
      mk.push({ time: snapT(c), position: "inBar", color: +t.net >= 0 ? cssVar("--up") : cssVar("--down"), shape: "circle", text: sgnR(+t.r) }); });
    if (p) { const o = sec(p.openT); mk.push({ time: snapT(o), position: p.dir === "long" ? "belowBar" : "aboveBar", color: cssVar("--accent"), shape: p.dir === "long" ? "arrowUp" : "arrowDown", text: "OPEN " + p.strategy }); }
    // price-structure layers (fixed rules on closed candles, same module the edge function uses)
    const pal = zonePal(), read = DeskZones.zonesOf(b.map((x) => ({ t: sec(x.t), o: x.o, h: x.h, l: x.l, c: x.c, v: x.v }))), t0s = sec(b[0].t);
    CH.prims.forEach((q) => { try { CH.series.c.detachPrimitive(q); } catch (_) { /* already gone */ } }); CH.prims = [];
    CH.zlines.forEach((l) => CH.series.c.removePriceLine(l)); CH.zlines = [];
    const ZL = (price, color, title, style = 2) => { if (isFinite(price)) CH.zlines.push(CH.series.c.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: false, title })); };
    const boxes = DeskSetup.zoneBoxes(read, CH.layers, pal, (t) => snapT(t), t0s);
    if (CH.layers.trade && p) boxes.push(...DeskSetup.tradeBoxes(p, pal, (ms) => snapT(sec(ms))));
    boxes.forEach((bx) => { const q = new DeskSetup.Box(bx); CH.series.c.attachPrimitive(q); CH.prims.push(q); });
    if (CH.layers.value && read.value) { ZL(read.value.poc, "#e3c14d", "POC", 0); ZL(read.value.vah, "#e3c14d", "VAH", 3); ZL(read.value.val, "#e3c14d", "VAL", 3); }
    if (CH.layers.pd && read.range) { ZL(read.range.eq, cssVar("--fg-3"), `mid · ${read.range.zone}`, 1); }
    if (CH.layers.liq) read.pools.forEach((q) => ZL(q.px, "#b48ef0", q.kind + (q.swept ? " swept" : ""), 3));
    if (CH.layers.structure) read.structure.forEach((e) => mk.push({ time: snapT(e.t), position: e.side === "bull" ? "belowBar" : "aboveBar", color: e.side === "bull" ? "#4fd1c5" : "#d46bd6", shape: "square", text: e.kind + (e.side === "bull" ? "↑" : "↓") }));
    window.__zoneRead = read;
    const focusOn = !!(CH.layers.focus && p), fitKey = tf + (focusOn ? "+f" : "");
    if (focusOn) { const rec = b.slice(-80), R0 = Math.abs(p.entry - p.stop0), lo = Math.min(p.stop0 - 0.5 * R0, ...rec.map((x) => x.l)), hi = Math.max(p.tp3 + 0.5 * R0, ...rec.map((x) => x.h)); CH.series.c.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: lo, maxValue: hi } }) }); }
    else CH.series.c.applyOptions({ autoscaleInfoProvider: undefined });
    if (CH.fit !== fitKey) { CH.fit = fitKey; CH.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, b.length - (focusOn ? 80 : 150)), to: b.length + 12 }); }
    const t0 = sec(b[0].t); CH.series.c.setMarkers(mk.filter((x) => x.time != null && x.time >= t0).sort((a, z) => a.time - z.time));
    // legend
    legend.push(["#f2a93b", "Daily EMA50 (regime line)", "$" + fmtPx(eDnow)], [cssVar("--up"), "+3% EMA distance reference", "$" + fmtPx(eDnow / 0.97)], [cssVar("--down"), "−3% EMA distance reference", "$" + fmtPx(eDnow / 1.03)]);
    if (dc) legend.push(["#5aa9e6", "4H 55-bar high / low (breakout triggers)", "$" + fmtPx(dc.hi) + " / $" + fmtPx(dc.lo)]);
    legend.push(["#4fd1c5", `EMA20 (${tf})`, "$" + fmtPx(e20[e20.length - 1])], ["#b48ef0", `EMA50 (${tf})`, "$" + fmtPx(e50[e50.length - 1])]);
    if (p) legend.push([cssVar("--fg"), `Open ${p.dir} (${nameOf(p.strategy)})`, `entry $${fmtPx(p.entry)} · stop $${fmtPx(p.stop)}`]);
    $("legend").innerHTML = legend.map(([c, k, v]) => `<div><i style="background:${c}"></i><span class="muted">${esc(k)}</span><span>${esc(v)}</span></div>`).join("");
    $("chartNote").textContent = `Reaction areas from fixed rules on closed candles (FVG, IFVG, order blocks, value area, premium/discount), not forecasts. Trade boxes show the bot's recorded plan. Reference indicators use the displayed feed while reported positions use the runner feed; these can differ. Candles: ${main.src} ${BOOK === "GOLD" ? "PAXG (gold)" : "BTC"} · refreshed ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;
    // the bot's read, in words
    const d = (last - eDnow) / last, rd = [];
    rd.push(`<div>Price is <b>${pct(d)}</b> from the displayed daily EMA50. The ±3% lines are reference overlays, not entry approval. Consult each strategy's reported decision and configuration.</div>`);
    if (dc) rd.push(`<div>Reference 4H 55-bar range: <b>$${fmtPx(dc.lo)}–$${fmtPx(dc.hi)}</b>. The configured breakout lookback may differ.</div>`);
    if (p) rd.push(`<div>Managing an open <b>${p.dir}</b>: ${p.tp1Done ? "TP1 taken, " : ""}stop $${fmtPx(p.stop)}, next target $${fmtPx(!p.tp1Done ? p.tp1 : !p.tp2Done ? p.tp2 : p.tp3)}.</div>`);
    const nw = (S.last_run || {}).news; if (nw) rd.push(`<div>News risk <b>${esc(nw.risk)}</b> (${esc(String(nw.by || "").startsWith("ai:") ? "AI" : "keyword rules")}, ${esc(nw.mode)} mode): ${esc(nw.reason)}</div>`);
    $("botRead").innerHTML = rd.join("");
    renderSetupCard(p, S);
  } catch (e) { if (request !== CH.request || book !== BOOK || tf !== CH.tf) return; renderSetupCard(((DATA.state || {}).state || {}).pos, DATA.state); $("lwMsg").hidden = false; $("lwMsg").textContent = "Couldn't load candles here (" + (e && e.message || "network") + "). Retry when the candle source is reachable."; }
}

async function renderSetupCard(p, S) {
  const el = $("setupCard"), pal = zonePal(), nm = (BOOK === "GOLD" ? "Gold (PAXG)" : "BTC");
  if (!p) { el.innerHTML = `<div class="setup-head"><h2>Trade setup</h2></div><p class="note" style="margin-top:6px">No open ${nm} trade. When the bot enters, the setup appears here: entry, red stop-loss block, green take-profit blocks and the structure checks that agree with the trade. Reaction areas on the chart below show where the rules would care.</p>`; return; }
  let conf = null, why = "";
  try {
    const m15 = (await getBars("15m", 500)).bars.filter((x) => x.t + 9e5 <= p.openT).map((x) => ({ t: sec(x.t), o: x.o, h: x.h, l: x.l, c: x.c, v: x.v }));
    conf = DeskZones.confluence(DeskZones.zonesOf(m15), { dir: p.dir, entry: p.entry, stop: p.stop0, tp1: p.tp1, tp2: p.tp2, tp3: p.tp3 });
  } catch (e) { why = "Could not load 15m candles to check structure at entry."; }
  const R = Math.abs(p.entry - p.stop0), rr = (x) => (Math.abs(x - p.entry) / R).toFixed(2), d = p.dir === "long" ? 1 : -1;
  el.innerHTML = `<div class="setup-head"><span class="side ${p.dir}">${p.dir.toUpperCase()}</span><h2>${esc(nameOf(p.strategy))} · ${nm}</h2><span class="note" style="margin-left:auto">PAPER · opened ${ago(p.openT)}</span></div>
    <div class="setup-grid"><div class="setup-svg">${DeskSetup.setupSVG(p, pal, fmtPx)}</div>
    <div><div class="grid2"><div><div class="k">Entry</div><div class="v">${fmtPx(p.entry)}</div></div><div><div class="k">Stop loss (original)</div><div class="v down">${fmtPx(p.stop0)} · −1R</div></div>
    <div><div class="k">Take profits</div><div class="v up">${fmtPx(p.tp1)} · ${fmtPx(p.tp2)} · ${fmtPx(p.tp3)}</div></div><div><div class="k">Reward at TP1 / TP2 / TP3</div><div class="v">${rr(p.tp1)}R / ${rr(p.tp2)}R / ${rr(p.tp3)}R</div></div>
    <div><div class="k">Risk</div><div class="v">${fmt$(p.riskAmt)} · ${fmtPx(R)} pts</div></div><div><div class="k">Size</div><div class="v">${(+p.originalQty).toFixed(5)} ${BOOK === "GOLD" ? "oz" : "BTC"}</div></div></div>
    ${conf ? `<h3 style="margin:14px 0 0;font:600 13px var(--f-display)">Structure checks at entry: ${conf.met} of ${conf.of} agree</h3><p class="note faint" style="margin:2px 0 0">A count of rule items on 15m candles at the time of entry. It is not a win probability.</p>${DeskSetup.checksHTML(conf)}` : `<p class="note">${esc(why)}</p>`}
    <p class="note" style="margin-top:10px"><b>Why the bot took it:</b> ${(p.why || []).map(esc).join(" · ") || "—"}</p></div></div>`;
}
async function showTV() {
  $("lwBox").hidden = true; $("tvBox").hidden = false;
  if (CH.tvLoaded) return;
  try {
    await loadScript("https://s3.tradingview.com/tv.js");
    new window.TradingView.widget({ autosize: true, symbol: (BOOK_META[BOOK] || BOOK_META.BTC).tv, interval: { "15m": "15", "1h": "60", "4h": "240", "1d": "D" }[CH.tf], timezone: "Etc/UTC",
      theme: "light", style: "1", allow_symbol_change: true, hide_side_toolbar: false, withdateranges: true, studies: ["MAExp@tv-basicstudies"], container_id: "tvw" });
    CH.tvLoaded = true; $("tvMsg").hidden = true;
  } catch (e) { $("tvMsg").textContent = "TradingView can't load inside this viewer. Open the live dashboard on Vercel for the full TradingView chart."; }
}
document.querySelectorAll("#tfSeg button").forEach((bt) => bt.addEventListener("click", () => {
  CH.tf = bt.dataset.tf; document.querySelectorAll("#tfSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === bt)));
  if (CH.mode === "tv") { CH.tvLoaded = false; $("tvw").innerHTML = ""; showTV(); } else chartShow();
}));
document.querySelectorAll("#chartMode button").forEach((bt) => bt.addEventListener("click", () => {
  CH.mode = bt.dataset.m; document.querySelectorAll("#chartMode button").forEach((x) => x.setAttribute("aria-pressed", String(x === bt))); chartShow();
}));

renderAll();
let startTab = (location.hash || "").slice(1);
if (!VIEWS.includes(startTab)) { try { startTab = localStorage.getItem("db5tab") || "tower"; } catch (e) { startTab = "tower"; } }
show(startTab);

// ── live data through the viewer's Supabase connector (read-only query) ──
const Q = `select json_build_object(
 'state', (select row_to_json(s) from (select state - 'carried' as state, state->'carried' carried, last_run, updated_at from dbv5_state where id='main') s),
 'events', (select coalesce(json_agg(e),'[]') from (select ts,kind,strategy,msg from dbv5_events where kind <> 'SKIP' or ts > now() - interval '30 minutes' order by id desc limit 40) e),
 'trades', (select coalesce(json_agg(t),'[]') from (select strategy,dir,entry,exit_avg,net,r,reason,open_t,close_t from dbv5_trades order by close_t desc limit 60) t),
 'curve', (select coalesce(json_agg(c order by ts),'[]') from (select ts, equity, price from dbv5_equity where ts > now() - interval '14 days' and (extract(minute from ts)::int % 30 < 5 or ts > now() - interval '1 day')) c),
 'bt', (select row_to_json(b) from (select results->>'label' label, ran_at, results->'combined'->'all' a, results->'combined'->'by' "by", results->'combined'->>'maxDD' mdd, results->'combined'->>'endEquity' eq, results->>'from' f, results->>'to' t, results->'curve' curve from dbv5_backtests where results->>'label' like 'LIVE_CONFIG%' order by id desc limit 1) b),
 'now', now()) as d`;

function parseRows(res) {
  const p = res && (res.payload !== undefined ? res.payload : res);
  let text = typeof p === "string" ? p : (p && typeof p.result === "string" ? p.result : null);
  if (text == null && Array.isArray(p)) return p;
  if (text == null && res && Array.isArray(res.content)) text = res.content.map((c) => c.text || "").join("\n");
  if (text == null) return null;
  const m = text.match(/<untrusted-data-[^>]*>\s*([\s\S]*?)\s*<\/untrusted-data-/);
  const body = m ? m[1] : text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  try { return JSON.parse(body); } catch (e) { return null; }
}

const LIVE_URL = "https://deskbot-azure.vercel.app";
const API = "https://xevymbzgpcsdhygswxlk.supabase.co/functions/v1/deskbot-v5";
function fromApi(g) {
  RAW = g;
  const bk = g.books && g.books.GOLD;
  $("bookSeg").hidden = false;
  document.querySelectorAll("#bookSeg button").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.b === BOOK)); if (b.dataset.b === "GOLD") b.title = bk && bk.state ? "" : "Gold book not started yet"; });
  const gold = BOOK === "GOLD";
  if (gold && !bk?.state) return { ...SNAP, state:{}, bt:null };
  const sym = gold ? "GOLD" : "BTC", mine = (x) => (x.symbol || "BTC") === sym;
  const st = (gold ? bk.state : g.state) || {}, r = !gold && g.backtest && g.backtest.results;
  return {
    state: { state: st, carried: st.carried, integrity: gold ? bk.integrity : g.integrity, last_run: gold ? bk.lastRun : g.lastRun, updated_at: gold ? bk.updated : g.updated },
    events: (g.events || []).filter((e) => mine(e) && (e.kind !== "SKIP" || Date.now() - new Date(e.ts).getTime() < 1800000)).slice(0, 40),
    agents: (g.agents || []).filter(mine).slice(0, 30),
    trades: (g.trades || []).filter(mine), curve: (gold ? bk.curve : g.curve) || [],
    bt: r && /^LIVE_CONFIG/.test(r.label || "") ? { label: r.label, ran_at: g.backtest.ran_at, a: r.combined.all, by: r.combined.by, mdd: r.combined.maxDD, eq: r.combined.endEquity, f: r.from, t: r.to, curve: r.curve } : null,
  };
}
let mcp = null, busy = false, directOK = false;
async function pullDirect() {
  try {
    const r = await fetch(API, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("status unavailable");
    const d = fromApi(await r.json());
    if (!d.state.state || !d.state.updated_at) throw new Error("status incomplete");
    DATA = d; LIVE = true; renderAll(); $("srcBanner").hidden = true; return true;
  } catch (e) {
    LIVE = false; renderAll(); $("srcBanner").hidden = false;
    $("srcBanner").textContent = "Disconnected from public status. Previously received values may be stale; empty fields mean no data has been received.";
    return false;
  }
}
async function pull() {
  if (directOK || !mcp) { directOK = await pullDirect(); if (directOK || !mcp) return; }
  if (busy) return; busy = true;
  try {
    const res = await mcp.callTool("Supabase", "execute_sql", { project_id: PROJECT, query: Q });
    const rows = parseRows(res);
    const d = rows && rows[0] && (typeof rows[0].d === "string" ? JSON.parse(rows[0].d) : rows[0].d);
    if (d && d.state) {
      DATA = d; RAW = null; LIVE = true; renderAll();
      $("srcBanner").hidden = true;
    } else throw { code: "parse" };
  } catch (err) {
    LIVE = false; renderAll();
    const code = err && err.code;
    const msg = code === "needs_reauth" ? "Reconnect Supabase in claude.ai Settings → Connectors to see live numbers."
      : code === "server_not_connected" ? "Add the Supabase connector in claude.ai Settings → Connectors to see live numbers."
      : code === "not_in_manifest" || code === "approval_required" ? "Live numbers need your OK to read Supabase. Tap Refresh on the System tab to allow it."
      : code === "server_unavailable" ? "Supabase didn't answer just now. Showing the last numbers; it retries every minute."
      : "Couldn't load live numbers. Previously received values may be stale.";
    $("srcBanner").hidden = false; $("srcBanner").textContent = msg;
  } finally { busy = false; }
}

$("refBtn").addEventListener("click", () => pull());
$("runBtn").addEventListener("click", async () => {
  const b = $("runBtn"); b.disabled = true; $("runMsg").textContent = "Asking the cloud bot to run a check…";
  try {
    if (!mcp) { mcp = window.claude && window.claude.use ? await window.claude.use("mcp") : null; if (!mcp) throw { code: "no_connector" }; }
    await mcp.callTool("Supabase", "execute_sql", { project_id: PROJECT, query: `select public.dbv5_invoke('{"action":"run"}'::jsonb) as request_id` });
    setTimeout(async () => { await pull(); $("runMsg").textContent = "Run requested. A queue acknowledgement does not prove completion; inspect the reported run timestamp."; b.disabled = false; }, 6000);
  } catch (e) { $("runMsg").textContent = "The check didn't start (" + ((e && e.code) || "error") + "). The schedule keeps running regardless."; b.disabled = false; }
});

(async () => {
  directOK = await pullDirect();
  if (!directOK) {
    try { mcp = window.claude && window.claude.use ? await window.claude.use("mcp") : null; } catch (e) { mcp = null; }
    if (mcp) await pull();
    else $("srcBanner").textContent = "Public account status is disconnected. Values remain empty until data is received.";
    if (mcp && !LIVE) {
      $("srcBanner").innerHTML = 'Public account status is disconnected. <button class="btn primary" id="connectBtn" type="button" style="margin-top:8px">Connect live data</button> or <a href="' + LIVE_URL + '" target="_blank" rel="noopener">open the live dashboard ↗</a>';
      $("connectBtn").addEventListener("click", async () => {
        try { const perm = await window.claude.use("permissions"); if (perm) await perm.request(["mcp:Supabase"]); } catch (e) {}
        await pull();
      });
    }
  }
  setInterval(() => { if (!document.hidden) pull(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
  setInterval(() => { if (!document.hidden) { renderDesk(); renderSystem(); } }, 10000);
})();

// ---- AI chat (talks to the cloud bot's free-LLM assistant; proposals need Backtest + Apply) ----
const CHAT = { hist: [], busy: false };
// Owner credential stays in page memory. Remove the legacy persistent copy.
try { localStorage.removeItem("deskbot_chat_pw"); } catch {}
let chatPw = "";
function chatAdd(cls, html) { const d = document.createElement("div"); d.className = "msg " + cls; d.innerHTML = html; $("chatLog").appendChild(d); $("chatLog").scrollTop = 1e9; return d; }
function pwUI() { $("pwRow").hidden = !!chatPw; }
async function chatCall(body) {
  if (!chatPw) { $("pwRow").hidden = false; throw { code: "no_pw" }; }
  const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "x-chat-key": chatPw }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ ok: false, error: "HTTP " + r.status }));
  if (r.status === 401) { chatPw = ""; pwUI(); throw { code: "bad_password" }; }
  return j;
}
const chatErr = (e) => e && e.code === "bad_password" ? "Wrong chat password, or DESKBOT_CHAT_KEY isn't set in Supabase yet. Enter it again below."
  : e && e.code === "no_pw" ? "Enter the chat password first (the value you set as DESKBOT_CHAT_KEY in Supabase)."
  : "Couldn't reach the bot just now. Try again in a moment.";
function propCard(p) {
  const d = chatAdd("a prop", `<b>Proposed change</b> <span class="muted">(not applied)</span><pre>${esc(JSON.stringify(p.patch, null, 1))}</pre><div class="muted">${esc(p.why || "")}</div>
    <div class="row"><button class="btn" data-a="bt" type="button">Backtest 180d</button><button class="btn primary" data-a="ap" type="button">Apply</button></div><div class="res"></div>`);
  d.querySelector('[data-a="bt"]').onclick = async (ev) => {
    const b = ev.target; b.disabled = true; d.querySelector(".res").innerHTML = '<div class="muted" style="margin-top:6px">Backtesting current vs proposed on 180 days of Binance candles (≈30–60 s)…</div>';
    try {
      const r = await chatCall({ action: "chat_backtest", patch: p.patch, days: 180 });
      if (!r.ok) throw { msg: (r.errors || [r.error]).join("; ") };
      const row = (k, x) => `<tr><td>${k}</td><td>${x.trades}</td><td class="${x.expR >= 0 ? "up" : "down"}">${x.expR >= 0 ? "+" : ""}${x.expR.toFixed(3)}R</td><td>${isFinite(x.pf) ? x.pf.toFixed(2) : "∞"}</td><td>$${x.endEquity.toFixed(0)}</td><td>${(x.maxDD * 100).toFixed(1)}%</td></tr>`;
      const better = r.proposed.endEquity > r.current.endEquity && r.proposed.maxDD <= r.current.maxDD * 1.25;
      d.querySelector(".res").innerHTML = `<table><tr><th></th><th>trades</th><th>avg</th><th>PF</th><th>$1000→</th><th>maxDD</th></tr>${row("Current", r.current)}${row("Proposed", r.proposed)}</table>
        <div class="${better ? "up" : "muted"}" style="margin-top:6px">${better ? "Proposed did better on this window. Still one window — weigh it before applying." : "Proposed did not clearly beat the current setup on this window."}</div>`;
    } catch (e) { d.querySelector(".res").innerHTML = `<div class="down" style="margin-top:6px">${esc(e.msg || chatErr(e))}</div>`; }
    b.disabled = false;
  };
  d.querySelector('[data-a="ap"]').onclick = async (ev) => {
    const b = ev.target; b.disabled = true;
    try {
      const r = await chatCall({ action: "chat_apply", patch: p.patch, why: p.why });
      if (!r.ok) throw { msg: r.reply || (r.errors || [r.error]).join("; ") };
      d.querySelector(".row").innerHTML = '<span class="up">Applied. The bot uses it from its next 5-minute run.</span> <button class="btn" type="button" data-a="un">Undo</button>';
      d.querySelector('[data-a="un"]').onclick = async (e2) => { e2.target.disabled = true; try { const u = await chatCall({ action: "chat_undo" }); d.querySelector(".row").innerHTML = u.ok ? '<span class="muted">Undone — previous config restored.</span>' : `<span class="down">${esc(u.error)}</span>`; } catch (e) { e2.target.disabled = false; } };
      pull();
    } catch (e) { b.disabled = false; d.querySelector(".res").innerHTML = `<div class="down" style="margin-top:6px">${esc(e.msg || chatErr(e))}</div>`; }
  };
}
async function chatSend(text) {
  text = (text || "").trim(); if (!text || CHAT.busy) return;
  CHAT.busy = true; $("chatSend").disabled = true; $("chatIn").value = "";
  chatAdd("u", esc(text));
  const wait = chatAdd("a", '<span class="muted">Thinking…</span>');
  try {
    const r = await chatCall({ action: "chat", message: text, history: CHAT.hist.slice(-8) });
    wait.innerHTML = esc(r.reply || r.error || "No answer.") + (r.by ? `<span class="by">${esc(r.by)}</span>` : "");
    if (r.ok) { CHAT.hist.push({ role: "user", content: text }, { role: "assistant", content: r.reply }); if (r.proposal) propCard(r.proposal); }
    if (r.proposalErrors) chatAdd("sys", "The AI suggested a change that isn't allowed, so it was dropped: " + esc(r.proposalErrors.join("; ")));
  } catch (e) { wait.className = "msg sys"; wait.textContent = chatErr(e); }
  CHAT.busy = false; $("chatSend").disabled = false;
}
function chatOpen(open) {
  $("chat").hidden = !open;
  document.dispatchEvent(new CustomEvent("desk:chat",{detail:{open}})); $("chatFab").hidden = open; $("chatFab").setAttribute("aria-expanded", String(open));
  if (open && !$("chatLog").children.length) chatAdd("sys", "Ask about trades, skips, strategies or settings. It reads the live bot. If it suggests a change, you can backtest it and only you can press Apply. It can't touch leverage, the daily loss limit, risk per trade or paper mode, and it can't place orders.");
  if (open) { pwUI(); setTimeout(() => $(chatPw ? "chatIn" : "chatPw").focus(), 50); }
}
$("chatFab").onclick = () => chatOpen(true);
$("chatX").onclick = () => chatOpen(false);
$("pwSave").onclick = () => { chatPw = $("chatPw").value.trim(); $("chatPw").value = ""; pwUI(); $("chatIn").focus(); };
$("chatPw").addEventListener("keydown", (e) => { if (e.key === "Enter") $("pwSave").click(); });
$("chatSend").onclick = () => chatSend($("chatIn").value);
$("chatIn").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatSend($("chatIn").value); } });
$("chatChips").addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") chatSend(e.target.textContent); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("chat").hidden) chatOpen(false); });

$("bookSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || b.dataset.b === BOOK) return;
  const bk = RAW && RAW.books && RAW.books.GOLD;
  if (b.dataset.b === "GOLD" && !(bk && bk.state)) { $("srcBanner").hidden = false; $("srcBanner").textContent = "The gold paper book hasn't started yet."; return; }
  BOOK = b.dataset.b; try { localStorage.setItem("deskbot_book", BOOK); } catch (err) {}
  if (RAW) { DATA = fromApi(RAW); renderAll(); }
  CH.tvLoaded = false; $("tvw").innerHTML = ""; if (!$("v-chart").hidden) chartShow();
});


// Read-only navigation and review tools. No new mutation endpoints.
$("globalRefresh").addEventListener("click", () => pull());
$("strategySearch").addEventListener("input",renderStrategies);
$("tradeSearch").addEventListener("input",renderTrades);
$("strategyFilter").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;strategyFilter=b.dataset.filter;document.querySelectorAll("#strategyFilter button").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));renderStrategies();});
document.querySelector(".sidebar-brand").addEventListener("click",e=>{e.preventDefault();show("desk");});
document.querySelector('[role="tablist"]').addEventListener("keydown",e=>{const keys=["ArrowRight","ArrowDown","ArrowLeft","ArrowUp","Home","End"];if(!keys.includes(e.key))return;const tabs=[...document.querySelectorAll(".tab")],i=tabs.indexOf(document.activeElement);if(i<0)return;e.preventDefault();let j=e.key==="Home"?0:e.key==="End"?tabs.length-1:(i+(["ArrowRight","ArrowDown"].includes(e.key)?1:-1)+tabs.length)%tabs.length;tabs[j].focus();show(tabs[j].dataset.v);});
window.addEventListener("hashchange",()=>show(location.hash.slice(1)));
$("exportTrades").addEventListener("click",()=>{
 const q=($("tradeSearch").value||"").toLowerCase(),rows=(DATA.trades||[]).filter(x=>(x.strategy+" "+x.reason+" "+x.dir).toLowerCase().includes(q));
 if(!rows.length){$("srcBanner").hidden=false;$("srcBanner").textContent="No matching returned trades to export.";return;}
 const keys=["symbol","strategy","dir","entry","exit_avg","net","r","fees","funding","open_t","close_t","reason"];
 const cell=v=>'"'+(typeof v==="string"?v.replace(/^(\s*[=+@-])/ ,"'$1"):String(v??"")).replaceAll('"','""')+'"';
 const csv=[keys.join(","),...rows.map(r=>keys.map(k=>cell(k==="symbol"?r.symbol||BOOK:r[k])).join(","))].join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download="deskbot-"+BOOK.toLowerCase()+"-returned-paper-trades.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

$("setupSearch").addEventListener("input",()=>renderSetupRadar());
$("setupFamily").addEventListener("change",()=>renderSetupRadar());
