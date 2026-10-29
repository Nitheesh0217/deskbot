// Trading Tower view: draws the building from DeskTower.build(...) and animates the hand-offs of the latest check.
// Presentation only. It reads the same public status the other tabs read and never sends anything or changes the engine.
(function (root) {
  'use strict';
  const T = root.DeskTower;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduce = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const FLOOR_TINT = { ops: '#8a8f99', execution: '#5aa86a', risk: '#d46b6b', portfolio: '#c9a24a', desks: '#3fa6a0', research: '#8e7be0', intel: '#5a8fe0', data: '#6aa0b8' };
  const SKIN = ['#f6d5b8', '#e8b98f', '#d79b6c', '#b97a50', '#8a5a3a', '#f1c9a5'];
  const HAIR = ['#2b211c', '#4a3425', '#7a5230', '#1a1a1d', '#b8863b', '#6b6f76'];
  const SHIRT = ['#2f4b7c', '#6b3f69', '#2f6f62', '#7a4a2f', '#3b3f58', '#8a3b3b'];
  const KIND_LABEL = { AI: 'AI · ADVISORY', 'RULES+AI': 'RULES + AI', OFFLINE: 'OFFLINE', RULES: 'RULES' };
  const FAMILY_ICON = { Trend: '↗', Breakout: '⌁', Reversal: '↶', 'Mean reversion': '≈' };
  let M = null, ctx = null, selected = null, lastRunAt = null, built = false, timer = 0, playing = false, motionOff = false, priceTimer = 0;
  const seenFeed = new Set();

  // A small flat avatar, generated from the id: same person every time. AI roles get a chip badge.
  function avatar(id, floor, kind) {
    const h = hash(id), pick = (a, k) => a[(h >>> k) % a.length];
    const skin = pick(SKIN, 3), hair = pick(HAIR, 7), shirt = pick(SHIRT, 11), style = (h >>> 5) % 5, tint = FLOOR_TINT[floor] || '#999';
    const hairSvg = [`<path d="M20 25c0-9 6-14 12-14s12 5 12 14c-3-4-8-6-12-6s-9 2-12 6z" fill="${hair}"/>`,
      `<path d="M19 28c-1-11 5-17 13-17s14 6 13 17c0 6-2 11-3 13-1-8-3-13-10-13s-9 5-10 13c-1-2-3-7-3-13z" fill="${hair}"/>`,
      `<circle cx="32" cy="12" r="5.5" fill="${hair}"/><path d="M20 25c0-9 6-14 12-14s12 5 12 14c-3-4-8-6-12-6s-9 2-12 6z" fill="${hair}"/>`,
      '', `<path d="M19 24c0-9 6-13 13-13s13 4 13 13z" fill="${hair}"/><rect x="17" y="23" width="30" height="3.4" rx="1.7" fill="${tint}"/>`][style];
    const glasses = ['research', 'ops', 'portfolio', 'intel'].includes(floor) ? `<g fill="none" stroke="#222" stroke-width="1.3"><circle cx="27" cy="31" r="4"/><circle cx="37" cy="31" r="4"/><path d="M31 31h2"/></g>` : '';
    const headset = ['data', 'execution', 'desks'].includes(floor) ? `<path d="M19 30c0-10 6-17 13-17s13 7 13 17" fill="none" stroke="#2a2f3a" stroke-width="2.4"/><rect x="16.5" y="29" width="4.5" height="8" rx="2" fill="#2a2f3a"/><path d="M19 37c0 4 4 5 8 5" fill="none" stroke="#2a2f3a" stroke-width="1.6"/>` : '';
    const tie = ['risk', 'portfolio'].includes(floor) ? `<path d="M32 46l-3 4 3 9 3-9z" fill="${tint}"/>` : '';
    const chip = /AI/.test(kind) ? `<g><rect x="45" y="2" width="17" height="12" rx="4" fill="${tint}"/><text x="53.5" y="11" text-anchor="middle" font-size="8" font-weight="700" font-family="monospace" fill="#fff">AI</text></g>` : '';
    return `<svg class="av" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><circle cx="32" cy="32" r="31" fill="${tint}" opacity=".18"/><g class="body"><path d="M10 64c1-13 10-18 22-18s21 5 22 18z" fill="${shirt}"/><rect x="28" y="40" width="8" height="8" rx="3" fill="${skin}"/>` +
      `<ellipse cx="32" cy="30" rx="12" ry="14" fill="${skin}"/>${hairSvg}<circle cx="27" cy="31" r="1.4" fill="#222"/><circle cx="37" cy="31" r="1.4" fill="#222"/><path d="M28 37c2 2 6 2 8 0" fill="none" stroke="#7a3b2e" stroke-width="1.3" stroke-linecap="round"/>${glasses}${headset}${tie}</g>${chip}</svg>`;
  }

  function skeleton() {
    const wrap = $('bld'); if (!wrap || built) return;
    const byFloor = {};
    Object.entries(T.ROSTER).forEach(([id, r]) => { (byFloor[r[3]] = byFloor[r[3]] || []).push(id); });
    const emp = (id, f) => { const r = T.ROSTER[id]; return `<button type="button" class="emp" data-emp="${id}" data-status="idle" aria-pressed="false">${avatar(id, f, r[2])}<div><div class="nm">${esc(r[0])}<span class="kind ${/AI/.test(r[2]) ? 'ai' : ''}">${KIND_LABEL[r[2]] || r[2]}</span></div><div class="tt">${esc(r[1])}</div></div><span class="sdot" aria-hidden="true"></span><div class="say">…</div></button>`; };
    wrap.innerHTML = `<span class="antenna" aria-hidden="true"></span><div class="roof"><h2>DeskBot Tower</h2><small id="roofSub">PAPER · no funded orders</small></div>` +
      T.FLOORS.map((f) => `<section class="floor ${f.n === 1 ? 'ground' : ''}" data-floor="${f.id}" aria-label="${esc('Floor ' + f.n + ': ' + f.name)}"><div class="floor-head"><b>${f.n}</b><strong>${esc(f.name)}</strong><span>${esc(f.job)}</span></div><div class="rooms">` +
        (byFloor[f.id] || []).map((id) => emp(id, f.id)).join('') +
        (f.id === 'desks' ? '<div class="fam-desks" id="famDesks"></div>' : '') +
        (f.id === 'research' ? '<div class="rdesks" id="rDesks"></div>' : '') + `</div></section>`).join('') +
      '<div class="street" aria-hidden="true"><span>PAPER TRADING · NO FUNDED ORDERS</span></div><div class="lift" id="lift" aria-hidden="true"></div><div class="packets" id="packets" aria-hidden="true"></div>';
    wrap.addEventListener('click', (e) => { const b = e.target.closest('.emp'); if (b) select(b.dataset.emp); });
    const wf = $('towerFlow'); if (wf) wf.addEventListener('click', (e) => { const b = e.target.closest('[data-step]'); if (b) { select(b.dataset.step); const el = document.querySelector(`.emp[data-emp="${b.dataset.step}"]`); el && el.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'center' }); } });
    built = true;
  }

  const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 90 ? Math.round(s) + 's ago' : s < 5400 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago'; };
  function select(id) {
    const e = M && M.staff[id]; if (!e) return; selected = id;
    document.querySelectorAll('.emp').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.emp === id)));
    const f = T.FLOORS.find((x) => x.id === e.floor);
    const auth = e.kind === 'AI' ? 'optional free AI role, advisory only; it cannot place, size or block a trade' : e.kind === 'RULES+AI' ? 'fixed rules, with an optional AI summary' : e.kind === 'OFFLINE' ? 'offline research tooling; not part of the live decision loop' : 'fixed rules in the cloud runner';
    $('drawer').innerHTML = `${avatar(id, e.floor, e.kind)}<h3>${esc(e.name)}</h3><div class="muted">${esc(e.title)} · Floor ${f ? f.n + ' ' + esc(f.name) : ''}</div>
      <p class="tower-note" style="margin-top:8px;clear:both">Status <b>${esc(e.status)}</b> · ${auth}${e.at ? ' · last log ' + esc(ago(e.at)) : ''}</p>
      <p style="margin:8px 0 0;font:500 13px/1.5 var(--f-mono)">${esc(e.line)}</p>${(e.detail || []).length || (e.chk || []).length ? `<ul>${[...(e.detail || []), ...(e.chk || [])].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
  }

  function paint() {
    const m = M;
    Object.entries(m.staff).forEach(([id, e]) => { const el = document.querySelector(`.emp[data-emp="${id}"]`); if (!el) return; el.dataset.status = e.status; el.querySelector('.say').textContent = e.line; });
    const fd = $('famDesks');
    if (fd) fd.innerHTML = m.desks.map((d) => `<div class="fam"><div class="fam-h"><span class="fam-i" aria-hidden="true">${FAMILY_ICON[d.family] || '·'}</span><b>${esc(d.family)} desk</b><small>${d.strategies.filter((s) => s.status !== 'off').length} of ${d.strategies.length} on</small></div>` +
      (d.strategies.map((s) => `<div class="sdesk ${s.position ? 'pos' : ''} ${s.signal ? 'sig' : ''}" data-status="${s.status}"><b>${esc(s.name)}</b><small>${esc(s.state)}${s.position ? ' · OPEN POSITION' : s.signal ? ' · CANDIDATE ' + esc(String(s.signal.dir).toUpperCase()) : ''}</small><small>${esc(String(s.line).slice(0, 96))}</small></div>`).join('') || '<small class="faint">No strategies loaded</small>') + '</div>').join('');
    const rd = $('rDesks');
    if (rd) rd.innerHTML = m.research.map((r) => { const live = r.id === 'signalq' && m.experiment && m.experiment.started; return `<details class="rdesk ${live ? 'live' : ''}"><summary><b>${esc(r.name)}</b><span class="tag">${live ? 'EXPERIMENT RUNNING' : r.id === 'signalq' ? 'EXPERIMENT READY' : 'PROPOSED · NOT AN EDGE'}</span></summary><p><b>Inputs:</b> ${esc(r.inputs)}</p><p><b>Must answer:</b> ${esc(r.question)}</p></details>`; }).join('');
    const wf = $('towerFlow');
    if (wf) wf.innerHTML = m.workflow.map((s) => `<button type="button" class="step" data-step="${s.id}" data-status="${s.status}" title="${esc(s.job)}"><span class="n">${s.i}</span><span class="l">${esc(s.label)}</span><span class="o">${esc(String(s.out).slice(0, 48))}</span></button>`).join('<span class="arrow" aria-hidden="true">→</span>');
    const g = m.growth;
    $('gNow').textContent = g.now == null ? '—' : '$' + g.now.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    $('gPct').textContent = g.pct == null ? 'Starting equity not reported' : (g.pct >= 0 ? '+' : '−') + Math.abs(g.pct).toFixed(2) + '% since the v5 paper start' + (g.start ? ' ($' + g.start.toFixed(2) + ')' : '');
    $('gPct').className = g.pct == null ? 'muted' : g.pct >= 0 ? 'up' : 'down';
    drawGrowth(g); board();
    $('roofSub').textContent = `PAPER · ${m.book} book · ${m.runFresh ? 'runner alive' : 'runner status stale or unknown'}`;
    $('towerRun').textContent = m.runAt ? new Date(m.runAt).toISOString().slice(11, 19) + ' UTC' : 'not reported';
    $('towerAct').textContent = m.action || 'not reported';
    $('towerLive').classList.toggle('on', m.runFresh);
    feed();
    if (selected) select(selected);
  }

  function board() {
    const el = $('expBoard'); if (!el) return; const ex = M.experiment;
    if (ex == null) { el.innerHTML = '<p class="tower-note">The verdict table is not live yet. Once the backend release is applied, every new entry records a rules verdict and an AI verdict before its outcome.</p>'; return; }
    if (!ex.started) { el.innerHTML = '<p class="tower-note">Live and waiting for the first entry. Verdicts are recorded when a position opens, before it has an outcome.</p>'; return; }
    const fmtR = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(3) + 'R');
    el.innerHTML = `<div class="exp-base">Baseline (engine, unchanged): <b>${ex.baseline.n}</b> closed · ${fmtR(ex.baseline.sumR)} total · ${ex.open || 0} open</div>` + (ex.arms || []).map((a) => `<div class="exp-arm"><div class="exp-h"><b>${a.arm === 'ai' ? 'Baseline + AI filter' : 'Baseline + rules filter'}</b><span class="res ${a.result}">${esc(a.result.replace(/_/g, ' '))}</span></div>
      <div class="exp-g"><span>decided <b>${a.decided}</b></span><span>kept <b>${a.kept.n}</b> ${fmtR(a.kept.meanR)}/trade</span><span>would skip <b>${a.skipped.n}</b> ${fmtR(a.skipped.meanR)}/trade</span><span>abstained <b>${a.abstained}</b></span>${a.lateOrMissing ? `<span>late <b>${a.lateOrMissing}</b></span>` : ''}</div>
      <div class="exp-g"><span>Δ per entry ${a.meanDeltaR == null ? 'shown after 30 decided' : fmtR(a.meanDeltaR)}</span>${a.ci95 ? `<span>95% CI ${fmtR(a.ci95[0])} … ${fmtR(a.ci95[1])}</span>` : ''}${a.arm === 'ai' ? `<span>AI calls ${a.calls} · ${(a.ms / 1000).toFixed(1)}s</span>` : ''}</div></div>`).join('') +
      `<p class="tower-note">Decision needs 100 decided trades per arm. Filters never change a trade. ${esc((ex.caveats || [])[2] || '')}</p>`;
  }

  function drawGrowth(g) {
    const svg = $('gSvg'), pts = g.points.slice(-240); if (pts.length < 2) { svg.innerHTML = '<text x="150" y="80" text-anchor="middle" fill="currentColor" opacity=".5" font-size="12">No equity series returned yet</text>'; return; }
    const W = 300, H = 150, pad = 8, lo = Math.min(...pts, g.start ?? Infinity), hi = Math.max(...pts, g.start ?? -Infinity), span = hi - lo || 1;
    const X = (i) => pad + (i / (pts.length - 1)) * (W - 2 * pad), Y = (v) => H - pad - ((v - lo) / span) * (H - 2 * pad);
    const line = pts.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
    svg.innerHTML = `${g.start ? `<line class="base" x1="${pad}" x2="${W - pad}" y1="${Y(g.start).toFixed(1)}" y2="${Y(g.start).toFixed(1)}"/>` : ''}<path class="area" d="${line}L${X(pts.length - 1).toFixed(1)} ${H - pad}L${pad} ${H - pad}Z"/><path class="line" id="gLine" pathLength="1" d="${line}"/>`;
    const p = $('gLine'); if (p && p.animate && !reduce() && !motionOff) { p.style.strokeDasharray = '1'; p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 1400, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }); }
  }

  function feed() {
    const lines = [];
    (M.flow || []).forEach((f) => { const a = M.staff[f.from], b = M.staff[f.to]; if (a && b) lines.push({ t: M.runAt, key: 'f' + f.from + f.to + M.runAt + f.label, html: `<b>${esc(a.name)}</b> → <b>${esc(b.name)}</b>: ${esc(f.label)}${f.advisory ? ' <i>(advisory)</i>' : ''}`, adv: f.advisory }); });
    (ctx.agents || []).slice(0, 12).forEach((r, i) => { const t = Date.parse(r.ts); lines.push({ t: Number.isFinite(t) ? t : null, key: 'a' + r.ts + r.agent + i, html: `<b>${esc(r.agent)}</b> logged: ${esc(String(r.input_summary || '').slice(0, 120))}${r.output && r.output.verdict ? ` — ${esc(r.output.verdict)}` : ''}` }); });
    $('towerFeed').innerHTML = lines.map((l) => `<div class="${l.adv ? 'adv' : ''} ${seenFeed.has(l.key) ? '' : 'new'}"><span class="faint">${l.t ? new Date(l.t).toISOString().slice(11, 19) : '—'}</span><span>${l.html}</span></div>`).join('') || '<div><span></span><span class="faint">No hand-offs returned yet.</span></div>';
    lines.forEach((l) => seenFeed.add(l.key));
  }

  // Animate the latest check: a message packet travels desk to desk while the workflow strip lights the matching step.
  function replay() {
    if (!M || playing) return; const wrap = $('bld'), layer = $('packets'), lift = $('lift'); if (!wrap || !layer) return;
    if (reduce() || motionOff || !layer.animate) return;
    playing = true; const box = wrap.getBoundingClientRect(); let i = 0;
    const lightStep = (id) => document.querySelectorAll('#towerFlow .step').forEach((s) => s.classList.toggle('on', s.dataset.step === id));
    const step = () => {
      const f = M.flow[i++];
      if (!f) { playing = false; lift.classList.remove('on'); lightStep(null); document.querySelectorAll('.floor.hot').forEach((x) => x.classList.remove('hot')); return; }
      const a = document.querySelector(`.emp[data-emp="${f.from}"]`), b = document.querySelector(`.emp[data-emp="${f.to}"]`); if (!a || !b) return step();
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(), pk = document.createElement('div');
      pk.className = 'pkt' + (f.advisory ? ' adv' : ''); pk.textContent = f.label; layer.appendChild(pk);
      const x0 = ra.left - box.left + ra.width / 2 - 20, y0 = ra.top - box.top + ra.height / 2, x1 = rb.left - box.left + rb.width / 2 - 20, y1 = rb.top - box.top + rb.height / 2;
      const fl = b.closest('.floor'); document.querySelectorAll('.floor.hot').forEach((x) => x.classList.remove('hot')); fl && fl.classList.add('hot');
      lightStep(T.WORKFLOW.some((w) => w[0] === f.to) ? f.to : T.WORKFLOW.some((w) => w[0] === f.from) ? f.from : null);
      if (fl) { lift.classList.add('on'); lift.style.transition = 'transform .8s cubic-bezier(.6,0,.2,1), opacity .3s'; lift.style.transform = `translateY(${(fl.getBoundingClientRect().top - box.top + fl.offsetHeight / 2 - 17).toFixed(0)}px)`; }
      const an = pk.animate([{ transform: `translate(${x0}px,${y0}px) scale(.6)`, opacity: 0 }, { transform: `translate(${x0}px,${y0}px) scale(1)`, opacity: 1, offset: .15 }, { transform: `translate(${x1}px,${y1}px) scale(1)`, opacity: 1, offset: .85 }, { transform: `translate(${x1}px,${y1}px) scale(.6)`, opacity: 0 }], { duration: 1100, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' });
      an.onfinish = () => { pk.remove(); b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); };
      setTimeout(step, 650);
    };
    step();
  }

  function countdown() {
    const now = Date.now(), next = Math.ceil((now + 1) / 300000) * 300000, s = Math.max(0, Math.round((next - now) / 1000));
    const el = $('towerNext'); if (el) el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  async function price() {
    if (document.hidden) return; const el = $('towerPx'); if (!el) return;
    try {
      const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'allMids' }), signal: AbortSignal.timeout(6000) });
      const j = await r.json(), px = +j.BTC; if (!Number.isFinite(px)) throw 0;
      const prev = +el.dataset.px || px; el.dataset.px = px; el.textContent = '$' + px.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' BTC';
      if (!reduce() && el.animate && px !== prev) el.animate([{ color: px > prev ? 'var(--up)' : 'var(--down)' }, { color: 'inherit' }], { duration: 900 });
    } catch (_) { el.textContent = 'live price unavailable'; }
  }

  function render(c) {
    ctx = c; if (!$('v-tower')) return; skeleton();
    M = T.build(c, Date.now());
    paint();
    if (M.runAt && M.runAt !== lastRunAt) { const first = lastRunAt === null; lastRunAt = M.runAt; if (!first || !$('v-tower').hidden) setTimeout(replay, first ? 500 : 100); }
  }
  function onView(v) { if (v === 'tower') { if (M) setTimeout(replay, 350); if (!priceTimer) { price(); priceTimer = setInterval(price, 8000); timer = timer || setInterval(countdown, 1000); countdown(); } } }
  document.addEventListener('desk:view', (e) => onView(e.detail.view));
  document.addEventListener('DOMContentLoaded', () => { const r = $('towerReplay'), p = $('towerMotion'); r && r.addEventListener('click', replay); p && p.addEventListener('click', () => { motionOff = !motionOff; p.setAttribute('aria-pressed', String(motionOff)); p.textContent = motionOff ? 'Motion off' : 'Motion on'; }); });
  root.TowerView = { render, replay, select, avatar };
})(typeof globalThis !== 'undefined' ? globalThis : this);
