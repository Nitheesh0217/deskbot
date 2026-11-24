#!/usr/bin/env bash
# Download Binance USD-M perpetual 5m klines + funding from the public archive (data.binance.vision), verify every monthly file
# against its published SHA-256, and build the research inputs used by scripts/challenger_study.ts:
#   <out>/kline5_<SYM>.csv.gz  (t,o,h,l,c,v; window [from-day, to-day))   <out>/funding_<SYM>.csv
#   scripts/fetch_archive.sh <out> 2023-06 2026-10 2023-06-15 2026-10-22 BTCUSDT ETHUSDT ...
set -euo pipefail
out=${1:?out}; m0=${2:?YYYY-MM}; m1=${3:?YYYY-MM}; d0=${4:?YYYY-MM-DD}; d1=${5:?YYYY-MM-DD}; shift 5
mkdir -p "$out/raw"
get() { local u=$1 f=$2; for t in 1 2 3; do
  [ -f "$f" ] && [ -f "$f.CHECKSUM" ] && (cd "$(dirname "$f")" && sha256sum -c --quiet "$(basename "$f").CHECKSUM" 2>/dev/null) && return 0
  curl -sSf -m 90 -o "$f" "$u" 2>/dev/null || true; curl -sSf -m 30 -o "$f.CHECKSUM" "$u.CHECKSUM" 2>/dev/null || true; done
  echo "FAILED $f" >&2; return 1; }
one() { local s=$1 ym=$m0; mkdir -p "$out/raw/$s"
  while [[ ! "$ym" > "$m1" ]]; do
    get "https://data.binance.vision/data/futures/um/monthly/klines/$s/5m/$s-5m-$ym.zip" "$out/raw/$s/$s-5m-$ym.zip" || true
    get "https://data.binance.vision/data/futures/um/monthly/fundingRate/$s/$s-fundingRate-$ym.zip" "$out/raw/$s/$s-fundingRate-$ym.zip" || true
    y=${ym%-*}; m=$((10#${ym#*-} + 1)); [ $m -gt 12 ] && { m=1; y=$((y + 1)); }; ym=$(printf "%04d-%02d" "$y" "$m")
  done
  python3 -I - "$out" "$s" "$d0" "$d1" <<'PY'
import sys, zipfile, glob, gzip, datetime as dt
out, s, d0, d1 = sys.argv[1:5]
ms = lambda d: int(dt.datetime.fromisoformat(d).replace(tzinfo=dt.timezone.utc).timestamp() * 1000)
a, b = ms(d0), ms(d1); rows, fr = {}, []
for z in sorted(glob.glob(f"{out}/raw/{s}/*.zip")):
    with zipfile.ZipFile(z) as zf:
        for n in zf.namelist():
            for line in zf.read(n).decode().splitlines():
                p = line.split(",")
                if not p[0].isdigit(): continue
                if "fundingRate" in z: fr.append((int(p[0]), p[1], p[2])); continue
                t = int(p[0]); t = t // 1000 if t > 1e14 else t
                if a <= t < b: rows[t] = f"{t},{p[1]},{p[2]},{p[3]},{p[4]},{p[5]}"
ks = sorted(rows); gaps = sum(1 for x, y in zip(ks, ks[1:]) if y - x != 300000)
with gzip.open(f"{out}/kline5_{s}.csv.gz", "wt") as g: g.write("\n".join(rows[k] for k in ks) + "\n")
with open(f"{out}/funding_{s}.csv", "w") as g: g.write("calc_time,funding_interval_hours,rate\n" + "\n".join(f"{x},{y},{z}" for x, y, z in sorted(fr)) + "\n")
print(f"{s}: {len(ks)} bars, {gaps} gaps, {len(fr)} funding settlements")
PY
}
for s in "$@"; do one "$s" & done; wait
