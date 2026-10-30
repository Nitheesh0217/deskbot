"""M1 summary (frozen spec research/2026-10-30-entry-exit/SPEC_FROZEN.md, Section 3). Descriptive only.
python3 -I m1_summary.py out/excursions_BTC.json [out/excursions_GOLD.json ...] > out/M1_SUMMARY.md
Reads the per-trade measurement rows from scripts/excursion_study.ts; never re-runs anything."""
import json, statistics as st, sys

def med(xs):
    xs = [x for x in xs if x is not None]
    return round(st.median(xs), 2) if xs else None

def pct(n, d):
    return f"{100 * n / d:.0f}%" if d else "—"

def tercile_cuts(xs):
    xs = sorted(x for x in xs if x is not None)
    if len(xs) < 3:
        return None
    return xs[len(xs) // 3], xs[2 * len(xs) // 3]

def by_tercile(rows, key):
    cuts = tercile_cuts([r[key] for r in rows])
    if not cuts:
        return []
    out = []
    for name, f in (("low", lambda v: v <= cuts[0]), ("mid", lambda v: cuts[0] < v <= cuts[1]), ("high", lambda v: v > cuts[1])):
        g = [r for r in rows if r[key] is not None and f(r[key])]
        if g:
            out.append((name, len(g), round(sum(r["netR"] for r in g) / len(g), 3), pct(sum(1 for r in g if r["tp1BeforeStop"]), len(g))))
    return out, cuts

print("# M1 results: excursions, time to target and entry timing (development data only)\n")
print("Isolated lanes, frozen data and config (FREEZE.json). All three years are development data (SPEC_FROZEN 1).")
print("Censored trades (forced closed at the data end before their max hold) are excluded from outcome columns.")
print("'Hit' columns are first-touch counts on the 5m path, not probabilities.\n")
exitc = []
for path in sys.argv[1:]:
    data = json.load(open(path))
    rows = data["rows"]
    print(f"## {data['book']} ({data['from'][:10]} → {data['to'][:10]})\n")
    print("| strategy | n (cens.) | net R | mean R | win | TP1 before stop | TP2 | TP3 | med MFE R | med MAE R | med giveback R | time exits | med h to TP1 / stop | max hold h | ambiguous bars |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    strategies = sorted({r["strategy"] for r in rows}, key=lambda s: -sum(1 for r in rows if r["strategy"] == s))
    for s in strategies:
        a = [r for r in rows if r["strategy"] == s]
        c = [r for r in a if not r["censored"]]
        n = len(c)
        if not n:
            print(f"| {s} | 0 ({len(a)}) | — |"); continue
        tex = sum(1 for r in c if "TIME" in str(r["reason"]).upper() or r["heldH"] >= r["maxHoldH"] - 0.1)
        tp1h = [r["hTp1"] for r in c if r["tp1BeforeStop"]]
        print(f"| {s} | {n} ({len(a) - n}) | {sum(r['netR'] for r in c):+.1f} | {sum(r['netR'] for r in c) / n:+.3f} | {pct(sum(1 for r in c if r['netR'] > 0), n)} | "
              f"{pct(sum(1 for r in c if r['tp1BeforeStop']), n)} | {pct(sum(1 for r in c if r['tp2BeforeStop']), n)} | {pct(sum(1 for r in c if r['tp3BeforeStop']), n)} | "
              f"{med([r['mfeR'] for r in c])} | {med([r['maeR'] for r in c])} | {med([r['givebackR'] for r in c])} | {pct(tex, n)} | "
              f"{med(tp1h)} / {med([r['hStop'] for r in c if r['hStop'] is not None and not r['tp1BeforeStop']])} | {c[0]['maxHoldH']} | {sum(r['ambiguousBars'] for r in c)} |")
        # EXIT-C justification rule, applied mechanically (SPEC_FROZEN 4), BTC only
        if data["book"] == "BTC" and n:
            no_tp1 = [r for r in c if not r["tp1BeforeStop"]]
            late_open = sum(1 for r in no_tp1 if r["heldH"] > 0.5 * r["maxHoldH"])
            cond1 = tex / n >= 0.25
            cond2 = bool(tp1h) and med(tp1h) < 0.2 * c[0]["maxHoldH"] and no_tp1 and late_open / len(no_tp1) >= 0.40
            exitc.append((s, n, round(tex / n, 3), med(tp1h), c[0]["maxHoldH"], round(late_open / len(no_tp1), 3) if no_tp1 else None, cond1 or cond2))
    print()
    print("### Entry timing (causal measures at the signal) vs outcome, by tercile\n")
    for s in strategies:
        c = [r for r in rows if r["strategy"] == s and not r["censored"]]
        if len(c) < 30:
            continue
        for key, label in (("signalBarMoveATR", "signal bar's own move (ATR)"), ("beyondTriggerATR", "close beyond Donchian trigger (ATR)"), ("atrPct", "ATR % of price (volatility)")):
            res = by_tercile(c, key)
            if not res:
                continue
            groups, cuts = res
            print(f"- **{s}**, {label}, cuts {cuts[0]:.2f} / {cuts[1]:.2f}: " + "; ".join(f"{g} n={n} mean {m:+.3f}R TP1-first {h}" for g, n, m, h in groups))
    print()
print("## EXIT-C justification check (BTC; SPEC_FROZEN 4)\n")
print("| strategy | n | share closed by time | median h to TP1 | max hold h | share of non-TP1 trades open past 50% hold | justified |")
print("|---|---|---|---|---|---|---|")
for s, n, te, mt, mh, lo, j in exitc:
    print(f"| {s} | {n} | {te} | {mt} | {mh} | {lo} | {'YES' if j else 'no'} |")
