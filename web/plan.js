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
      rows.push({ key: k, label: k.toUpperCase(), price: p[k], pct: pct(p[k]), r: rOf(p[k]), qty: q0 * share, share, kind: 'executable', status: p[k + 'Done'] ? 'hit' : 'resting' });
    }
    const expiresAt = finite(p.openT) && finite(p.maxHoldH) ? p.openT + p.maxHoldH * 3600e3 : null, now = a.now ?? Date.now();
    const exitRules = [];
    if (a.exitMode === 'HOLD') exitRules.push('stop stays at the original level until TP2, then moves to entry');
    if (a.exitMode === 'BE_AT_TP1') exitRules.push('stop moves to entry at TP1 and to TP1 at TP2');
    if (a.traderParts) exitRules.push(`trade manager may adjust: ${a.traderParts}`);
    if (expiresAt) exitRules.push(`time exit at ${new Date(expiresAt).toISOString().slice(0, 16).replace('T', ' ')} UTC (max hold)`);
    return {
      rows,
      meta: {
        strategy: p.strategy, dir: p.dir, signalTimeframe: a.cadence ? CADENCE_TXT[a.cadence] || a.cadence : null, maxHoldH: p.maxHoldH ?? null,
        maxHoldText: finite(p.maxHoldH) ? (p.maxHoldH >= 48 ? `${+(p.maxHoldH / 24).toFixed(1)} days` : `${p.maxHoldH} h`) : null,
        expiresAt, heldH: finite(p.openT) ? (now - p.openT) / 3600e3 : null, riskPts: R, riskPct: (R / p.entry) * 100, riskAmt: p.riskAmt ?? null, exitRules,
      },
    };
  }
  const api = { planRows, CUM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DeskPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
