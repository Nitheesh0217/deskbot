// Trading Tower model. Pure functions: status payload in, floors / staff / hand-offs out. No DOM, no network.
// Staff are software agents (fixed rules, plus optional free LLM roles that are advisory only). A person-like name is a label for a role.
// Every line a staff member "says" is copied from a field the runner actually reported. A missing field says "not reported"; nothing is invented.
(function (root) {
  'use strict';
  const finite = (n) => typeof n === 'number' && Number.isFinite(n);
  const num = (n, d = 0) => (finite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
  const usd = (n) => (finite(n) ? (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
  const NR = 'not reported';
  const FRESH_MS = 30 * 60000;

  // The roster: id, display name, title, kind (RULES = fixed code, AI = optional free-LLM, advisory only), floor.
  const FLOORS = [
    { id: 'penthouse', name: 'Penthouse', sub: 'Portfolio office' },
    { id: 'risk', name: 'Floor 8', sub: 'Risk office' },
    { id: 'committee', name: 'Floor 7', sub: 'Investment committee (advisory)' },
    { id: 'trading', name: 'Floor 6', sub: 'Trading floor' },
    { id: 'research', name: 'Floor 5', sub: 'Research lab' },
    { id: 'data', name: 'Floor 4', sub: 'Market data room' },
    { id: 'execution', name: 'Floor 3', sub: 'Paper execution desk' },
    { id: 'compliance', name: 'Basement', sub: 'Compliance & audit' },
  ];
  const ROSTER = {
    pm: ['Morgan', 'Portfolio manager', 'RULES', 'penthouse'],
    cro: ['Reese', 'Chief risk officer', 'RULES', 'risk'],
    riskplan: ['Quinn', 'Risk planner', 'RULES', 'risk'],
    analyst: ['Avery', 'Desk analyst', 'AI', 'committee'],
    bear: ['Blake', 'Skeptic (bear case)', 'AI', 'committee'],
    bull: ['Sky', 'Supporter (bull case)', 'AI', 'committee'],
    judge: ['Judge Harper', 'Committee judge', 'AI', 'committee'],
    chart: ['Ada', 'Market-structure analyst', 'RULES', 'research'],
    zones: ['Zed', 'Zone mapper (FVG / OB / value)', 'RULES', 'research'],
    news: ['Nora', 'News desk', 'RULES+AI', 'research'],
    feed: ['Felix', 'Price & candle feed', 'RULES', 'data'],
    deriv: ['Dara', 'Derivatives data (funding, OI)', 'RULES', 'data'],
    mood: ['Mina', 'Sentiment data', 'RULES', 'data'],
    scout: ['Sage', 'Setup scout', 'RULES', 'trading'],
    validator: ['Val', 'Independent checker', 'RULES', 'risk'],
    manager: ['Theo', 'Position manager', 'RULES', 'execution'],
    recorder: ['Rex', 'Decision recorder', 'RULES', 'compliance'],
    auditor: ['Iris', 'Config auditor', 'RULES', 'compliance'],
    postmortem: ['Pat', 'Post-trade reviewer', 'RULES', 'compliance'],
  };

  const rowsOf = (agents, name) => (Array.isArray(agents) ? agents : []).filter((a) => a && a.agent === name);
  const ts = (x) => { const t = Date.parse(x && x.ts); return Number.isFinite(t) ? t : null; };
  const fresh = (t, now) => t != null && now - t <= FRESH_MS;

  function member(id, status, line, detail = [], at = null) {
    const [name, title, kind, floor] = ROSTER[id];
    return { id, name, title, kind, floor, status, line, detail, at };
  }

  // status: working (reported activity in the last 30 min or live now), idle (configured, nothing recent), off (switched off / no provider), alert (error or warning)
  function build(input, now = Date.now()) {
    const S = input.state || {}, st = S.state || {}, lr = S.last_run || {}, m = lr.market || {}, desk = lr.desk || {};
    const agents = input.agents || [], trades = input.trades || [], curve = input.curve || [];
    const have = finite(st.equity);
    const strategies = input.strategies || [];
    const dec = lr.decision || {}, signals = Array.isArray(dec.signals) ? dec.signals : [], rejects = Array.isArray(dec.rejects) ? dec.rejects : [];
    const runT = Date.parse(lr.ts), runFresh = Number.isFinite(runT) && now - runT <= 12 * 60000;
    const integ = S.integrity || lr.integrity || {};
    const book = input.book === 'GOLD' ? 'PAXG' : 'BTC';
    const staff = {};
    const add = (m2) => { staff[m2.id] = m2; };

    // data room
    const px = finite(m.price) ? m.price : null;
    add(member('feed', runFresh ? 'working' : 'idle', px != null ? `${book} ${usd(px)} via ${lr.source || 'unknown feed'}` : NR, [`Source: ${lr.source || NR}`, `Last run: ${Number.isFinite(runT) ? new Date(runT).toISOString().slice(11, 19) + ' UTC' : NR}`]));
    const fund = finite(m.funding) ? m.funding : null, oi = finite(m.oi) ? m.oi : null;
    add(member('deriv', fund != null || oi != null ? (runFresh ? 'working' : 'idle') : 'idle', fund != null ? `funding ${(fund * 100).toFixed(4)}% per interval${oi != null ? ` · OI ${num(oi, 0)}` : ''}` : NR, [`Funding: ${fund == null ? NR : (fund * 100).toFixed(4) + '%'}`, `Open interest: ${oi == null ? NR : num(oi, 0)}`]));
    const fng = m.fng != null ? m.fng : (m.fear ?? null);
    add(member('mood', fng != null ? 'working' : 'idle', fng != null ? `Fear & Greed ${typeof fng === 'object' ? JSON.stringify(fng) : fng}` : NR, []));

    // research lab
    const c = desk.chart || {}, tr = c.trend || {}, arrow = (v) => (v === 1 ? '▲' : v === -1 ? '▼' : '·');
    const chartRows = rowsOf(agents, 'chart');
    add(member('chart', c.bias || chartRows.length ? (fresh(ts(chartRows[0]), now) || runFresh ? 'working' : 'idle') : 'idle',
      c.bias ? `bias ${String(c.bias).toUpperCase()} · 1m${arrow(tr.m1)} 5m${arrow(tr.m5)} 15m${arrow(tr.m15)} 1h${arrow(tr.h1)} 4h${arrow(tr.h4)}` : NR,
      [c.support ? `Support: ${c.support.name} $${num(c.support.px, 0)} (${c.support.atr} ATR)` : `Support: ${NR}`, c.resistance ? `Resistance: ${c.resistance.name} $${num(c.resistance.px, 0)} (${c.resistance.atr} ATR)` : `Resistance: ${NR}`], ts(chartRows[0])));
    const z = c.zones;
    add(member('zones', z ? 'working' : 'idle', z ? (typeof z.summary === 'string' ? z.summary : `${Object.keys(z).length} zone groups reported`) : 'zones appear after the next cloud check', []));
    const news = lr.news;
    add(member('news', news ? (news.risk === 'high' ? 'alert' : 'working') : 'idle', news ? `news risk ${String(news.risk).toUpperCase()} (${String(news.by || '').startsWith('ai:') ? 'AI' : 'keyword rules'}, ${news.mode || NR} mode)` : NR, news && news.reason ? [String(news.reason)] : []));

    // execution desk
    const scoutRows = rowsOf(agents, 'signals');
    add(member('scout', signals.length ? 'working' : runFresh ? 'idle' : 'idle',
      runFresh || signals.length ? `${signals.length} setup(s) passed the rules, ${rejects.length} rejection record(s)` : NR,
      signals.slice(0, 4).map((s) => `${s.strategy} ${String(s.dir || '').toUpperCase()} · score ${s.score}`), ts(scoutRows[0])));
    const valRows = rowsOf(agents, 'validator'), v0 = valRows[0] && valRows[0].output;
    add(member('validator', valRows.length ? (fresh(ts(valRows[0]), now) ? 'working' : 'idle') : 'idle',
      v0 ? `${v0.enforcing ? 'ENFORCING' : 'advisory'} · ${(v0.verdicts || []).length} verdict(s)` : (desk.validator === false ? 'advisory (off)' : NR),
      v0 ? (v0.verdicts || []).slice(0, 4).map((x) => `${x.strategy}: ${x.ok ? 'ok' : 'concern'}${x.roomR != null ? ` · room ${x.roomR}R` : ''}`) : [], ts(valRows[0])));
    const p = st.pos, mgrRows = rowsOf(agents, 'manager');
    add(member('manager', p ? 'working' : mgrRows.length && fresh(ts(mgrRows[0]), now) ? 'working' : 'idle',
      p ? `managing ${String(p.dir).toUpperCase()} ${p.strategy} · stop ${num(p.stop, 0)}${p.tp1Done ? ' · TP1 taken' : ''}` : 'flat, no position to manage',
      p && Array.isArray(p.plan) ? p.plan.slice(-3).reverse().map((x) => `${new Date(x.t).toISOString().slice(11, 16)} ${x.msg}`) : [], ts(mgrRows[0])));

    // risk office
    const cb = st.cb || {}, cooling = finite(cb.cooldownUntil) && cb.cooldownUntil > now;
    const rk = lr.risk;
    add(member('cro', cooling ? 'alert' : have ? 'working' : 'idle',
      cooling ? `circuit breaker active until ${new Date(cb.cooldownUntil).toISOString().slice(11, 16)} UTC` : have ? `breaker clear · ${cb.consec || 0} consecutive loss(es)${rk && finite(rk.pct) ? ` · risk per trade ${(rk.pct * 100).toFixed(2)}%` : ''}` : NR,
      ['Rules: 3 losses in 4 h pause entries; 5% daily loss cap; 6 trades per day', 'Authority: can block entries; cannot raise risk']));
    const rp = rowsOf(agents, 'risk')[0], plans = rp && rp.output && rp.output.plans || [];
    add(member('riskplan', rp ? (fresh(ts(rp), now) ? 'working' : 'idle') : 'idle', rp ? `${plans.length} stop/target plan(s) drafted` : NR,
      plans.slice(0, 3).map((x) => `${x.strategy} ${x.dir}: stop ${x.stop} (${x.stopPct}%) · TP1 ${x.tp1}`), ts(rp)));

    // committee
    const prov = (name) => rowsOf(agents, name)[0];
    const chk = prov('desk-checks');
    const role = (id, agent, label) => {
      const r = prov(agent), o = r && r.output;
      const off = !r && !(lr.ai && lr.ai.provider) ? true : false;
      const line = o ? (o.verdict ? `${o.verdict}: ${o.reason || ''}` : (o.summary || o.case || NR)) : (off ? 'no AI provider configured; rule checks still run' : NR);
      return member(id, r && !r.error ? (fresh(ts(r), now) ? 'working' : 'idle') : r && r.error ? 'alert' : 'off', String(line).slice(0, 220), r && r.error ? [String(r.error)] : [`Authority: advisory only (${label})`], ts(r));
    };
    add(role('analyst', 'desk-analyst', 'summarises the setup'));
    add(role('bear', 'desk-bear', 'argues against'));
    add(role('bull', 'desk-bull', 'argues for'));
    add(role('judge', 'desk-judge', 'weighs both sides'));
    staff.analyst.chk = chk ? (chk.output && chk.output.checks || []).map((x) => `${x.level || 'info'}: ${x.code || x.id || ''}`).slice(0, 4) : [];

    // portfolio / compliance
    const closedPnl = trades.reduce((a, t) => a + (finite(+t.net) ? +t.net : 0), 0);
    const startEq = finite(st.startEquity) && st.startEquity > 0 ? st.startEquity : null;
    add(member('pm', have ? 'working' : 'idle', have ? `paper equity ${usd(st.equity + (finite(lr.upnl) ? lr.upnl : 0))}${startEq ? ` · ${(((st.equity + (lr.upnl || 0)) / startEq - 1) * 100).toFixed(2)}% since start` : ''}` : NR,
      [`Closed trades: ${st.stats && st.stats.all ? st.stats.all.n : trades.length}`, `Closed net P&L in view: ${usd(closedPnl)}`, 'Paper account. No funded orders.']));
    const pe = lr.provenanceError;
    add(member('recorder', pe ? 'alert' : have ? 'working' : 'idle', pe ? String(pe).slice(0, 160) : lr.action && /^OPEN/.test(lr.action) ? 'decision record written before the position was adopted' : 'records every new entry before it opens', ['Immutable record: inputs, hashes, config, chosen signal']));
    add(member('auditor', integ && integ.approved === false ? 'alert' : have ? 'working' : 'idle', integ.hash ? `config ${String(integ.hash).slice(0, 8)} · fingerprint ${integ.approved ? 'approved' : 'not approved'}` : NR, integ.reason ? [String(integ.reason)] : []));
    const pm = prov('desk-postmortem');
    add(member('postmortem', pm ? 'working' : 'idle', pm && pm.output ? `${pm.input_summary || ''}: ${(pm.output.flags || []).map((f) => f.code || f).join(', ') || 'no flags'}` : 'reviews each closed trade; none returned yet', []));

    // strategy traders (one desk per strategy, taken from the registry the page passes in)
    const traders = strategies.map((s) => ({ id: s.id, name: s.name, state: s.state, line: s.reason || '', status: s.state === 'DISABLED' ? 'off' : s.state === 'ERROR' || s.state === 'DATA BLOCKED' ? 'alert' : s.state === 'RUNNING' ? 'working' : 'idle', position: !!(p && p.strategy === s.id) }));

    // hand-offs of the latest cycle: each label is copied from a reported field
    const flow = [
      { from: 'feed', to: 'chart', label: px != null ? `${book} ${usd(px)}` : NR },
      { from: 'chart', to: 'scout', label: c.bias ? `bias ${String(c.bias).toUpperCase()}` : NR },
      { from: 'scout', to: 'validator', label: `${signals.length} setup(s)` },
      { from: 'validator', to: 'riskplan', label: v0 ? `${(v0.verdicts || []).filter((x) => x.ok).length} ok` : NR },
      { from: 'riskplan', to: 'manager', label: lr.action || NR },
      { from: 'manager', to: 'recorder', label: p ? 'position logged' : 'no change' },
      { from: 'recorder', to: 'pm', label: have ? usd(st.equity) : NR },
      { from: 'scout', to: 'analyst', label: signals.length ? 'for review' : 'nothing to review', advisory: true },
      { from: 'analyst', to: 'judge', label: 'summary', advisory: true },
    ];

    const eq = curve.map((x) => +x.equity).filter(finite);
    const growth = { points: eq, start: startEq, now: have ? st.equity + (finite(lr.upnl) ? lr.upnl : 0) : null };
    growth.pct = growth.start && growth.now != null ? (growth.now / growth.start - 1) * 100 : null;
    return { floors: FLOORS, staff, traders, flow, growth, runFresh, runAt: Number.isFinite(runT) ? runT : null, action: lr.action || null, book };
  }

  const api = { build, ROSTER, FLOORS, FRESH_MS, NR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DeskTower = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
