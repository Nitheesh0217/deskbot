"""Applies the frozen decision rules (SPEC_FROZEN 5) to out/challengers/results.jsonl + daily_*.json. Mechanical; no tuning.
python3 -I challenger_decide.py out/challengers > out/CHALLENGERS.md"""
import json, os, random, sys

D = sys.argv[1]
res = [json.loads(l) for l in open(os.path.join(D, "results.jsonl")) if l.startswith("{")]
key = lambda r: (r["strategy"], r["variant"])
groups = {}
for r in res:
    groups.setdefault(key(r), {}).setdefault(r["costx"], {})[r["book"]] = r

def daily(book, s, v, x):
    tag = f"{book}_{s}_{v}" + ("" if x == 1 else f"_cost{x}")
    return json.load(open(os.path.join(D, f"daily_{tag}.json")))

def cbb(xs, block, n=10_000, seed=20261030):
    rnd, L, out = random.Random(seed), len(xs), []
    for _ in range(n):
        s, k = 0.0, 0
        while k < L:
            st = rnd.randrange(L)
            for j in range(min(block, L - k)):
                s += xs[(st + j) % L]; k += 1
        out.append(s)
    out.sort()
    return round(out[int(0.0125 * n)], 2), round(out[int(0.9875 * n) - 1], 2)

print("# Frozen challengers vs BASE (development data; SPEC_FROZEN 4-5)\n")
print("Each row is an isolated lane on the identical 3-year 5m window. The hook-free copy of the lane step reproduced `lanes.stepLane` trade-for-trade in every run (identity check).")
print("Interval: circular block bootstrap of the pooled sum of paired daily ΔR, 10,000 resamples, seed 20261030, 97.5% two-sided (1.25-98.75 pct).")
print("Outcomes are REJECT or FORWARD-SHADOW at most. Nothing here can promote a change to a book.\n")
for (s, v), byx in sorted(groups.items()):
    g1, g15 = byx.get(1, {}), byx.get(1.5, {})
    books = sorted(g1)
    print(f"## {v} on {s} (books: {', '.join(books)})\n")
    print("| book | trades B→C | net R B→C | exp R B→C | win B→C | PF B→C | maxDD % B→C | worst R B→C | CVaR5 R B→C | fees+funding $ B→C | skipped / TP1 modified / time50 closes |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    reasons, small = [], False
    for b in books:
        B, C = g1[b]["base"], g1[b]["challenger"]
        small |= B["trades"] < 30
        f = lambda k: f"{B[k]} → {C[k]}"
        print(f"| {b} | {f('trades')} | {f('netR')} | {f('expR')} | {f('win')} | {f('pf')} | {f('maxDDpct')} | {round(B['worstR'],2)} → {round(C['worstR'],2)} | {f('cvar5R')} | "
              f"{round(B['fees']+B['funding'],1)} → {round(C['fees']+C['funding'],1)} | {C['skipped']} / {C['tp1Modified']} / {C['time50Closes']} |")
        if C["maxDDpct"] - B["maxDDpct"] > 2: reasons.append(f"{b} max drawdown +{C['maxDDpct'] - B['maxDDpct']:.2f} pp")
        if C["cvar5R"] < B["cvar5R"] - 0.05: reasons.append(f"{b} CVaR5 worse by {B['cvar5R'] - C['cvar5R']:.3f}R")
        if C["worstR"] < B["worstR"] - 0.25: reasons.append(f"{b} worst trade worse by {B['worstR'] - C['worstR']:.2f}R")
    dnet = sum(g1[b]["challenger"]["netR"] - g1[b]["base"]["netR"] for b in books)
    dnet15 = sum(g15[b]["challenger"]["netR"] - g15[b]["base"]["netR"] for b in g15) if g15 else None
    days = [daily(b, s, v, 1) for b in books]
    L = max(len(d["dR"]) for d in days); d0 = min(d["day0"] for d in days)
    pooled = [0.0] * L
    for d in days:
        for i, x in enumerate(d["dR"]): pooled[d["day0"] - d0 + i] += x
    ivs = {blk: cbb(pooled, blk) for blk in (10, 5, 20)}
    if dnet <= 0: reasons.append(f"pooled ΔnetR {dnet:+.2f} ≤ 0")
    if ivs[10][1] < 0: reasons.append("interval entirely below 0")
    if dnet15 is None: reasons.append("1.5× cost run missing")
    elif dnet15 <= 0: reasons.append(f"ΔnetR at 1.5× costs {dnet15:+.2f} ≤ 0")
    print(f"\nPooled ΔnetR {dnet:+.2f}R; at 1.5× costs {dnet15:+.2f}R. 97.5% interval of pooled ΔR (block 10): {ivs[10]}; block 5: {ivs[5]}; block 20: {ivs[20]}.")
    verdict = "REJECT" if reasons else "FORWARD-SHADOW (candidate only)"
    print(f"\n**Verdict: {verdict}**" + (f": {'; '.join(reasons)}." if reasons else "."))
    if small: print("\nSample warning: at least one book has fewer than 30 base trades; no reliable conclusion either way.")
    if not reasons and ivs[10][0] <= 0 <= ivs[10][1]: print("\nThe interval includes 0: the improvement is not distinguishable from noise on this sample.")
    print()
