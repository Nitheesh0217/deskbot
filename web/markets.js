// Markets tab: a dense, terminal-style context board around the bot's two books (BTC, PAXG).
// Ideas adapted from OpenTerminal (MIT, github.com/ErTasselli/OpenTerminal): market clocks, feed latency, crypto board with
// dominance and sparklines, macro tiles, economic calendar, de-duplicated news, flash on change.
// Data comes from /api/feeds (a fixed-allowlist proxy). Display only: nothing here reaches the trading engine.
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  const money = (v, d) => (fin(v) ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: d ?? (v >= 100 ? 0 : v >= 1 ? 2 : 4), maximumFractionDigits: d ?? (v >= 100 ? 0 : v >= 1 ? 2 : 4) }) : '—');
  const big = (v) => (!fin(v) ? '—' : v >= 1e12 ? '$' + (v / 1e12).toFixed(2) + 'T' : v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : '$' + v.toFixed(0));
  const pct = (v) => (fin(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%' : '—');
  const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? Math.round(s) + 's' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd'; };
  const S = { feeds: {}, timers: [], started: false, newsTab: 'btc', calFilter: 'hm', prev: {} };

  async function feed(k) {
    const t0 = performance.now();
    try {
      const r = await fetch(`./api/feeds?k=${k}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
      S.feeds[k] = { ok: true, ms: Math.round(performance.now() - t0), at: Date.now(), data: j.data, fetchedAt: j.fetchedAt };
    } catch (e) { S.feeds[k] = { ...(S.feeds[k] || {}), ok: false, err: String(e.message || e).slice(0, 80), at: Date.now() }; }
    paint(k); latency();
  }

  // ── clocks and sessions (UTC hours; BTC trades 24/7, sessions matter to the session strategies) ──
  const SESSIONS = [['Asia', 0, 8], ['London', 7, 16], ['New York', 13, 21]];
  function clocks() {
    const el = $('mkClocks'); if (!el) return; const now = new Date(), h = now.getUTCHours() + now.getUTCMinutes() / 60;
    const z = (tz, l) => `<span class="clk"><b>${l}</b> ${now.toLocaleTimeString('en-GB', { timeZone: tz, hour12: false })}</span>`;
    const active = SESSIONS.filter(([, a, b]) => h >= a && h < b).map(([n]) => n);
    const next = SESSIONS.map(([n, a]) => ({ n, dt: ((a - h + 24) % 24) || 24 })).filter((x) => !active.includes(x.n)).sort((a, b) => a.dt - b.dt)[0];
    const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })), nyMin = ny.getHours() * 60 + ny.getMinutes(), wk = ny.getDay() > 0 && ny.getDay() < 6;
    const nyse = wk && nyMin >= 570 && nyMin < 960;
    el.innerHTML = z('UTC', 'UTC') + z('America/New_York', 'NY') + z('Europe/London', 'LDN') + z('Asia/Tokyo', 'TYO') +
      `<span class="clk ses"><i class="dot on"></i>CRYPTO 24/7</span><span class="clk ses"><i class="dot ${nyse ? 'on' : ''}"></i>NYSE ${nyse ? 'OPEN' : 'CLOSED'}</span>` +
      `<span class="clk ses">session: <b>${active.length ? active.join(' + ') : 'none'}</b>${next ? ` · ${esc(next.n)} opens in ${Math.floor(next.dt)}h${String(Math.round((next.dt % 1) * 60)).padStart(2, '0')}m` : ''}</span>`;
  }
  function latency() {
    const el = $('mkFeeds'); if (!el) return;
    el.innerHTML = 'feeds: ' + ['crypto', 'macro', 'calendar', 'news'].map((k) => { const f = S.feeds[k]; return `<span class="lat ${!f ? '' : f.ok ? 'ok' : 'bad'}" title="${esc(f && f.err || '')}">${k} ${!f ? '…' : f.ok ? f.ms + 'ms · ' + ago(f.at) : 'down'}</span>`; }).join(' · ');
  }
  function flash(el, key, val) { if (!el) return; const p = S.prev[key]; if (p != null && val != null && p !== val) { el.classList.remove('fl-up', 'fl-dn'); void el.offsetWidth; el.classList.add(val > p ? 'fl-up' : 'fl-dn'); } S.prev[key] = val; }
  const spark = (pts, up) => { if (!pts || pts.length < 2) return ''; const lo = Math.min(...pts), hi = Math.max(...pts), sp = hi - lo || 1; const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1) * 80).toFixed(1)} ${(22 - (v - lo) / sp * 20).toFixed(1)}`).join(''); return `<svg class="spk" viewBox="0 0 80 24" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" class="${up ? 'up' : 'dn'}"/></svg>`; };

  function paint(k) {
    const f = S.feeds[k];
    if (k === 'crypto') {
      const el = $('mkCrypto'), hd = $('mkCryptoHead'); if (!el) return;
      if (!f || !f.ok) { el.innerHTML = `<p class="mk-note">${f ? 'Crypto feed unavailable: ' + esc(f.err) : 'Loading…'}</p>`; return; }
      const g = f.data.global;
      hd.innerHTML = g ? `<span>Total <b>${big(g.totalMarketCap)}</b> <i class="${(g.change24h || 0) >= 0 ? 'up' : 'down'}">${pct(g.change24h)}</i></span><span>BTC.D <b>${fin(g.btcDominance) ? g.btcDominance.toFixed(1) + '%' : '—'}</b></span><span>ETH.D <b>${fin(g.ethDominance) ? g.ethDominance.toFixed(1) + '%' : '—'}</b></span><span class="faint">${esc(f.data.source)}</span>` : `<span class="faint">${esc(f.data.source)} · dominance unavailable</span>`;
      el.innerHTML = `<table class="mk-t"><thead><tr><th>#</th><th>Asset</th><th class="r">Last</th><th class="r">24h</th><th class="r hide-s">Mkt cap</th><th class="r hide-s">7d</th></tr></thead><tbody>` +
        f.data.rows.map((r) => `<tr class="${r.symbol === 'BTC' || r.symbol === 'PAXG' ? 'book' : ''}"><td class="faint">${r.rank ?? ''}</td><td><b>${esc(r.symbol)}</b> <span class="faint hide-s">${esc(r.name)}</span>${r.symbol === 'BTC' || r.symbol === 'PAXG' ? ' <span class="bk">BOOK</span>' : ''}</td><td class="r num" data-k="px-${esc(r.symbol)}">${money(r.price)}</td><td class="r num ${(r.change24h || 0) >= 0 ? 'up' : 'down'}">${pct(r.change24h)}</td><td class="r num hide-s">${big(r.marketCap)}</td><td class="r hide-s">${spark(r.spark, (r.change24h || 0) >= 0)}</td></tr>`).join('') + '</tbody></table>';
      f.data.rows.forEach((r) => flash(el.querySelector(`[data-k="px-${CSS.escape(r.symbol)}"]`), 'px-' + r.symbol, r.price));
    }
    if (k === 'macro') {
      const el = $('mkMacro'); if (!el) return;
      if (!f || !f.ok) { el.innerHTML = `<p class="mk-note">${f ? 'Macro feed unavailable: ' + esc(f.err) : 'Loading…'}</p>`; return; }
      const by = Object.fromEntries(f.data.map((x) => [x.id, x]));
      const curve = fin(by.DGS10 && by.DGS10.value) && fin(by.DGS2 && by.DGS2.value) ? by.DGS10.value - by.DGS2.value : null;
      el.innerHTML = f.data.map((x) => `<div class="mk-tile"><span>${esc(x.label)}</span><b class="num">${fin(x.value) ? x.value.toFixed(x.id === 'DTWEXBGS' ? 2 : 2) + (x.id.startsWith('DGS') || x.id === 'DFEDTARU' ? '%' : '') : '—'}</b><i class="${(x.change || 0) > 0 ? 'up' : (x.change || 0) < 0 ? 'down' : 'faint'}">${fin(x.change) ? (x.change > 0 ? '▲' : x.change < 0 ? '▼' : '·') + ' ' + Math.abs(x.change).toFixed(2) : ''}</i><small class="faint">${esc(x.date || '')}</small></div>`).join('') +
        (curve != null ? `<div class="mk-tile"><span>10Y − 2Y</span><b class="num ${curve < 0 ? 'down' : ''}">${curve >= 0 ? '+' : ''}${curve.toFixed(2)}</b><i class="faint">${curve < 0 ? 'inverted' : 'normal'}</i><small class="faint">curve</small></div>` : '');
    }
    if (k === 'calendar') {
      const el = $('mkCal'); if (!el) return;
      if (!f || !f.ok) { el.innerHTML = `<p class="mk-note">${f ? 'Calendar unavailable: ' + esc(f.err) : 'Loading…'}</p>`; return; }
      const now = Date.now(), keep = (e) => S.calFilter === 'all' || (S.calFilter === 'h' ? e.impact === 'High' : e.impact === 'High' || e.impact === 'Medium');
      const ev = f.data.filter(keep), next = ev.find((e) => Date.parse(e.date) > now && e.impact === 'High');
      $('mkNext').innerHTML = next ? `Next high-impact: <b>${esc(next.country)} ${esc(next.title)}</b> in <b>${countdown(Date.parse(next.date) - now)}</b>` : 'No more high-impact events this week';
      let day = '';
      el.innerHTML = ev.map((e) => { const t = Date.parse(e.date), d = new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); const hdr = d !== day ? `<div class="cal-day">${d} (UTC)</div>` : ''; day = d;
        return hdr + `<div class="cal-row ${t < now ? 'past' : ''} ${t > now && t - now < 3 * 3600e3 ? 'soon' : ''}"><span class="num">${new Date(t).toISOString().slice(11, 16)}</span><i class="imp ${esc(e.impact)}" title="${esc(e.impact)} impact"></i><b>${esc(e.country)}</b><span class="tt">${esc(e.title)}</span><span class="num faint">${e.forecast ? 'f ' + esc(e.forecast) : ''}${e.previous ? ' · p ' + esc(e.previous) : ''}</span></div>`; }).join('') || '<p class="mk-note">No events for this filter.</p>';
    }
    if (k === 'news') {
      const el = $('mkNews'); if (!el) return;
      if (!f || !f.ok) { el.innerHTML = `<p class="mk-note">${f ? 'News unavailable: ' + esc(f.err) : 'Loading…'}</p>`; return; }
      const list = (f.data[S.newsTab] || []);
      el.innerHTML = list.map((n) => `<a class="nw" ${n.link ? `href="${esc(n.link)}" target="_blank" rel="noopener noreferrer"` : ''}><span>${esc(n.title)}</span><small class="faint">${esc(n.publisher)}${n.publishedAt ? ' · ' + ago(Date.parse(n.publishedAt)) + ' ago' : ''}</small></a>`).join('') || '<p class="mk-note">No headlines.</p>';
    }
  }
  const countdown = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 1440 ? Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h' : m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; };

  function start() {
    if (S.started) return; S.started = true;
    const every = (k, ms) => { feed(k); S.timers.push(setInterval(() => { if (!document.hidden && !$('v-markets').hidden) feed(k); }, ms)); };
    every('crypto', 60e3); every('macro', 15 * 60e3); every('calendar', 10 * 60e3); every('news', 5 * 60e3);
    clocks(); S.timers.push(setInterval(() => { if (!$('v-markets').hidden) { clocks(); latency(); paint('calendar'); } }, 1000));
    document.querySelectorAll('#mkNewsTabs button').forEach((b) => b.addEventListener('click', () => { S.newsTab = b.dataset.n; document.querySelectorAll('#mkNewsTabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); paint('news'); }));
    document.querySelectorAll('#mkCalFilter button').forEach((b) => b.addEventListener('click', () => { S.calFilter = b.dataset.f; document.querySelectorAll('#mkCalFilter button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); paint('calendar'); }));
  }
  /** Next high-impact event, for the tower's catalyst analyst (display only). Loads the calendar once if needed. */
  async function nextHighImpact() {
    if (!S.feeds.calendar || !S.feeds.calendar.ok || Date.now() - S.feeds.calendar.at > 30 * 60e3) await feed('calendar');
    const f = S.feeds.calendar; if (!f || !f.ok) return null; const now = Date.now();
    const e = f.data.find((x) => x.impact === 'High' && Date.parse(x.date) > now); return e ? { ...e, inMs: Date.parse(e.date) - now, label: `${e.country} ${e.title} in ${countdown(Date.parse(e.date) - now)}` } : null;
  }
  document.addEventListener('desk:view', (e) => { if (e.detail.view === 'markets') start(); });
  root.DeskMarkets = { start, nextHighImpact, _state: S };
})(typeof globalThis !== 'undefined' ? globalThis : this);
