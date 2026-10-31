// Decision receipts (System view): what each strategy's RULES did on the newest evaluated 5m bar, grouped so that an executed
// entry, a wait, a gate rejection and an off-cadence bar are never blended. Presentation only: reads lastRun.receipts, fetches
// nothing. These are recorded rule outcomes, not predictions; no confidence or probability is shown or implied.
// Pattern idea (WAIT / rejected / executed kept apart): mars-tw/jev-trading-command-center (MIT); no code copied.
(function (root) {
  'use strict';
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); };
  /** Display groups, in order. Outcomes come from the backend (observe.ts); anything unknown lands in "Other" rather than vanishing. */
  var GROUPS = [
    ['executed', 'Executed', ['EXECUTED']],
    ['waiting', 'Waiting', ['WAIT', 'NO_SETUP', 'SHADOW_SIGNAL']],
    ['rejected', 'Rejected by gates', ['GATE_REJECTED']],
    ['notdue', 'Not due', ['NOT_DUE']],
    ['off', 'Off', ['DISABLED']],
  ];
  var TAG = { WAIT: 'wait', NO_SETUP: 'no setup', SHADOW_SIGNAL: 'shadow only, not entered' };
  var DISCLAIMER = 'Rule outcomes recorded by the paper engine for its newest evaluated 5m bar. They are not predictions: no confidence or probability is implied.';
  var num = function (x) { return typeof x === 'number' && Number.isFinite(x); };

  /** View model for one book's lastRun. state: none | not-reported | no-new-bar | ok. */
  function model(lastRun) {
    if (!lastRun || typeof lastRun !== 'object') return { state: 'none', groups: [], barT: null, total: 0 };
    if (!Object.prototype.hasOwnProperty.call(lastRun, 'receipts')) return { state: 'not-reported', groups: [], barT: null, total: 0 };
    var list = lastRun.receipts;
    if (!Array.isArray(list)) return { state: 'no-new-bar', groups: [], barT: null, total: 0 };
    var known = {}, groups = GROUPS.map(function (g) { g[2].forEach(function (o) { known[o] = g[0]; }); return { id: g[0], label: g[1], items: [] }; });
    var other = { id: 'other', label: 'Other', items: [] }, barT = null;
    list.forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var item = { strategy: String(r.strategy || 'unknown'), outcome: String(r.outcome || 'unknown'), code: r.code ? String(r.code) : null, reason: typeof r.reason === 'string' && r.reason ? r.reason : 'reason not recorded', barT: num(r.barT) ? r.barT : null, tag: TAG[r.outcome] || null };
      if (item.outcome !== 'SHADOW_SIGNAL' && item.barT != null && (barT == null || item.barT > barT)) barT = item.barT;
      var gid = known[item.outcome]; (gid ? groups.filter(function (g) { return g.id === gid; })[0] : other).items.push(item);
    });
    if (other.items.length) groups.push(other);
    return { state: 'ok', groups: groups, barT: barT, total: list.length };
  }

  var CLS = { executed: 'up', waiting: '', rejected: 'warn', notdue: 'faint', off: 'faint', other: 'down' };
  function html(m, opts) {
    var o = opts || {}, nameOf = typeof o.nameOf === 'function' ? o.nameOf : function (x) { return x; };
    var head = '<h2>Decision receipts' + (o.bookLabel ? ' · ' + esc(o.bookLabel) : '') + '</h2><p class="note obs-disclaimer">' + esc(DISCLAIMER) + '</p>';
    if (m.state === 'none') return head + '<p class="note obs-nr">No run reported for this book.</p>';
    if (m.state === 'not-reported') return head + '<p class="note obs-nr">Decision receipts not reported by this backend version.</p>';
    if (m.state === 'no-new-bar') return head + '<p class="note obs-nr">The last run evaluated no new 5m bar, so it recorded no receipts.</p>';
    var bar = m.barT != null ? '<p class="note faint">Bar closed ' + esc(new Date(m.barT + 1).toISOString().slice(0, 16).replace('T', ' ')) + ' UTC · ' + m.total + ' receipts</p>' : '';
    return head + bar + '<div class="obs-groups">' + m.groups.map(function (g) {
      return '<div class="obs-group" data-group="' + g.id + '"><div class="obs-group-h"><b class="' + CLS[g.id] + '">' + esc(g.label) + '</b><span class="num faint">' + g.items.length + '</span></div>' +
        (g.items.length ? '<ul>' + g.items.map(function (r) {
          return '<li><span class="obs-strat">' + esc(nameOf(r.strategy)) + (r.tag ? ' <i class="faint">(' + esc(r.tag) + ')</i>' : '') + '</span><span class="obs-reason">' + esc(r.reason) + (r.code ? ' <span class="faint">[' + esc(r.code) + ']</span>' : '') + '</span></li>';
        }).join('') + '</ul>' : '<p class="note faint">None</p>') + '</div>';
    }).join('') + '</div>';
  }

  /** Creates (once) a card in the System view right after the freshness card (or the evidence card) and fills it. */
  function mount(view, lastRun, opts) {
    if (!view || !view.ownerDocument) return;
    var doc = view.ownerDocument, card = doc.getElementById('obsReceipts');
    if (!card) {
      card = doc.createElement('div'); card.className = 'card obs-card'; card.id = 'obsReceipts'; card.setAttribute('aria-label', 'Decision receipts');
      var after = doc.getElementById('obsFresh') || view.querySelector(':scope > .card');
      if (after && after.parentNode === view && after.nextSibling) view.insertBefore(card, after.nextSibling); else view.appendChild(card);
    }
    card.innerHTML = html(model(lastRun), opts);
  }

  root.DeskReceipts = Object.freeze({ GROUPS: GROUPS, DISCLAIMER: DISCLAIMER, model: model, html: html, mount: mount });
})(typeof globalThis !== 'undefined' ? globalThis : this);
