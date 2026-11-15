#!/usr/bin/env bash
# Download Binance USD-M perpetual funding settlements from the public archive (data.binance.vision) and verify every monthly file
# against its published SHA-256 before use (idea from LumiBot's Binance bulk-file route; no code copied). Research data only.
#   scripts/fetch_funding.sh BTCUSDT 2023-09 2026-10 research_data
set -euo pipefail
sym=${1:?symbol}; from=${2:?YYYY-MM}; to=${3:?YYYY-MM}; out=${4:-research_data}
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
base=https://data.binance.vision/data/futures/um/monthly/fundingRate/$sym
ym=$from
while [[ ! "$ym" > "$to" ]]; do
  f=$sym-fundingRate-$ym.zip
  curl -sSf -m 60 -o "$tmp/$f" "$base/$f" || { echo "missing: $f (not published yet?)" >&2; exit 1; }
  curl -sSf -m 60 -o "$tmp/$f.CHECKSUM" "$base/$f.CHECKSUM"
  (cd "$tmp" && sha256sum -c --quiet "$f.CHECKSUM") || { echo "checksum FAILED: $f" >&2; exit 1; }
  y=${ym%-*}; m=$((10#${ym#*-} + 1)); [ $m -gt 12 ] && { m=1; y=$((y + 1)); }; ym=$(printf "%04d-%02d" "$y" "$m")
done
mkdir -p "$out" "$tmp/csv"
(cd "$tmp" && for z in *.zip; do unzip -oq "$z" -d csv; done)
dst="$out/funding_${sym}_binance_${from}_${to}.csv"
{ echo "calc_time,funding_interval_hours,rate"; for c in "$tmp"/csv/*.csv; do tail -n +2 "$c"; done | sort -n; } > "$dst"
cat "$tmp"/*.CHECKSUM > "$out/funding_${sym}_binance.SHA256SUMS"
echo "$dst: $(($(wc -l < "$dst") - 1)) settlements, all files checksum-verified"
