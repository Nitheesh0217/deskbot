// Paper position checks, market context, config guard, intent check, phase timings, R:R / direction badges, stale-plan
// warnings and privacy mode. Presentation only: reads lastRun fields and the stored position, fetches nothing, never moves a
// level and shows no probabilities. Every value shown is either reported by the runner or computed from displayed levels.
// Pattern ideas (privacy marks that keep price levels, direction badge, R:R from levels rather than model text, stale-plan
// warnings, "first rule (+N more)" summaries) from Superior-Trade/trading-terminal (Apache-2.0,
// Copyright 2026 Superior Trade); written fresh for DeskBot, no code copied.
(function (root) {
  'use strict';
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); };
  var num = function (x) { return typeof x === 'number' && Number.isFinite(x); };
  var has = function (o, k) { return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); };
  var NR = 'not reported';
  /** Liquidation must sit at least this many stop distances beyond entry, or the chip turns amber. */
  var LIQ_WARN_X = 3;
  /** Hyperliquid's minimum order value (USD). */
  var MIN_NOTIONAL_USD = 10;
  var MASK = '$•••', QMASK = '•••';
  var OBSERVE = 'observe-only, not used for decisions';
  var sgn = function (x, dp) { return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(dp); };

  // ── privacy mode ────────────────────────────────────────────────────────────────────────────────────────────────────
  var PRIV_KEY = 'deskbot.privacy';
  var privState = null;
  /** Privacy mode: hides $ amounts and position sizes; R, % and prices stay. Default OFF; remembered per browser. */
  function privacyOn() {
    if (privState === null) { privState = false; try { privState = root.localStorage && root.localStorage.getItem(PRIV_KEY) === '1'; } catch (_) { /* storage optional */ } }
    return !!privState;
  }
  function setPrivacy(on) { privState = !!on; try { if (root.localStorage) root.localStorage.setItem(PRIV_KEY, privState ? '1' : '0'); } catch (_) { /* storage optional */ } return privState; }
  /** A dollar text, masked when privacy is on (the formatter is the caller's). */
  function money(text, on) { return on ? MASK : text; }
  /** A size text, masked when privacy is on. */
  function qty(text, on) { return on ? QMASK : text; }

  // ── position checks ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** View model of lastRun.positionChecks (+ market.hl for szDecimals / max leverage).
   *  state: 'not-reported' (field absent), 'flat' (null: no open position) or 'ok' with chips. Chip state ok | warn | nr. */
  function positionModel(lastRun, opts) {
    var o = opts || {}, priv = !!o.privacy;
    var lr = lastRun && typeof lastRun === 'object' ? lastRun : {};
    if (!has(lr, 'positionChecks')) return { state: 'not-reported', chips: [], notes: [] };
    var pc = lr.positionChecks;
    if (pc === null) return { state: 'flat', chips: [], notes: [] };
    if (typeof pc !== 'object') return { state: 'not-reported', chips: [], notes: [] };
    var hl = (lr.market && lr.market.hl) || {}, chips = [];
    // leverage: amber only against the venue's own reported maximum (no invented threshold)
    var lev = pc.impliedLeverage;
    chips.push({ id: 'leverage', label: 'Leverage', value: num(lev) ? lev.toFixed(2) + '×' : NR,
      state: !num(lev) ? 'nr' : num(hl.maxLeverage) && lev > hl.maxLeverage ? 'warn' : 'ok',
      explain: 'Implied leverage of the paper position (notional ÷ equity)' + (num(hl.maxLeverage) ? '; the venue allows up to ' + hl.maxLeverage + '×.' : '.') });
    var lb = pc.liqBufferX;
    chips.push({ id: 'liq', label: 'Liquidation buffer', value: num(lb) ? lb.toFixed(1) + '× stop' : NR,
      state: !num(lb) ? 'nr' : lb < LIQ_WARN_X || pc.liqOk === false ? 'warn' : 'ok',
      explain: 'Distance from entry to the estimated liquidation price, in stop distances. Amber below ' + LIQ_WARN_X + '×: the stop should trigger well before liquidation.' });
    var nt = pc.notionalUsd, mOk = typeof pc.minNotionalOk === 'boolean' ? pc.minNotionalOk : num(nt) ? nt >= MIN_NOTIONAL_USD : null;
    chips.push({ id: 'minOrder', label: 'Min order', value: mOk == null ? NR : (num(nt) ? money('$' + nt.toFixed(2), priv) + ' vs ' : '') + '$' + MIN_NOTIONAL_USD + ' min',
      state: mOk == null ? 'nr' : mOk ? 'ok' : 'warn', explain: 'Order value against the venue minimum of $' + MIN_NOTIONAL_USD + '; smaller orders would be rejected on a real venue.' });
    var qr = pc.qtyRepresentable;
    chips.push({ id: 'size', label: 'Size representable', value: typeof qr !== 'boolean' ? NR : (qr ? 'yes' : 'no') + (num(hl.szDecimals) ? ' · ' + hl.szDecimals + ' size decimals' : ''),
      state: typeof qr !== 'boolean' ? 'nr' : qr ? 'ok' : 'warn', explain: 'Whether the position size can be expressed in the venue\'s size step (szDecimals).' });
    var dg = pc.degenerateStop;
    chips.push({ id: 'stop', label: 'Degenerate stop', value: typeof dg !== 'boolean' ? NR : dg ? 'yes' : 'no',
      state: typeof dg !== 'boolean' ? 'nr' : dg ? 'warn' : 'ok', explain: 'A degenerate stop sits at or on the wrong side of entry (zero risk distance), so R cannot be defined.' });
    var notes = Array.isArray(pc.notes) ? pc.notes.filter(function (n) { return typeof n === 'string' && n; }) : [];
    return { state: 'ok', ok: typeof pc.ok === 'boolean' ? pc.ok : null, chips: chips, notes: notes };
  }

  // ── badges ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** R:R from the plan levels (DeskPlan.planRows output): reward to each target over the ORIGINAL risk. Uses the plan rows'
   *  own R values, so it always equals the plan table. Never typed by a model. */
  function rrBadge(plan) {
    if (!plan || !Array.isArray(plan.rows)) return null;
    var tps = plan.rows.filter(function (r) { return /^tp[123]$/.test(r.key) && num(r.r); });
    if (!tps.length) return null;
    return { values: tps.map(function (r) { return r.r; }), keys: tps.map(function (r) { return r.key; }),
      text: 'R:R ' + tps.map(function (r) { return '1:' + r.r.toFixed(2); }).join(' · '),
      explain: 'Reward to ' + tps.map(function (r) { return r.key.toUpperCase(); }).join(' / ') + ' over the original risk (entry to original stop), computed from the plan levels.' };
  }
  function dirBadge(dir) {
    if (dir !== 'long' && dir !== 'short') return null;
    return { dir: dir, text: dir === 'long' ? '▲ LONG' : '▼ SHORT' };
  }

  // ── stale plan ──────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Warnings when the displayed price or clock contradicts what the stored plan allows for an OPEN position: price already
   *  beyond TP3 or beyond the active stop, or open longer than the max hold. Computed only from displayed data. */
  function stalePlan(p, price, now, fmt) {
    var out = [], F = typeof fmt === 'function' ? fmt : String;
    if (!p || (p.dir !== 'long' && p.dir !== 'short')) return out;
    var d = p.dir === 'long' ? 1 : -1;
    if (num(price)) {
      if (num(p.tp3) && !p.tp3Done && (price - p.tp3) * d >= 0) out.push({ id: 'beyondTp3', text: 'Plan check: price ' + F(price) + ' is beyond TP3 ' + F(p.tp3) + ' while the position shows open' });
      if (num(p.stop) && (price - p.stop) * d <= 0) out.push({ id: 'beyondStop', text: 'Plan check: price ' + F(price) + ' is beyond the active stop ' + F(p.stop) + ' while the position shows open' });
    }
    if (num(p.openT) && num(p.maxHoldH) && p.maxHoldH > 0 && num(now)) {
      var heldH = (now - p.openT) / 3600e3;
      if (heldH > p.maxHoldH) out.push({ id: 'overHold', text: 'Plan check: open ' + Math.floor(heldH) + 'h, past its max hold of ' + p.maxHoldH + 'h' });
    }
    return out;
  }

  // ── market context ──────────────────────────────────────────────────────────────────────────────────────────────────
  /** Hyperliquid context + range diagnostic. Every cell reads a reported field or says "not reported". */
  function marketModel(lastRun, opts) {
    var o = opts || {}, fmtPx = typeof o.fmtPx === 'function' ? o.fmtPx : function (x) { return String(x); }, unit = o.unit || '';
    var m = (lastRun && lastRun.market) || {}, hl = m.hl && typeof m.hl === 'object' ? m.hl : null, rd = m.rangeDiag && typeof m.rangeDiag === 'object' ? m.rangeDiag : null;
    var cells = [];
    var f = hl && hl.fundingAprPct;
    cells.push({ id: 'funding', label: 'Funding APR (Hyperliquid)', value: num(f) ? sgn(f, 2) + '% APR · ' + (f > 0 ? 'longs pay shorts' : f < 0 ? 'shorts pay longs' : 'neither side pays') : NR, tone: '' });
    var pr = hl && hl.premium;   // Hyperliquid reports premium as a fraction of the oracle price
    cells.push({ id: 'premium', label: 'Premium vs oracle', value: num(pr) ? sgn(pr * 100, 4) + '%' + (num(hl.oraclePx) ? ' · oracle ' + fmtPx(hl.oraclePx) : '') : NR, tone: '' });
    cells.push({ id: 'oi', label: 'Open interest (Hyperliquid)', value: hl && num(hl.oi) ? Math.round(hl.oi).toLocaleString('en-US') + (unit ? ' ' + unit : '') : NR, tone: '' });
    cells.push({ id: 'maxLev', label: 'Max leverage', value: hl && num(hl.maxLeverage) ? hl.maxLeverage + '×' : NR, tone: '' });
    cells.push({ id: 'delisted', label: 'Listing', value: hl && typeof hl.delisted === 'boolean' ? (hl.delisted ? 'Delisted' : 'Listed') : NR, tone: hl && hl.delisted === true ? 'down' : '' });
    var range = !rd ? { state: 'not-reported' } : {
      state: 'ok', efficiency: num(rd.efficiency) ? rd.efficiency.toFixed(2) : NR, touches: num(rd.touches) ? String(Math.round(rd.touches)) : NR,
      verdict: typeof rd.isRange === 'boolean' ? (rd.isRange ? 'Range-like' : 'Not range-like') : NR };
    return { hl: !!hl, cells: cells, range: range };
  }

  // ── config guard / intent / timing ──────────────────────────────────────────────────────────────────────────────────
  /** "first rule (+N more)" over a list of names. */
  function firstPlusMore(names) {
    var list = (names || []).filter(function (n) { return n != null && n !== ''; }).map(String);
    if (!list.length) return '';
    return list[0] + (list.length > 1 ? ' (+' + (list.length - 1) + ' more)' : '');
  }
  function guardModel(lastRun) {
    var lr = lastRun && typeof lastRun === 'object' ? lastRun : {};
    if (!has(lr, 'cfgGuard') || !lr.cfgGuard || typeof lr.cfgGuard !== 'object') return { state: 'not-reported', summary: 'Config guard: ' + NR, violations: [] };
    var v = (Array.isArray(lr.cfgGuard.violations) ? lr.cfgGuard.violations : []).filter(function (x) { return x && typeof x === 'object'; })
      .map(function (x) { return { rule: String(x.rule || 'unnamed rule'), msg: typeof x.msg === 'string' ? x.msg : '' }; });
    if (!v.length && lr.cfgGuard.ok !== false) return { state: 'ok', summary: 'Config guard: all rules pass', violations: [] };
    if (!v.length) return { state: 'fail', summary: 'Config guard: failed (no rule named)', violations: [] };
    return { state: 'fail', summary: 'Config guard: ' + firstPlusMore(v.map(function (x) { return x.rule; })), violations: v };
  }
  function intentModel(lastRun) {
    var ic = lastRun && lastRun.intentCheck;
    if (!ic || typeof ic !== 'object') return { state: 'not-reported', text: 'Intent check: ' + NR, mismatches: [] };
    var mm = (Array.isArray(ic.mismatches) ? ic.mismatches : []).map(function (x) { return typeof x === 'string' ? x : x && typeof x === 'object' ? [x.rule || x.field, x.msg || x.reason].filter(Boolean).join(': ') || JSON.stringify(x) : String(x); });
    if (ic.ok === true && !mm.length) return { state: 'ok', text: 'Intent check: recorded action matches the decision', mismatches: [] };
    return { state: 'fail', text: 'Intent check: ' + (mm.length ? firstPlusMore(mm) : 'mismatch (details not reported)'), mismatches: mm };
  }
  var isEpoch = function (x) { return num(x) && x > 1e12; };
  var hms = function (t) { return new Date(t).toISOString().slice(11, 19) + ' UTC'; };
  var dur = function (ms) { return Math.abs(ms) < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s'; };
  /** Phase timings as reported: bar close → evaluation → paper fill, plus the reported lag. Epoch values show as UTC times with
   *  the step from the previous phase; anything else is shown as a reported duration. */
  function timingModel(lastRun) {
    var t = lastRun && lastRun.timing;
    if (!t || typeof t !== 'object') return { state: 'not-reported', steps: [], lag: NR };
    var steps = [], prev = null;
    [['barCloseT', 'Bar close'], ['evalStartMs', 'Evaluation'], ['fillMs', 'Paper fill']].forEach(function (s) {
      var v = t[s[0]], txt;
      if (isEpoch(v)) { txt = hms(v) + (isEpoch(prev) ? ' (+' + dur(v - prev) + ')' : ''); prev = v; }
      else if (num(v)) txt = dur(v);
      else txt = s[0] === 'fillMs' && v === null ? 'no fill this run' : NR;
      steps.push({ id: s[0], label: s[1], value: txt });
    });
    return { state: 'ok', steps: steps, lag: num(t.lagMs) ? dur(t.lagMs) : NR };
  }

  // ── HTML ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  var chipHTML = function (c) {
    var aria = c.label + ': ' + c.value + '. ' + c.explain;
    return '<span class="rc-chip" data-rc="' + c.id + '" data-state="' + c.state + '" title="' + esc(c.explain) + '" aria-label="' + esc(aria) + '" tabindex="0"><span class="rc-k">' + esc(c.label) + '</span><b>' + esc(c.value) + '</b></span>';
  };
  function badgesHTML(plan) {
    var d = dirBadge(plan && plan.meta && plan.meta.dir), rr = rrBadge(plan), out = '';
    if (d) out += '<span class="rc-badge rc-dir ' + d.dir + '" data-rc="dir">' + esc(d.text) + '</span>';
    if (rr) out += '<span class="rc-badge rc-rr" data-rc="rr" title="' + esc(rr.explain) + '" aria-label="' + esc(rr.text + '. ' + rr.explain) + '">' + esc(rr.text) + '</span>';
    return out;
  }
  function staleHTML(list) {
    return list.map(function (w) { return '<span class="rc-chip rc-stale" data-rc="' + w.id + '" data-state="warn" role="status" aria-label="' + esc(w.text + '. Computed from the displayed price, plan levels and clock; the runner feed may differ.') + '" title="Computed from the displayed price, plan levels and clock; the runner\'s feed may differ.">' + esc(w.text) + '</span>'; }).join('');
  }
  function privacyButton() {
    var on = privacyOn();
    return '<button type="button" class="rc-priv" data-rc-privacy aria-pressed="' + on + '" title="Hide $ amounts and position sizes (R, % and prices stay). Remembered in this browser.">Privacy ' + (on ? 'on' : 'off') + '</button>';
  }

  function safetyHTML(ctx) {
    var c = ctx || {}, pm = positionModel(c.lastRun, { privacy: privacyOn() }), g = guardModel(c.lastRun);
    var head = '<div class="section-top"><h2>Paper position checks (observe-only)</h2>' + privacyButton() + '</div>' +
      '<p class="note faint">Reported by the paper runner for the open position. Checks are displayed, not enforced here; nothing on this page moves a level.</p>';
    var badges = c.pos ? '<div class="rc-row">' + badgesHTML(c.plan) + staleHTML(stalePlan(c.pos, c.price, c.now, c.fmtPx)) + '</div>' : '';
    var body;
    if (pm.state === 'not-reported') body = '<p class="note rc-nr">Position checks not reported by this backend version.</p>';
    else if (pm.state === 'flat') body = '<p class="note rc-nr">No open paper position: nothing to check.</p>';
    else body = '<div class="rc-row" role="list" aria-label="Position checks">' + pm.chips.map(chipHTML).join('') + '</div>' +
      (pm.ok === false ? '<p class="note warn">The runner flags at least one check for this position.</p>' : '') +
      (pm.notes.length ? '<ul class="rc-notes">' + pm.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '');
    var guard = '<p class="note rc-guard" data-state="' + g.state + '">' + esc(g.summary) + '</p>';
    return head + badges + body + guard;
  }
  function marketHTML(ctx) {
    var c = ctx || {}, mm = marketModel(c.lastRun, { fmtPx: c.fmtPx, unit: c.unit });
    var cells = mm.cells.map(function (x) { return '<div data-rc="' + x.id + '"><div class="k">' + esc(x.label) + '</div><div class="v ' + x.tone + (x.value === NR ? ' rc-nrv' : '') + '">' + esc(x.value) + '</div></div>'; }).join('');
    var r = mm.range, range = r.state !== 'ok' ? '<p class="note rc-nr">Range diagnostic not reported.</p>' :
      '<div class="grid2"><div data-rc="eff"><div class="k">Efficiency</div><div class="v">' + esc(r.efficiency) + '</div></div><div data-rc="touches"><div class="k">Edge touches</div><div class="v">' + esc(r.touches) + '</div></div>' +
      '<div data-rc="verdict"><div class="k">Read</div><div class="v">' + esc(r.verdict) + '</div></div></div>';
    return '<div class="section-top"><h2>Market context · ' + esc(c.bookLabel || '') + '</h2><span class="chip">' + esc(OBSERVE) + '</span></div>' +
      (mm.hl ? '' : '<p class="note rc-nr">Hyperliquid market fields not reported by this backend version.</p>') +
      '<div class="grid2">' + cells + '</div><h3 class="rc-h3">Range diagnostic <small class="faint">(' + esc(OBSERVE) + ')</small></h3>' + range;
  }
  function systemHTML(ctx) {
    var c = ctx || {}, g = guardModel(c.lastRun), ic = intentModel(c.lastRun), tm = timingModel(c.lastRun);
    var list = g.violations.length ? '<ul class="rc-rules">' + g.violations.map(function (v) { return '<li><b>' + esc(v.rule) + '</b>' + (v.msg ? ' <span>' + esc(v.msg) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : '';
    var steps = tm.state !== 'ok' ? '<p class="note rc-nr">Phase timings not reported.</p>' :
      '<ol class="rc-steps">' + tm.steps.map(function (s) { return '<li data-rc="' + s.id + '"><span class="k">' + esc(s.label) + '</span><b>' + esc(s.value) + '</b></li>'; }).join('') + '</ol><p class="note">Reported lag: <b>' + esc(tm.lag) + '</b></p>';
    return '<h2>Config guard &amp; run checks' + (c.bookLabel ? ' · ' + esc(c.bookLabel) : '') + '</h2>' +
      '<p class="note faint">Reported by the paper runner. Displayed only; this page does not change configuration.</p>' +
      '<p class="rc-sum" data-state="' + g.state + '">' + esc(g.summary) + '</p>' + list +
      '<p class="rc-sum" data-state="' + ic.state + '">' + esc(ic.text) + '</p>' +
      (ic.mismatches.length > 1 ? '<ul class="rc-rules">' + ic.mismatches.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>' : '') +
      '<h3 class="rc-h3">Phase timings</h3>' + steps;
  }

  /** Chips for the chart's plan panel: direction, R:R and stale-plan warnings plus the privacy toggle. */
  function planChipsHTML(pos, plan, price, now, fmt) {
    return (pos && plan ? badgesHTML(plan) + staleHTML(stalePlan(pos, price, now, fmt)) : '') + privacyButton();
  }

  var onChange = null, bound = false;
  function ensureCard(doc, parent, id, label, afterIds) {
    var card = doc.getElementById(id);
    if (card) return card;
    card = doc.createElement('section'); card.className = 'card rc-card'; card.id = id; card.setAttribute('aria-label', label);
    var after = null; for (var i = 0; i < afterIds.length && !after; i++) { var a = doc.getElementById(afterIds[i]); if (a && a.parentNode === parent) after = a; }
    if (after) parent.insertBefore(card, after.nextSibling); else parent.appendChild(card);
    return card;
  }
  /** Creates (once) the Overview cards (after #posCard) and the System card (after the receipts), and fills them.
   *  ctx = { lastRun, pos, plan, price, now, fmtPx, unit, bookLabel, onChange }. */
  function mount(views, ctx) {
    var desk = views && views.desk, sys = views && views.system;
    if (!desk || !desk.ownerDocument) return;
    var doc = desk.ownerDocument;
    if (ctx && typeof ctx.onChange === 'function') onChange = ctx.onChange;
    if (!bound) {
      bound = true;
      doc.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('[data-rc-privacy]') : null;
        if (!b) return;
        setPrivacy(!privacyOn());
        if (onChange) onChange();
      });
    }
    ensureCard(doc, desk, 'rcSafety', 'Paper position checks', ['posCard']).innerHTML = safetyHTML(ctx);
    ensureCard(doc, desk, 'rcMarket', 'Market context', ['rcSafety', 'posCard']).innerHTML = marketHTML(ctx);
    if (sys) ensureCard(doc, sys, 'rcSystem', 'Config guard and run checks', ['obsReceipts', 'obsFresh']).innerHTML = systemHTML(ctx);
  }

  var api = { LIQ_WARN_X: LIQ_WARN_X, MIN_NOTIONAL_USD: MIN_NOTIONAL_USD, MASK: MASK, QMASK: QMASK, OBSERVE: OBSERVE,
    privacyOn: privacyOn, setPrivacy: setPrivacy, money: money, qty: qty, positionModel: positionModel, rrBadge: rrBadge, dirBadge: dirBadge,
    stalePlan: stalePlan, marketModel: marketModel, firstPlusMore: firstPlusMore, guardModel: guardModel, intentModel: intentModel,
    timingModel: timingModel, safetyHTML: safetyHTML, marketHTML: marketHTML, systemHTML: systemHTML, planChipsHTML: planChipsHTML, mount: mount };
  root.DeskRisk = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
