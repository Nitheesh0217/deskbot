import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { STRATEGIES, OPT_IN, CFG_DEFAULTS, applyCfg, offReason } from '../supabase/functions/deskbot-v5/engine.ts';

const ctx: any = {};
vm.runInNewContext(readFileSync(new URL('../web/desk-model.js', import.meta.url), 'utf8'), ctx);
const model = ctx.DeskBotModel;

test('dashboard registry covers every engine strategy exactly once', () => {
  assert.deepEqual(Array.from(model.strategies, (s: any) => s.id).sort(), [...STRATEGIES].sort());
  assert.equal(new Set(model.strategies.map((s: any) => s.id)).size, STRATEGIES.length);
});
test('missing account data is unknown rather than an invented zero', () => {
  const a = model.account({}, {});
  assert.equal(a.available, false); assert.equal(a.net, null); assert.equal(a.risk, null);
  assert.equal(model.strategyStatus('TREND_MTF', {}, {}, false).enabled, null);
  assert.equal(model.account({ equity: '300', pos: null }, {}).available, false);
});
test('effective strategy enablement respects opt-in defaults, scale and disable flag', () => {
  assert.equal(model.strategyStatus('EMA_CROSS', {}, {}, true).enabled, false);
  const st = { cfg: { RISK_SCALE: { EMA_CROSS: 0.5, SESSION_BO: 0 } }, enabled: { TREND_MTF: false } };
  assert.equal(model.strategyStatus('EMA_CROSS', st, {}, true).enabled, true);
  assert.equal(model.strategyStatus('SESSION_BO', st, {}, true).state, 'DISABLED');
  assert.equal(model.strategyStatus('TREND_MTF', st, {}, true).state, 'DISABLED');
});
test('zero trades and missing evaluation never imply strategy was called', () => {
  const st = { stats: { by: { D_BEARTRAP: { n: 0 } } } };
  assert.equal(model.strategyStatus('D_BEARTRAP', st, {}, true).state, 'NOT REPORTED');
  const lastRun = { ts: '2026-10-28T12:00:00Z', decision: { rejects: [{ strategy: 'D_BEARTRAP', reason: 'Waits for daily close' }] } };
  assert.equal(model.strategyStatus('D_BEARTRAP', st, lastRun, true).state, 'WAITING FOR BAR');
  assert.equal(model.strategyStatus('D_BEARTRAP', st, lastRun, true).reportedAt, lastRun.ts);
});
test('only explicitly flat accounts report zero open risk; signals remain separate from execution', () => {
  assert.equal(model.account({ equity: 300 }, {}).risk, null);
  assert.equal(model.account({ equity: 300, pos: null }, {}).risk, 0);
  assert.equal(model.account({ equity: 300, pos: { riskAmt: 4 } }, {}).risk, 4);
  const r = model.strategyStatus('TREND_MTF', {}, { decision: { signals: [{ strategy: 'TREND_MTF', dir: 'long', score: 82 }] } }, true);
  assert.equal(r.state, 'SETUP REPORTED'); assert.match(r.reason, /heuristic/);
});
test('agent catalog matches the instrumented source roles rather than claiming eight AI workers', () => {
  const source = ['agents.ts', 'worklog.ts'].map((f) => readFileSync(new URL('../supabase/functions/deskbot-v5/' + f, import.meta.url), 'utf8')).join('\n');
  const instrumented = [...new Set([...source.matchAll(/agent: "([^"]+)"/g)].map(x => x[1]))].sort();
  assert.deepEqual(Array.from(model.agentRoles, (r: any) => r.id).sort(), instrumented);
  assert.equal(model.agentRoles.filter((r: any) => r.kind === 'Optional AI').length, 1);
});
test('operations deduplicates known strategy records and preserves unknown coverage', () => {
  const unknown = model.operations({equity:300}, {}, [], true);
  assert.equal(unknown.qualified, null); assert.equal(unknown.reported, null); assert.equal(unknown.providerCount, null);
  const lr = {decision:{signals:[{strategy:'TREND_MTF'},{strategy:'TREND_MTF'},{strategy:'FAKE'}],rejects:[{strategy:'D_THRUST'}]}};
  const result = model.operations({equity:300}, lr, [], true);
  assert.equal(result.qualified, 1); assert.equal(result.reported, 2);
  assert.equal(model.operations({}, lr, [], false).qualified, null);
});
test('returned agent logs do not turn disabled controls or failed reviews into active AI', () => {
  const lr = {desk:{body:false,validator:false,reentry:null},ai:{providers:[]},decision:{signals:[],rejects:[]}};
  const op = model.operations({equity:300}, lr, [{agent:'validator',ts:'2026-10-28T12:00:00Z'},{agent:'ai-review',error:'quota',ts:'2026-10-28T12:00:00Z'}], true);
  assert.equal(op.observedRoles, 2); assert.equal(op.providerCount, 0);
  assert.equal(op.roles.find((r: any) => r.id === 'validator').status, 'ADVISORY · OFF');
  assert.equal(op.roles.find((r: any) => r.id === 'reentry').status, 'OFF');
  assert.equal(op.roles.find((r: any) => r.id === 'ai-review').status, 'NOT CONFIGURED');
  assert.equal(op.roles.find((r: any) => r.id === 'ai-review').record.error, 'quota');
});
test('net-positive strategy count uses closed net outcomes, not win rate or setup score', () => {
  const st = {equity:300,stats:{by:{TREND_MTF:{n:3,net:-8,wins:2},SESSION_BO:{n:1,net:2},D_THRUST:{n:0,net:100}}}};
  const op = model.operations(st, {}, [], true);
  assert.equal(op.traded, 2); assert.equal(op.positive, 1);
  assert.equal(new Set(op.rows.map((r: any) => r.family)).size, 4);
});
test('one enabled / risk-scale resolver matches the engine and never mutates its inputs', () => {
  // defaults and the opt-in list are the engine's
  assert.deepEqual({ ...model.DEFAULT_RISK_SCALE }, { ...CFG_DEFAULTS.RISK_SCALE });
  assert.deepEqual([...model.OPT_IN].sort(), [...OPT_IN].sort());
  // book cfg RISK_SCALE merges over the defaults (opt-ins default 0, others 1); inputs untouched
  const cfg = { RISK_SCALE: { EMA_CROSS: 0.25, TREND_MTF: 0.5 } }, before = JSON.stringify(cfg), defaults = JSON.stringify(model.DEFAULT_RISK_SCALE);
  const map = model.riskScaleMap(cfg);
  assert.equal(map.EMA_CROSS, 0.25); assert.equal(map.TREND_MTF, 0.5); assert.equal(map.HTF_TREND, 1); assert.equal(map.SSR, 0);
  map.SSR = 1;
  assert.equal(JSON.stringify(cfg), before); assert.equal(JSON.stringify(model.DEFAULT_RISK_SCALE), defaults);
  assert.ok(Object.isFrozen(model.DEFAULT_RISK_SCALE));
  assert.equal(model.riskScaleMap(undefined).D_BEARTRAP, 1); assert.equal(model.riskScaleMap({}).EMA_PB, 0);
  // each OFF rule
  assert.equal(model.resolveStrategy('TREND_MTF', {}, { TREND_MTF: false }).off, 'flag');
  assert.equal(model.resolveStrategy('SESSION_BO', { RISK_SCALE: { SESSION_BO: 0 } }, {}).off, 'scale');
  assert.equal(model.resolveStrategy('HTF_SWEEP', { RISK_SCALE: { HTF_SWEEP: -1 } }, {}).off, 'opt-in');
  assert.equal(model.resolveStrategy('HTF_SWEEP', { RISK_SCALE: { HTF_SWEEP: 0.3 } }, {}).enabled, true);
  assert.equal(model.resolveStrategy('D_THRUST', undefined, undefined).enabled, true);
  // the same on/off decision as engine.offReason for every strategy under a spread of configs and flags
  const cases: any[] = [
    [undefined, {}], [{ RISK_SCALE: {} }, {}], [{ RISK_SCALE: { EMA_CROSS: 0.5, SESSION_BO: 0 } }, { TREND_MTF: false }],
    [{ RISK_SCALE: { ...CFG_DEFAULTS.RISK_SCALE, SSR: 1, EMA_PB: 0.25, D_BEARTRAP: 0 } }, { SWEEP_REV: false, SSR: true }],
    [{ RISK_SCALE: { HTF_SWEEP: -0.5, VWAP_REVERT: 0.1 } }, { HTF_TREND: true }],
  ];
  try {
    for (const [c, enabled] of cases) {
      applyCfg(c as never);
      for (const id of STRATEGIES) {
        const engineOn = offReason(id, enabled) === null, why = `${id} ${JSON.stringify(c)} ${JSON.stringify(enabled)}`;
        assert.equal(model.resolveStrategy(id, c, enabled).enabled, engineOn, why);
        // strategyStatus (operations / setup radar) uses the same rule
        assert.equal(model.strategyStatus(id, { cfg: c, enabled }, {}, true).enabled, engineOn, why);
      }
    }
  } finally { applyCfg(); }
});
