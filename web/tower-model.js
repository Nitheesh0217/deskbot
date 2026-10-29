// Trading Tower model. Pure functions: status payload in, departments / staff / workflow / hand-offs out. No DOM, no network.
// The building follows the departments of a systematic trading firm (data, intelligence, research, strategy desks, portfolio, risk,
// execution, operations). They are logical departments, not a claim about any particular firm's floors.
// Staff are software agents: fixed rules in the cloud runner, plus optional free-LLM roles that are advisory only. Names are labels for roles.
// Every line a staff member "says" is copied from a field the runner reported. A missing field says "not reported"; nothing is invented.
(function (root) {
  'use strict';
  const finite = (n) => typeof n === 'number' && Number.isFinite(n);
  const num = (n, d = 0) => (finite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
  const usd = (n) => (finite(n) ? (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
  const pct = (x, d = 3) => (finite(x) ? (x * 100).toFixed(d) + '%' : '—');
  const NR = 'not reported';
  const FRESH_MS = 30 * 60000, RUN_FRESH_MS = 12 * 60000;

  // Top floor first (the page draws the building from the roof down).
  const FLOORS = [
    { id: 'ops', n: 8, name: 'Operations & review', job: 'Reconcile records; attribute results to signals, costs, execution and failures; run controlled experiments.' },
    { id: 'execution', n: 7, name: 'Execution', job: 'Model executable prices, fees, slippage, funding and the position lifecycle. Paper fills only.' },
    { id: 'risk', n: 6, name: 'Risk management', job: 'Deterministic sizing, limits, stale-data rejection and vetoes. Can block; cannot raise risk.' },
    { id: 'portfolio', n: 5, name: 'Portfolio management', job: 'Compare eligible candidates, attach evidence, allocate one position or none (WAIT).' },
    { id: 'desks', n: 4, name: 'Strategy desks', job: 'Trend, breakout, reversal and mean-reversion candidates from the same snapshot.' },
    { id: 'research', n: 3, name: 'Quantitative research', job: 'Specify features, horizons and experiments offline; keep failed results. Never edits live rules.' },
    { id: 'intel', n: 2, name: 'Market intelligence', job: 'Structure, levels, catalysts and sentiment as timestamped evidence.' },
    { id: 'data', n: 1, name: 'Data infrastructure', job: 'Validate timestamps, candles, venue, instrument and freshness. Reject unusable data.' },
  ];
  // id: [name, title, kind, floor]. kind: RULES = fixed code in the runner, AI = optional free LLM (advisory only), OFFLINE = research tooling, not in the live loop.
  const ROSTER = {
    auditor: ['Rex', 'Auditor (decision records)', 'RULES', 'ops'],
    postmortem: ['Pat', 'Post-trade reviewer', 'RULES', 'ops'],
    config: ['Iris', 'Config auditor', 'RULES', 'ops'],
    experiment: ['Elle', 'Experiment officer (FILTER-1)', 'RULES', 'ops'],
    exec: ['Xavi', 'Paper execution trader', 'RULES', 'execution'],
    manager: ['Theo', 'Position manager', 'RULES', 'execution'],
    cro: ['Reese', 'Risk controller', 'RULES', 'risk'],
    riskplan: ['Quinn', 'Risk planner (stops & targets)', 'RULES', 'risk'],
    validator: ['Val', 'Independent checker', 'RULES', 'risk'],
    pm: ['Morgan', 'Portfolio allocator', 'RULES', 'portfolio'],
    evaluator: ['Eve', 'Evaluation service', 'RULES', 'portfolio'],
    analyst: ['Avery', 'Committee analyst', 'AI', 'portfolio'],
    bear: ['Blake', 'Skeptical reviewer', 'AI', 'portfolio'],
    bull: ['Sky', 'Supporting reviewer', 'AI', 'portfolio'],
    judge: ['Harper', 'Committee judge', 'AI', 'portfolio'],
    scout: ['Sage', 'Setup scout', 'RULES', 'desks'],
    researcher: ['Rhea', 'Offline researcher', 'OFFLINE', 'research'],
    chart: ['Ada', 'Market-structure analyst', 'RULES', 'intel'],
    zones: ['Zed', 'Zone mapper (FVG / OB / value)', 'RULES', 'intel'],
    news: ['Nora', 'Catalyst analyst (news)', 'RULES+AI', 'intel'],
    steward: ['Stella', 'Evidence steward', 'RULES', 'data'],
    feed: ['Felix', 'Price & candle feed', 'RULES', 'data'],
    deriv: ['Dara', 'Derivatives data (funding, OI)', 'RULES', 'data'],
  };
  const FAMILY = { D_THRUST: 'Trend', TREND_MTF: 'Trend', EMA_CROSS: 'Trend', EMA_PB: 'Trend', HTF_TREND: 'Breakout', SESSION_BO: 'Breakout', D_BEARTRAP: 'Reversal', SWEEP_REV: 'Reversal', HTF_SWEEP: 'Reversal', SSR: 'Reversal', VWAP_REVERT: 'Mean reversion' };
  // Proposed research desks: hypotheses to test, NOT established edges. Only signal quality has a live experiment.
  const RESEARCH = [
    { id: 'orderflow', name: 'Order-flow desk', inputs: 'Trades, bid/ask depth, cancellations, liquidity changes', question: 'Do observations available now predict a later executable return? (feature window strictly before outcome window)' },
    { id: 'volatility', name: 'Volatility desk', inputs: 'Compression, unusual volume, changing volatility', question: 'Can it forecast expansion, and separately, its direction?' },
    { id: 'catalyst', name: 'Catalyst desk', inputs: 'First-seen news, scheduled events', question: 'Does genuinely new information improve a defined continuation or reversal forecast?' },
    { id: 'relval', name: 'Relative-value desk', inputs: 'Eligible instruments and venues (e.g. HL PAXG vs Binance PAXGUSDT)', question: 'Does an apparent discrepancy survive costs, delays and instrument differences?' },
    { id: 'signalq', name: 'Signal-quality desk', inputs: 'Existing signals and their outcomes', question: 'Can a filter reject weak entries without discarding too many good ones? (FILTER-1)' },
  ];
  const WORKFLOW = [
    ['steward', 'Evidence steward', 'one timestamped snapshot; reject unusable data'],
    ['scout', 'Specialist desks', 'candidates from the same snapshot'],
    ['news', 'Catalyst analyst', 'attach news and event evidence'],
    ['bear', 'Skeptical reviewer', 'contradictions and missing assumptions'],
    ['evaluator', 'Evaluation service', 'results for this strategy, instrument and cost model'],
    ['pm', 'Portfolio allocator', 'one candidate or WAIT'],
    ['cro', 'Risk controller', 'approve size or veto'],
    ['exec', 'Paper execution & auditor', 'fill, record, reconcile'],
    ['researcher', 'Offline researcher', 'propose a new experiment; never edit live rules'],
  ];

  const rowsOf = (agents, name) => (Array.isArray(agents) ? agents : []).filter((a) => a && a.agent === name);
  const ts = (x) => { const t = Date.parse(x && x.ts); return Number.isFinite(t) ? t : null; };
  const fresh = (t, now) => t != null && now - t <= FRESH_MS;
  function member(id, status, line, detail = [], at = null) { const [name, title, kind, floor] = ROSTER[id]; return { id, name, title, kind, floor, status, line, detail, at }; }

  // status: working (reported activity recently), idle (configured, nothing recent), off (switched off / no provider / offline), alert (failed check or warning)
  function build(input, now = Date.now()) {
    const S = input.state || {}, st = S.state || {}, lr = S.last_run || {}, m = lr.market || {}, desk = lr.desk || {};
    const agents = input.agents || [], trades = input.trades || [], curve = input.curve || [], cfg = input.config || {};
    const providers = Array.isArray(input.aiProviders) ? input.aiProviders : null;
    const have = finite(st.equity);
    const dec = lr.decision || {}, signals = Array.isArray(dec.signals) ? dec.signals : [], rejects = Array.isArray(dec.rejects) ? dec.rejects : [];
    const runT = Date.parse(lr.ts), runAge = Number.isFinite(runT) ? now - runT : null, runFresh = runAge != null && runAge >= -60000 && runAge <= RUN_FRESH_MS;
    const integ = S.integrity || lr.integrity || {};
    const book = input.book === 'GOLD' ? 'PAXG' : 'BTC';
    const staff = {}, add = (x) => { staff[x.id] = x; };
    const p = st.pos && typeof st.pos === 'object' ? st.pos : null;

    // 1 data infrastructure
    const px = finite(m.price) ? m.price : null;
    const checks = [
      ['last run within 12 min', runFresh], ['feed named', !!lr.source], ['price present', px != null], ['config fingerprint reported', !!integ.hash], ['no decision-record failure', !lr.provenanceError],
    ];
    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    const cu = lr.catchup && typeof lr.catchup === 'object' ? lr.catchup : null;
    const cuLine = cu ? (cu.scanned ? ` · late run: re-checked ${cu.scanned} skipped bar(s), ${cu.boundaryBars} close(s)${cu.valid && cu.valid.length ? `, recovered ${cu.valid.join(', ')}` : ''}${cu.missed ? `, ${cu.missed} logged as missed` : ''}` : ' · no bars skipped') : '';
    add(member('steward', !have ? 'idle' : failed.length ? 'alert' : 'working', !have ? NR : (failed.length ? `${failed.length} evidence check(s) failed: ${failed.join(', ')}` : `snapshot usable · ${checks.length}/${checks.length} checks pass`) + cuLine,
      [...checks.map((c) => `${c[1] ? '✓' : '✗'} ${c[0]}`), cu ? `Missed-bar catch-up: ${cu.mode} (skipped 15m/1H/4H/daily closes from the last hour are re-checked; a setup is entered only if the stop is untouched, TP1 not reached and price within 0.25R)` : 'Missed-bar catch-up: reported after the backend release']));
    add(member('feed', runFresh ? 'working' : 'idle', px != null ? `${book} ${usd(px)} via ${lr.source || 'unnamed feed'}` : NR, [`Source: ${lr.source || NR}`, `Last run: ${Number.isFinite(runT) ? new Date(runT).toISOString().slice(11, 19) + ' UTC' : NR}`]));
    const fund = finite(m.funding) ? m.funding : null, oi = finite(m.oi) ? m.oi : null;
    add(member('deriv', fund != null || oi != null ? (runFresh ? 'working' : 'idle') : 'idle', fund != null ? `funding ${pct(fund, 4)} per interval${oi != null ? ` · OI ${num(oi, 0)}` : ''}` : NR, []));

    // 2 market intelligence
    const c = desk.chart || {}, tr = c.trend || {}, arrow = (v) => (v === 1 ? '▲' : v === -1 ? '▼' : '·');
    const chartRows = rowsOf(agents, 'chart');
    add(member('chart', c.bias ? (runFresh || fresh(ts(chartRows[0]), now) ? 'working' : 'idle') : 'idle',
      c.bias ? `bias ${String(c.bias).toUpperCase()} · 1m${arrow(tr.m1)} 5m${arrow(tr.m5)} 15m${arrow(tr.m15)} 1h${arrow(tr.h1)} 4h${arrow(tr.h4)}` : NR,
      [c.support ? `Support: ${c.support.name} $${num(c.support.px, 0)} (${c.support.atr} ATR)` : `Support: ${NR}`, c.resistance ? `Resistance: ${c.resistance.name} $${num(c.resistance.px, 0)} (${c.resistance.atr} ATR)` : `Resistance: ${NR}`], ts(chartRows[0])));
    const z = c.zones;
    add(member('zones', z ? 'working' : 'idle', z ? (typeof z.summary === 'string' ? z.summary : `${Object.keys(z).length} zone group(s) reported`) : 'zones appear after the next cloud check', []));
    const news = lr.news;
    add(member('news', news ? (news.risk === 'high' ? 'alert' : 'working') : 'idle', news ? `news risk ${String(news.risk).toUpperCase()} (${String(news.by || '').startsWith('ai:') ? 'AI' : 'keyword rules'}, ${news.mode || NR} mode)` : NR, news && news.reason ? [String(news.reason)] : []));

    // 3 research (offline)
    add(member('researcher', 'off', 'FILTER-1 pre-registered; challengers A_COSTR50 and B_BE_TP1 rejected 28 Oct', ['Works offline on frozen data; promotes nothing without review', 'docs/research/FILTER_EXPERIMENT.md', 'docs/research (profit-improvement brief)']));

    // 4 strategy desks
    const scoutRows = rowsOf(agents, 'signals');
    add(member('scout', signals.length ? 'working' : runFresh ? 'idle' : 'idle', runFresh || signals.length ? `${signals.length} candidate(s) passed the rules · ${rejects.length} rejection record(s)` : NR,
      signals.slice(0, 4).map((s) => `${s.strategy} ${String(s.dir || '').toUpperCase()} · score ${s.score}${(s.why || []).some((w) => String(w).startsWith('CATCH-UP')) ? ' · recovered from a skipped bar' : ''}`), ts(scoutRows[0])));
    const strategies = (input.strategies || []).map((s) => ({ id: s.id, name: s.name, family: FAMILY[s.id] || 'Other', state: s.state, line: s.reason || '',
      status: s.state === 'DISABLED' ? 'off' : s.state === 'ERROR' || s.state === 'DATA BLOCKED' ? 'alert' : s.state === 'RUNNING' ? 'working' : 'idle',
      signal: signals.find((x) => x.strategy === s.id) || null, position: !!(p && p.strategy === s.id) }));
    const desks = ['Trend', 'Breakout', 'Reversal', 'Mean reversion'].map((f) => ({ family: f, strategies: strategies.filter((s) => s.family === f) }));

    // 5 portfolio management
    const best = signals.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    const opened = /^OPEN/.test(lr.action || '');
    const recovered = !!(p && Array.isArray(p.why) && p.why.some((w) => String(w).startsWith('CATCH-UP')));
    add(member('pm', !have ? 'idle' : 'working', !have ? NR : opened && p ? `allocated: ${p.strategy} ${String(p.dir).toUpperCase()} (${recovered ? 'recovered from a skipped bar' : 'highest-scoring eligible candidate'})` : p ? `holding ${p.strategy}; one position per book, no new allocation` : signals.length ? `${signals.length} candidate(s); best ${best.strategy} score ${best.score}; ${lr.action || NR}` : 'WAIT · no eligible candidate this check',
      ['Rule: one position per book; highest score among candidates that pass every gate; WAIT is a valid outcome']));
    const bt = input.bt;
    add(member('evaluator', bt ? 'working' : 'idle', bt && bt.a ? `${bt.label}: ${bt.a.n} trades, ${finite(bt.a.expR) ? (bt.a.expR >= 0 ? '+' : '') + bt.a.expR.toFixed(3) + 'R/trade' : NR} after costs` : 'no live-config backtest returned',
      bt ? [`Ran ${String(bt.ran_at || NR).slice(0, 16)}`, 'Historical evidence for this config label only; does not certify the current runtime'] : []));
    const prov = (name) => rowsOf(agents, name)[0];
    const role = (id, agent, label) => {
      const r = prov(agent), o = r && r.output;
      const noProvider = providers ? providers.length === 0 : !(lr.ai && Array.isArray(lr.ai.providers) && lr.ai.providers.length);
      const line = o ? (o.verdict ? `${o.verdict}: ${o.reason || ''}` : (o.summary || o.case || NR)) : noProvider ? 'no AI provider configured; this seat is empty' : 'waiting for the next entry to review';
      const status = r && r.error ? 'alert' : r ? (fresh(ts(r), now) ? 'working' : 'idle') : noProvider ? 'off' : 'idle';
      return member(id, status, String(line).slice(0, 220), r && r.error ? [String(r.error)] : [`Advisory only (${label}); cannot place, size or block a trade`], ts(r));
    };
    add(role('analyst', 'desk-analyst', 'summarises the setup'));
    add(role('bear', 'desk-bear', 'argues against'));
    add(role('bull', 'desk-bull', 'argues for'));
    add(role('judge', 'desk-judge', 'its verdict is scored in FILTER-1'));
    const chk = prov('desk-checks');
    staff.analyst.chk = chk ? ((chk.output && chk.output.checks) || []).map((x) => `${x.level || 'info'}: ${x.id || x.code || ''}`).slice(0, 5) : [];

    // 6 risk management
    const cb = st.cb || {}, cooling = finite(cb.cooldownUntil) && cb.cooldownUntil > now;
    const rk = lr.risk;
    add(member('cro', cooling ? 'alert' : have ? 'working' : 'idle',
      cooling ? `VETO: circuit breaker until ${new Date(cb.cooldownUntil).toISOString().slice(11, 16)} UTC` : have ? `entries permitted · breaker clear · ${cb.consec || 0} consecutive loss(es)${rk && finite(rk.pct) ? ` · risk/trade ${(rk.pct * 100).toFixed(2)}%` : ''}` : NR,
      ['3 losses in 4 h pause entries · 5% daily loss cap · 6 entries/day · leverage ≤ 5×', integ.approved === false ? 'Config fingerprint not approved (warning only unless enforcement is on)' : 'Config fingerprint approved']));
    const rp = prov('risk'), plans = (rp && rp.output && rp.output.plans) || [];
    add(member('riskplan', rp ? (fresh(ts(rp), now) ? 'working' : 'idle') : 'idle', rp ? `${plans.length} stop/target plan(s) drafted` : NR, plans.slice(0, 3).map((x) => `${x.strategy} ${x.dir}: stop ${x.stop} (${x.stopPct}%) · TP1 ${x.tp1}`), ts(rp)));
    const vr = prov('validator'), v0 = vr && vr.output;
    add(member('validator', vr ? (fresh(ts(vr), now) ? 'working' : 'idle') : 'idle', v0 ? `${v0.enforcing ? 'ENFORCING' : 'advisory'} · ${(v0.verdicts || []).length} check(s)` : desk.validator === false ? 'advisory (off)' : NR,
      v0 ? (v0.verdicts || []).slice(0, 4).map((x) => `${x.strategy}: ${x.ok ? 'ok' : 'concern'}${x.roomR != null ? ` · room ${x.roomR}R` : ''}`) : [], ts(vr)));

    // 7 execution
    const costs = finite(cfg.TAKER_FEE) ? `taker ${pct(cfg.TAKER_FEE)} · maker ${pct(cfg.MAKER_FEE)} · slippage ${pct(cfg.SLIPPAGE)} · funding hourly` : 'cost model not reported';
    add(member('exec', opened ? 'working' : have ? 'idle' : 'idle', opened && p ? `paper fill ${String(p.dir).toUpperCase()} @ ${num(p.entry, book === 'PAXG' ? 2 : 0)} incl. slippage` : `no order this check · ${costs}`, [costs, 'Paper only: no exchange account, no funded orders']));
    const mgr = prov('manager');
    add(member('manager', p ? 'working' : mgr && fresh(ts(mgr), now) ? 'working' : 'idle', p ? `managing ${String(p.dir).toUpperCase()} ${p.strategy} · stop ${num(p.stop, 0)}${p.tp1Done ? ' · TP1 taken' : ''}` : 'flat, no position to manage',
      p && Array.isArray(p.plan) ? p.plan.slice(-3).reverse().map((x) => `${new Date(x.t).toISOString().slice(11, 16)} ${x.msg}`) : [], ts(mgr)));

    // 8 operations & review
    const pe = lr.provenanceError;
    add(member('auditor', pe ? 'alert' : have ? 'working' : 'idle', pe ? String(pe).slice(0, 160) : opened ? 'decision record written before the position was adopted' : 'every new entry is recorded before it opens', ['Immutable record: inputs, hashes, config, chosen signal']));
    add(member('config', integ.approved === false ? 'alert' : integ.hash ? 'working' : 'idle', integ.hash ? `config ${String(integ.hash).slice(0, 8)} · fingerprint ${integ.approved ? 'approved' : 'not approved'}` : NR, integ.reason ? [String(integ.reason)] : []));
    const pmr = prov('desk-postmortem');
    add(member('postmortem', pmr ? 'working' : 'idle', pmr && pmr.output ? `${pmr.input_summary || ''}: ${((pmr.output.flags || []).map((f) => f.code || f.id || f)).join(', ') || 'no flags'}` : 'reviews each closed trade; none returned yet', []));
    const ex = input.experiment;
    const exLine = ex == null ? 'verdict table not live yet' : !ex.started ? 'waiting for the first entry' : (ex.arms || []).map((a) => `${a.arm}: ${a.decided} decided · ${a.result}`).join(' · ');
    add(member('experiment', ex && ex.started ? 'working' : 'idle', `FILTER-1 · ${exLine}`, ['Baseline vs baseline + rules filter vs baseline + AI filter; filters are shadow-only', 'Verdicts recorded before outcomes in an append-only table']));

    // the 9-step workflow for the latest check, each label copied from a reported field
    const stepLabel = {
      steward: staff.steward.line, scout: `${signals.length} candidate(s)`, news: news ? `news ${news.risk}` : NR, bear: staff.bear.status === 'off' ? 'seat empty (no provider)' : prov('desk-bear') ? 'reviewed' : 'nothing to review',
      evaluator: bt ? bt.label : 'no evidence attached', pm: opened ? 'allocated' : p ? 'holding; no new allocation' : signals.length ? (lr.action || NR) : 'WAIT', cro: cooling ? 'VETO' : have ? 'permitted' : NR, exec: opened ? 'paper fill recorded' : 'no order', researcher: 'offline',
    };
    const workflow = WORKFLOW.map(([id, label, job], i) => ({ i: i + 1, id, label, job, owner: staff[id], status: staff[id].status, out: stepLabel[id] }));
    const flow = [
      { from: 'feed', to: 'steward', label: px != null ? `${book} ${usd(px)}` : NR },
      { from: 'steward', to: 'chart', label: failed.length ? `${failed.length} check(s) failed` : 'snapshot ok' },
      { from: 'chart', to: 'scout', label: c.bias ? `bias ${String(c.bias).toUpperCase()}` : NR },
      { from: 'news', to: 'scout', label: news ? `news ${news.risk}` : 'no catalyst data' },
      { from: 'scout', to: 'pm', label: `${signals.length} candidate(s)` },
      { from: 'evaluator', to: 'pm', label: bt ? 'evidence attached' : 'no evidence' },
      { from: 'scout', to: 'bear', label: signals.length ? 'for challenge' : 'nothing to challenge', advisory: true },
      { from: 'bear', to: 'judge', label: 'objections', advisory: true },
      { from: 'pm', to: 'cro', label: opened ? 'proposal' : 'WAIT' },
      { from: 'cro', to: 'exec', label: cooling ? 'VETO' : opened ? 'size approved' : 'nothing to size' },
      { from: 'exec', to: 'manager', label: opened ? 'position opened' : lr.action || NR },
      { from: 'manager', to: 'auditor', label: p ? 'position logged' : 'no change' },
      { from: 'judge', to: 'experiment', label: 'verdict (shadow)', advisory: true },
      { from: 'auditor', to: 'postmortem', label: have ? usd(st.equity) : NR },
    ];

    const eq = curve.map((x) => +x.equity).filter(finite);
    const startEq = finite(st.startEquity) && st.startEquity > 0 ? st.startEquity : null;
    const growth = { points: eq, start: startEq, now: have ? st.equity + (finite(lr.upnl) ? lr.upnl : 0) : null, closedNet: trades.reduce((a, t) => a + (finite(+t.net) ? +t.net : 0), 0), closedN: trades.length };
    growth.pct = growth.start && growth.now != null ? (growth.now / growth.start - 1) * 100 : null;
    return { floors: FLOORS, staff, desks, research: RESEARCH, workflow, flow, growth, experiment: ex === undefined ? null : ex, runFresh, runAt: Number.isFinite(runT) ? runT : null, action: lr.action || null, book };
  }

  const api = { build, ROSTER, FLOORS, FAMILY, RESEARCH, WORKFLOW, FRESH_MS, NR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DeskTower = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
