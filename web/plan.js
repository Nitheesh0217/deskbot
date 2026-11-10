// Plan table for an open paper position: every executable level with its price, distance from entry, R (from the ORIGINAL
// risk, entry → original stop) and exit quantity, plus the strategy's signal timeframe and maximum holding period.
// Pure (no DOM); the chart and the setup card render it. Display only: it never moves a level.
(function (root) {
  'use strict';
  // the engine fills targets cumulatively (engine.ts fill(): CUM tp1 0.5, tp2 0.75, tp3 1.0 of the ORIGINAL quantity)
  const CUM = { tp1: 0.5, tp2: 0.75, tp3: 1 };
  const CADENCE_TXT = { '5m': 'every 5m close', '15m': '15m close', '1h': '1H close', '4h': '4H close', '1d': 'daily close (00:00 UTC)' };
  const finite = (x) => typeof x === 'number' && isFinite(x);

  /**
   * a = { price (current), cadence ('4h' …), exitMode ('HOLD' | 'BE_AT_TP1'), traderParts ('be,stop,…'), now }
   * Returns { rows, meta }. Rows: kind 'executable' (orders the paper engine will act on), 'market' (current price) or
   * 'reference' (original stop: defines 1R, no longer an order once the stop has moved).
   */
  function planRows(p, a) {
    a = a || {};
    const d = p.dir === 'long' ? 1 : -1, R = Math.abs(p.entry - p.stop0), q0 = +p.originalQty;
    const pct = (x) => (finite(x) ? ((x - p.entry) / p.entry) * 100 : null);
    const rOf = (x) => { if (!finite(x) || !(R > 0)) return null; const v = ((x - p.entry) * d) / R; return v === 0 ? 0 : v; };   // no -0
    const rows = [{ key: 'entry', label: `Entry · ${p.dir}`, price: p.entry, pct: 0, r: 0, qty: null, kind: 'executable', status: 'filled' }];
    if (finite(a.price)) rows.push({ key: 'current', label: 'Current price', price: a.price, pct: pct(a.price), r: rOf(a.price), qty: null, kind: 'market', status: '' });
    const moved = p.stop !== p.stop0;
    rows.push({ key: 'stop', label: moved ? 'Active stop' : 'Stop (original = active)', price: p.stop, pct: pct(p.stop), r: rOf(p.stop), qty: +p.remainingQty, kind: 'executable', status: 'resting' });
    if (moved) rows.push({ key: 'stop0', label: 'Original stop (defines 1R)', price: p.stop0, pct: pct(p.stop0), r: -1, qty: null, kind: 'reference', status: 'replaced' });
    let prevCum = 0;
    for (const k of ['tp1', 'tp2', 'tp3']) {
      const cum = CUM[k], share = cum - prevCum; prevCum = cum;
      // the executor closes UP TO cum × original quantity (minus what is already closed), so the planned exit is `share` of the
      // ORIGINAL size and the position is `cum` closed afterwards; an earlier partial close makes the actual fill smaller
      const exitText = `${Math.round(share * 100)}% of original → ${Math.round(cum * 100)}% closed`;
      rows.push({ key: k, label: k.toUpperCase(), price: p[k], pct: pct(p[k]), r: rOf(p[k]), qty: q0 * share, share, cum, exitText, kind: 'executable', status: p[k + 'Done'] ? 'hit' : 'resting' });
    }
    const expiresAt = finite(p.openT) && finite(p.maxHoldH) ? p.openT + p.maxHoldH * 3600e3 : null, now = a.now ?? Date.now();
    const exitRules = [];
    if (a.exitMode === 'HOLD') exitRules.push('stop stays at the original level until TP2, then moves to entry');
    if (a.exitMode === 'BE_AT_TP1') exitRules.push('stop moves to entry at TP1 and to TP1 at TP2');
    if (a.traderParts) exitRules.push(`trade manager may adjust: ${a.traderParts}`);
    if (expiresAt) exitRules.push(`time exit at ${new Date(expiresAt).toISOString().slice(0, 16).replace('T', ' ')} UTC (max hold: a limit, not a forecast that a target is reached by then)`);
    return {
      rows,
      meta: {
        strategy: p.strategy, dir: p.dir, signalTimeframe: a.cadence ? CADENCE_TXT[a.cadence] || a.cadence : null, maxHoldH: p.maxHoldH ?? null,
        maxHoldText: finite(p.maxHoldH) ? (p.maxHoldH >= 48 ? `${+(p.maxHoldH / 24).toFixed(1)} days` : `${p.maxHoldH} h`) : null,
        expiresAt, heldH: finite(p.openT) ? (now - p.openT) / 3600e3 : null, riskPts: R, riskPct: (R / p.entry) * 100, riskAmt: p.riskAmt ?? null, exitRules,
      },
    };
  }
  const sgn = (x, dp) => (x > 0 ? '+' : x < 0 ? '-' : '') + Math.abs(x).toFixed(dp);

  /** Live R of the open position: price distance from entry in units of the ORIGINAL risk (entry → original stop), signed
   *  in the trade's favour. Unrealised only: fills already taken at a target are not included. */
  function liveR(p, price) {
    const R = Math.abs(p.entry - p.stop0), d = p.dir === 'long' ? 1 : -1;
    if (!finite(price) || !(R > 0)) return null;
    let r = ((price - p.entry) * d) / R; if (Math.abs(r) < 0.005) r = 0;
    return { r, text: `${sgn(r, 2)}R open`, note: 'unrealised, from the original risk', tone: r > 0 ? 'up' : r < 0 ? 'down' : 'flat' };
  }

  /** Time in trade against the maximum hold. The max hold is a LIMIT (the engine's time exit), not a forecast.
   *  state: 'ok' below 75% of the limit, 'amber' from 75%, 'red' from 90%. */
  function holdClock(openT, maxHoldH, now) {
    if (!finite(openT) || !finite(maxHoldH) || !(maxHoldH > 0)) return null;
    const heldMs = Math.max(0, (finite(now) ? now : Date.now()) - openT), heldH = heldMs / 3600e3, frac = heldH / maxHoldH;
    const held = heldH < 1 ? `${Math.floor(heldMs / 60e3)}m` : `${Math.floor(heldH)}h`;
    return { heldH, maxHoldH, frac, pct: Math.floor(frac * 100), state: frac >= 0.9 ? 'red' : frac >= 0.75 ? 'amber' : 'ok',
      text: `held ${held} of ${maxHoldH}h (${Math.floor(frac * 100)}%)`, note: 'max hold is a limit, not a forecast' };
  }

  /** Nearest round number to price (step = one power of ten below the price's magnitude: 77,300 → 77,000; 2,640 → 2,600). */
  function roundLevel(price) {
    if (!finite(price) || !(price > 0)) return null;
    const step = Math.pow(10, Math.floor(Math.log10(price)) - 1);
    return { name: 'round number', px: Math.round(price / step) * step };
  }

  /** Curated context levels: at most `cap` (default 5) candidates nearest to the current price, nearest first; a level within
   *  `dedupPct` % (default 0.05) of one already kept is dropped as a duplicate. Display only: never an order. */
  function pickRefs(cands, price, o) {
    o = o || {}; const cap = o.cap ?? 5, tol = ((o.dedupPct ?? 0.05) / 100) * price;
    if (!finite(price)) return [];
    const pool = (cands || []).filter((c) => c && finite(c.px)).map((c) => ({ name: c.name, px: c.px, dist: Math.abs(c.px - price) }))
      .sort((a, b) => a.dist - b.dist), out = [];
    for (const c of pool) { if (out.length >= cap) break; if (out.some((k) => Math.abs(k.px - c.px) <= tol)) continue; out.push({ ...c, label: `Ref · ${c.name}` }); }
    return out;
  }

  /** Short right-edge labels for the executable plan (entry neutral, stop red, targets green), e.g. "TP2 · 3.0R · -8.6%". */
  function levelLabels(plan) {
    if (!plan) return [];
    const out = [], tag = (r) => `${sgn(r.r, 1)}R · ${sgn(r.pct, 1)}%`;
    for (const r of plan.rows) {
      if (r.key === 'entry') out.push({ key: r.key, price: r.price, role: 'entry', title: `Entry · ${plan.meta.dir === 'long' ? 'LONG' : 'SHORT'}`, style: 0, width: 2 });
      else if (r.key === 'stop') out.push({ key: r.key, price: r.price, role: 'stop', title: `Stop · ${tag(r)}`, style: 0, width: 2 });
      else if (r.key === 'stop0') out.push({ key: r.key, price: r.price, role: 'stop', title: 'Orig stop · -1R', style: 2, width: 1 });
      else if (/^tp/.test(r.key)) out.push({ key: r.key, price: r.price, role: 'target', title: `${r.label}${r.status === 'hit' ? ' ✓' : ''} · ${tag(r)}`, style: r.status === 'hit' ? 2 : 0, width: 1 });
    }
    return out;
  }

  const EXIT_CODES = ['TP1', 'TP2', 'TP3', 'STOP', 'TIME', 'MANUAL'];
  /** Exit reason of a closed trade, READ from its recorded reason (engine finalize(): exit kinds joined by "→", e.g.
   *  "TP1→STOP (BE/locked)"); the final exit is the last recorded step. Never inferred from prices: an unrecognised or
   *  missing reason gives code null and the raw text. */
  function exitTag(trade) {
    const raw = trade && typeof trade.reason === 'string' ? trade.reason.trim() : '';
    if (!raw) return null;
    const last = raw.split('→').pop().replace(/\(.*?\)/g, '').trim().toUpperCase();
    const code = EXIT_CODES.includes(last) ? last : null;
    return { code, text: code || raw, recorded: raw, locked: /BE\/locked/.test(raw) };
  }

  const api = { planRows, CUM, liveR, holdClock, roundLevel, pickRefs, levelLabels, exitTag };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DeskPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
