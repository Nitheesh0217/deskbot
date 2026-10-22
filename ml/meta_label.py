"""DeskBot v5 — meta-labeling: learn WHICH of the system's own setups to take.

Every setup the engine flagged (ml/data/setups_*.csv) is labelled with its real outcome after costs.
A model sees only the market state at entry and predicts P(win). Walk-forward, no peeking:
for each test quarter, train on everything that CLOSED before the quarter starts (purged by
the trade's holding time), pick the probability threshold on the training data only, then
score the untouched quarter. Compares: take-everything baseline, logistic regression,
LightGBM, and a small neural network (MLP).

usage: python3 ml/meta_label.py ml/data/setups_ms0.012.csv
"""
import json, sys, warnings
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
import lightgbm as lgb

warnings.filterwarnings("ignore")
SRC = sys.argv[1] if len(sys.argv) > 1 else "ml/data/setups_ms0.012.csv"
d = pd.read_csv(SRC, parse_dates=["t"]).sort_values("t").reset_index(drop=True)
d["t"] = d.t.dt.tz_localize(None)
d["close_t"] = d.t + pd.to_timedelta(d.bars_held * 5, unit="min")

STRATS = sorted(d.strategy.unique())
for s in STRATS:
    d["s_" + s] = (d.strategy == s).astype(int)
d["is_long"] = (d.dir == "long").astype(int)
d["reg_trend"] = (d.regime == "TREND").astype(int)
d["reg_range"] = (d.regime == "RANGE").astype(int)
d["hour_sin"] = np.sin(2 * np.pi * d.hour / 24); d["hour_cos"] = np.cos(2 * np.pi * d.hour / 24)
FEATS = ["score", "stop_atr15", "risk_pct", "st5", "st15", "st1h", "st4h", "align", "chop5", "chop15", "rsi15", "rsi1h",
         "vwap_dev", "atr5_pct", "atr15_pct", "atr4h_pct", "atrD_pct", "roc5", "ema_gap5", "poc_dist", "hi20_dist", "lo20_dist",
         "ema50_4h_dist", "ema200_1h_dist", "ema50D_dist", "r1h", "r4h", "r24h", "r72h", "r7d", "rv1h_24", "rv1h_168", "rv_ratio",
         "vol15_ratio", "is_long", "reg_trend", "reg_range", "hour_sin", "hour_cos"] + ["s_" + s for s in STRATS]
X_all = d[FEATS].astype(float).replace([np.inf, -np.inf], np.nan)
y_all = d.win.values

def models():
    return {
        "logistic": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=0.05, max_iter=2000)),
        "lightgbm": lgb.LGBMClassifier(n_estimators=250, learning_rate=0.03, num_leaves=8, min_child_samples=60, subsample=0.8,
                                       subsample_freq=1, colsample_bytree=0.7, reg_lambda=5.0, verbose=-1, random_state=7),
        "neural_net": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                                    MLPClassifier(hidden_layer_sizes=(32, 16), alpha=1e-2, max_iter=400, early_stopping=True, random_state=7)),
    }

def best_threshold(p, R, min_n=40):
    """threshold maximising average R on TRAIN predictions (out-of-fold), needing >= min_n trades"""
    best, bt = -9, 0.5
    for th in np.arange(0.30, 0.80, 0.01):
        m = p >= th
        if m.sum() >= min_n and R[m].mean() > best: best, bt = R[m].mean(), th
    return bt

quarters = pd.period_range("2024Q3", "2026Q3", freq="Q")
res = {k: [] for k in ["baseline", "logistic", "lightgbm", "neural_net"]}
oos_rows = []
for q in quarters:
    q0, q1 = q.start_time, q.end_time
    tr = d.close_t < q0                     # purged: trade must have CLOSED before the test quarter starts
    te = (d.t >= q0) & (d.t <= q1)
    if te.sum() == 0: continue
    Xtr, ytr, Rtr = X_all[tr], y_all[tr], d.R.values[tr]
    Xte, Rte = X_all[te], d.R.values[te]
    res["baseline"].append((q, te.sum(), Rte.sum()))
    for name, mdl in models().items():
        # out-of-fold train predictions (time-ordered 4 folds) to set the threshold honestly
        idx = np.where(tr)[0]; folds = np.array_split(idx, 4); oof = np.full(len(idx), np.nan)
        for k in range(1, 4):
            fit_i = np.concatenate(folds[:k]); pred_i = folds[k]
            m = models()[name]; m.fit(X_all.iloc[fit_i], y_all[fit_i])
            oof[np.searchsorted(idx, pred_i)] = m.predict_proba(X_all.iloc[pred_i])[:, 1]
        ok = ~np.isnan(oof)
        th = best_threshold(oof[ok], Rtr[ok])
        mdl.fit(Xtr, ytr)
        p = mdl.predict_proba(Xte)[:, 1]
        take = p >= th
        res[name].append((q, int(take.sum()), float(Rte[take].sum())))
        for i, (pi, ti) in enumerate(zip(p, take)):
            oos_rows.append({"q": str(q), "model": name, "idx": int(np.where(te)[0][i]), "p": float(pi), "take": bool(ti)})

print(f"source: {SRC}  setups: {len(d)}")
summary = {}
for name, rows in res.items():
    n = sum(r[1] for r in rows); sr = sum(r[2] for r in rows)
    per_q = " ".join(f"{str(r[0])[2:]}:{r[1]}/{r[2]:+.1f}R" for r in rows)
    summary[name] = {"trades": n, "sumR": sr, "avgR": sr / max(1, n)}
    print(f"{name:11s} OOS trades {n:5d}  sumR {sr:+8.1f}  avgR {sr/max(1,n):+.3f}   | {per_q}")
pd.DataFrame(oos_rows).to_csv(SRC.replace(".csv", "_oos.csv"), index=False)
summary = {k:{kk:float(vv) for kk,vv in v.items()} for k,v in summary.items()}
json.dump(summary, open(SRC.replace(".csv", "_meta_summary.json"), "w"), indent=1)
