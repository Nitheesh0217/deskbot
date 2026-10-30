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
    analyst: ['Avery', 'Analyst team (market · sentiment · positioning · news)', 'RULES', 'portfolio'],
    bull: ['Sky', 'Bull researcher', 'AI', 'portfolio'],
    bear: ['Blake', 'Bear researcher', 'AI', 'portfolio'],
    judge: ['Harper', 'Research manager (judges the debate)', 'AI', 'portfolio'],
    trader: ['Tess', 'Committee trader (take or pass)', 'AI', 'portfolio'],
    cio: ['Cass', 'Portfolio manager (final rating, scored in FILTER-1)', 'AI', 'portfolio'],
    riskdebate: ['Rio', 'Risk debate (aggressive · conservative · neutral)', 'AI', 'risk'],
    scout: ['Sage', 'Setup scout', 'RULES', 'desks'],
    researcher: ['Rhea', 'Offline researcher', 'OFFLINE', 'research'],
    chart: ['Ada', 'Market-structure analyst', 'RULES', 'intel'],
    zones: ['Zed', 'Zone mapper (FVG / OB / value)', 'RULES', 'intel'],
    news: ['Nora', 'Catalyst analyst (news)', 'RULES+AI', 'intel'],
    steward: ['Stella', 'Evidence steward', 'RULES', 'data'],
    feed: ['Felix', 'Price & candle feed', 'RULES', 'data'],
    deriv: ['Dara', 'Derivatives data (funding, OI)', 'RULES', 'data'],
    // workers that run outside the 5-minute book loop (the 15-minute scan job, owner chat); same infrastructure, own outputs
    scanner: ['Mira', 'Market scanner (10 markets, 15 min)', 'RULES', 'desks'],
    caller: ['Cole', 'Call maker & scorer (CALL-1, 4 h)', 'RULES', 'research'],
    tracker: ['Tara', 'Setup tracker (forward record)', 'RULES', 'research'],
    options: ['Opal', 'Options & futures reader (Deribit)', 'RULES', 'intel'],
    assistant: ['Ash', 'Desk assistant (owner chat)', 'AI', 'ops'],
  };
  // Worker states shown in the tower. Waiting for a legitimate trigger is healthy; missing telemetry is UNKNOWN, never healthy.
  const STATES = ['RUNNING', 'WAITING', 'DISABLED', 'BLOCKED', 'DEGRADED', 'ERROR', 'UNKNOWN'];
  const STATUS_OF = { RUNNING: 'working', WAITING: 'idle', DISABLED: 'off', BLOCKED: 'off', DEGRADED: 'alert', ERROR: 'alert', UNKNOWN: 'idle' };
  const AI_KEYS = 'GROQ_API_KEY, GEMINI_API_KEY, NVIDIA_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY, GITHUB_MODELS_TOKEN or OPENROUTER_API_KEY';
  const SRC = 'https://github.com/Nitheesh0217/deskbot/blob/main/supabase/functions/deskbot-v5/';
  /** Next run of a minute-list cron schedule (UTC), e.g. [7,22,37,52]. */
  /** A timestamp that can establish health: parseable and not in the future (2 min clock tolerance). */
  const validTs = (x, now) => { const t = typeof x === 'number' ? x : Date.parse(x); return Number.isFinite(t) && t <= now + 120e3 ? t : null; };
  const nextAt = (mins, now) => { const d = new Date(now); d.setUTCSeconds(0, 0); for (let i = 1; i <= 61; i++) { const t = new Date(d.getTime() + i * 60e3); if (mins.includes(t.getUTCMinutes())) return t.getTime(); } return null; };
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
  /** A worker with an explicit state and the facts behind it. Visual status follows the state. */
  function worker(id, state, line, facts = {}, detail = []) { const w = member(id, STATUS_OF[state] || 'idle', line, detail, facts.lastSuccess || null); w.state = state; w.facts = facts; return w; }
  /** Default state for members still built with the older status vocabulary. idle without a fresh run is UNKNOWN, not healthy. */
  const stateFor = (e, runFresh) => e.state || (e.status === 'working' ? 'RUNNING' : e.status === 'alert' ? 'ERROR' : e.status === 'off' ? (e.kind === 'OFFLINE' ? 'DISABLED' : 'BLOCKED') : runFresh ? 'WAITING' : 'UNKNOWN');

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
    const cal = input.calendarNext && input.calendarNext.label ? input.calendarNext : null;
    add(member('news', news ? (news.risk === 'high' ? 'alert' : 'working') : cal ? 'working' : 'idle', news ? `news risk ${String(news.risk).toUpperCase()} (${String(news.by || '').startsWith('ai:') ? 'AI' : 'keyword rules'}, ${news.mode || NR} mode)${cal ? ` · next high-impact: ${cal.label}` : ''}` : cal ? `next high-impact: ${cal.label}` : NR,
      [...(news && news.reason ? [String(news.reason)] : []), ...(cal ? [`Calendar (Forex Factory, display only): ${cal.label}${cal.forecast ? ' · forecast ' + cal.forecast : ''}${cal.previous ? ' · previous ' + cal.previous : ''}`, 'The engine\'s news pause is a separate rule-based layer; the calendar does not gate trades'] : [])]));

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
    const say = (o) => o.rating ? `${o.rating}${o.stance ? ' → ' + o.stance : ''}: ${o.rationale || o.executive_summary || ''}` : o.action ? `${String(o.action).toUpperCase()}: ${o.reason || ''}` : o.argument ? o.argument : o.verdict ? `${o.verdict}: ${o.reason || ''}` : (o.summary || o.case || NR);
    const aiFlags = input.ai || null;   // status.ai: provider names and feature switches (no secrets)
    const role = (id, agents_, label) => {
      const rs = [].concat(agents_).map(prov).filter(Boolean), r = rs[0], o = r && r.output;
      const noProvider = providers ? providers.length === 0 : !(lr.ai && Array.isArray(lr.ai.providers) && lr.ai.providers.length);
      const off = aiFlags && (aiFlags.agentAi === false || aiFlags.deskWorkflow === false);
      const line = o ? say(o) : noProvider ? 'no AI provider configured; this seat is empty' : off ? 'switched off (AGENT_AI or DESK_WORKFLOW = off)' : 'waiting for the next entry to review';
      const status = r && r.error ? 'alert' : r ? (fresh(ts(r), now) ? 'working' : 'idle') : noProvider ? 'off' : 'idle';
      const detail = rs.length > 1 ? rs.map((x) => `${x.agent.replace('desk-risk-', '')}: ${x.error ? 'error' : say(x.output || {})}`.slice(0, 160)) : [];
      const okEver = rs.some((x) => !x.error);   // a logged successful call is the only evidence of connectivity
      const state = r && r.error && fresh(ts(r), now) ? 'ERROR' : noProvider ? 'BLOCKED' : off ? 'DISABLED' : r && !r.error && fresh(ts(r), now) ? 'RUNNING' : okEver ? 'WAITING' : 'UNKNOWN';
      const w = worker(id, state, String(line).slice(0, 220), { lastSuccess: r && !r.error ? ts(r) : null, lastOutput: o ? say(o).slice(0, 120) : null, blocker: noProvider ? `missing credentials: no AI provider secret set (${AI_KEYS}); see docs/AI_PROVIDERS.md` : off ? 'disabled by configuration' : !okEver ? 'provider configured; connectivity unverified (no successful call logged yet)' : null, trigger: 'a new paper entry (event-driven)', evidence: SRC + 'desk.ts', durationMs: r && r.ms != null ? r.ms : null, usage: r && r.provider ? r.provider : null, calls: id === 'riskdebate' ? '3 calls per round (aggressive, conservative, neutral)' : id === 'bull' || id === 'bear' ? '1 call per debate round' : '1 call' },
        r && r.error ? [String(r.error)] : [...detail, `Advisory only (${label}); cannot place, size or block a trade`]);
      w.status = status; return w;
    };
    const an = prov('desk-analysts'), am = an && an.output && an.output.market;
    add(member('analyst', an ? (fresh(ts(an), now) ? 'working' : 'idle') : 'idle', am ? `${am.regime} · trend ${am.supertrend_up_frames}↑ ${am.supertrend_down_frames}↓ · RSI15 ${am.rsi15 ?? NR}` : 'reports on the next entry (rule-based, no provider needed)',
      an && an.output ? [`sentiment: fear/greed ${(an.output.sentiment || {}).fear_greed ?? NR}`, `positioning: funding ${(an.output.positioning || {}).funding_per_interval ?? NR}`, `news: ${(an.output.news || {}).risk ?? NR}`] : [], ts(an)));
    add(role('bull', 'desk-bull', 'argues for'));
    add(role('bear', 'desk-bear', 'argues against'));
    add(role('judge', ['desk-research', 'desk-judge'], 'rates the instrument after the debate'));
    add(role('trader', 'desk-trader', 'take or pass on the plan'));
    add(role('riskdebate', ['desk-risk-aggressive', 'desk-risk-conservative', 'desk-risk-neutral'], 'three-way risk debate'));
    add(role('cio', 'desk-pm', 'final rating, scored in FILTER-1'));
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
    // Theo: his own keyed work-log records (worklog.ts), for this book only
    const mine = agents.filter((a) => a && a.agent === 'manager' && (!a.output || !a.output.symbol || a.output.symbol === (book === 'PAXG' ? 'GOLD' : 'BTC')));
    const mgr = mine[0], mo = (mgr && mgr.output) || {};
    const mgrLine = mgr ? `${mgr.error ? 'FAILED: ' + mgr.error : String(mgr.input_summary || '')}` : '';
    // work-log backlog (persist.ts): records saved with the book but not yet confirmed in the log. Old backlog = delivery is failing.
    const wb = input.work && input.work.backlog ? input.work.backlog[book === 'PAXG' ? 'GOLD' : 'BTC'] : null, wbOld = wb && wb.pending > 0 && wb.oldestQueuedAt ? now - Date.parse(wb.oldestQueuedAt) : 0;
    const mState = mgr && mgr.error && fresh(ts(mgr), now) ? 'ERROR' : !runFresh ? 'UNKNOWN' : wbOld > 30 * 60e3 ? 'DEGRADED' : mgr && fresh(ts(mgr), now) ? 'RUNNING' : 'WAITING';
    add(worker('manager', mState, p ? `managing ${String(p.dir).toUpperCase()} ${p.strategy} · stop ${num(p.stop, 0)}${p.tp1Done ? ' · TP1 taken' : ''}${mgr ? ' · last action: ' + mgrLine : ''}` : mgr ? `flat · last action: ${mgrLine}` : 'flat, no position to manage',
      { lastAttempt: runFresh && (p || (mgr && fresh(ts(mgr), now))) ? runT : null, lastSuccess: mgr && !mgr.error ? ts(mgr) : null, lastOutput: mgr ? `${mo.action || 'action'} ${mo.ref || ''}`.trim() : null, trigger: p ? 'every 5-minute run while a position is open (1m path)' : 'an open position', backlog: wb ? `${wb.pending} pending${wb.oldestQueuedAt ? ' since ' + wb.oldestQueuedAt.slice(0, 16).replace('T', ' ') + ' UTC' : ''}` : 'not reported', next: runFresh ? nextAt([1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56], now) : null, blocker: mgr && mgr.error ? mgr.error : wbOld > 30 * 60e3 ? `work-log delivery failing: ${wb.pending} record(s) pending for ${Math.round(wbOld / 60e3)} min (kept, not lost)` : null, evidence: SRC + 'worklog.ts', freshness: runFresh ? 'run fresh' : 'run stale' },
      mine.slice(0, 5).map((x) => `${new Date(ts(x)).toISOString().slice(5, 16).replace('T', ' ')} ${x.error ? 'FAILED ' + x.error : x.input_summary}`)));

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
      steward: staff.steward.line, scout: `${signals.length} candidate(s)`, news: news ? `news ${news.risk}` : NR, bear: staff.bear.status === 'off' ? 'seat empty (no provider)' : prov('desk-pm') ? `committee: ${prov('desk-pm').output.rating || 'no rating'}` : prov('desk-bear') ? 'reviewed' : 'nothing to review',
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
      { from: 'scout', to: 'bull', label: signals.length ? 'case for' : 'nothing to argue', advisory: true },
      { from: 'bull', to: 'bear', label: 'debate', advisory: true },
      { from: 'bear', to: 'judge', label: 'objections', advisory: true },
      { from: 'judge', to: 'trader', label: 'rating', advisory: true },
      { from: 'trader', to: 'riskdebate', label: 'proposal', advisory: true },
      { from: 'riskdebate', to: 'cio', label: 'risk views', advisory: true },
      { from: 'pm', to: 'cro', label: opened ? 'proposal' : 'WAIT' },
      { from: 'cro', to: 'exec', label: cooling ? 'VETO' : opened ? 'size approved' : 'nothing to size' },
      { from: 'exec', to: 'manager', label: opened ? 'position opened' : lr.action || NR },
      { from: 'manager', to: 'auditor', label: p ? 'position logged' : 'no change' },
      { from: 'cio', to: 'experiment', label: 'rating (shadow)', advisory: true },
      { from: 'auditor', to: 'postmortem', label: have ? usd(st.equity) : NR },
    ];

    const eq = curve.map((x) => +x.equity).filter(finite);
    const startEq = finite(st.startEquity) && st.startEquity > 0 ? st.startEquity : null;
    const growth = { points: eq, start: startEq, now: have ? st.equity + (finite(lr.upnl) ? lr.upnl : 0) : null, closedNet: trades.reduce((a, t) => a + (finite(+t.net) ? +t.net : 0), 0), closedN: trades.length };
    growth.pct = growth.start && growth.now != null ? (growth.now / growth.start - 1) * 100 : null;
    // workers outside the book loop: the 15-minute scan job (scanner, call maker, setup tracker, options reader) and owner chat
    const scan = input.scan && typeof input.scan === 'object' ? input.scan : null;
    const scanT = validTs(scan && scan.ts, now), scanAge = scanT != null ? now - scanT : null;
    const ms = scan && Array.isArray(scan.markets) ? scan.markets : [], okN = ms.filter((x) => x && x.ok).length, setupsN = ms.reduce((a, x) => a + ((x && x.setups) || []).length, 0);
    const barT = Math.max(0, ...ms.map((x) => (x && finite(x.barT) ? x.barT : 0)));
    const scanNext = nextAt([7, 22, 37, 52], now);
    const scanHealth = !scan ? ['UNKNOWN', 'no scan in the status payload'] : scanT == null ? ['UNKNOWN', `scan timestamp ${scan.ts == null ? 'missing' : Date.parse(scan.ts) > now ? 'in the future' : 'invalid'}: health cannot be established`]
      : scanAge > 35 * 60e3 ? ['ERROR', `no successful scan for ${Math.round(scanAge / 60e3)} min (expected every 15)`] : scanAge > 20 * 60e3 ? ['DEGRADED', `last scan ${Math.round(scanAge / 60e3)} min ago (expected every 15)`] : ['RUNNING', null];
    const scanOk = scanHealth[0] === 'RUNNING';
    const scanBase = { lastAttempt: null, lastAttemptNote: 'failed attempts are recorded only as ERROR events, not per worker', next: scanNext, durationMs: scan && finite(scan.ms) ? scan.ms : null, freshness: barT ? `newest closed 5m bar ${Math.round((now - barT) / 60e3)} min old` : null };
    const scannerState = scanHealth[0] !== 'RUNNING' ? scanHealth[0] : !ms.length || !okN ? 'ERROR' : okN < ms.length ? 'DEGRADED' : 'RUNNING';
    add(worker('scanner', scannerState, scan ? `${okN}/${ms.length} markets read · ${setupsN} rule setup(s)${scanBase.durationMs != null ? ` · ${Math.round(scanBase.durationMs / 100) / 10} s` : ''}` : 'no scan reported',
      { ...scanBase, lastSuccess: scannerState === 'RUNNING' || scannerState === 'DEGRADED' ? scanT : null, lastOutput: scan ? `${okN} markets, ${setupsN} setups${scanT ? ' at ' + new Date(scanT).toISOString().slice(11, 16) + ' UTC' : ''}` : null,
        blocker: scanHealth[1] || (!ms.length ? 'scan covered 0 markets' : !okN ? 'every market failed' : okN < ms.length ? `${ms.length - okN} market(s) failed: ${ms.filter((x) => !x.ok).map((x) => x.sym + ' ' + (x.error || '')).join('; ').slice(0, 120)}` : null), evidence: SRC + 'scan.ts', trigger: 'cron 7-59/15' }));
    // caller / tracker: only their own telemetry on this scan row counts; the scan's success time is not theirs unless they report it
    const wk = scan && scan.work && typeof scan.work === 'object' ? scan.work : null, errs = wk && Array.isArray(wk.errors) ? wk.errors.map(String) : [];
    const counts = (o, keys) => o && typeof o === 'object' && keys.every((k) => Number.isFinite(o[k])) ? o : null;
    const sub = (id, part, own, label, extra) => {
      const state = scanHealth[0] !== 'RUNNING' ? scanHealth[0] : !wk ? 'UNKNOWN' : own.length ? 'ERROR' : !part ? 'UNKNOWN' : 'RUNNING';
      const blocker = own.join('; ') || (scanHealth[1]) || (!wk ? 'this scan row carries no per-worker telemetry' : !part ? `no valid ${label} counts on the latest scan` : null);
      add(worker(id, state, extra.line, { ...scanBase, lastSuccess: state === 'RUNNING' ? scanT : null, lastOutput: extra.out, blocker, evidence: SRC + 'track.ts', trigger: extra.trigger }));
    };
    const cw = counts(wk && wk.calls, ['new', 'scored', 'open']), tw = counts(wk && wk.tracker, ['new', 'resolved', 'open']);
    const track = input.track && typeof input.track === 'object' ? input.track : null;
    const calls = track && Array.isArray(track.calls) ? track.calls : [], scoredN = calls.reduce((a, c) => a + (finite(c.scored) ? c.scored : 0), 0), openN = calls.reduce((a, c) => a + (finite(c.open) ? c.open : 0), 0);
    sub('caller', cw, errs.filter((e) => /call/i.test(e)), 'call', { line: `${openN} open · ${scoredN} scored (record)${cw ? ` · latest scan +${cw.new} new, ${cw.scored} scored` : ''}`, out: cw ? `+${cw.new} calls, ${cw.scored} scored` : null, trigger: 'each scan; scores 4 h after a call' });
    const tm = track && Array.isArray(track.markets) ? track.markets : [], resN = tm.reduce((a, x) => a + (finite(x.resolved) ? x.resolved : 0), 0), topenN = tm.reduce((a, x) => a + (finite(x.open) ? x.open : 0), 0);
    sub('tracker', tw, errs.filter((e) => !/call/i.test(e)), 'tracker', { line: `${topenN} open · ${resN} resolved setups (record)${tw ? ` · latest scan +${tw.new}` : ''}`, out: tw ? `+${tw.new} new, ${tw.resolved} resolved` : null, trigger: 'each scan; waits for setups to fire' });
    // Opal: usable data per currency; no telemetry, total failure and partial results are different states
    const dv = scan && Array.isArray(scan.deriv) ? scan.deriv.filter((d) => d && typeof d === 'object') : [];
    const usable = (d) => (d.dvol && finite(d.dvol.last)) || (d.options && finite(d.options.putCallOI)) || (Array.isArray(d.futures) && d.futures.length > 0);
    const dOk = dv.filter(usable), dBad = dv.filter((d) => !usable(d) || (Array.isArray(d.errors) && d.errors.length));
    const oState = scanHealth[0] !== 'RUNNING' ? scanHealth[0] : !dv.length ? 'UNKNOWN' : !dOk.length ? 'ERROR' : dBad.length ? 'DEGRADED' : 'RUNNING';
    add(worker('options', oState, dOk.map((d) => `${d.currency} DVOL ${d.dvol && finite(d.dvol.last) ? d.dvol.last : '—'} · P/C ${d.options && finite(d.options.putCallOI) ? d.options.putCallOI : '—'}`).join(' · ') || 'no usable derivatives context',
      { ...scanBase, lastSuccess: oState === 'RUNNING' || oState === 'DEGRADED' ? scanT : null, lastOutput: dOk.map((d) => d.currency).join(', ') || null,
        blocker: scanHealth[1] || (!dv.length ? 'no derivatives telemetry on the latest scan' : dBad.map((d) => `${d.currency}: ${(Array.isArray(d.errors) && d.errors.length ? d.errors.join(', ') : 'no usable data')}`).join('; ') || null), evidence: SRC + 'scan.ts', trigger: 'each scan (context only, never a trade signal)' }));
    // Ash: provider names prove configuration only; connectivity is unverified until a successful call is logged
    const chat = input.chat && typeof input.chat === 'object' ? input.chat : null, chatProv = chat && Array.isArray(chat.ai) && chat.ai.every((x) => typeof x === 'string') ? chat.ai : null;
    const aState = !chat ? 'UNKNOWN' : chat.enabled === false ? 'DISABLED' : !chatProv ? 'UNKNOWN' : !chatProv.length ? 'BLOCKED' : 'UNKNOWN';
    add(worker('assistant', aState, aState === 'DISABLED' ? 'owner chat is off (no DESKBOT_CHAT_KEY password set)' : aState === 'BLOCKED' ? 'no AI provider configured' : chatProv && chatProv.length ? `configured (${chatProv.join(', ')}); connectivity unverified until a successful call is logged` : 'chat status missing or malformed',
      { blocker: aState === 'BLOCKED' ? `missing credentials: no AI provider secret set (${AI_KEYS})` : aState === 'DISABLED' ? 'DESKBOT_CHAT_KEY not set' : !chatProv ? 'chat.ai missing or malformed in the status payload' : 'no successful provider call observed', trigger: 'owner message (event-driven)', usage: chatProv && chatProv.length ? chatProv.join(', ') : null, evidence: SRC + 'chat.ts', permissions: 'explains and proposes; config changes need the owner to apply them; no order tools' }));

    // Health of the per-run seats. A fresh book run proves only what that run reported; historical rows prove nothing current.
    // Output lines stay as they are (last output); state and blocker say whether the worker is executing now.
    const health = (id, state, blocker, extra = {}) => { const e = staff[id]; e.state = state; e.status = STATUS_OF[state]; e.facts = { lastOutput: e.line, ...(e.facts || {}), ...(blocker ? { blocker } : {}), ...extra }; };
    const stale = runT != null && !runFresh ? `latest book run ${Math.round((now - runT) / 60e3)} min old` : 'no book run reported';
    const perRun = (id, reported, missing) => health(id, !runFresh ? 'UNKNOWN' : reported ? 'RUNNING' : 'DEGRADED', !runFresh ? stale : reported ? null : missing, { lastSuccess: runFresh && reported ? runT : null });
    const onEvent = (id, row, trigger) => { const t = row ? ts(row) : null; health(id, row && row.error && fresh(t, now) ? 'ERROR' : row && fresh(t, now) ? 'RUNNING' : runFresh ? 'WAITING' : 'UNKNOWN', row && row.error ? String(row.error) : !runFresh ? stale : null, { lastSuccess: row && !row.error ? t : null, trigger }); };
    perRun('feed', !!lr.source && px != null, 'latest run reported no source or price');
    perRun('deriv', fund != null || oi != null, 'latest run reported no funding or open interest');
    perRun('chart', !!c.bias, 'latest run reported no chart read');
    perRun('zones', !!z, 'latest run reported no zones');
    perRun('scout', !!lr.decision || Array.isArray(dec.signals), 'latest run reported no evaluation');
    perRun('pm', !!lr.action, 'latest run reported no action');
    perRun('cro', have, 'no account state');
    perRun('config', !!integ.hash, 'no config fingerprint reported');
    const newsT = news && finite(news.t) ? news.t : null;
    health('news', !runFresh ? 'UNKNOWN' : newsT == null ? (news ? 'UNKNOWN' : 'WAITING') : now - newsT > 75 * 60e3 ? 'DEGRADED' : 'RUNNING', !runFresh ? stale : newsT != null && now - newsT > 75 * 60e3 ? `last news read ${Math.round((now - newsT) / 60e3)} min ago (expected every 30)` : news && newsT == null ? 'news read has no timestamp' : null, { lastSuccess: newsT });
    onEvent('exec', opened ? { ts: lr.ts } : null, 'a selected candidate');
    health('auditor', pe ? 'ERROR' : !runFresh ? 'UNKNOWN' : opened ? 'RUNNING' : 'WAITING', pe ? String(pe) : !runFresh ? stale : null, { trigger: 'a new entry' });
    onEvent('riskplan', rp, 'signals on a new bar'); onEvent('validator', vr, 'signals on a new bar'); onEvent('postmortem', pmr, 'a closed trade'); onEvent('analyst', an, 'a new paper entry');
    health('evaluator', bt ? 'WAITING' : 'UNKNOWN', bt ? null : 'no live-config backtest in the status payload', { lastOutput: bt ? `${bt.label || 'backtest'} run ${String(bt.ran_at || '').slice(0, 10)}` : null, trigger: 'on-demand backtest (historical evidence, not current execution)' });
    health('experiment', ex == null ? 'UNKNOWN' : ex.started ? 'RUNNING' : 'WAITING', ex == null ? 'experiment report not in the status payload' : null, { trigger: 'each status request (report) / each entry (verdicts)' });
    // Stella's checks include run freshness themselves, so a failed check (stale run included) is DEGRADED, never masked as UNKNOWN
    health('steward', failed.length ? 'DEGRADED' : 'UNKNOWN', failed.length ? `${failed.length} evidence check(s) failed: ${failed.join(', ')} (computed in the browser; no backend worker)` : 'no backend worker: these checks are computed in the browser from the latest run', { trigger: 'dashboard refresh' });
    health('researcher', 'DISABLED', 'offline by design; not in the live loop');
    for (const e of Object.values(staff)) if (!e.state) e.state = stateFor(e, runFresh);

    return { floors: FLOORS, staff, desks, research: RESEARCH, workflow, flow, growth, experiment: ex === undefined ? null : ex, runFresh, runAt: Number.isFinite(runT) ? runT : null, action: lr.action || null, book };
  }

  const api = { build, STATES, nextAt, ROSTER, FLOORS, FAMILY, RESEARCH, WORKFLOW, FRESH_MS, NR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DeskTower = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
