// Command palette (⌘K / Ctrl+K, or "/") and keyboard shortcuts (Alt+1…9 switch views).
// Idea and interaction model from OpenTerminal's CommandPalette (MIT, github.com/ErTasselli/OpenTerminal); rewritten in plain JS
// for DeskBot's commands: views, books, chart timeframes and indicators, tower employees, replay and motion.
// Every command clicks an existing control, so the palette can do nothing the page itself cannot.
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let sel = 0, items = [], shown = [];
  const click = (q) => () => { const el = typeof q === 'string' ? document.querySelector(q) : q; el && el.click(); };
  const view = (v) => () => document.querySelector(`.tab[data-v="${v}"]`)?.click();

  function build() {
    const out = [];
    document.querySelectorAll('.tab[data-v]').forEach((t, i) => out.push({ group: 'Go to', label: t.textContent.trim(), hint: i < 9 ? `Alt+${i + 1}` : '', run: view(t.dataset.v) }));
    document.querySelectorAll('#bookSeg button').forEach((b) => out.push({ group: 'Book', label: 'Switch to ' + b.textContent.trim(), run: click(b) }));
    document.querySelectorAll('#tfSeg button').forEach((b) => out.push({ group: 'Chart', label: 'Timeframe ' + b.textContent.trim(), run: () => { view('chart')(); setTimeout(click(b), 60); } }));
    document.querySelectorAll('#indSeg button').forEach((b) => out.push({ group: 'Chart', label: 'Toggle ' + b.textContent.trim(), run: () => { view('chart')(); setTimeout(click(b), 60); } }));
    document.querySelectorAll('#layers input').forEach((i) => out.push({ group: 'Chart', label: 'Layer ' + i.parentElement.textContent.trim(), run: () => { view('chart')(); setTimeout(() => i.click(), 60); } }));
    if (root.DeskTower) Object.entries(root.DeskTower.ROSTER).forEach(([id, r]) => out.push({ group: 'Tower', label: `${r[0]} — ${r[1]}`, run: () => { view('tower')(); setTimeout(() => { root.TowerView && root.TowerView.select(id); document.querySelector(`.emp[data-emp="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 120); } }));
    out.push({ group: 'Action', label: 'Replay the last check (tower)', run: () => { view('tower')(); setTimeout(() => root.TowerView && root.TowerView.replay(), 300); } });
    out.push({ group: 'Action', label: 'Toggle motion', run: click('#towerMotion') });
    out.push({ group: 'Action', label: 'Refresh account data', run: click('#globalRefresh') });
    out.push({ group: 'Action', label: 'Open desk assistant', run: click('#chatFab') });
    return out;
  }
  const score = (q, s) => { if (!q) return 1; s = s.toLowerCase(); let i = 0, sc = 0, last = -1; for (const ch of q) { const j = s.indexOf(ch, i); if (j < 0) return 0; sc += j === last + 1 ? 3 : 1; last = j; i = j + 1; } return sc + (s.startsWith(q) ? 5 : 0); };

  function render() {
    const q = $('cmdQ').value.trim().toLowerCase();
    shown = items.map((it) => ({ it, s: score(q, `${it.group} ${it.label}`) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.it);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    $('cmdList').innerHTML = shown.map((it, i) => `<div class="cmd-it ${i === sel ? 'on' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}"><span class="g">${esc(it.group)}</span><span class="l">${esc(it.label)}</span><span class="h">${esc(it.hint || '')}</span></div>`).join('') || '<div class="cmd-empty">No matching command</div>';
    $('cmdList').querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  function open() {
    items = build(); sel = 0; $('cmd').hidden = false; $('cmdQ').value = ''; render(); setTimeout(() => $('cmdQ').focus(), 20);
    const m = root.Motion; m && m.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches && m.animate($('cmdBox'), { opacity: [0, 1], y: [-12, 0], scale: [0.98, 1] }, { type: 'spring', stiffness: 380, damping: 30 });
  }
  function close() { $('cmd').hidden = true; }
  function run(i) { const it = shown[i]; close(); it && it.run(); }

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('cmd').hidden ? open() : close(); return; }
    if (!$('cmd').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
      return;
    }
    if (typing) return;
    if (e.key === '/') { e.preventDefault(); open(); return; }
    if (e.altKey && /^Digit[1-9]$/.test(e.code)) { const t = document.querySelectorAll('.tab[data-v]')[+e.code.slice(5) - 1]; if (t) { e.preventDefault(); t.click(); } }
  });
  document.addEventListener('DOMContentLoaded', () => {
    $('cmdQ').addEventListener('input', () => { sel = 0; render(); });
    $('cmdList').addEventListener('click', (e) => { const r = e.target.closest('.cmd-it'); if (r) run(+r.dataset.i); });
    $('cmd').addEventListener('click', (e) => { if (e.target === $('cmd')) close(); });
    $('cmdBtn') && $('cmdBtn').addEventListener('click', open);
  });
  root.DeskPalette = { open, close, _build: build, _score: score };
})(typeof globalThis !== 'undefined' ? globalThis : this);
