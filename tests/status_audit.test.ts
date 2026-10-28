import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditStatus, renderAudit, fetchStatus, STATUS_URL } from '../scripts/audit_status.mjs';

const now = Date.parse('2026-10-28T12:00:00Z');
const time = new Date(now - 60_000).toISOString();
const opts = { now, sourceVersion: '5.8.0', sourceCommit: 'a'.repeat(40) };
function fixture() {
  return {
    version: '5.8.0', mode: 'PAPER', updated: time,
    integrity: { approved: true },
    state: { version: '5.8.0', startEquity: 300, equity: 301, pos: null, stats: { all: { n: 1, net: 1 } }, cfg: { RISK_SCALE: { SWEEP_REV: 1 } } },
    lastRun: { ts: time, source: 'hyperliquid', market: { barT: now - 60_000 } },
    trades: [{ id: 'one', symbol: 'BTC', dir: 'long', net: 1, fees: 0.1, funding: 0, r: 0.5, open_t: new Date(now - 3600_000).toISOString(), close_t: time }],
    books: {}, backtest: { results: { version: '5.8.0', cfg: { RISK_SCALE: { SWEEP_REV: 1 } } } },
  };
}
const has = (a: ReturnType<typeof auditStatus>, code: string) => a.findings.some((f: { code: string }) => f.code === code);

test('reconciles count-matched flat ledger without certifying deployed source or profitability', () => {
  const a = auditStatus(fixture(), opts);
  assert.equal(a.books[0].ledgerMatches, true);
  assert.equal(a.books[0].equityMatches, true);
  assert.equal(a.books[0].feesInReturnedRows, 0.1);
  assert.equal(a.readiness, 'INCOMPLETE');
  assert.equal(a.executionDecision, 'WAIT');
  assert.ok(has(a, 'DEPLOYED_ARTIFACT_SHA_UNVERIFIED'));
});
test('partial bounded history is unknown, not an accounting failure or a complete export', () => {
  const f = fixture(); f.state.stats.all.n = 100; f.state.stats.all.net = 1;
  const a = auditStatus(f, opts);
  assert.equal(a.books[0].coverage, 'partial');
  assert.equal(a.books[0].ledgerMatches, null);
  assert.ok(has(a, 'BOUNDED_TRADE_COVERAGE'));
  assert.equal(has(a, 'LEDGER_NET_MISMATCH'), false);
});
test('detects independent ledger and flat equity errors', () => {
  const f = fixture(); f.trades[0].net = 2; f.state.equity = 303;
  const a = auditStatus(f, opts);
  assert.ok(has(a, 'LEDGER_NET_MISMATCH'));
  assert.ok(has(a, 'FLAT_EQUITY_MISMATCH'));
});
test('duplicate IDs invalidate totals instead of double counting', () => {
  const f = fixture(); f.trades.push({ ...f.trades[0] }); f.state.stats.all.n = 2;
  const a = auditStatus(f, opts);
  assert.ok(has(a, 'TRADE_ID_MISSING_OR_DUPLICATE'));
  assert.equal(a.books[0].ledgerNet, null);
});
test('numeric strings, nulls and malformed rows cannot become plausible zero totals', () => {
  const f: any = fixture(); f.state.equity = '301'; f.trades[0].net = null;
  const a = auditStatus(f, opts);
  assert.equal(a.books[0].equity, null);
  assert.equal(a.books[0].ledgerNet, null);
  assert.ok(has(a, 'ACCOUNT_TOTALS_INVALID'));
  assert.ok(has(a, 'TRADE_ROWS_INVALID'));
});
test('fresh BTC cannot hide stale GOLD or a stale market bar', () => {
  const f: any = fixture();
  f.books.GOLD = structuredClone(f);
  f.books.GOLD.updated = '2020-01-01T00:00:00Z';
  f.books.GOLD.lastRun.market.barT = now - 3600_000;
  const a = auditStatus(f, opts);
  assert.ok(a.findings.some((x: any) => x.book === 'GOLD' && x.code === 'BOOK_UPDATE_STALE_OR_INVALID'));
  assert.ok(a.findings.some((x: any) => x.book === 'GOLD' && x.code === 'CLOSED_BAR_STALE_OR_INVALID'));
  assert.equal(a.books[1].instrument, 'PAXG (gold proxy; not XAUUSD)');
});
test('future and timezone-free run timestamps are invalid; forming bars are rejected', () => {
  const f = fixture(); f.updated = '2026-10-28T12:00:00'; f.lastRun.ts = '2026-10-29T12:00:00Z'; f.lastRun.market.barT = now + 1;
  const a = auditStatus(f, opts);
  for (const code of ['BOOK_UPDATE_STALE_OR_INVALID', 'RUN_STALE_OR_INVALID', 'CLOSED_BAR_STALE_OR_INVALID']) assert.ok(has(a, code));
});
test('missing approval, source drift and live mode remain blockers', () => {
  const f = fixture(); f.mode = 'LIVE'; f.integrity.approved = false;
  const a = auditStatus(f, { ...opts, sourceVersion: '5.7.0' });
  for (const code of ['CONFIG_NOT_APPROVED', 'SOURCE_VERSION_MISMATCH', 'MODE_NOT_VERIFIED_PAPER']) assert.ok(has(a, code));
  assert.equal(a.readiness, 'NEEDS_CHANGES');
});
test('open or unknown position does not manufacture a closed-equity reconciliation', () => {
  const f: any = fixture(); f.state.pos = { qty: 1 }; f.state.equity = 330;
  const a = auditStatus(f, opts);
  assert.equal(a.books[0].equityMatches, null);
  assert.equal(has(a, 'FLAT_EQUITY_MISMATCH'), false);
  assert.ok(has(a, 'OPEN_OR_UNKNOWN_POSITION_RECONCILIATION'));
});
test('old backtest and config drift are explicit, never applied to the engine', () => {
  const f = fixture(); f.backtest.results.version = '5.1.0'; f.backtest.results.cfg.RISK_SCALE.SWEEP_REV = 0;
  const before = structuredClone(f), a = auditStatus(f, opts);
  assert.deepEqual(a.books[0].differingRiskScales, ['SWEEP_REV']);
  assert.ok(has(a, 'MATCHED_VALIDATION_MISSING'));
  assert.deepEqual(f, before);
});
test('HTML escapes untrusted strings and reports omit raw private/unknown payload fields', () => {
  const f: any = fixture(); f.version = '<script>alert(1)</script>'; f.secret = 'DO_NOT_EXPORT'; f.state._news = { headline: 'DO_NOT_EXPORT' };
  const a = auditStatus(f, opts), html = renderAudit(a);
  assert.equal(html.includes('<script>alert'), false);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(JSON.stringify(a).includes('DO_NOT_EXPORT'), false);
  assert.ok(html.includes("default-src 'none'"));
});
test('only known books and explicitly labeled trade symbols are accepted', () => {
  const f: any = fixture(); f.books.XAUUSD = {}; delete f.trades[0].symbol;
  const a = auditStatus(f, opts);
  assert.ok(has(a, 'UNSUPPORTED_BOOK'));
  assert.ok(has(a, 'TRADE_SYMBOL_INVALID'));
});
test('fetch uses only allowlisted GET without keys and rejects HTTP errors', async () => {
  const raw = await fetchStatus(async (url: string, init: RequestInit) => {
    assert.equal(url, STATUS_URL); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { Accept: 'application/json' });
    return new Response(JSON.stringify(fixture()));
  });
  assert.equal(JSON.parse(raw).mode, 'PAPER');
  await assert.rejects(() => fetchStatus(async () => new Response('', { status: 503 })), /HTTP 503/);
});
test('fetch rejects oversized bodies', async () => {
  await assert.rejects(() => fetchStatus(async () => new Response('x'.repeat(8 * 1024 * 1024 + 1))), /8 MiB/);
});
test('CLI writes redacted JSON and self-contained HTML offline, returning incomplete exit code', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deskbot-audit-'));
  try {
    const input = join(dir, 'input.json'), output = join(dir, 'out');
    await writeFile(input, JSON.stringify(fixture()));
    const result = spawnSync(process.execPath, ['scripts/audit_status.mjs', '--input', input, '--output', output], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
    const saved = JSON.parse(await readFile(join(output, 'status-audit.json'), 'utf8'));
    assert.match(saved.inputSha256, /^[a-f0-9]{64}$/);
    assert.equal(saved.captureMethod, 'local-file');
    assert.equal(saved.executionDecision, 'WAIT');
    assert.ok((await readFile(join(output, 'status-audit.html'), 'utf8')).includes('Static observation'));
    const invalid = spawnSync(process.execPath, ['scripts/audit_status.mjs', '--input', input, '--fetch', '--output', output], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
