"""DeskBot v5 — "predict the right side": direction model on bar patterns.

At every 1h close (2023-01 → 2026-08) build ~45 features from the 5m/1h/4h/1d bars that are CLOSED
at that moment, and a triple-barrier label: does price hit +k×ATR(1h) before −k×ATR(1h) within H hours?
(no barrier hit = 0.5 / dropped). Walk-forward by quarter with purging. Models: logistic, LightGBM,
neural net (MLP). Then a trading test with costs: when the model's P(up) is far enough from 0.5,
enter at the next 1h open toward the predicted side, stop/target = the same barriers.

usage: python3 ml/direction.py <BTCUSDT_5m.csv>
"""
import sys, json, warnings
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
import lightgbm as lgb
warnings.filterwarnings("ignore")

SRC = sys.argv[1]
K, H = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0, int(sys.argv[3]) if len(sys.argv) > 3 else 24
COST = 2 * (0.00045 + 0.0002)            # round trip taker + slippage, fraction of price

m5 = pd.read_csv(SRC, parse_dates=["timestamp"]).set_index("timestamp")
m5.index = m5.index.tz_localize(None)
def rs(rule): return m5.resample(rule, label="left", closed="left").agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}).dropna()
h1, h4, d1 = rs("1h"), rs("4h"), rs("1D")

def atr(df, n=14):
    pc = df.close.shift(); tr = pd.concat([df.high - df.low, (df.high - pc).abs(), (df.low - pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()
def rsi(c, n=14):
    dlt = c.diff(); up = dlt.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean(); dn = (-dlt.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn)
def ema(c, n): return c.ewm(span=n, adjust=False).mean()

f = pd.DataFrame(index=h1.index)
c = h1.close; a1 = atr(h1)
for n in [1, 2, 4, 8, 12, 24, 48, 72, 168]: f[f"ret{n}"] = c.pct_change(n)
for n in [24, 72, 168]: f[f"rv{n}"] = np.log(c).diff().rolling(n).std()
f["rv_ratio"] = f.rv24 / f.rv168
f["atr1_pct"] = a1 / c
f["rsi14"] = rsi(c); f["rsi4h_like"] = rsi(c, 56)
for n in [20, 50, 200]: f[f"ema{n}_d"] = c / ema(c, n) - 1
f["ema20_50"] = ema(c, 20) / ema(c, 50) - 1
hh24, ll24 = h1.high.rolling(24).max(), h1.low.rolling(24).min()
f["pos24"] = (c - ll24) / (hh24 - ll24); f["rng24_pct"] = (hh24 - ll24) / c
hh168, ll168 = h1.high.rolling(168).max(), h1.low.rolling(168).min()
f["pos168"] = (c - ll168) / (hh168 - ll168)
f["vol_ratio"] = h1.volume / h1.volume.rolling(168).mean()
f["body"] = (h1.close - h1.open) / a1; f["uwick"] = (h1.high - h1[["open", "close"]].max(axis=1)) / a1; f["lwick"] = (h1[["open", "close"]].min(axis=1) - h1.low) / a1
f["hour_sin"] = np.sin(2 * np.pi * f.index.hour / 24); f["hour_cos"] = np.cos(2 * np.pi * f.index.hour / 24); f["dow"] = f.index.dayofweek
# higher timeframes: only bars CLOSED at this 1h close → shift by one bar then forward-fill onto the 1h grid
def htf(df, name):
    g = pd.DataFrame(index=df.index)
    g[f"{name}_ret1"] = df.close.pct_change(); g[f"{name}_ret5"] = df.close.pct_change(5)
    g[f"{name}_ema50_d"] = df.close / ema(df.close, 50) - 1; g[f"{name}_rsi"] = rsi(df.close)
    g[f"{name}_atr_pct"] = atr(df) / df.close
    g.index = g.index + (df.index[1] - df.index[0])          # value becomes known when the bar closes
    return g.reindex(f.index.union(g.index)).ffill().reindex(f.index)
f = f.join(htf(h4, "h4")).join(htf(d1, "d1"))
# shift all 1h features so that row t uses bars closed at t (row index = bar OPEN time → known at open+1h)
f.index = f.index + pd.Timedelta(hours=1)

# triple-barrier label from the next 1h bar open onward
hi, lo, op = h1.high.values, h1.low.values, h1.open.values
idx_of = {t: i for i, t in enumerate(h1.index)}
labels, rets = [], []
a1v = (a1).values
for t in f.index:
    i = idx_of.get(t)
    if i is None or i + H >= len(h1): labels.append(np.nan); rets.append(np.nan); continue
    e = op[i]; w = K * a1v[i - 1]
    up, dn = e + w, e - w; lab = np.nan
    for j in range(i, i + H):
        hu, hd = hi[j] >= up, lo[j] <= dn
        if hu and hd: lab = np.nan; break
        if hu: lab = 1; break
        if hd: lab = 0; break
    labels.append(lab); rets.append(w / e)
f["y"] = labels; f["barrier_pct"] = rets
data = f.dropna(subset=["y"]).replace([np.inf, -np.inf], np.nan)
FEATS = [c for c in data.columns if c not in ("y", "barrier_pct")]
print(f"1h samples with a barrier hit: {len(data)}  up-rate {data.y.mean():.3f}  K={K} H={H}h  median barrier {data.barrier_pct.median()*100:.2f}%")

def models():
    return {
        "logistic": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=0.05, max_iter=3000)),
        "lightgbm": lgb.LGBMClassifier(n_estimators=300, learning_rate=0.02, num_leaves=12, min_child_samples=150, subsample=0.8, subsample_freq=1,
                                       colsample_bytree=0.6, reg_lambda=10, verbose=-1, random_state=7),
        "neural_net": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                                    MLPClassifier(hidden_layer_sizes=(64, 32), alpha=3e-2, max_iter=300, early_stopping=True, random_state=7)),
    }

out = {}
quarters = pd.period_range("2024Q3", "2026Q3", freq="Q")
for name in models():
    acc, n_all, trades, sumR = [], 0, 0, 0.0; perq = []
    for q in quarters:
        q0, q1 = q.start_time, q.end_time
        tr = data.index < q0 - pd.Timedelta(hours=H)        # purge the label horizon
        te = (data.index >= q0) & (data.index <= q1)
        if te.sum() == 0: continue
        m = models()[name]; m.fit(data.loc[tr, FEATS], data.loc[tr, "y"])
        p = m.predict_proba(data.loc[te, FEATS])[:, 1]; y = data.loc[te, "y"].values
        acc.append(((p > 0.5) == y).mean()); n_all += te.sum()
        # trade only confident calls, 1 position per H window to avoid overlap
        conf = np.abs(p - 0.5) >= 0.06
        last = pd.Timestamp(0); qR, qn = 0.0, 0
        for t, pi, yi, bp, ok in zip(data.index[te], p, y, data.loc[te, "barrier_pct"].values, conf):
            if not ok or t < last: continue
            win = (pi > 0.5) == (yi == 1)
            r = (1.0 if win else -1.0) - COST / bp          # symmetric barriers: ±1R, minus costs in R
            qR += r; qn += 1; last = t + pd.Timedelta(hours=H)
        trades += qn; sumR += qR; perq.append(f"{str(q)[2:]}:{qn}/{qR:+.1f}R")
    out[name] = {"oos_accuracy": float(np.mean(acc)), "samples": int(n_all), "trades": trades, "sumR": sumR, "avgR": sumR / max(1, trades)}
    print(f"{name:11s} OOS accuracy {np.mean(acc):.3f} (base {max(data.y.mean(),1-data.y.mean()):.3f}) | confident trades {trades:4d} sumR {sumR:+7.1f} avgR {sumR/max(1,trades):+.3f} | {' '.join(perq)}")
json.dump(out, open(f"ml/data/direction_K{K}_H{H}.json", "w"), indent=1)
