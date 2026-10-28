"""Descriptive attribution of the 29 live paper trades (BTC and GOLD books), 22-28 Oct 2026.
Input:  data/live_trades_2026-10-28.csv (exported from dbv5_trades; every column reproducible with the SQL in README.md)
Output: prints tables; writes out/live_attribution.json. Pure descriptive accounting; small-sample statistics are labelled as such."""
import csv, json, random, statistics as st, sys, os
rows = list(csv.DictReader(open(os.path.join(os.path.dirname(__file__), '..', 'data', 'live_trades_2026-10-28.csv'))))
F = ['hold_min','entry','stop_pct','notional','risk','gross_filled','slip','fee_entry','fee_exit_taker','fee_exit_maker','funding','net','r','score']
for r in rows:
    for k in F: r[k] = float(r[k])
    r['fees'] = r['fee_entry'] + r['fee_exit_taker'] + r['fee_exit_maker']
    r['cost'] = r['fees'] + r['slip'] + r['funding']            # funding sign: positive = paid
    r['frictionless'] = r['gross_filled'] + r['slip']           # price P&L before slippage (fills already contain it)
    r['stopout'] = r['path'] == 'STOP'
out = {}
def agg(rs):
    n = len(rs)
    if not n: return {}
    return dict(n=n, wins=sum(x['net'] > 0 for x in rs), net=round(sum(x['net'] for x in rs), 3), sumR=round(sum(x['r'] for x in rs), 3),
                meanR=round(sum(x['r'] for x in rs) / n, 3), frictionless=round(sum(x['frictionless'] for x in rs), 3), slip=round(sum(x['slip'] for x in rs), 3),
                fees=round(sum(x['fees'] for x in rs), 3), funding=round(sum(x['funding'] for x in rs), 3), cost=round(sum(x['cost'] for x in rs), 3),
                risk=round(sum(x['risk'] for x in rs), 2))
def show(title, groups):
    print(f'\n== {title}')
    print(f"{'group':28} {'n':>3} {'win':>3} {'net$':>8} {'sumR':>7} {'meanR':>7} {'frictionless$':>13} {'slip$':>7} {'fees$':>7} {'fund$':>7} {'cost$':>7} {'cost/|fric|':>11}")
    for k, rs in groups:
        a = agg(rs)
        if not a: continue
        ratio = a['cost'] / abs(a['frictionless']) if a['frictionless'] else float('nan')
        print(f"{k:28} {a['n']:>3} {a['wins']:>3} {a['net']:>8.2f} {a['sumR']:>7.2f} {a['meanR']:>7.3f} {a['frictionless']:>13.2f} {a['slip']:>7.2f} {a['fees']:>7.2f} {a['funding']:>7.3f} {a['cost']:>7.2f} {ratio:>11.2f}")
    return {k: agg(rs) for k, rs in groups}
by = lambda f: sorted({f(r) for r in rows})
out['total'] = show('TOTAL AND BY BOOK', [('ALL', rows)] + [(s, [r for r in rows if r['sym'] == s]) for s in ('BTC', 'GOLD')])
out['strategy'] = show('BY BOOK x STRATEGY', [(f"{s}/{t}", [r for r in rows if r['sym'] == s and r['strat'] == t]) for s in ('BTC', 'GOLD') for t in by(lambda r: r['strat']) if any(r['sym'] == s and r['strat'] == t for r in rows)])
out['exit'] = show('BY EXIT PATH CLASS', [('STOP only', [r for r in rows if r['path'] == 'STOP']), ('TP1>STOP (gave back)', [r for r in rows if r['path'] == 'TP1>STOP']), ('TP path to BE/lock', [r for r in rows if 'STOP' in r['path'] and r['path'] not in ('STOP', 'TP1>STOP')]),
                     ('full TP1>TP2>TP3', [r for r in rows if r['path'] == 'TP1>TP2>TP3']), ('MANUAL', [r for r in rows if r['path'] == 'MANUAL'])])
bucket = lambda r: '<0.15%' if r['stop_pct'] < 0.15 else '0.15-0.25%' if r['stop_pct'] < 0.25 else '>=0.25%'
out['stop_width'] = show('BY STOP WIDTH (% of entry)', [(b, [r for r in rows if bucket(r) == b]) for b in ('<0.15%', '0.15-0.25%', '>=0.25%')])
out['stop_width_x_book'] = show('STOP WIDTH x BOOK', [(f'{s} {b}', [r for r in rows if r['sym'] == s and bucket(r) == b]) for s in ('BTC', 'GOLD') for b in ('<0.15%', '0.15-0.25%', '>=0.25%')])
out['fast_stop'] = show('STOP-OUTS BY TIME TO STOP', [('stop within 30 min', [r for r in rows if r['stopout'] and r['hold_min'] <= 30]), ('stop after 30 min', [r for r in rows if r['stopout'] and r['hold_min'] > 30]), ('not a plain stop', [r for r in rows if not r['stopout']])])
out['direction'] = show('BY DIRECTION', [(d, [r for r in rows if r['dir'] == d]) for d in ('short', 'long')])
# round-trip cost expressed against the stop distance: cost% of notional / stop%
for r in rows: r['cost_pct_notional'] = 100 * (r['fees'] + r['slip']) / r['notional']
print('\n== ROUND-TRIP COST (fees+slippage) as % of notional, by exit class')
for k, rs in (('plain stop', [r for r in rows if r['stopout']]), ('full TP', [r for r in rows if r['path'] == 'TP1>TP2>TP3'])):
    print(k, 'mean cost % notional', round(st.mean(r['cost_pct_notional'] for r in rs), 3), '| mean stop width %', round(st.mean(r['stop_pct'] for r in rs), 3),
          '| cost / stop-width', round(st.mean(r['cost_pct_notional'] / r['stop_pct'] for r in rs), 2))
# notional/equity: leverage cap evidence
print('\n== LEVERAGE: notional / (approx equity 340) for the 1750-notional trades')
print('trades with notional >= 1650:', sum(r['notional'] >= 1650 for r in rows), 'of', len(rows))
# --- uncertainty (small sample): bootstrap of mean R, trade-level iid and moving-block (block=3 trades) in close order
random.seed(20261028)
def boot(vals, B=20000, block=1):
    n = len(vals); means = []
    for _ in range(B):
        s = []
        while len(s) < n:
            i = random.randrange(n); s.extend(vals[i:i + block] if block > 1 else [vals[i]])
        means.append(sum(s[:n]) / n)
    means.sort(); return round(means[int(.025 * B)], 3), round(means[int(.975 * B)], 3)
ordered = rows  # CSV is in close_t order except where noted; block bootstrap on this order
out['uncertainty'] = {}
for k, rs in (('ALL', rows), ('BTC', [r for r in rows if r['sym'] == 'BTC']), ('GOLD', [r for r in rows if r['sym'] == 'GOLD'])):
    v = [r['r'] for r in rs]
    out['uncertainty'][k] = dict(n=len(v), meanR=round(sum(v) / len(v), 3), ci95_iid=boot(v), ci95_block3=boot(v, block=3))
print('\n== UNCERTAINTY of mean net R per trade (bootstrap, 20000 resamples; n small!)')
for k, u in out['uncertainty'].items(): print(k, u)
# ids of the largest contributors
print('\n== TEN WORST TRADES BY NET $')
for r in sorted(rows, key=lambda x: x['net'])[:10]: print(r['id'], r['sym'], r['strat'], r['path'], 'net', r['net'], 'R', r['r'], 'stop%', r['stop_pct'], 'hold', int(r['hold_min']))
os.makedirs(os.path.join(os.path.dirname(__file__), '..', 'out'), exist_ok=True)
json.dump(out, open(os.path.join(os.path.dirname(__file__), '..', 'out', 'live_attribution.json'), 'w'), indent=1)
