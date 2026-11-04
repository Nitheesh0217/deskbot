// Shared display helpers for the dashboard scripts (classic <script defer> globals, loaded first).
// Presentation only: nothing here reads or changes trading data.
(function (root) {
  'use strict';
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  /** HTML-escape any value; null and undefined become ''. */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  /** True only for a real, finite number (no coercion). */
  const finite = (n) => typeof n === 'number' && Number.isFinite(n);
  /** Relative age of a timestamp (ms, ISO string or Date): "42s ago", "12m ago", "3h ago", "2d ago". */
  function ago(ts, now) {
    const s = ((now == null ? Date.now() : now) - new Date(ts).getTime()) / 1000;
    if (!Number.isFinite(s)) return 'timestamp unknown';
    if (s < 0) return 'future timestamp';
    if (s < 90) return Math.round(s) + 's ago';
    if (s < 5400) return Math.round(s / 60) + 'm ago';
    if (s < 172800) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }
  /** document.getElementById shorthand. */
  const $ = (id) => document.getElementById(id);
  const api = Object.freeze({ esc, ago, finite, $ });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DeskUtil = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
