"""Fidelity of the research replay vs the live paper ledger over the same days (24 Oct 00:00 -> 28 Oct 22:00 UTC).
Matches a replay trade to a live trade when strategy and direction agree and entry times are within TOL minutes (greedy, one-to-one).
Differences are expected: live uses Hyperliquid candles/funding/news/F&G, real 1m trade management, probation and circuit-breaker state."""
import csv, glob, json, os, datetime as d, sys
R = os.path.join(os.path.dirname(__file__), '..')
TOL = 15 * 60_000
live = list(csv.DictReader(open(R + '/data/live_trades_2026-10-28.csv')))
def live_ms(r):
    mm, hhmm = r['opened_utc'].split(); mo, da = map(int, mm.split('-')); h, mi = map(int, hhmm.split(':'))
    return int(d.datetime(2026, mo, da, h, mi, tzinfo=d.timezone.utc).timestamp() * 1000)
W0 = 1792800000000
res = {}
for sym, book in (('BTC', 'BTC'), ('PAXG', 'GOLD')):
    runs = sorted(glob.glob(R + f'/out/runs/BASE_{sym}_W{W0}_cm1_*.json'))
    rep = json.load(open(runs[-1]))['trades']
    lv = [dict(r, t=live_ms(r)) for r in live if r['sym'] == book and live_ms(r) >= W0]
    used = set(); matches = []
    for r in rep:
        best = None
        for i, l in enumerate(lv):
            if i in used or l['strat'] != r['s'] or (l['dir'] == 'short') != (r['d'] == -1): continue
            dt = abs(l['t'] - r['o'])
            if dt <= TOL and (best is None or dt < best[1]): best = (i, dt)
        if best: used.add(best[0]); matches.append((r, lv[best[0]], best[1]))
    n_rep, n_live = len(rep), len(lv)
    print(f'\n== {book}: replay {n_rep} trades, live {n_live} trades (since 24 Oct 00:00), matched {len(matches)}')
    same_outcome = sum(1 for r, l, _ in matches if (r['n'] > 0) == (float(l['net']) > 0))
    print(f'   matched trades with same win/loss sign: {same_outcome}/{len(matches)}')
    for r, l, dt in matches:
        print(f"   {l['id'][:22]:22} {l['strat']:10} live net {float(l['net']):7.2f} R {float(l['r']):6.2f} | replay net {r['n']:7.2f} R {r['r']:6.2f} | dt {dt//60000:>2} min | live path {l['path']:12} replay {r['rs']}")
    print('   live-only :', [f"{l['opened_utc']} {l['strat']}" for i, l in enumerate(lv) if i not in used])
    mr = {id(r) for r, _, _ in matches}
    print('   replay-only:', [f"{d.datetime.fromtimestamp(r['o']/1000, d.timezone.utc).strftime('%m-%d %H:%M')} {r['s']}" for r in rep if id(r) not in mr])
    res[book] = dict(replay=n_rep, live=n_live, matched=len(matches), same_sign=same_outcome,
                     replay_netR=round(sum(t['r'] for t in rep), 3), live_netR=round(sum(float(l['r']) for l in lv), 3),
                     replay_net=round(sum(t['n'] for t in rep), 2), live_net=round(sum(float(l['net']) for l in lv), 2))
print('\n', json.dumps(res))
json.dump(res, open(R + '/out/fidelity_summary.json', 'w'), indent=1)
