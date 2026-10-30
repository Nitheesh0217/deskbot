// Browser-only, read-only presentation helpers. No fetches, credentials or order tools.
(function (root) {
  'use strict';
  function configLabel(integrity) {
    if (!integrity || typeof integrity.approved !== 'boolean') return 'Approval not reported';
    return integrity.approved ? 'Fingerprint approved; performance not certified' : 'Not approved; entry enforcement not reported';
  }
  function summarize(status, now, live) {
    var rows = [], issues = [];
    if (!live || !status || typeof status !== 'object') {
      return { mode: 'SAVED SNAPSHOT', rows: [], issues: ['Disconnected from public status; displayed values may be historical.'] };
    }
    if (status.mode !== 'PAPER') issues.push('Paper mode not verified.');
    var books = { BTC: status };
    if (status.books && Object.prototype.hasOwnProperty.call(status.books, 'GOLD')) books.GOLD = status.books.GOLD;
    Object.keys(books).forEach(function (symbol) {
      var b = books[symbol] || {}, lr = b.lastRun || {};
      var update = Date.parse(b.updated), run = Date.parse(lr.ts), bar = lr.market && lr.market.barT;
      var validAge = function (ms) { return Number.isFinite(ms) && now - ms >= -60000 && now - ms <= 1200000; };
      var fresh = validAge(update) && validAge(run) && typeof bar === 'number' && bar <= now && validAge(bar);
      if (!fresh) issues.push(symbol + ': stale, missing or invalid book/run/candle timestamps.');
      if (!b.integrity || b.integrity.approved !== true) issues.push(symbol + ': configuration approval missing; this page cannot infer whether entries are paused.');
      var providers = Array.isArray(lr.ai && lr.ai.providers) ? lr.ai.providers.filter(function (p) { return p === 'groq' || p === 'gemini'; }) : [];
      rows.push({ symbol: symbol, instrument: symbol === 'GOLD' ? 'PAXG proxy (not XAUUSD)' : 'BTC', fresh: fresh, runAt: Number.isFinite(run) ? new Date(run).toISOString() : 'Unknown', approval: configLabel(b.integrity), ai: providers.length ? providers.join(', ') + ' configured; response availability varies' : 'No provider reported; deterministic rules remain active' });
    });
    var bt = status.backtest && status.backtest.results;
    if (!bt || bt.version !== status.version) issues.push('Displayed historical validation does not match the current runtime version.');
    var br = status.brokers;
    if (!br || !Array.isArray(br.connected)) issues.push('Broker connection state not reported.');
    else if (!br.connected.length) issues.push('No broker account connected (read-only registry only). Paper execution only; funded orders ' + (br.fundedOrders === 'disabled' ? 'disabled.' : 'state not reported.'));
    issues.push('Deployed artifact SHA and complete account history are not verified by public status.');
    return { mode: status.mode === 'PAPER' ? 'PAPER · PUBLIC OBSERVATION' : 'MODE UNVERIFIED', rows: rows, issues: issues };
  }
  root.DeskBotEvidence = Object.freeze({ configLabel: configLabel, summarize: summarize });
})(globalThis);
