"""Frozen comparison + verdict logic. Reads out/runs/*.json written by harness/run.ts (tag == 'eval'), writes out/results.json and RESULTS.md.
Usage: python3 -I analysis/compare.py
Dependence-aware uncertainty: paired DAILY delta-R (challenger minus BASE, same book/period, indexed by trade close day),
circular moving-block bootstrap, block length L=10 days (sensitivity L=5, 20), B=10000, seed 20261028, two-sided 97.5% interval
(Bonferroni for the two challengers: percentiles 1.25 / 98.75)."""
import json, glob, os, random, math, sys
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DAY = 86_400_000
C_END = 1792627200000
PER = {'A': (C_END - 1095 * DAY, C_END - 730 * DAY), 'B': (C_END - 730 * DAY, C_END - 365 * DAY), 'C': (C_END - 365 * DAY, C_END)}
SYMS = ('BTC', 'PAXG'); CHALL = ('A_COSTR50', 'B_BE_TP1')
B_BOOT, SEED, LEN = 10000, 20261028, 10

def load():
    runs = {}
    for f in sorted(glob.glob(R + '/out/runs/*.json')):
        j = json.load(open(f)); m = j['meta']
        if m.get('tag') != 'eval' or m['period'] not in PER: continue
        runs[(m['variant'], m['sym'], m['period'], m['costmult'])] = j   # sorted by runId (timestamp suffix) -> latest wins
    return runs

def daily(j):
    s, e = PER[j['meta']['period']]; n = (e - s) // DAY; a = [0.0] * n
    for t in j['trades']:
        d = (t['c'] - s) // DAY
        if 0 <= d < n: a[d] += t['r']
    return a

def metrics(js):
    """js: list of run dicts (one per book) of one variant/period; pooled."""
    tr = [t for j in js for t in j['trades']]
    rs = sorted(t['r'] for t in tr); n = len(rs)
    k = max(1, math.ceil(0.05 * n)) if n else 0
    span = sum(PER[j['meta']['period']][1] - PER[j['meta']['period']][0] for j in js)
    expo = sum(max(0, t['c'] - t['o']) for t in tr) / span if span else 0
    gw = sum(t['n'] for t in tr if t['n'] > 0); gl = -sum(t['n'] for t in tr if t['n'] < 0)
    return dict(trades=n, netR=sum(rs), meanR=(sum(rs) / n if n else None), net=sum(t['n'] for t in tr),
                winrate=(sum(1 for t in tr if t['n'] > 0) / n if n else None), pf=(gw / gl if gl > 0 else None),
                worstR=(rs[0] if n else None), cvar5R=(sum(rs[:k]) / k if n else None), exposure=expo,
                maxDD={j['meta']['sym']: j['meta']['maxDD'] for j in js},
                endEq={j['meta']['sym']: j['meta']['endEquity'] for j in js},
                fees=sum(t['f'] for t in tr), funding=sum(t['u'] for t in tr))

def mbb(delta, L, rng):
    n = len(delta); nb = math.ceil(n / L); out = []
    for _ in range(B_BOOT):
        s = 0.0
        for _ in range(nb):
            st = rng.randrange(n)
            for i in range(L): s += delta[(st + i) % n]
        out.append(s / (nb * L))
    out.sort(); return out

def boot(delta):
    res = {}
    for L in (5, 10, 20):
        rng = random.Random(SEED + L); b = mbb(delta, L, rng)
        res[f'L{L}'] = dict(lo=b[int(0.0125 * B_BOOT)], hi=b[int(0.9875 * B_BOOT) - 1], p_le0=sum(1 for x in b if x <= 0) / B_BOOT)
    n = len(delta); m = sum(delta) / n; v = sum((x - m) ** 2 for x in delta) or 1e-12
    rho = [sum((delta[i] - m) * (delta[i + k] - m) for i in range(n - k)) / v for k in (1, 2, 3)]
    res['days'] = n; res['meanDailyDeltaR'] = m; res['totalDeltaR'] = sum(delta); res['acf1_3'] = rho
    res['neff'] = n / max(1.0, 1 + 2 * sum(max(0, r_) for r_ in rho))
    return res

def get(runs, v, per_list, syms, cm=1):
    js = [runs.get((v, s, p, cm)) for p in per_list for s in syms]
    return js if all(js) else None

def delta_series(runs, v, per_list, syms, cm=1):
    b, c = get(runs, 'BASE', per_list, syms, cm), get(runs, v, per_list, syms, cm)
    if not b or not c: return None
    out = []
    for p in per_list:
        db = [0.0] * len(daily(b[0])); dc = list(db)
        for s in syms:
            jb, jc = runs[('BASE', s, p, cm)], runs[(v, s, p, cm)]
            for i, x in enumerate(daily(jb)): db[i] += x
            for i, x in enumerate(daily(jc)): dc[i] += x
        out += [y - x for x, y in zip(db, dc)]
    return out

def verdict(res):
    """Frozen rules (SPEC_FROZEN.md section 6). Returns (label, [reasons])."""
    why = []; rej = []
    H, D = res['hold'], res['dev']
    if H is None: return 'INCOMPLETE', ['holdout not run']
    if H['d']['netR'] <= 0: rej.append('R1 holdout pooled dNetR <= 0')
    if D['boot']['L10']['hi'] < 0: rej.append('R2 dev interval entirely below 0')
    for tag, blk in (('dev', D), ('hold', H)):
        for s in SYMS:
            if blk['c']['maxDD'][s] > blk['b']['maxDD'][s] + 0.02: rej.append(f'R3 {tag} {s} maxDD worse by >2pp')
    if H['c']['cvar5R'] < H['b']['cvar5R'] - 0.05: rej.append('R4 holdout CVaR5 worse by >0.05R')
    if H['c']['worstR'] < H['b']['worstR'] - 0.25: rej.append('R4 holdout worst trade worse by >0.25R')
    if H['c']['exposure'] > H['b']['exposure'] * 1.10: rej.append('R5 holdout exposure >10% above baseline')
    if res['hold_cost15'] is not None and res['hold_cost15'] <= 0: rej.append('R6 holdout dNetR at 1.5x costs <= 0')
    if rej: return 'REJECT', rej
    ok = []
    ok.append(('P1 dev interval lower bound > 0', D['boot']['L10']['lo'] > 0))
    ok.append(('P2 holdout interval lower bound > 0', H['boot']['L10']['lo'] > 0))
    ok.append(('P3 challenger holdout trades >= 30', H['c']['trades'] >= 30))
    ok.append(('P4 dNetR > 0 in both dev years', all(x > 0 for x in res['dev_years'].values())))
    ok.append(('P5 holdout dNetR at 0.5x and 1.5x costs > 0', res['hold_cost05'] is not None and res['hold_cost05'] > 0 and res['hold_cost15'] > 0))
    bk = res['hold_by_book']
    ok.append(('G1 books agree in sign when each has >= 20 challenger trades', not (all(bk[s]['c_trades'] >= 20 for s in SYMS) and (bk['BTC']['dNetR'] > 0) != (bk['PAXG']['dNetR'] > 0))))
    fails = [n for n, g in ok if not g]
    return ('PROMOTE_TO_EXTENDED_PAPER' if not fails else 'INCONCLUSIVE'), (fails or ['all promote criteria met'])

def main():
    runs = load(); out = {}
    for v in ('BASE',) + CHALL:
        out.setdefault('metrics', {})[v] = {}
        for per in ('A', 'B', 'C'):
            js = get(runs, v, [per], SYMS)
            if js: out['metrics'][v][per] = metrics(js)
            for s in SYMS:
                j = get(runs, v, [per], [s])
                if j: out['metrics'][v][f'{per}:{s}'] = metrics(j)
    out['verdict'] = {}
    for v in CHALL:
        res = {}
        dv = get(runs, v, ['A', 'B'], SYMS); db = get(runs, 'BASE', ['A', 'B'], SYMS)
        ds = delta_series(runs, v, ['A', 'B'], SYMS)
        if dv and db and ds:
            res['dev'] = dict(c=metrics(dv), b=metrics(db), boot=boot(ds), d=dict(netR=metrics(dv)['netR'] - metrics(db)['netR']))
            res['dev_years'] = {p: metrics(get(runs, v, [p], SYMS))['netR'] - metrics(get(runs, 'BASE', [p], SYMS))['netR'] for p in 'AB'}
        hv = get(runs, v, ['C'], SYMS); hb = get(runs, 'BASE', ['C'], SYMS)
        hs = delta_series(runs, v, ['C'], SYMS)
        res['hold'] = None
        if hv and hb and hs:
            res['hold'] = dict(c=metrics(hv), b=metrics(hb), boot=boot(hs), d=dict(netR=metrics(hv)['netR'] - metrics(hb)['netR']))
            res['hold_by_book'] = {}
            for s in SYMS:
                c1, b1 = metrics(get(runs, v, ['C'], [s])), metrics(get(runs, 'BASE', ['C'], [s]))
                sd = delta_series(runs, v, ['C'], [s])
                res['hold_by_book'][s] = dict(c_trades=c1['trades'], b_trades=b1['trades'], dNetR=c1['netR'] - b1['netR'], boot=boot(sd)['L10'])
            for cm, key in ((1.5, 'hold_cost15'), (0.5, 'hold_cost05')):
                a, b = get(runs, v, ['C'], SYMS, cm), get(runs, 'BASE', ['C'], SYMS, cm)
                res[key] = (metrics(a)['netR'] - metrics(b)['netR']) if a and b else None
        else: res['hold_cost15'] = res['hold_cost05'] = None
        res['verdict'], res['reasons'] = verdict(res) if 'dev' in res else ('INCOMPLETE', ['dev runs missing'])
        out['verdict'][v] = res
    json.dump(out, open(R + '/out/results.json', 'w'), indent=1)
    def f(x, p=3): return 'n/a' if x is None else f'{x:.{p}f}'
    L = ['# Results (generated by analysis/compare.py)\n']
    for per in ('A', 'B', 'C'):
        L += [f'\n## Period {per}  (BTC+PAXG pooled; per-book DD)\n', '| variant | trades | net R | mean R/trade | net $ | win % | PF | worst R | CVaR5 R | exposure | maxDD BTC | maxDD PAXG |', '|---|---|---|---|---|---|---|---|---|---|---|---|']
        for v in ('BASE',) + CHALL:
            m = out['metrics'][v].get(per)
            if m: L.append(f"| {v} | {m['trades']} | {f(m['netR'],2)} | {f(m['meanR'])} | {f(m['net'],1)} | {f(100*m['winrate'],1)} | {f(m['pf'],2)} | {f(m['worstR'],2)} | {f(m['cvar5R'],2)} | {f(100*m['exposure'],1)}% | {f(100*m['maxDD']['BTC'],1)}% | {f(100*m['maxDD']['PAXG'],1)}% |")
    L.append('\n## Challenger vs BASE (paired daily dR, circular block bootstrap, 97.5% interval)\n')
    for v, r in out['verdict'].items():
        L.append(f"\n### {v}: **{r['verdict']}**  — {'; '.join(r['reasons'])}\n")
        for tag in ('dev', 'hold'):
            if r.get(tag):
                b = r[tag]['boot']
                L.append(f"- {tag}: dNetR {f(r[tag]['d']['netR'],2)}; mean daily dR {f(b['meanDailyDeltaR'],4)}; L10 [{f(b['L10']['lo'],4)}, {f(b['L10']['hi'],4)}] (L5 [{f(b['L5']['lo'],4)}, {f(b['L5']['hi'],4)}], L20 [{f(b['L20']['lo'],4)}, {f(b['L20']['hi'],4)}]); P(<=0) {f(b['L10']['p_le0'],3)}; n days {b['days']}, ACF1-3 {[round(x,3) for x in b['acf1_3']]}, effective n ~{f(b['neff'],0)}")
        L.append(f"- holdout dNetR at 1.5x costs: {f(r.get('hold_cost15'),2)}; at 0.5x: {f(r.get('hold_cost05'),2)}")
    open(R + '/RESULTS.md', 'w').write('\n'.join(L) + '\n')
    print('\n'.join(L))
if __name__ == '__main__': main()
