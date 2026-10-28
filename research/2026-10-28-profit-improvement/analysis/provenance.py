"""Per-trade provenance + the three deterioration groups with trade IDs (live ledger, 29 closed paper trades, 22-28 Oct 2026).
Engine/config epoch is INFERRED from the deploy/config timeline in docs (dbv5_trades stores no version or config fingerprint)."""
import csv, json, os, datetime as d
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
rows = list(csv.DictReader(open(R + '/data/live_trades_2026-10-28.csv')))
def ms(r):
    mm, hhmm = r['opened_utc'].split(); mo, da = map(int, mm.split('-')); h, mi = map(int, hhmm.split(':'))
    return int(d.datetime(2026, mo, da, h, mi, tzinfo=d.timezone.utc).timestamp() * 1000)
# epochs from docs/CHANGELOG.md and docs/control/EVIDENCE_LOG.md: v5.7.0 trade manager 2026-10-23; gold cfg change 2026-10-23; v5.8.0 (fn v17) 2026-10-24; v18 2026-10-28
def epoch(r):
    t = d.datetime.fromtimestamp(ms(r) / 1000, d.timezone.utc)
    code = 'v5.7.0(or earlier)' if t < d.datetime(2026, 10, 24, tzinfo=d.timezone.utc) else 'v5.8.0 (agents OFF in decisions)'
    cfg = 'live-cfg (BTC be; GOLD stall, EMA_CROSS 0.25, TREND_MTF minStop 0.4%)' if (r['sym'] == 'GOLD' and t >= d.datetime(2026, 10, 23, tzinfo=d.timezone.utc)) else 'live-cfg (BTC be)' if r['sym'] == 'BTC' and t >= d.datetime(2026, 10, 23, tzinfo=d.timezone.utc) else 'pre-2026-10-23 cfg'
    return code, cfg
for r in rows: r['code'], r['cfg'] = epoch(r); r['ms'] = ms(r)
rows.sort(key=lambda r: r['ms'])
with open(R + '/out/provenance.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['id', 'sym', 'strat', 'dir', 'opened_utc', 'path', 'stop_pct', 'net', 'r', 'fees', 'slip', 'engine_epoch(inferred)', 'cfg_epoch(inferred)'])
    for r in rows: w.writerow([r['id'], r['sym'], r['strat'], r['dir'], r['opened_utc'], r['path'], r['stop_pct'], r['net'], r['r'], round(float(r['fee_entry']) + float(r['fee_exit_taker']) + float(r['fee_exit_maker']), 4), r['slip'], r['code'], r['cfg']])
G = {
 '1 GOLD book (all strategies)': [r for r in rows if r['sym'] == 'GOLD'],
 '2 plain stop-outs (path == STOP)': [r for r in rows if r['path'] == 'STOP'],
 '3 narrow stops 0.15-0.25% (cost-heavy)': [r for r in rows if 0.15 <= float(r['stop_pct']) < 0.25],
}
out = {}
for k, rs in G.items():
    out[k] = dict(n=len(rs), net=round(sum(float(r['net']) for r in rs), 2), sumR=round(sum(float(r['r']) for r in rs), 2), ids=[r['id'] for r in rs])
    print(k, out[k]['n'], out[k]['net'], out[k]['sumR']); print('   ', ', '.join(out[k]['ids']))
print('code epochs:', {e: sum(1 for r in rows if r['code'] == e) for e in {r['code'] for r in rows}})
json.dump(out, open(R + '/out/deterioration_groups.json', 'w'), indent=1)
