// Per-book, per-timeframe data freshness (System view). Presentation only: reads lastRun.frames / lastRun.sources from the
// public status, fetches nothing and never changes trading data. A value the backend did not report is shown as "not reported"
// or MISSING, never as a number. Pattern idea (freshness cards): mars-tw/jev-trading-command-center (MIT); no code copied.
(function (root) {
  'use strict';
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); };
  var MIN = 60000;
  /** Evaluation frames in display order: key in lastRun.frames, label, bar length in ms. */
  var TFS = [['m5', '5m', 5 * MIN], ['m15', '15m', 15 * MIN], ['h1', '1h', 60 * MIN], ['h4', '4h', 240 * MIN]];
  var MIXED_TEXT = 'Mixed feeds: new entries paused this run';
  var SOURCE_LABEL = { hyperliquid: 'Hyperliquid', binance: 'Binance' };

  /** A frame is STALE when its newest closed bar is older than two bar lengths plus two minutes. */
  function staleAfterMs(barMs) { return 2 * barMs + 2 * MIN; }
  var num = function (x) { return typeof x === 'number' && Number.isFinite(x); };
  var srcLabel = function (s) { return typeof s === 'string' && s ? (SOURCE_LABEL[s] || s) : 'not reported'; };

  /** Status of one frame: FRESH / STALE / MISSING. A missing, non-numeric or future close time is MISSING (age null). */
  function frameStatus(frame, barMs, now) {
    var t = frame && frame.lastClosedBarT;
    if (!num(t) || !num(now) || t - now > MIN) return { status: 'MISSING', ageMs: null };
    var age = Math.max(0, now - t);
    return { status: age > staleAfterMs(barMs) ? 'STALE' : 'FRESH', ageMs: age };
  }
  function fmtAge(ms) {
    if (!num(ms)) return 'MISSING';
    var m = Math.round(ms / MIN);
    if (m < 1) return '<1m';
    if (m < 120) return m + 'm';
    var h = Math.floor(m / 60); return h < 48 ? h + 'h ' + (m % 60) + 'm' : Math.round(h / 24) + 'd';
  }
  function fmtT(t) { return num(t) ? new Date(t + 1).toISOString().slice(5, 16).replace('T', ' ') + ' UTC' : 'MISSING'; }

  /** {book: lastRun} from the status response (all books) or, without it, the one book the page shows. */
  function booksFrom(raw, data, book) {
    var out = {};
    if (raw && typeof raw === 'object') {
      var bks = raw.books && typeof raw.books === 'object' ? raw.books : {};
      out.BTC = (bks.BTC && bks.BTC.lastRun) || raw.lastRun || null;
      if (bks.GOLD && (bks.GOLD.lastRun || bks.GOLD.state)) out.GOLD = bks.GOLD.lastRun || null;
      return out;
    }
    var lr = data && data.state && data.state.last_run;
    out[book || 'BTC'] = lr || null;
    return out;
  }

  /** View model: one entry per book with rows per timeframe, or reported:false when the backend sent no frames. */
  function model(books, now) {
    return Object.keys(books || {}).map(function (book) {
      var lr = books[book], frames = lr && lr.frames && typeof lr.frames === 'object' ? lr.frames : null;
      var sources = lr && lr.sources && typeof lr.sources === 'object' ? lr.sources : null;
      var srcOf = function (k) { return frames && frames[k] && frames[k].source || (sources && sources[k]) || null; };
      var seen = TFS.map(function (x) { return srcOf(x[0]); }).filter(Boolean);
      var mixed = seen.length > 1 && seen.some(function (s) { return s !== seen[0]; });
      var rows = frames ? TFS.map(function (x) {
        var f = frames[x[0]] || null, st = frameStatus(f, x[2], now);
        return { tf: x[0], label: x[1], source: srcOf(x[0]), sourceLabel: srcLabel(srcOf(x[0])), lastClosedBarT: st.status === 'MISSING' ? null : f.lastClosedBarT, ageMs: st.ageMs, status: st.status, staleAfterMs: staleAfterMs(x[2]), bars: f && num(f.bars) ? f.bars : null, gaps: f && num(f.gaps) ? f.gaps : null };
      }) : [];
      return { book: book, label: book === 'GOLD' ? 'PAXG' : 'BTC', reported: !!frames, runTs: lr && lr.ts || null, mixed: mixed, banner: mixed ? MIXED_TEXT : null, rows: rows };
    });
  }

  var CSS_STATUS = { FRESH: 'up', STALE: 'warn', MISSING: 'down' };
  function html(m) {
    var head = '<h2>Data freshness by timeframe</h2><p class="note">Newest closed bar per evaluation frame, as reported by the last paper run. ' +
      'STALE = older than two bar lengths plus 2 minutes. Ages use this device\'s clock.</p>';
    if (!m.length) return head + '<p class="note obs-nr">Freshness not reported.</p>';
    return head + m.map(function (b) {
      var top = '<div class="obs-book"><div class="obs-book-h"><b>' + esc(b.label) + '</b><span class="note faint">' + (b.runTs ? 'run ' + esc(String(b.runTs).slice(0, 16).replace('T', ' ')) + ' UTC' : 'run time not reported') + '</span></div>';
      var ban = b.banner ? '<p class="banner obs-mixed" role="status">' + esc(b.banner) + '</p>' : '';
      if (!b.reported) return top + ban + '<p class="note obs-nr">Per-timeframe freshness not reported by this backend version.</p></div>';
      return top + ban + '<div class="obs-grid">' + b.rows.map(function (r) {
        return '<div class="obs-cell" data-tf="' + esc(r.tf) + '" data-status="' + r.status + '"><div class="obs-cell-h"><b>' + esc(r.label) + '</b><span class="obs-st ' + CSS_STATUS[r.status] + '">' + r.status + '</span></div>' +
          '<div class="obs-kv"><span>Source</span><span>' + esc(r.sourceLabel) + '</span></div>' +
          '<div class="obs-kv"><span>Last closed</span><span class="num">' + esc(fmtT(r.lastClosedBarT)) + '</span></div>' +
          '<div class="obs-kv"><span>Age</span><span class="num">' + esc(fmtAge(r.ageMs)) + '</span></div>' +
          '<div class="obs-kv"><span>Missing bars</span><span class="num' + (r.gaps ? ' obs-warn' : '') + '">' + (r.gaps == null ? 'not reported' : esc(String(r.gaps))) + '</span></div></div>';
      }).join('') + '</div></div>';
    }).join('');
  }

  /** Creates (once) a card inside the System view, after the evidence card, and fills it. */
  function mount(view, raw, data, book, now) {
    if (!view || !view.ownerDocument) return;
    var card = view.ownerDocument.getElementById('obsFresh');
    if (!card) {
      card = view.ownerDocument.createElement('div'); card.className = 'card obs-card'; card.id = 'obsFresh'; card.setAttribute('aria-label', 'Data freshness by timeframe');
      var first = view.querySelector(':scope > .card'); if (first && first.nextSibling) view.insertBefore(card, first.nextSibling); else view.appendChild(card);
    }
    card.innerHTML = html(model(booksFrom(raw, data, book), now));
  }

  root.DeskFreshness = Object.freeze({ TFS: TFS, MIXED_TEXT: MIXED_TEXT, staleAfterMs: staleAfterMs, frameStatus: frameStatus, fmtAge: fmtAge, booksFrom: booksFrom, model: model, html: html, mount: mount });
})(typeof globalThis !== 'undefined' ? globalThis : this);
