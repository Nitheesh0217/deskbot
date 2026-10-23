// DeskBot v5.6 — research layer: setup mining + walk-forward ML (meta-labeling). Pure TS: runs in Deno (cloud) and Node (local).
// No order placement. Used offline/cloud-side to decide which setups the live bot should take.
import {
  buildSeries, snapshot, evaluate, initState, openPosition, managePosition, STRATEGIES, CFG, applyCfg, signalFeatures, modelInput, mlProb,
  BASE_FEATURES, type Bar, type Frames, type Signal,
} from "./engine.ts";

export type Setup = { t: number; strategy: string; dir: string; R: number; win: number; mfe: number; mae: number; hold: number; f: number[] };

/** Replay every 5m close with ALL strategies on (no regime gate, no ML filter); simulate each signal on its own with live exits. */
export function mineSetups(fr: Frames, cfg: Record<string, unknown> = {}, warm = 400): Setup[] {
  applyCfg({ ...(cfg as object), RISK_SCALE: Object.fromEntries(STRATEGIES.map((s) => [s, 1])), REGIME_GATE: {}, ML_FILTER: null } as never);
  const S = buildSeries(fr), m5 = fr.m5, out: Setup[] = [];
  const enabled = Object.fromEntries(STRATEGIES.map((s) => [s, true]));
  for (let i = warm; i < m5.length - 2; i++) {
    const snap = snapshot(S, i);
    const { signals } = evaluate(snap, enabled, S);
    for (const sig of signals as Signal[]) {
      const st = initState(1000, m5[i + 1].t);
      const p = openPosition(st, sig, m5[i + 1].o, m5[i + 1].t); if (!p) continue;
      const d = sig.dir === "long" ? 1 : -1, R0 = Math.abs(p.entry - p.stop0);
      let mfe = 0, mae = 0, j = i + 1, tr = null;
      for (; j < m5.length && st.pos; j++) {
        const b = m5[j];
        if (b.ct > p.openT) { mfe = Math.max(mfe, ((d === 1 ? b.h : b.l) - p.entry) * d / R0); mae = Math.min(mae, ((d === 1 ? b.l : b.h) - p.entry) * d / R0); }
        const x = managePosition(st, [b], null); if (x.length) { tr = x[0]; break; }
      }
      if (!tr) continue;
      out.push({ t: snap.T + 1, strategy: sig.strategy, dir: sig.dir, R: +tr.r.toFixed(4), win: tr.net > 0 ? 1 : 0, mfe: +mfe.toFixed(3), mae: +mae.toFixed(3), hold: j - i,
        f: signalFeatures(snap, S, sig).map((v) => (isFinite(v) ? +v.toFixed(6) : NaN)) });
    }
  }
  applyCfg();
  return out;
}

// ─── logistic regression (L2), standardized + clipped inputs ─────────────────────────────────────
export type Model = NonNullable<typeof CFG.ML_FILTER>;
export function fitLogit(X: number[][], y: number[], names: string[], l2 = 1.0, iters = 400, lr = 0.2): Model {
  const n = X.length, k = X[0].length, mean = new Array(k).fill(0), std = new Array(k).fill(0), cnt = new Array(k).fill(0);
  for (const r of X) r.forEach((v, j) => { if (isFinite(v)) { mean[j] += v; cnt[j]++; } });
  for (let j = 0; j < k; j++) mean[j] = cnt[j] ? mean[j] / cnt[j] : 0;
  for (const r of X) r.forEach((v, j) => { if (isFinite(v)) std[j] += (v - mean[j]) ** 2; });
  for (let j = 0; j < k; j++) std[j] = cnt[j] > 1 ? Math.sqrt(std[j] / (cnt[j] - 1)) || 1 : 1;
  const Z = X.map((r) => r.map((v, j) => (isFinite(v) ? Math.max(-6, Math.min(6, (v - mean[j]) / std[j])) : 0)));
  const w = new Array(k).fill(0); let b = Math.log((y.reduce((a, v) => a + v, 0) + 1) / (n - y.reduce((a, v) => a + v, 0) + 1));
  const g = new Array(k);
  for (let it = 0; it < iters; it++) {
    g.fill(0); let gb = 0;
    for (let i = 0; i < n; i++) { let z = b; const zi = Z[i]; for (let j = 0; j < k; j++) z += w[j] * zi[j]; const e = 1 / (1 + Math.exp(-z)) - y[i]; gb += e; for (let j = 0; j < k; j++) g[j] += e * zi[j]; }
    for (let j = 0; j < k; j++) w[j] -= lr * (g[j] / n + (l2 / n) * w[j]);
    b -= lr * gb / n;
  }
  return { names, mean, std, w: w.map((v) => +v.toFixed(5)), b: +b.toFixed(5), thr: 0.5 };
}
export function modelNames() { return [...BASE_FEATURES, ...BASE_FEATURES.map((f) => "rev_" + f), ...STRATEGIES.map((s) => "s_" + s), "is_gold"]; }

type Row = Setup & { sym: string };
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export function stats(rows: { R: number }[]) {
  const n = rows.length, sum = rows.reduce((a, r) => a + r.R, 0), gw = rows.filter((r) => r.R > 0).reduce((a, r) => a + r.R, 0), gl = -rows.filter((r) => r.R <= 0).reduce((a, r) => a + r.R, 0);
  return { n, sumR: +sum.toFixed(2), expR: n ? +(sum / n).toFixed(3) : 0, wr: n ? +(rows.filter((r) => r.R > 0).length / n).toFixed(3) : 0, pf: gl > 0 ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0) };
}
/** Pick the probability threshold on TRAINING rows only: maximise total R, keep ≥ minKeep setups. */
function pickThr(p: number[], R: number[], minKeep: number) {
  let best = 0.5, bestSum = -Infinity;
  for (let t = 0.30; t <= 0.80001; t += 0.02) {
    let s = 0, c = 0; for (let i = 0; i < p.length; i++) if (p[i] >= t) { s += R[i]; c++; }
    if (c >= minKeep && s > bestSum) { bestSum = s; best = +t.toFixed(2); }
  }
  return best;
}
/** Expanding-window walk-forward by calendar year. Train on setups that CLOSED before the test year; test on that year. */
export function walkForward(rows: Row[], testYears: number[], opts: { l2?: number; minKeep?: number } = {}) {
  const names = modelNames(), X = (r: Row) => modelInput(r.f, r.strategy, r.sym === "GOLD");
  const folds: unknown[] = [], oos: (Row & { p: number; take: boolean })[] = [];
  for (const Y of testYears) {
    const t0 = Date.UTC(Y, 0, 1), t1 = Date.UTC(Y + 1, 0, 1);
    const train = rows.filter((r) => r.t + r.hold * 300_000 < t0), test = rows.filter((r) => r.t >= t0 && r.t < t1);
    if (train.length < 200 || !test.length) continue;
    const m = fitLogit(train.map(X), train.map((r) => r.win), names, opts.l2 ?? 1);
    const pTr = train.map((r) => mlProb(X(r), m));
    m.thr = pickThr(pTr, train.map((r) => r.R), opts.minKeep ?? Math.max(50, Math.round(train.length * 0.05)));
    for (const r of test) { const p = mlProb(X(r), m); oos.push({ ...r, p, take: p >= m.thr }); }
    folds.push({ year: Y, train: train.length, test: test.length, thr: m.thr, all: stats(test), taken: stats(oos.filter((r) => r.t >= t0 && r.t < t1 && r.take)) });
  }
  const by = (key: (r: Row) => string) => {
    const g: Record<string, { all: Row[]; taken: Row[] }> = {};
    for (const r of oos) { const k = key(r); (g[k] ??= { all: [], taken: [] }).all.push(r); if (r.take) g[k].taken.push(r); }
    return Object.fromEntries(Object.entries(g).sort().map(([k, v]) => [k, { all: stats(v.all), ai: stats(v.taken) }]));
  };
  return { folds, total: { all: stats(oos), ai: stats(oos.filter((r) => r.take)) }, bySym: by((r) => r.sym), byStrategy: by((r) => r.sym + " " + r.strategy), byYear: by((r) => r.sym + " " + new Date(r.t).getUTCFullYear()) };
}
/** "Where the money is made": per symbol × strategy × direction × year, plus conditional cuts. */
export function whereMoney(rows: Row[]) {
  const g: Record<string, Row[]> = {};
  for (const r of rows) for (const k of [`${r.sym}|${r.strategy}|ALL`, `${r.sym}|${r.strategy}|${r.dir}`, `${r.sym}|${r.strategy}|Y${new Date(r.t).getUTCFullYear()}`]) (g[k] ??= []).push(r);
  const iD = BASE_FEATURES.indexOf("ema50D_dist");
  for (const r of rows) { const dd = r.f[iD]; const b = !isFinite(dd) ? "na" : dd > 0.03 ? ">+3%" : dd > 0 ? "0..3%" : dd > -0.03 ? "-3..0%" : "<-3%"; (g[`${r.sym}|${r.strategy}|regime${b}`] ??= []).push(r); }
  return Object.fromEntries(Object.entries(g).sort().map(([k, v]) => [k, stats(v)]));
}
export { avg };
