"""Market-data audit for 5m candle CSV/CSV.GZ (checks follow the data-scrub checklist from shakeebshaan/claude-code-quant-skills, MIT;
independent implementation, standard library only, no network). Exit 1 on any FAIL.
  python3 -I scripts/data_scrub.py kline5_BTC.csv.gz [--tf-ms 300000]
Columns expected (no header): open_time_ms, open, high, low, close, volume."""
import csv, gzip, io, json, math, statistics, sys
path = sys.argv[1]; tf = int(sys.argv[sys.argv.index("--tf-ms") + 1]) if "--tf-ms" in sys.argv else 300_000
op = gzip.open if path.endswith(".gz") else open
rows = [r for r in csv.reader(io.TextIOWrapper(op(path, "rb"), encoding="utf8")) if r]
res = {"file": path, "bars": len(rows), "checks": {}}
def check(name, ok, detail): res["checks"][name] = {"status": "PASS" if ok else "FAIL", "detail": detail}
try:
    T = [int(r[0]) for r in rows]; O, H, L, C, V = ([float(r[i]) for r in rows] for i in range(1, 6)); check("schema", all(len(r) >= 6 for r in rows), "6 numeric columns")
except Exception as e: check("schema", False, str(e)); print(json.dumps(res, indent=1)); sys.exit(1)
dup = len(T) - len(set(T)); nonmono = sum(1 for i in range(1, len(T)) if T[i] <= T[i - 1]); check("timestamps_unique_monotonic", dup == 0 and nonmono == 0, f"duplicates {dup}, non-increasing {nonmono}")
check("timestamps_aligned_to_timeframe", all(t % tf == 0 for t in T), f"all multiples of {tf} ms (UTC epoch, no timezone/DST ambiguity)")
gaps = [(T[i - 1], T[i]) for i in range(1, len(T)) if T[i] - T[i - 1] != tf]; check("no_gaps_24x7", not gaps, f"{len(gaps)} gaps" + (f", first at {gaps[0][0]}, largest {max((b - a) // tf for a, b in gaps)} bars" if gaps else ""))
bad = sum(1 for i in range(len(rows)) if not (L[i] <= O[i] <= H[i] and L[i] <= C[i] <= H[i] and L[i] <= H[i])); check("ohlc_integrity", bad == 0, f"{bad} bars violate low<=open/close<=high")
check("volume_non_negative", all(v >= 0 for v in V), f"min volume {min(V)}"); nan = sum(1 for x in O + H + L + C + V if not math.isfinite(x)); check("no_nan_inf", nan == 0, f"{nan} non-finite values")
stale = sum(1 for i in range(len(rows)) if V[i] == 0 and O[i] == H[i] == L[i] == C[i]); flat = sum(1 for i in range(len(rows)) if H[i] == L[i] and V[i] > 0)
check("no_stale_synthetic_bars", stale == 0, f"zero-volume flat bars {stale}"); res["info_flat_bars_with_volume"] = flat
big = [(T[i], C[i] / C[i - 1] - 1) for i in range(1, len(rows)) if abs(C[i] / C[i - 1] - 1) > 0.20]; check("no_return_outliers_over_20pct", not big, f"{len(big)} bars with |return|>20%" + (f", e.g. {big[:3]}" if big else ""))
med = [statistics.median(V[max(0, i - 30):i]) if i >= 30 else None for i in range(len(V))]; spikes = sum(1 for i in range(30, len(V)) if med[i] and V[i] > 20 * med[i]); res["info_volume_spikes_over_20x_median30"] = spikes
from datetime import datetime, timezone
res["range_utc"] = [datetime.fromtimestamp(T[0] / 1000, timezone.utc).isoformat(), datetime.fromtimestamp(T[-1] / 1000, timezone.utc).isoformat()]
print(json.dumps(res, indent=1)); sys.exit(0 if all(c["status"] == "PASS" for c in res["checks"].values()) else 1)
