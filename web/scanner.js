// Scanner and Committee views. Display only: reads the public status payload (scan, agents, state, config) and draws it.
// Scanner: the bot's own rules run on every Hyperliquid market every 15 minutes, plus Deribit options/futures context.
// Committee: the TradingAgents-structured review of each new paper trade (analysts → debate → research manager → trader →
// risk debate → portfolio manager), shown stage by stage. Trading state: Nautilus Trader's ACTIVE / REDUCING / HALTED idea,
// derived here from controls the bot already has; it adds no new control.
(function (root) {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (x, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
  const px = (x) => (typeof x === 'number' ? num(x, x >= 1000 ? 1 : x >= 1 ? 3 : 5) : '—');
  const sgn = (x, d = 2, u = '%') => (typeof x === 'number' && Number.isFinite(x) ? `<span class="${x > 0 ? 'up' : x < 0 ? 'down' : ''}">${x > 0 ? '+' : ''}${num(x, d)}${u}</span>` : '—');
  const ago = (iso, now) => { const m = Math.round((now - Date.parse(iso)) / 60000); return !Number.isFinite(m) ? '—' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

  /** ACTIVE: new entries allowed. REDUCING: new entries blocked by a risk control, open positions still managed. HALTED: the book is not running. */
  function tradingState(state, config, lastRun, now) {
    if (!state) return { state: 'HALTED', reasons: ['book not initialised'] };
    const reasons = [], cfg = config || {}, runAt = lastRun && Date.parse(lastRun.ts);
    if (!runAt || now - runAt > 20 * 60e3) return { state: 'HALTED', reasons: [`no run for ${runAt ? Math.round((now - runAt) / 60e3) + ' min' : 'ever'}`] };
    if (lastRun.integrity && lastRun.integrity.ok === false) return { state: 'HALTED', reasons: ['configuration integrity check failed'] };
    const cb = state.cb || {}, day = state.day || {};
    if (cb.cooldownUntil > now) reasons.push(`circuit-breaker cooldown until ${new Date(cb.cooldownUntil).toISOString().slice(11, 16)} UTC`);
    const lim = cfg.DAILY_LOSS_LIMIT, eq = state.markedEquity ?? state.equity;
    if (day.halted || (lim && day.startEquity && eq <= day.startEquity * (1 - lim))) reasons.push('daily loss limit hit');
    if (cfg.MAX_TRADES_PER_DAY && day.trades >= cfg.MAX_TRADES_PER_DAY) reasons.push('daily trade cap reached');
    const en = state.enabled || {}; if (Object.keys(en).length && Object.values(en).every((v) => v === false)) reasons.push('every strategy auto-disabled');
    return reasons.length ? { state: 'REDUCING', reasons } : { state: 'ACTIVE', reasons: ['new entries allowed by every risk control'] };
  }

  const STAGES = [
    ['desk-checks', 'Pre-trade checks', 'rules'], ['desk-analysts', 'Analyst team', 'market · sentiment · positioning · news'],
    ['desk-bull', 'Bull researcher', 'argues for'], ['desk-bear', 'Bear researcher', 'argues against'], ['desk-research', 'Research manager', 'judges the debate'],
    ['desk-trader', 'Trader', 'take or pass'], ['desk-risk-aggressive', 'Aggressive risk', ''], ['desk-risk-conservative', 'Conservative risk', ''], ['desk-risk-neutral', 'Neutral risk', ''],
    ['desk-pm', 'Portfolio manager', 'final rating (scored in FILTER-1)'],
  ];
  /** Group agent-log rows by trade ref, newest first; a debate with several rounds keeps every speech in order. */
  function committees(agents) {
    const by = new Map();
    for (const a of (agents || []).slice().reverse()) {   // agents arrive newest first
      const ref = a.output && a.output.ref; if (!ref || !STAGES.some((s) => s[0] === a.agent)) continue;
      if (!by.has(ref)) by.set(ref, { ref, symbol: a.symbol, ts: a.ts, rows: [] });
      const c = by.get(ref); c.rows.push(a); c.ts = a.ts;
    }
    return [...by.values()].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  }

  function stageBody(a) {
    const o = a.output || {};
    if (a.error) return `<p class="cm-err">${esc(a.error)}</p>`;
    if (a.agent === 'desk-checks') return `<ul class="cm-l">${(o.checks || []).map((c) => `<li class="${c.level}">${esc(c.text || c.id)}</li>`).join('') || '<li>no findings</li>'}</ul>`;
    if (a.agent === 'desk-analysts') {
      const m = o.market || {}, s = o.sentiment || {}, p = o.positioning || {}, n = o.news || {};
      return `<div class="cm-kv"><span>Market</span><b>${esc(m.regime)} · trend ${m.supertrend_up_frames ?? 0}↑ ${m.supertrend_down_frames ?? 0}↓ · RSI15 ${esc(m.rsi15 ?? '—')} · VWAP ${esc(m.vwap_dev_sigma ?? '—')}σ</b>
        <span>Sentiment</span><b>fear/greed ${esc(s.fear_greed ?? '—')} · 24h flow ${esc(s.order_flow_24h_imbalance ?? '—')}</b>
        <span>Positioning</span><b>funding ${esc(p.funding_per_interval ?? '—')} · OI ${esc(p.open_interest ?? '—')}</b>
        <span>News</span><b>${esc(n.risk ?? '—')}${n.reason ? ' · ' + esc(n.reason) : ''}</b></div>`;
    }
    if (o.rating) return `<div class="cm-rate r-${esc(o.rating)}">${esc(o.rating)}${o.stance ? ` <small>→ ${esc(o.stance)} the ${esc(o.direction)}</small>` : ''}</div><p>${esc(o.rationale || o.executive_summary || '')}</p>${o.thesis ? `<p class="faint">${esc(o.thesis)}</p>` : ''}${o.would_change_my_mind ? `<p class="faint">Would change my mind: ${esc(o.would_change_my_mind)}</p>` : ''}`;
    if (o.action) return `<div class="cm-rate ${o.action === 'take' ? 'r-Buy' : 'r-Sell'}">${esc(o.action.toUpperCase())}</div><p>${esc(o.reason)}</p><p class="faint">${esc(o.execution_note)}</p>`;
    if (o.argument) return `<p>${esc(o.argument)}</p><p class="faint">Strongest point: ${esc(o.strongest_point)}</p>`;
    return '<p class="faint">recorded</p>';
  }
  function renderCommittee(el, agents, providers) {
    if (!el) return;
    const cs = committees(agents);
    const head = `<p class="mk-note">Advisory only: these agents cannot open, size or close anything. The LLM seats are filled only when the owner adds a free GROQ_API_KEY or GEMINI_API_KEY as a Supabase Edge Function secret; ${providers && providers.length ? `<b>configured: ${esc(providers.join(', '))}</b>` : '<b>none configured now, so only the rule-based stages run</b>'}. Structure adapted from TradingAgents (Apache-2.0).</p>`;
    if (!cs.length) { el.innerHTML = head + '<div class="card"><p>No paper entry has been reviewed in the loaded window yet. The committee convenes on the next entry the rules take.</p></div>'; return; }
    el.innerHTML = head + cs.slice(0, 6).map((c, i) => {
      const pm = c.rows.find((r) => r.agent === 'desk-pm' && !r.error), stance = pm && pm.output.stance;
      return `<details class="card cm" ${i === 0 ? 'open' : ''}><summary><b>${esc(c.ref)}</b><span>${esc(c.symbol || '')}</span><span class="faint">${esc(String(c.ts).slice(0, 16).replace('T', ' '))} UTC</span>${pm ? `<span class="cm-rate r-${esc(pm.output.rating)}">${esc(pm.output.rating)} · ${esc(stance)}</span>` : '<span class="faint">no final rating</span>'}</summary>
        <ol class="cm-flow">${c.rows.map((a) => { const s = STAGES.find((x) => x[0] === a.agent); return `<li class="${a.error ? 'err' : ''}"><div class="cm-h"><b>${esc(s[1])}</b><small>${esc(s[2])}${a.provider ? ' · ' + esc(a.provider) : ''}${a.ms ? ' · ' + a.ms + ' ms' : ''}</small></div>${stageBody(a)}</li>`; }).join('')}</ol></details>`;
    }).join('');
  }

  function renderScan(el, scan, now, track) {
    if (!el) return;
    if (!scan) { el.innerHTML = '<div class="card"><p>No scan recorded yet. The scanner runs every 15 minutes once backend v20 is live.</p></div>'; return; }
    const ms = (scan.markets || []), setups = ms.filter((m) => m.ok && m.setups && m.setups.length);
    const rows = ms.map((m) => !m.ok ? `<tr><td>${esc(m.sym)}</td><td colspan="8" class="faint">${esc(m.error)}</td></tr>` :
      `<tr class="${m.book ? 'book' : ''}"><td><b>${esc(m.sym)}</b>${m.book ? ' <span class="bk">BOOK</span>' : ''}</td><td class="r">${px(m.price)}</td><td class="r">${sgn(m.chg24h)}</td><td>${esc(m.regime)}</td><td>${esc(m.trend)}</td><td class="r">${num(m.rsi15, 0)}</td><td class="r hide-s">${num(m.atr15Pct, 2)}%</td><td class="r hide-s">${m.funding == null ? '—' : sgn(m.funding * 100, 4)}</td>
       <td>${m.setups.length ? m.setups.map((g) => `<span class="sc-set ${g.dir}">${esc(g.dir.toUpperCase())} ${esc(g.strategy)}</span>`).join(' ') : `<span class="faint">${esc(((m.blocked || [])[0] || {}).reason || 'no rule fired')}</span>`}</td></tr>`).join('');
    const cards = setups.flatMap((m) => m.setups.map((g) => `<div class="sc-card ${g.dir}"><div><b>${esc(m.sym)}</b> <span class="sc-set ${g.dir}">${esc(g.dir.toUpperCase())}</span> ${esc(g.strategy)}${m.book ? '' : ' <small class="faint">untested market</small>'}</div>
      <div class="cm-kv"><span>Entry ref</span><b>${px(g.entry)}</b><span>Stop</span><b>${px(g.stop)} (${num(g.stopPct, 2)}%)</b><span>Rule score</span><b>${num(g.score, 2)} <small class="faint">heuristic, not a probability</small></b></div>
      <ul class="cm-l">${(g.why || []).map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`)).join('');
    const recs = Object.fromEntries(((track && track.calls) || []).map((c) => [c.sym, c]));
    const order = [...ms].sort((a, b) => byBoard(a, b));
    el.innerHTML = `<div class="bd-head"><span><b>${ms.length} markets</b> checked ${esc(ago(scan.ts, now))}</span><span class="faint">every 15 min · calls are rule-based leans for the next 4 h, scored afterwards</span></div>
      <div class="bd-grid">${order.map((m) => boardCard(m, recs[m.sym])).join('')}</div>
      ${cards ? `<h3 class="bd-sub">Rules firing now</h3><div class="sc-cards">${cards}</div>` : ''}
      <details class="bd-more"><summary>Details: call record, setup record, options &amp; futures, all indicators</summary>
        ${callPanel(track)}
        ${trackPanel(track)}
        <div class="mk-grid">${(scan.deriv || []).map(derivPanel).join('')}</div>
        <section class="card mk-panel"><div class="mk-h"><b>ALL MARKETS</b><span class="mk-sub">indicators per market</span></div><div class="mk-body"><table class="mk-t"><thead><tr><th>Market</th><th class="r">Price</th><th class="r">24h</th><th>Regime</th><th>Trend</th><th class="r">RSI15</th><th class="r hide-s">ATR15</th><th class="r hide-s">Funding/h</th><th>Rules</th></tr></thead><tbody>${rows}</tbody></table></div></section>
        <p class="mk-note">${esc(scan.note || '')}</p>
      </details>`;
  }
  const P1 = ['BTC', 'GOLD'], byBoard = (a, b) => (a.priority || 3) - (b.priority || 3) || (P1.indexOf(a.sym) - P1.indexOf(b.sym)) || callRank(b) - callRank(a);
  const callRank = (m) => (m && m.ok && m.call && m.call.lean !== 'NONE' ? 10 + Math.abs(m.call.votes || 0) : 0);
  const TIERS = { 1: 'TRADING', 2: 'NEXT', 3: 'WATCH' };
  /** One market, one card: price, the call and how this market's calls have done. */
  function boardCard(m, rec) {
    if (!m.ok) return `<div class="bd-card off"><div class="bd-top"><b>${esc(m.sym)}</b></div><p class="faint">${esc(m.error)}</p></div>`;
    const c = m.call || { lean: 'NONE', votes: 0, cautions: [] }, cls = c.lean === 'LONG' ? 'long' : c.lean === 'SHORT' ? 'short' : 'none';
    const arrow = c.lean === 'LONG' ? '▲' : c.lean === 'SHORT' ? '▼' : '•';
    const strength = c.lean === 'NONE' ? 'trend frames disagree' : c.source === 'rules setup' ? 'a strategy fired' : `${Math.abs(c.votes)} of 4 signals agree`;
    const r = rec && rec.scored ? `${num(rec.hitRate, 0)}% right · ${rec.scored} scored` : rec && rec.open ? 'first call being scored' : 'no calls scored yet';
    return `<div class="bd-card ${cls} ${m.priority === 1 ? 'p1' : ''}">
      <div class="bd-top"><b>${esc(m.sym)}</b><span class="tier t${m.priority || 3}">${TIERS[m.priority || 3]}</span><span class="bd-px">${px(m.price)} ${sgn(m.chg24h)}</span></div>
      <div class="bd-call ${cls}"><span class="bd-arrow">${arrow}</span><div><b>${c.lean === 'NONE' ? 'NO CALL' : c.lean}</b><small>${esc(strength)}</small></div></div>
      ${c.cautions && c.cautions.length ? `<div class="bd-caution">⚠ ${esc(c.cautions.join(' · '))}</div>` : ''}
      <div class="bd-foot"><span>${esc(m.regime || '')} · ${esc(m.trend || '')}</span><span>${esc(r)}</span></div></div>`;
  }
  /** Compact list for the Overview: one line per market. */
  function renderMini(el, scan, track) {
    if (!el) return;
    const ms = (scan && scan.markets) || [];
    if (!ms.length) { el.innerHTML = '<p class="note">No scan yet.</p>'; return; }
    const recs = Object.fromEntries(((track && track.calls) || []).map((c) => [c.sym, c]));
    el.innerHTML = [...ms].sort((a, b) => byBoard(a, b)).map((m) => {
      const c = (m.ok && m.call) || { lean: 'NONE' }, cls = c.lean === 'LONG' ? 'long' : c.lean === 'SHORT' ? 'short' : 'none', rec = recs[m.sym];
      return `<div class="mini-row ${m.priority === 1 ? 'p1' : ''}"><b>${esc(m.sym)}</b><span class="num">${m.ok ? px(m.price) : '—'}</span><span class="num">${m.ok ? sgn(m.chg24h) : ''}</span><span class="mini-call ${cls}">${c.lean === 'NONE' ? 'NO CALL' : esc(c.lean)}</span><span class="faint">${rec && rec.scored ? num(rec.hitRate, 0) + '% of ' + rec.scored : 'scoring'}</span></div>`;
    }).join('');
  }
  function callPanel(t) {
    const cs = (t && t.calls) || []; if (!cs.length) return '';
    return `<section class="card mk-panel"><div class="mk-h"><b>CALL RECORD</b><span class="mk-sub">each market's 4-hour call, scored on the price move (before costs)</span></div><div class="mk-body"><table class="mk-t"><thead><tr><th>Market</th><th class="r">Scored</th><th class="r">Open</th><th class="r">Right</th><th class="r">Mean move</th><th>Status</th></tr></thead><tbody>
      ${cs.map((m) => `<tr class="${m.priority === 1 ? 'book' : ''}"><td><b>${esc(m.sym)}</b></td><td class="r">${m.scored}</td><td class="r">${m.open}</td><td class="r">${m.hitRate == null ? '—' : num(m.hitRate, 0) + '%'}</td><td class="r">${m.meanMoveAtr == null ? '—' : sgn(m.meanMoveAtr, 2, ' ATR')}</td><td><span class="verdict ${/AHEAD/.test(m.verdict) ? 'up' : /NO EDGE/.test(m.verdict) ? 'down' : 'faint'}">${esc(m.verdict)}</span></td></tr>`).join('')}</tbody></table></div>
      <p class="mk-note">A call is right when price moved its way 4 hours later. 50% is a coin flip; a market needs 30 scored calls and a positive lower bound on the mean move before its calls count as ahead of the market.</p></section>`;
  }
  const TIER = { 1: 'P1 · trading', 2: 'P2 · next', 3: 'P3 · watch' };
  /** Forward record: every setup the rules fired, followed to TP1, stop or max hold. The evidence a market needs before a paper book. */
  function trackPanel(t) {
    if (!t) return '';
    const rows = (t.markets || []).map((m) => `<tr class="${m.priority === 1 ? 'book' : ''}"><td><b>${esc(m.sym)}</b> <span class="tier t${m.priority}">${esc(TIER[m.priority])}</span></td><td class="r">${m.resolved}</td><td class="r">${m.open}</td>
      <td class="r">${m.resolved ? num((m.wins / m.resolved) * 100, 0) + '%' : '—'}</td><td class="r">${m.meanNetR == null ? '—' : sgn(m.meanNetR, 2, 'R')}</td><td class="r hide-s">${m.lo95 == null ? '—' : sgn(m.lo95, 2, 'R')}</td>
      <td><span class="verdict ${/CANDIDATE/.test(m.verdict) ? 'up' : /NOT_YET/.test(m.verdict) ? 'down' : 'faint'}">${esc(m.verdict)}</span></td><td class="hide-s faint">${esc((m.byStrategy || []).slice(0, 3).map((x) => `${x.strategy} ${x.n}× ${x.meanNetR >= 0 ? '+' : ''}${x.meanNetR}R`).join(' · '))}</td></tr>`).join('');
    return `<section class="card mk-panel"><div class="mk-h"><b>FORWARD RECORD</b><span class="mk-sub">every setup the rules fired, followed to TP1 / stop / max hold after costs</span></div><div class="mk-body"><table class="mk-t"><thead><tr><th>Market</th><th class="r">Resolved</th><th class="r">Open</th><th class="r">Hit TP1</th><th class="r">Mean net</th><th class="r hide-s">95% low</th><th>Status</th><th class="hide-s">By strategy</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="mk-note">Promotion: ${esc(t.promotion || '')} Recorded at the bar each setup fired, before its outcome; a bar touching both stop and TP1 counts as the stop.</p></section>`;
  }
  function derivPanel(d) {
    const o = d.options, f = d.futures || [];
    return `<section class="card mk-panel"><div class="mk-h"><b>${esc(d.currency)} OPTIONS + FUTURES</b><span class="mk-sub">Deribit · index ${px(d.index)}</span></div>
      <div class="mk-tiles">
        <div class="mk-tile"><span>DVOL (30d implied)</span><b>${num(d.dvol && d.dvol.last, 1)}</b><i>${d.dvol && d.dvol.chg24h != null ? sgn(d.dvol.chg24h, 1, '') + ' 24h' : ''}</i></div>
        <div class="mk-tile"><span>Put/call OI</span><b>${num(o && o.putCallOI, 2)}</b><i>${o ? `${num(o.putOI, 0)} P / ${num(o.callOI, 0)} C` : ''}</i></div>
        <div class="mk-tile"><span>Max pain (next expiry)</span><b>${px(o && o.maxPainNearest)}</b><i>${o ? esc(String(o.nearestExpiry).slice(0, 10)) : ''}</i></div>
        <div class="mk-tile"><span>ATM IV · OTM put−call skew</span><b>${num(o && o.atmIV, 1)}</b><i>${o && o.putMinusCallIV != null ? sgn(o.putMinusCallIV, 1, ' vol') : ''}</i></div>
      </div>
      ${o && o.topOIStrikes ? `<div class="mk-next">Largest open interest at strikes: ${o.topOIStrikes.map((s) => `<b>${px(s.strike)}</b>`).join(' · ')}</div>` : ''}
      <table class="mk-t"><thead><tr><th>Future</th><th class="r">Mark</th><th class="r">Basis</th><th class="r">Annualised</th></tr></thead><tbody>${f.map((x) => `<tr><td>${esc(x.instrument)}</td><td class="r">${px(x.mark)}</td><td class="r">${sgn(x.basisPct, 3)}</td><td class="r">${x.annualisedPct == null ? '—' : sgn(x.annualisedPct, 2)}</td></tr>`).join('') || '<tr><td colspan="4" class="faint">unavailable</td></tr>'}</tbody></table>
      ${d.errors && d.errors.length ? `<p class="mk-note">partial: ${esc(d.errors.join('; '))}</p>` : ''}</section>`;
  }
  function renderState(el, ts) {
    if (!el) return;
    el.className = 'ts-pill ts-' + ts.state; el.title = ts.reasons.join('; ');
    el.innerHTML = `<b>${esc(ts.state)}</b><span>${esc(ts.reasons[0])}</span>`;
  }

  const api = { renderMini, boardCard, trackPanel, tradingState, committees, renderCommittee, renderScan, renderState, STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DeskScanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
