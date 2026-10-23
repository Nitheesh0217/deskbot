"""Download Binance spot 5m klines (public, no key) into data/<SYM>_5m.csv.gz.
Monthly archives from data.binance.vision, then the REST API for the current month.
usage: python scripts/fetch_klines.py BTCUSDT 2021-01 [PAXGUSDT ...]"""
import csv, gzip, io, json, sys, time, urllib.request, zipfile, datetime as dt, os

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "deskbot-research"}), timeout=60) as r:
                return r.read()
        except Exception as e:
            if getattr(e, "code", None) == 404: return None
            time.sleep(2 * (i + 1))
    raise RuntimeError("failed " + url)

def months(start):
    y, m = map(int, start.split("-")); today = dt.date.today()
    while (y, m) < (today.year, today.month):
        yield f"{y:04d}-{m:02d}"; m += 1
        if m == 13: y, m = y + 1, 1

def run(sym, start):
    rows = {}
    for ym in months(start):
        z = get(f"https://data.binance.vision/data/spot/monthly/klines/{sym}/5m/{sym}-5m-{ym}.zip")
        if not z: print(sym, ym, "missing"); continue
        with zipfile.ZipFile(io.BytesIO(z)) as zf:
            for line in zf.read(zf.namelist()[0]).decode().splitlines():
                p = line.split(",")
                t = int(p[0]); t = t // 1000 if t > 1e14 else t   # 2025+ archives use microseconds
                rows[t] = (p[1], p[2], p[3], p[4], p[5], p[9])
        print(sym, ym, len(rows), flush=True)
    s = max(rows) + 300_000 if rows else int(dt.datetime(int(start[:4]), int(start[5:]), 1).timestamp() * 1000)
    now = int(time.time() * 1000)
    while s < now - 300_000:
        j = json.loads(get(f"https://data-api.binance.vision/api/v3/klines?symbol={sym}&interval=5m&startTime={s}&limit=1000"))
        if not j: break
        for k in j:
            if k[6] < now: rows[int(k[0])] = (k[1], k[2], k[3], k[4], k[5], k[9])
        s = j[-1][0] + 300_000
    os.makedirs("data", exist_ok=True)
    with gzip.open(f"data/{sym}_5m.csv.gz", "wt", newline="") as f:
        w = csv.writer(f); w.writerow(["timestamp", "open", "high", "low", "close", "volume", "taker_buy"])
        for t in sorted(rows):
            w.writerow([dt.datetime.utcfromtimestamp(t / 1000).strftime("%Y-%m-%dT%H:%M:%SZ"), *rows[t]])
    print(sym, "done", len(rows))

if __name__ == "__main__":
    a = sys.argv[1:]; start = next((x for x in a if "-" in x), "2021-01")
    for sym in [x for x in a if "-" not in x]: run(sym, start)
