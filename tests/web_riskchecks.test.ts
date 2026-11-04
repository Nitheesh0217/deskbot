// Pure view models of web/riskchecks.js (vm-loaded like web_evidence.test.ts). Every input here is SYNTHETIC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const store: Record<string, string> = {};
const ctx: any = { localStorage: { getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => { store[k] = String(v); } } };
vm.runInNewContext(['plan.js', 'riskchecks.js'].map((f) => readFileSync(new URL('../web/' + f, import.meta.url), 'utf8')).join('\n'), ctx);
const R = ctx.DeskRisk, P = ctx.DeskPlan;
const now = Date.parse('2026-11-04T12:00:00Z'), H = 3600e3;
const long = { strategy: 'HTF_TREND', dir: 'long', entry: 100, stop: 95, stop0: 95, tp1: 107.5, tp2: 115, tp3: 130, originalQty: 2, remainingQty: 2, openT: now - 2 * H, maxHoldH: 48, riskAmt: 10 };
const short = { strategy: 'HTF_TREND', dir: 'short', entry: 77822.4324, stop: 80065.92995554466, stop0: 80065.92995554466, tp1: 74457.18606668302, tp2: 71091.93973336603, tp3: 64361.44706673206, originalQty: 0.00294, remainingQty: 0.00294, openT: now - 2 * H, maxHoldH: 504 };
const checks = (o: any = {}) => ({ impliedLeverage: 2.4, liqBufferX: 6.2, liqOk: true, notionalUsd: 245.3, minNotionalOk: true, qtyRepresentable: true, degenerateStop: false, ok: true, notes: [], ...o });
const J = (x: any) => JSON.parse(JSON.stringify(x)), deq = (a: any, b: any) => assert.deepEqual(J(a), J(b));
const byId = (m: any, id: string) => m.chips.find((c: any) => c.id === id);

test('R:R badge equals DeskPlan.planRows R for each target (long and short, moved stop)', () => {
  for (const p of [long, short, { ...long, stop: 100 }]) {
    const plan = P.planRows(p, { price: p.entry, now });
    const rr = R.rrBadge(plan), want = plan.rows.filter((r: any) => /^tp/.test(r.key)).map((r: any) => r.r);
    deq(rr.values, want);
    assert.equal(rr.text, 'R:R ' + want.map((v: number) => '1:' + v.toFixed(2)).join(' · '));
  }
  assert.equal(R.rrBadge(P.planRows(long, {})).text, 'R:R 1:1.50 · 1:3.00 · 1:6.00');
  assert.equal(R.rrBadge(null), null);
  assert.equal(R.dirBadge('long').text, '▲ LONG'); assert.equal(R.dirBadge('short').text, '▼ SHORT'); assert.equal(R.dirBadge('flat'), null);
  // no tier grades
  assert.equal(/tier/i.test(R.safetyHTML({ lastRun: {}, pos: long, plan: P.planRows(long, {}), now })), false);
});

test('position chips: thresholds and not-reported states', () => {
  assert.equal(R.positionModel({}).state, 'not-reported');
  assert.equal(R.positionModel({ positionChecks: null }).state, 'flat');
  const ok = R.positionModel({ positionChecks: checks(), market: { hl: { maxLeverage: 40, szDecimals: 5 } } });
  deq(ok.chips.map((c: any) => c.state), ['ok', 'ok', 'ok', 'ok', 'ok']);
  assert.equal(byId(ok, 'liq').value, '6.2× stop'); assert.equal(byId(ok, 'size').value, 'yes · 5 size decimals');
  assert.equal(byId(R.positionModel({ positionChecks: checks({ liqBufferX: 2.99 }) }), 'liq').state, 'warn');
  assert.equal(byId(R.positionModel({ positionChecks: checks({ liqBufferX: 3 }) }), 'liq').state, 'ok');
  assert.equal(byId(R.positionModel({ positionChecks: checks({ liqBufferX: 8, liqOk: false }) }), 'liq').state, 'warn');
  assert.equal(byId(R.positionModel({ positionChecks: checks({ impliedLeverage: 50 }), market: { hl: { maxLeverage: 40 } } }), 'leverage').state, 'warn');
  assert.equal(byId(R.positionModel({ positionChecks: checks({ minNotionalOk: undefined, notionalUsd: 9.99 }) }), 'minOrder').state, 'warn');
  assert.equal(byId(R.positionModel({ positionChecks: checks({ minNotionalOk: undefined, notionalUsd: 10 }) }), 'minOrder').state, 'ok');
  assert.equal(byId(R.positionModel({ positionChecks: checks({ qtyRepresentable: false }) }), 'size').state, 'warn');
  assert.equal(byId(R.positionModel({ positionChecks: checks({ degenerateStop: true }) }), 'stop').state, 'warn');
  const nr = R.positionModel({ positionChecks: {} });
  assert.ok(nr.chips.every((c: any) => c.state === 'nr' && c.value === 'not reported'));
  assert.ok(ok.chips.every((c: any) => c.explain.length > 10));
  assert.match(R.safetyHTML({ lastRun: { positionChecks: checks() } }), /aria-label="Leverage: 2\.40×\. /);
});

test('privacy masking hides $ amounts and sizes, keeps R, % and prices; default off; storage failures tolerated', () => {
  assert.equal(R.privacyOn(), false);
  assert.equal(R.money('$245.30', false), '$245.30'); assert.equal(R.money('$245.30', true), R.MASK);
  assert.equal(R.qty('0.00294', true), R.QMASK);
  const shown = byId(R.positionModel({ positionChecks: checks() }, { privacy: false }), 'minOrder').value;
  const hidden = byId(R.positionModel({ positionChecks: checks() }, { privacy: true }), 'minOrder').value;
  assert.equal(shown, '$245.30 vs $10 min'); assert.equal(hidden, R.MASK + ' vs $10 min');
  R.setPrivacy(true); assert.equal(store['deskbot.privacy'], '1'); assert.equal(R.privacyOn(), true);
  const html = R.safetyHTML({ lastRun: { positionChecks: checks() }, pos: long, plan: P.planRows(long, { price: 101 }), price: 101, now });
  assert.equal(html.includes('245.30'), false); assert.match(html, /R:R 1:1\.50/); assert.match(html, /aria-pressed="true"/);
  R.setPrivacy(false); assert.equal(store['deskbot.privacy'], '0');
  const broken: any = { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } };
  vm.runInNewContext(readFileSync(new URL('../web/riskchecks.js', import.meta.url), 'utf8'), broken);
  assert.equal(broken.DeskRisk.privacyOn(), false); assert.equal(broken.DeskRisk.setPrivacy(true), true); assert.equal(broken.DeskRisk.privacyOn(), true);
});

test('config guard summary uses the first rule plus (+N more)', () => {
  assert.equal(R.firstPlusMore(['A']), 'A'); assert.equal(R.firstPlusMore(['A', 'B', 'C']), 'A (+2 more)'); assert.equal(R.firstPlusMore([]), '');
  assert.equal(R.guardModel({}).summary, 'Config guard: not reported');
  assert.equal(R.guardModel({ cfgGuard: { ok: true, violations: [] } }).summary, 'Config guard: all rules pass');
  const g = R.guardModel({ cfgGuard: { ok: false, violations: [{ rule: 'RISK_CAP', msg: 'risk 3% > 2%' }, { rule: 'MAX_LEV', msg: 'x' }, { rule: 'TP_ORDER', msg: 'y' }] } });
  assert.equal(g.summary, 'Config guard: RISK_CAP (+2 more)'); assert.equal(g.violations.length, 3);
  assert.equal(R.intentModel({}).state, 'not-reported');
  assert.equal(R.intentModel({ intentCheck: { ok: true, mismatches: [] } }).state, 'ok');
  assert.equal(R.intentModel({ intentCheck: { ok: false, mismatches: ['dir', 'size'] } }).text, 'Intent check: dir (+1 more)');
  const t = R.timingModel({ timing: { barCloseT: now, evalStartMs: now + 41000, fillMs: now + 42200, lagMs: 41000 } });
  deq(t.steps.map((s: any) => s.value), ['12:00:00 UTC', '12:00:41 UTC (+41.0 s)', '12:00:42 UTC (+1.2 s)']); assert.equal(t.lag, '41.0 s');
  assert.equal(R.timingModel({ timing: { barCloseT: now, evalStartMs: now + 1, fillMs: null } }).steps[2].value, 'no fill this run');
  assert.equal(R.timingModel({}).state, 'not-reported');
});

test('market context: signed funding with who pays, range diagnostic, not reported when absent', () => {
  const m = R.marketModel({ market: { hl: { fundingAprPct: 10.95, premium: -0.00031, oraclePx: 77300, oi: 31234.6, maxLeverage: 40, delisted: false }, rangeDiag: { efficiency: 0.183, touches: 4, isRange: true } } });
  const v = (id: string) => m.cells.find((c: any) => c.id === id).value;
  assert.equal(v('funding'), '+10.95% APR · longs pay shorts'); assert.equal(m.cells[0].tone, ''); assert.equal(v('premium'), '−0.0310% · oracle 77300');
  assert.equal(v('oi'), '31,235'); assert.equal(v('maxLev'), '40×'); assert.equal(v('delisted'), 'Listed');
  deq(m.range, { state: 'ok', efficiency: '0.18', touches: '4', verdict: 'Range-like' });
  assert.equal(R.marketModel({ market: { hl: { fundingAprPct: -3 } } }).cells[0].value, '−3.00% APR · shorts pay longs');
  const none = R.marketModel({ market: {} });
  assert.equal(none.hl, false); assert.ok(none.cells.every((c: any) => c.value === 'not reported')); assert.equal(none.range.state, 'not-reported');
  assert.match(R.marketHTML({ lastRun: {} }), /observe-only, not used for decisions/);
});

test('stale plan: beyond TP3, beyond the active stop, past max hold; quiet otherwise', () => {
  deq(R.stalePlan(long, 101, now).map((w: any) => w.id), []);
  deq(R.stalePlan(long, 131, now).map((w: any) => w.id), ['beyondTp3']);
  deq(R.stalePlan({ ...long, tp3Done: true }, 131, now).map((w: any) => w.id), []);
  deq(R.stalePlan(long, 94, now).map((w: any) => w.id), ['beyondStop']);
  deq(R.stalePlan(short, 81000, now).map((w: any) => w.id), ['beyondStop']);
  deq(R.stalePlan(short, 64000, now).map((w: any) => w.id), ['beyondTp3']);
  deq(R.stalePlan(short, 77300, now).map((w: any) => w.id), []);
  const old = R.stalePlan({ ...long, openT: now - 49 * H }, 101, now);
  assert.equal(old[0].text, 'Plan check: open 49h, past its max hold of 48h');
  assert.ok(R.stalePlan(long, 131, now).every((w: any) => w.text.startsWith('Plan check: ')));
  deq(R.stalePlan(long, null, now), []); deq(R.stalePlan(null, 1, now), []);
});

test('index.html loads riskchecks after plan.js and before app.js', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('src="./plan.js"') < html.indexOf('src="./riskchecks.js"'));
  assert.ok(html.indexOf('src="./riskchecks.js"') < html.indexOf('src="./app.js"'));
  assert.ok(html.includes('href="./riskchecks.css"'));
  const src = readFileSync(new URL('../web/riskchecks.js', import.meta.url), 'utf8');
  assert.equal(/fetch\(|XMLHttpRequest|probabilit/i.test(src.replace(/no probabilities/gi, '')), false);
});
