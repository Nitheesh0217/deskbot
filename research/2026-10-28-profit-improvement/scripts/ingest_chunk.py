"""Append one spilled SQL-result chunk (CSV text produced by the export query in README.md) to data/kline5_<SYM>.csv.
Validates: contiguous 5-minute timestamps, OHLC sanity, no gaps between chunks. Usage: ingest_chunk.py <spillfile> <SYM> <expected_first_t_ms> <expected_rows>"""
import json, re, sys, os
path, sym, first_t, nrows = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
outer = json.load(open(path))['result']
m = re.search(r'(\[\{"csv":".*"\}\])', outer, re.S)
assert m, 'csv payload not found'
text = json.loads(m.group(1))[0]['csv']
rows = text.split('\n')
assert len(rows) == nrows, f'rows {len(rows)} != expected {nrows}'
out = os.path.join(os.path.dirname(__file__), '..', 'data', f'kline5_{sym}.csv')
prev = None if os.path.exists(out) and os.path.getsize(out) == 0 else None
last_t = None
if os.path.exists(out):
    with open(out, 'rb') as f:
        f.seek(0, 2); size = f.tell(); f.seek(max(0, size - 200)); tail = f.read().decode().strip().split('\n')[-1]
    last_t = int(tail.split(',')[0])
exp = first_t if last_t is None else last_t + 300000
assert exp == first_t, f'chunk start {first_t} does not follow file end {last_t}'
t_prev = None
for i, r in enumerate(rows):
    t, o, h, l, c, v = r.split(',')
    t = int(t); o, h, l, c, v = map(float, (o, h, l, c, v))
    assert t == first_t + i * 300000, f'gap/disorder at row {i}: {t}'
    assert l <= min(o, c) and h >= max(o, c) and v >= 0, f'bad OHLC at {t}'
with open(out, 'a') as f:
    f.write(('' if last_t is None else '') + text + '\n')
print(sym, 'appended', len(rows), 'rows from', first_t, 'to', first_t + (len(rows) - 1) * 300000)
