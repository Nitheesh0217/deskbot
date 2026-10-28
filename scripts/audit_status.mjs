// Read-only evidence observer. Never imports the engine or calls mutation endpoints.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';

export const STATUS_URL = 'https://xevymbzgpcsdhygswxlk.supabase.co/functions/v1/deskbot-v5?view=status';
const MAX_BYTES = 8 * 1024 * 1024;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' ? x.slice(0, 160) : null;
const known = new Set(['BTC', 'GOLD']);
const close = (a, b) => Math.abs(a - b) <= 0.0001;
const timestamp = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x) ? Date.parse(x) : NaN;

/** A status bundle is a bounded observation, not an authoritative ledger export. */
export function auditStatus(input, { now = Date.now(), sourceVersion = null, sourceCommit = null, maxAgeMs = 20 * 60_000 } = {}) {
  if (!object(input)) throw new Error('Status must be a JSON object');
  if (!finite(now) || !finite(maxAgeMs) || maxAgeMs <= 0) throw new Error('Invalid audit clock or freshness limit');
  const findings = [];
  const add = (code, book = null, severity = 'blocker') => findings.push({ code, book, severity });
  const mode = text(input.mode), version = text(input.version);
  if (mode !== 'PAPER') add('MODE_NOT_VERIFIED_PAPER');
  if (!version || !sourceVersion) add('SOURCE_VERSION_UNKNOWN');
  else if (version !== sourceVersion) add('SOURCE_VERSION_MISMATCH');
  if (!sourceCommit || !/^[a-f0-9]{40}$/.test(sourceCommit)) add('SOURCE_COMMIT_UNKNOWN');
  add('DEPLOYED_ARTIFACT_SHA_UNVERIFIED', null, 'unknown');

  const trades = Array.isArray(input.trades) ? input.trades : [];
  if (!Array.isArray(input.trades)) add('TRADE_ROWS_MISSING');
  const seen = new Set();
  const badIds = new Set();
  for (const t of trades) {
    if (!object(t) || !known.has(t.symbol)) { add('TRADE_SYMBOL_INVALID'); continue; }
    if (typeof t.id !== 'string' || !t.id || seen.has(t.id)) {
      add('TRADE_ID_MISSING_OR_DUPLICATE', t.symbol);
      if (typeof t.id === 'string') badIds.add(t.id);
    }
    seen.add(t.id);
  }
  const extras = object(input.books) ? input.books : {};
  for (const symbol of Object.keys(extras)) if (!known.has(symbol) || symbol === 'BTC') add('UNSUPPORTED_BOOK');
  const bookInputs = { BTC: input, ...(Object.hasOwn(extras, 'GOLD') ? { GOLD: extras.GOLD } : {}) };
  const books = [];
  for (const [symbol, raw] of Object.entries(bookInputs)) {
    const b = object(raw) ? raw : {};
    const s = object(b.state) ? b.state : {};
    if (!object(b.state)) add('BOOK_STATE_MISSING', symbol);
    const last = object(b.lastRun) ? b.lastRun : {};
    const checkTime = (value, code) => {
      const ms = timestamp(value), age = now - ms;
      if (!Number.isFinite(ms) || age < -60_000 || age > maxAgeMs) add(code, symbol);
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    };
    const updatedAt = checkTime(b.updated, 'BOOK_UPDATE_STALE_OR_INVALID');
    const runAt = checkTime(last.ts, 'RUN_STALE_OR_INVALID');
    const bar = last.market?.barT;
    if (!finite(bar) || bar > now || now - bar > maxAgeMs) add('CLOSED_BAR_STALE_OR_INVALID', symbol);
    if (s.version !== version) add('BOOK_VERSION_MISMATCH', symbol);
    const approved = b.integrity?.approved === true;
    if (!approved) add('CONFIG_NOT_APPROVED', symbol);
    const a = s.stats?.all;
    const count = object(a) && Number.isSafeInteger(a.n) && a.n >= 0 ? a.n : null;
    const net = finite(a?.net) ? a.net : null;
    const start = finite(s.startEquity) ? s.startEquity : null;
    const equity = finite(s.equity) ? s.equity : null;
    if (count === null || net === null || start === null || equity === null) add('ACCOUNT_TOTALS_INVALID', symbol);
    const rows = trades.filter(t => object(t) && t.symbol === symbol);
    const validRows = rows.every(t => typeof t.id === 'string' && t.id.length > 0 && !badIds.has(t.id) && finite(t.net) && finite(t.fees) && finite(t.funding) && finite(t.r) && ['long', 'short'].includes(t.dir) && Number.isFinite(timestamp(t.open_t)) && Number.isFinite(timestamp(t.close_t)) && timestamp(t.open_t) <= timestamp(t.close_t) && timestamp(t.close_t) <= now + 60_000);
    if (!validRows) add('TRADE_ROWS_INVALID', symbol);
    const coverage = count === null || !validRows ? 'unknown' : rows.length === count ? 'count-matched' : rows.length < count ? 'partial' : 'excess';
    if (coverage === 'partial') add('BOUNDED_TRADE_COVERAGE', symbol, 'unknown');
    if (coverage === 'excess') add('TRADE_COUNT_MISMATCH', symbol);
    const ledgerNet = validRows ? rows.reduce((sum, t) => sum + t.net, 0) : null;
    const ledgerMatches = coverage === 'count-matched' && net !== null ? close(ledgerNet, net) : null;
    if (ledgerMatches === false) add('LEDGER_NET_MISMATCH', symbol);
    // Open trades may have realized partials not represented by closed-trade stats.
    const flat = s.pos === null;
    if (!flat) add('OPEN_OR_UNKNOWN_POSITION_RECONCILIATION', symbol, 'unknown');
    const equityMatches = flat && start !== null && net !== null && equity !== null ? close(start + net, equity) : null;
    if (equityMatches === false) add('FLAT_EQUITY_MISMATCH', symbol);
    const bt = symbol === 'BTC' && object(input.backtest?.results) ? input.backtest.results : null;
    if (!bt || bt.version !== version) add('MATCHED_VALIDATION_MISSING', symbol, 'unknown');
    const drift = [];
    const liveScales = s.cfg?.RISK_SCALE, testedScales = bt?.cfg?.RISK_SCALE;
    if (object(liveScales) && object(testedScales)) {
      for (const key of new Set([...Object.keys(liveScales), ...Object.keys(testedScales)])) {
        if (/^[A-Z_]{1,40}$/.test(key) && liveScales[key] !== testedScales[key]) drift.push(key);
      }
    }
    if (drift.length) add('DISPLAYED_VALIDATION_CONFIG_DIFFERS', symbol, 'warning');
    books.push({
      symbol, instrument: symbol === 'GOLD' ? 'PAXG (gold proxy; not XAUUSD)' : 'BTC',
      updatedAt, runAt, approved, flat, startEquity: start, equity, net,
      closedTrades: count, returnedTrades: rows.length, coverage, ledgerNet, ledgerMatches, equityMatches,
      feesInReturnedRows: validRows ? rows.reduce((sum, t) => sum + t.fees, 0) : null,
      reportedMaxDrawdown: finite(s.maxDD) && s.maxDD >= 0 && s.maxDD <= 1 ? s.maxDD : null,
      // The runtime only reports one source label; never invent per-frame provenance.
      reportedSource: ['hyperliquid', 'binance'].includes(last.source) ? last.source : null,
      differingRiskScales: drift,
    });
  }
  return {
    schemaVersion: 1, capturedAt: new Date(now).toISOString(), mode, runtimeVersion: version,
    sourceVersion, sourceCommit, sourceIdentity: 'local-checkout; deployed-artifact-not-verified',
    scope: 'bounded-public-status; no broker or authenticated database verification',
    readiness: findings.some(f => f.severity === 'blocker') ? 'NEEDS_CHANGES' : 'INCOMPLETE',
    // This is an evidence gate, not a market-direction forecast or an order.
    executionDecision: 'WAIT', books, findings,
  };
}

const escape = value => String(value ?? 'unknown').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dollars = value => finite(value) ? value.toFixed(2) : 'unknown';
export function renderAudit(audit) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>DeskBot evidence review</title><style>
  body{font:16px/1.6 system-ui,sans-serif;background:#101722;color:#e8eef5;max-width:1100px;margin:40px auto;padding:0 24px}h1,h2{line-height:1.25}p,small{color:#bac8d7}.badge{display:inline-block;border:1px solid #e7b457;border-radius:6px;padding:4px 12px;color:#f9d290}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #334356}th{color:#b9c8d8}code{overflow-wrap:anywhere}section{margin:28px 0;padding:20px;background:#182230;border:1px solid #334356;border-radius:10px}.scroll{overflow-x:auto}li{margin:8px 0}a{color:#a9d3fc}
  </style></head><body><h1>DeskBot evidence review</h1><p class="badge">${escape(audit.mode)} · ${escape(audit.readiness)} · WAIT</p><p>Captured ${escape(audit.capturedAt)}. Static observation; this page does not update or trade.</p>
  <section><h2>Source identity</h2><p>Observed runtime ${escape(audit.runtimeVersion)} · inspected engine ${escape(audit.sourceVersion)}</p><p>Checkout <code>${escape(audit.sourceCommit)}</code></p><p>${escape(audit.scope)}. Matching version strings do not prove matching deployed code.</p></section>
  <section><h2>Paper account observations</h2><div class="scroll"><table><thead><tr><th>Instrument</th><th>Start USD</th><th>Equity USD</th><th>Net USD</th><th>Closed</th><th>Ledger coverage</th><th>Last run UTC</th></tr></thead><tbody>${audit.books.map(b => `<tr><td>${escape(b.instrument)}</td><td>${dollars(b.startEquity)}</td><td>${dollars(b.equity)}</td><td>${dollars(b.net)}</td><td>${escape(b.closedTrades)}</td><td>${escape(b.coverage)}</td><td>${escape(b.runAt)}</td></tr>`).join('')}</tbody></table></div><p>Net is the application-reported closed-trade total after its modeled costs. Fees are not subtracted twice. Count-matched rows establish internal consistency only. Open-position partials require a separate ledger.</p></section>
  <section><h2>Findings and blockers</h2><ul>${audit.findings.map(f => `<li><strong>${escape(f.severity)}</strong> · ${escape(f.book ?? 'desk')} · <code>${escape(f.code)}</code></li>`).join('')}</ul></section>
  <section><h2>Next evidence required</h2><p>Deployed artifact SHA, complete paginated trade/event history, configuration history, exact per-timeframe sources, and instrument-matched evaluation. WAIT is an evidence gate, not a forecast.</p></section></body></html>`;
}

export async function fetchStatus(fetcher = fetch) {
  const response = await fetcher(STATUS_URL, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Public status HTTP ${response.status}`);
  if (!response.body) throw new Error('Empty status response');
  const chunks = []; let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('Status exceeds 8 MiB limit');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('node scripts/audit_status.mjs (--input snapshot.json | --fetch) --output reports/audit');
    return;
  }
  let input, output, online = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--fetch' && !online) online = true;
    else if ((flag === '--input' || flag === '--output') && args[i + 1] && !args[i + 1].startsWith('--')) {
      if (flag === '--input' && !input) input = args[++i];
      else if (flag === '--output' && !output) output = args[++i];
      else throw new Error('Duplicate argument');
    } else throw new Error('Unknown or incomplete argument');
  }
  if (!output || online === Boolean(input)) throw new Error('Choose exactly one of --input or --fetch and supply --output');
  if (input && (await stat(input)).size > MAX_BYTES) throw new Error('Input exceeds 8 MiB limit');
  const raw = online ? await fetchStatus() : await readFile(input, 'utf8');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const engine = await readFile(resolve(root, 'supabase/functions/deskbot-v5/engine.ts'), 'utf8');
  let sourceCommit = null;
  try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* exported source can lack git metadata */ }
  const audit = auditStatus(JSON.parse(raw), { sourceCommit, sourceVersion: engine.match(/export const VERSION = "([^"]+)"/)?.[1] ?? null });
  audit.inputSha256 = createHash('sha256').update(raw).digest('hex');
  audit.captureMethod = online ? 'public-GET' : 'local-file';
  audit.sourceDirty = null;
  try { audit.sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()); } catch { /* unavailable is unknown */ }
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'status-audit.json'), JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 });
  await writeFile(resolve(output, 'status-audit.html'), renderAudit(audit), { mode: 0o600 });
  console.log(`Wrote evidence report: ${audit.readiness}; ${audit.books.length} books. No trading readiness certified.`);
  // 2 = report generated, evidence incomplete; 1 = execution/input error.
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Audit failed: invalid input, unavailable status, or local I/O error. No raw response logged.'); process.exitCode = 1; });
}
