// Trading Tower, building view: the same DeskTower model drawn as a 3D office building (CSS 3D transforms, no libraries).
// Building -> floor (department) -> worker. Only a seat whose reported state is RUNNING is drawn typing; every other state sits
// still and shows its colour and icon. Every text in the worker panel is a field the model already reports; nothing is invented.
(function (root) {
  'use strict';
  // roof -> ground: leadership (portfolio, risk) on top, data infrastructure on the ground floor
  const ORDER = ['portfolio', 'risk', 'execution', 'desks', 'research', 'intel', 'ops', 'data'];
  const STATES = ['RUNNING', 'WAITING', 'DEGRADED', 'BLOCKED', 'ERROR', 'DISABLED', 'UNKNOWN'];
  const ACTIVE = new Set(['RUNNING']);
  const ICON = { RUNNING: '▶', WAITING: '❚❚', DEGRADED: '!', BLOCKED: '⛔', ERROR: '✕', DISABLED: '⏻', UNKNOWN: '?' };
  const WORD = { RUNNING: 'running', WAITING: 'waiting', DEGRADED: 'degraded', BLOCKED: 'blocked', ERROR: 'error', DISABLED: 'disabled', UNKNOWN: 'unknown' };

  /** Pure model -> scene mapping. staff: DeskTower.build(...).staff; roster: DeskTower.ROSTER {id: [name, title, kind, department]}. */
  function scene(staff, roster, floorsMeta) {
    const meta = {}, groups = {};
    (Array.isArray(floorsMeta) ? floorsMeta : []).forEach((f) => { if (f && f.id) meta[f.id] = f; });
    Object.keys(roster || {}).forEach((id) => { const dept = String((roster[id] || [])[3] || 'other'); (groups[dept] = groups[dept] || []).push(id); });
    const rank = (d) => { const i = ORDER.indexOf(d); return i < 0 ? ORDER.length - 2.5 : i; };   // unknown departments sit above ops/data
    const depts = Object.keys(groups).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
    const floors = depts.map((dept, i) => {
      const seats = groups[dept].map((id) => {
        const r = roster[id], e = staff && staff[id], state = e && STATES.includes(e.state) ? e.state : 'UNKNOWN';
        return { id, name: String(r[0]), title: String(r[1]), kind: String(r[2]), dept, state, animated: ACTIVE.has(state) };
      });
      const counts = {}; seats.forEach((s) => { counts[s.state] = (counts[s.state] || 0) + 1; });
      return { id: dept, level: depts.length - i, name: meta[dept] ? meta[dept].name : dept, job: meta[dept] ? meta[dept].job : '', seats, counts };
    });
    return { floors, seats: floors.reduce((a, f) => a + f.seats.length, 0) };
  }
  const api = { scene, ORDER, STATES, ICON };
  root.DeskTower3D = api;
  if (typeof document === 'undefined') return;

  const KEY = 'deskbot.towerView';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const reduce = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const SKIN = ['#f6d5b8', '#e8b98f', '#d79b6c', '#b97a50', '#8a5a3a', '#f1c9a5'];
  const HAIR = ['#2b211c', '#4a3425', '#7a5230', '#1a1a1d', '#b8863b', '#6b6f76'];
  const SHIRT = ['#2f4b7c', '#6b3f69', '#2f6f62', '#7a4a2f', '#3b3f58', '#8a3b3b'];
  const STILL = { WAITING: 'configured and waiting for its trigger; not working right now', DEGRADED: 'reported partial results or a stale input', BLOCKED: 'cannot work until the blocker below is resolved', ERROR: 'its latest attempt failed', DISABLED: 'switched off or offline by design', UNKNOWN: 'no telemetry establishes its state; not assumed healthy' };
  let mode = 'building', M = null, S = null, openFloor = null, picked = null, enter = false, el = null, bar = null;
  try { if (localStorage.getItem(KEY) === 'list') mode = 'list'; } catch (_) { /* storage optional */ }

  const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 90 ? Math.round(s) + 's ago' : s < 5400 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago'; };
  const when = (t) => (Number.isFinite(t) && t > 0 ? `${new Date(t).toISOString().slice(11, 16)} UTC (${ago(t)})` : null);
  const authority = (kind) => kind === 'AI' ? 'Optional free AI role, advisory only; it cannot place, size or block a trade.' : kind === 'RULES+AI' ? 'Fixed rules, with an optional AI summary.' : kind === 'OFFLINE' ? 'Offline research tooling; not part of the live decision loop.' : 'Fixed rules in the cloud runner.';
  const badge = (state) => `<span class="wstate ws-${state}"><span aria-hidden="true">${ICON[state]}</span> ${state}</span>`;
  const counts = (f) => `<span class="t3d-counts">${STATES.filter((s) => f.counts[s]).map((s) => `<span class="t3d-cnt" data-state="${s}">${f.counts[s]} ${WORD[s]}</span>`).join('')}</span>`;
  const countWords = (f) => STATES.filter((s) => f.counts[s]).map((s) => `${f.counts[s]} ${WORD[s]}`).join(', ');

  /** One workstation, side view: chair, seated person facing a monitor on the desk. Only RUNNING seats get the typing/screen classes. */
  function figure(s) {
    const h = hash(s.id), pick = (a, k) => a[(h >>> k) % a.length], skin = pick(SKIN, 3), hair = pick(HAIR, 7), shirt = pick(SHIRT, 11), cid = 'scr-' + s.id;
    const lines = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${108 + (i * 7) % 9}" y="${18 + i * 6}" width="${14 + ((h >>> i) % 14)}" height="2.4" rx="1.2"/>`).join('');
    const screen = s.animated ? `<g class="code" fill="#d9fbe9" opacity=".85">${lines}</g>`
      : `<text x="122" y="38" text-anchor="middle" font-size="${s.state === 'WAITING' ? 10 : 14}" font-weight="700" fill="#fff" opacity=".92">${ICON[s.state]}</text>`;
    return `<svg class="t3d-fig" viewBox="0 0 160 112" aria-hidden="true" focusable="false"><defs><clipPath id="${cid}"><path d="M104 14 140 9v36l-36 3z"/></clipPath></defs>` +
      `<ellipse cx="86" cy="104" rx="70" ry="6" class="shadow"/>` +
      `<g class="desk"><rect x="76" y="62" width="80" height="6" rx="2"/><rect x="146" y="68" width="5" height="34"/><rect x="80" y="68" width="5" height="34"/><rect x="104" y="68" width="40" height="14" rx="2" opacity=".55"/></g>` +
      `<g class="monitor"><path class="glow" d="M98 6 148 0v54l-50 4z" fill="var(--s)" opacity="0"/><path d="M102 12 142 6.5v41L102 51z" fill="#1d232c"/><path class="screen" d="M104 14 140 9v36l-36 3z" fill="var(--s)"/>` +
      `<g clip-path="url(#${cid})">${screen}</g><rect x="119" y="49" width="5" height="10" fill="#2a313c"/><rect x="111" y="58" width="22" height="4" rx="2" fill="#2a313c"/></g>` +
      `<g class="chair"><rect x="22" y="34" width="7" height="38" rx="3"/><rect x="24" y="68" width="38" height="6" rx="3"/><rect x="40" y="74" width="5" height="22"/><rect x="28" y="96" width="30" height="4" rx="2"/></g>` +
      `<g class="person"><rect x="54" y="66" width="30" height="10" rx="5" fill="#2b3240"/><rect x="76" y="70" width="9" height="30" rx="4" fill="#2b3240"/><rect x="76" y="97" width="16" height="6" rx="3" fill="#15191f"/>` +
      `<rect x="34" y="38" width="22" height="34" rx="10" fill="${shirt}"/><rect x="45" y="30" width="7" height="8" rx="3" fill="${skin}"/>` +
      `<circle cx="48" cy="22" r="11" fill="${skin}"/><path d="M37 21c0-8 5-12 11-12s11 4 11 11c-3-3-7-4-11-4s-8 2-11 5z" fill="${hair}"/><circle cx="54" cy="21" r="1.4" fill="#222"/>` +
      `<g class="hands"><path d="M48 44 66 58 92 57" fill="none" stroke="${shirt}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="94" cy="57" r="3.6" fill="${skin}"/></g></g>` +
      `<rect x="84" y="58.5" width="20" height="3.5" rx="1.5" class="kbd"/></svg>`;
  }

  function head() {
    const f = openFloor && S.floors.find((x) => x.id === openFloor), w = f && picked && f.seats.find((x) => x.id === picked);
    const crumbs = [`<button type="button" class="t3d-crumb" data-act="home" ${f ? '' : 'aria-current="page"'}>DeskBot Tower</button>`];
    if (f) crumbs.push(`<span aria-hidden="true">›</span><span ${w ? '' : 'aria-current="page"'}>Floor ${f.level} · ${esc(f.name)}</span>`);
    if (w) crumbs.push(`<span aria-hidden="true">›</span><span aria-current="page">${esc(w.name)}</span>`);
    return `<header class="t3d-head"><div class="t3d-brand"><b>DeskBot</b><span>Trading Tower · ${S.seats} seats on ${S.floors.length} floors</span></div>` +
      `<div class="t3d-chips"><span class="t3d-chip paper">PAPER</span><span class="t3d-chip">Book <b>${esc(M ? M.book : 'not reported')}</b></span>` +
      `<span class="t3d-chip">Data <b>${M && M.runAt ? new Date(M.runAt).toISOString().slice(11, 19) + ' UTC' : 'not reported'}</b></span></div>` +
      `<nav class="t3d-crumbs" aria-label="Location in the building">${crumbs.join('')}</nav></header>`;
  }

  function building() {
    const floors = S.floors.map((f) => `<button type="button" class="t3d-floor" data-floor="${esc(f.id)}" aria-label="${esc(`Floor ${f.level}, ${f.name}: ${f.seats.length} seats, ${countWords(f)}. Look inside`)}">` +
      `<span class="t3d-face"><span class="t3d-lvl">${f.level}</span><span class="t3d-fname"><b>${esc(f.name)}</b>${counts(f)}</span>` +
      `<span class="t3d-wins">${f.seats.map((s, i) => `<i class="t3d-win" data-state="${s.state}"${s.animated ? ' data-anim' : ''} style="--i:${i}" title="${esc(s.name + ': ' + s.state)}"></i>`).join('')}</span></span>` +
      `<span class="t3d-side" aria-hidden="true"></span></button>`).join('');
    return `<div class="t3d-stage"><div class="t3d-bld"><div class="t3d-roof" aria-hidden="true"><span class="t3d-top"></span><span class="t3d-sign">DESKBOT</span><span class="t3d-mast"></span><span class="t3d-side"></span></div>${floors}` +
      `<div class="t3d-lobby" aria-hidden="true"><span class="t3d-door"></span><span>Paper trading · no funded orders</span><span class="t3d-side"></span></div></div></div>` +
      `<div class="t3d-legend" aria-label="State colours">${STATES.map((s) => `<span class="t3d-cnt" data-state="${s}">${s}</span>`).join('')}</div>` +
      `<p class="t3d-hint">Select a floor to look inside. Lit, flickering windows are seats reporting RUNNING; nothing else animates.</p>`;
  }

  function desk(s) {
    return `<button type="button" class="t3d-desk" data-seat="${esc(s.id)}" data-state="${s.state}"${s.animated ? ' data-anim' : ''} aria-pressed="${picked === s.id}" ` +
      `aria-label="${esc(`${s.name}, ${s.title}. State ${s.state}${s.animated ? ', working now' : ''}. Show details`)}">${figure(s)}` +
      `<span class="t3d-nm"><b>${esc(s.name)}</b>${badge(s.state)}</span><span class="t3d-tt">${esc(s.title)}</span>${/AI/.test(s.kind) ? '<span class="t3d-kind">AI · advisory</span>' : ''}</button>`;
  }

  function panel(f) {
    const s = picked && f.seats.find((x) => x.id === picked), e = s && M && M.staff[s.id];
    if (!s) return '<h4>Select a worker</h4><p class="t3d-muted">Pick anyone at a desk to see their role, state, authority and the facts the runner reported.</p>';
    const fa = (e && e.facts) || {}, bad = ['BLOCKED', 'ERROR', 'DEGRADED'].includes(s.state);
    const rows = [['Authority', authority(s.kind)], ['Latest report', e ? e.line : 'not reported'], ['Blocker', fa.blocker || (bad ? 'not reported' : 'none')],
      ['Last success', when(fa.lastSuccess) || 'none reported'], ['Last output', fa.lastOutput || 'not reported'], ['Trigger', fa.trigger || null], ['Next run', when(fa.next) ? new Date(fa.next).toISOString().slice(11, 16) + ' UTC' : null]].filter((r) => r[1]);
    const detail = ((e && e.detail) || []).slice(0, 4);
    return `<h4>${esc(s.name)}</h4><div class="t3d-muted">${esc(s.title)} · Floor ${f.level} ${esc(f.name)}</div>` +
      `<p class="t3d-state">${badge(s.state)} <span>${s.animated ? 'working now (latest report is fresh)' : esc(STILL[s.state] || '')}</span></p>` +
      `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${detail.length ? `<ul>${detail.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
  }

  function room(f) {
    return `<div class="t3d-room${enter && !reduce() ? ' enter' : ''}"><div class="t3d-roomhead"><button type="button" class="t3d-back" data-act="home">← Building</button>` +
      `<div><h3>Floor ${f.level} · ${esc(f.name)}</h3><p class="t3d-muted">${esc(f.job)}</p>${counts(f)}</div></div>` +
      `<div class="t3d-office"><div class="t3d-desks" role="group" aria-label="${esc(f.name + ' workers')}">${f.seats.map((s, i) => desk(s).replace('<button ', `<button style="--i:${i}" `)).join('')}</div>` +
      `<aside class="t3d-panel" aria-live="polite" aria-label="Worker details">${panel(f)}</aside></div></div>`;
  }

  const keyOf = (n) => n && (n.dataset.seat ? `[data-seat="${n.dataset.seat}"]` : n.dataset.floor ? `[data-floor="${n.dataset.floor}"]` : n.dataset.act ? `.t3d-back` : null);
  function draw(focusSel) {
    if (!el || !S) return;
    const a = document.activeElement, keep = focusSel || (a && el.contains(a) ? keyOf(a) : null);
    const f = openFloor && S.floors.find((x) => x.id === openFloor);
    el.innerHTML = head() + (f ? room(f) : building());
    el.dataset.view = f ? 'floor' : 'building'; enter = false;
    const n = keep && (el.querySelector(keep) || el.querySelector('.t3d-back'));
    if (n) n.focus({ preventScroll: !focusSel });
  }

  function onClick(e) {
    const b = e.target.closest('[data-floor],[data-seat],[data-act]'); if (!b || !el.contains(b)) return;
    if (b.dataset.floor) { openFloor = b.dataset.floor; picked = null; enter = true; draw('.t3d-back'); el.scrollIntoView({ block: 'nearest', behavior: reduce() ? 'auto' : 'smooth' }); }
    else if (b.dataset.seat) {
      picked = picked === b.dataset.seat ? null : b.dataset.seat; draw(`[data-seat="${b.dataset.seat}"]`);
      const p = el.querySelector('.t3d-panel'), r = p && p.getBoundingClientRect(); if (picked && r && (r.top > root.innerHeight - 200 || r.bottom < 80)) p.scrollIntoView({ block: 'nearest', behavior: reduce() ? 'auto' : 'smooth' });
    } else if (b.dataset.act === 'home') { const back = openFloor; openFloor = null; picked = null; draw(back ? `[data-floor="${back}"]` : null); }
  }
  function onKey(e) {
    if (e.key === 'Escape' && (picked || openFloor)) { e.preventDefault(); if (picked) { const id = picked; picked = null; draw(`[data-seat="${id}"]`); } else el.querySelector('.t3d-back').click(); return; }
    const t = e.target, list = t.dataset && (t.dataset.floor ? [...el.querySelectorAll('.t3d-floor')] : t.dataset.seat ? [...el.querySelectorAll('.t3d-desk')] : null);
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (list && step) { e.preventDefault(); const n = list[(list.indexOf(t) + step + list.length) % list.length]; n && n.focus(); }
  }

  function setMode(m, save) {
    mode = m === 'list' ? 'list' : 'building';
    if (save) { try { localStorage.setItem(KEY, mode); } catch (_) { /* storage optional */ } }
    const bld = document.getElementById('bld'); if (bld) bld.hidden = mode === 'building';
    if (el) el.hidden = mode !== 'building';
    if (bar) bar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  }
  function mount() {
    if (el) return el;
    const bld = document.getElementById('bld'), grid = bld && bld.parentNode; if (!grid || !grid.parentNode) return null;
    bar = document.createElement('div'); bar.className = 't3d-toggle'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Tower layout');
    bar.innerHTML = '<span>Layout</span><button type="button" data-mode="building" aria-pressed="false">Building (3D)</button><button type="button" data-mode="list" aria-pressed="false">List</button>';
    grid.parentNode.insertBefore(bar, grid);
    el = document.createElement('section'); el.className = 't3d'; el.id = 't3d'; el.setAttribute('aria-label', 'DeskBot tower drawn as an office building');
    grid.insertBefore(el, bld);
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode, true); });
    el.addEventListener('click', onClick); el.addEventListener('keydown', onKey);
    const pause = () => el.classList.toggle('paused', document.hidden); document.addEventListener('visibilitychange', pause); pause();
    setMode(mode);
    return el;
  }

  function render(c) {
    const T = root.DeskTower; if (!mount() || !T) return;
    M = c ? T.build(c, Date.now()) : null; S = scene(M ? M.staff : {}, T.ROSTER, T.FLOORS);
    if (openFloor && !S.floors.some((f) => f.id === openFloor)) { openFloor = null; picked = null; }
    draw();
  }
  // Hook: draw after the list view draws, from the same status context. tower.js and app.js stay unchanged.
  const TV = root.TowerView;
  if (TV && typeof TV.render === 'function' && !TV.render.t3d) {
    const orig = TV.render, wrapped = function (c) { const r = orig.apply(this, arguments); try { render(c); } catch (err) { console.error('tower3d', err); } return r; };
    wrapped.t3d = true; TV.render = wrapped;
  }
  const boot = () => { if (!S) render(null); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  Object.assign(api, { render, setMode });
})(typeof globalThis !== 'undefined' ? globalThis : this);
