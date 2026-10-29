import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context: any = {};
vm.runInNewContext(readFileSync(new URL('../web/evidence.js', import.meta.url), 'utf8'), context);
const evidence = context.DeskBotEvidence;
const now = Date.parse('2026-10-28T12:00:00Z');
function fixture() {
  return { mode: 'PAPER', version: '5.8.0', updated: new Date(now - 60000).toISOString(),
    integrity: { approved: false }, lastRun: { ts: new Date(now - 60000).toISOString(), market: { barT: now - 60000 }, ai: { providers: [] } } };
}
test('unapproved UI never asserts entries are paused without enforcement evidence', () => {
  assert.match(evidence.configLabel({ approved: false }), /enforcement not reported/);
  assert.equal(evidence.configLabel({ approved: false }).includes('paused'), false);
  assert.match(evidence.configLabel(null), /not reported/);
});
test('snapshot and disconnected mode remain explicit', () => {
  const r = evidence.summarize(fixture(), now, false);
  assert.equal(r.mode, 'SAVED SNAPSHOT'); assert.equal(r.rows.length, 0);
});
test('each book gets independent freshness and instrument labels', () => {
  const f: any = fixture(); f.books = { GOLD: fixture() };
  f.books.GOLD.updated = '2020-01-01T00:00:00Z';
  const r = evidence.summarize(f, now, true);
  assert.equal(r.rows[0].fresh, true); assert.equal(r.rows[1].fresh, false);
  assert.match(r.rows[1].instrument, /not XAUUSD/);
  assert.match(r.rows[0].ai, /No provider reported/);
});
test('a forming or stale candle cannot hide behind a fresh run timestamp', () => {
  const f = fixture(); f.lastRun.market.barT = now + 1;
  assert.equal(evidence.summarize(f, now, true).rows[0].fresh, false);
});
test('old validation and missing deployment identity remain visible', () => {
  const f: any = fixture(); f.backtest = { results: { version: '5.1.0' } };
  const r = evidence.summarize(f, now, true);
  assert.ok(r.issues.some((s: string) => s.includes('validation')));
  assert.ok(r.issues.some((s: string) => s.includes('artifact SHA')));
});
test('website loads presentation helpers before controller and external scripts parse', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('src="./evidence.js"') < html.indexOf('src="./app.js"'));
  assert.ok(html.indexOf('src="./desk-model.js"') < html.indexOf('src="./app.js"'));
  for (const file of ['evidence.js', 'desk-model.js', 'app.js']) new vm.Script(readFileSync(new URL('../web/' + file, import.meta.url), 'utf8'));
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim()) new vm.Script(match[1]);
  }
  assert.ok(html.includes('id="evidenceRows"'));
  assert.equal(html.includes('Entries paused: approval required'), false);
});
test('a failed refresh clears live evidence and exposes the disconnected banner', async () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const functionBody = app.slice(app.indexOf('async function pullDirect()'), app.indexOf('async function pull()'));
  const banner = { hidden: true, textContent: '' };
  const ctx: any = { AbortSignal, API: 'https://example.test/status', LIVE: true, fetch: async () => ({ ok: false }),
    $: () => banner, renderAll: () => {}, fromApi: () => { throw new Error('not called'); } };
  vm.createContext(ctx); vm.runInContext(functionBody, ctx);
  assert.equal(await ctx.pullDirect(), false);
  assert.equal(ctx.LIVE, false); assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /Disconnected/);
});
