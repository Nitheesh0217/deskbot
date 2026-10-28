// ═══════════════════════════════════════════════════════════════════════════
//  DeskBot v5 — engine (pure, runtime-agnostic: runs in Deno edge + Node tests)
//  PAPER ONLY. There is no order-placement code anywhere in this project.
//
//  Lineage: v3 (MTF SuperTrend flip, chop gate, swing stop, POC/EMA score,
//  circuit breaker, learning counters) + v4.3 (4H bias, real SuperTrend state
//  machine, closed-bars only, VWAP/RSI/ROC/funding/F&G scoring, dynamic risk,
//  50/25/25 partial exits on originalQty/remainingQty) + v5 additions:
//    • 7 strategies: daily bear-trap (P5) + daily thrust (P1) from the desk's own research,
//      4H trend breakout, v3/v4 MTF trend, sweep reversal, VWAP revert, session breakout
//    • bar-path position management (1m wicks, stop-first when ambiguous)
//    • realistic costs: taker/maker fees, slippage, funding accrual
//    • daily-anchored VWAP, leverage cap, daily loss limit, auto-cooldown breaker
//    • per-strategy stats + probation (losing strategies get de-risked/disabled)
//    • the same evaluate()/manage() code drives live runs AND the backtester
// ═══════════════════════════════════════════════════════════════════════════

export const VERSION = "5.8.0";

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number; ct: number };
export type Dir = "long" | "short";
export type StrategyId = "D_BEARTRAP" | "D_THRUST" | "HTF_TREND" | "TREND_MTF" | "SWEEP_REV" | "VWAP_REVERT" | "SESSION_BO" | "HTF_SWEEP" | "EMA_CROSS" | "SSR" | "EMA_PB";
export const STRATEGIES: StrategyId[] = ["D_BEARTRAP", "D_THRUST", "HTF_TREND", "TREND_MTF", "SWEEP_REV", "VWAP_REVERT", "SESSION_BO", "HTF_SWEEP", "EMA_CROSS", "SSR", "EMA_PB"];
// strategies that stay OFF unless RISK_SCALE names them explicitly (so a new idea can never go live by accident)
export const OPT_IN: StrategyId[] = ["HTF_SWEEP", "EMA_CROSS", "SSR", "EMA_PB"];

export const CFG = {
  // costs (Hyperliquid-style perp, paper)
  TAKER_FEE: 0.00045,       // 0.045% per side on market entries / stops
  MAKER_FEE: 0.00015,       // 0.015% on resting TP limits
  SLIPPAGE: 0.0002,         // 0.02% adverse on market fills
  BT_FUNDING_PER_HOUR: 0.0000125, // backtest assumption when no live rate (charged as a cost)
  // risk
  MIN_SCORE: 72,
  MAX_LEVERAGE: 5,          // notional ≤ 5 × equity
  DAILY_LOSS_LIMIT: 0.05,   // stop new entries after −5% on the UTC day
  MAX_TRADES_PER_DAY: 6,
  CB_LOSSES: 3,             // consecutive losses → cooldown
  CB_COOLDOWN_MS: 4 * 3600_000,
  SESSION_BLOCK_UTC: [0, 7] as [number, number], // no new trend/breakout entries 00:00–06:59 UTC
  // targets as R multiples + allocation of ORIGINAL qty (v4.3 convention)
  ALLOC: { tp1: 0.5, tp2: 0.25, tp3: 0.25 },
  TARGETS: {
    D_BEARTRAP:  { tp1: 2, tp2: 2, tp3: 2, maxHoldH: 720 },   // research P5: single 2R target
    D_THRUST:    { tp1: 2, tp2: 2, tp3: 2, maxHoldH: 720 },   // research P1: single 2R target
    HTF_TREND:   { tp1: 1.5, tp2: 3, tp3: 6, maxHoldH: 504 },
    TREND_MTF:   { tp1: 1, tp2: 2, tp3: 3.5, maxHoldH: 24 },
    SWEEP_REV:   { tp1: 1, tp2: 2, tp3: 3,   maxHoldH: 16 },
    VWAP_REVERT: { tp1: 1, tp2: 1.5, tp3: 2, maxHoldH: 8 },
    SESSION_BO:  { tp1: 1, tp2: 2, tp3: 3.5, maxHoldH: 12 },
    HTF_SWEEP:   { tp1: 1.5, tp2: 3, tp3: 5, maxHoldH: 120 },
    EMA_CROSS:   { tp1: 1.5, tp2: 3, tp3: 5, maxHoldH: 48 },
    SSR:         { tp1: 3, tp2: 3, tp3: 3, maxHoldH: 8 },      // STRATEGY.md v1.4: single 3R bracket, flat by NY afternoon
    EMA_PB:      { tp1: 1, tp2: 2, tp3: 3, maxHoldH: 2 },      // XAU Pullback v1: 1R/2R/3R, max 24 x 5m bars
  } as Record<StrategyId, { tp1: number; tp2: number; tp3: number; maxHoldH: number }>,
  // exit management: "BE_AT_TP1" (v4.3: stop→entry after TP1) | "HOLD" (journal v0.4: keep stop until TP2, then →entry)
  EXIT_MODE: "BE_AT_TP1" as "BE_AT_TP1" | "HOLD",
  // sweep reversals: false = 4H counter-bias only penalised, true = must not be against 4H
  SWEEP_REQUIRE_HTF: false,
  // per-strategy risk multiplier (1 = full dynamic risk; 0.25 = evidence-gathering size)
  RISK_SCALE: { D_BEARTRAP: 1, D_THRUST: 1, HTF_TREND: 1, TREND_MTF: 1, SWEEP_REV: 1, VWAP_REVERT: 1, SESSION_BO: 1, HTF_SWEEP: 0, EMA_CROSS: 0, SSR: 0, EMA_PB: 0 } as Record<StrategyId, number>,
  // HTF_SWEEP: failed break of the 4H 55-bar high/low (the turn starts AT the level). Trigger TF: "4h" bar close or earlier "1h" close.
  HSW_TF: "4h" as "4h" | "1h", HSW_WICK: 0.4, HSW_MAX_RISK_ATR: 2.5,
  // EMA_CROSS: EMA20 crosses EMA50 on the trigger timeframe (user's chart idea). Stop = XC_STOP_ATR × ATR(15m) beyond entry.
  XC_TF: "15m" as "15m" | "1h", XC_STOP_ATR: 2, XC_REQUIRE_4H: false, XC_LONGS: true, XC_SHORTS: true,
  HTF_DONCHIAN: 20, HTF_ATR_STOP: 2,
  // minimum stop distance as a fraction of price (0 = off). Keeps round-trip costs a small share of 1R.
  MIN_STOP_PCT: 0,
  // skip any setup whose round-trip cost exceeds this share of 1R (desk STRATEGY.md cost filter; 1 = off)
  MAX_COST_R: 1,
  // v5.1 ML lessons — daily regime gate: take a setup only if price sits at least this far beyond the daily EMA50
  // IN the trade's direction ((price − EMA50D)/price × dir). Missing key = off. Walk-forward evidence: docs/ML_REPORT.md
  REGIME_GATE: {} as Partial<Record<StrategyId, number>>,
  // per-strategy minimum stop distance (fraction of price); overrides MIN_STOP_PCT when larger
  MIN_STOP_BY: {} as Partial<Record<StrategyId, number>>,
  // probation (auto-learning)
  // AI/ML trade filter (meta-labeling). null = off. Logistic model over signalFeatures(); trained walk-forward offline.
  ML_FILTER: null as null | { names: string[]; mean: number[]; std: number[]; w: number[]; b: number; thr: number; ver?: string },
  TRADER: true,
  TRADER_PARTS: "",      // v5.7 trade manager: re-plans open positions (never widens stop, never adds size)
  // v5.8 desk agents. All three default OFF so a deploy never changes a running book; enable per book from backtest evidence.
  //  BODY_SL  (risk agent): stop just beyond the candle BODY extreme (open/close, not the wick) of the last `n` trigger-timeframe
  //           candles, `buf`×ATR beyond it, never closer than `minPct` of price. Only ever tightens the strategy's own stop.
  //  REENTRY  (re-entry agent): after a losing stop-out, the same setup may be re-taken if price reclaims the stopped level with the
  //           trend still aligned and a score ≥ minScore, within `windowH` hours, at most `max` times in a row.
  //  VALIDATOR (signal validator agent): rejects a signal with less than `minRoomR`×R of clear space to the next opposing liquidity level,
  //           or (trend strategies) one fighting both the 1H and 4H trend.
  BODY_SL: { on: false, n: 3, buf: 0.1, minPct: 0.003 },
  REENTRY: { on: false, windowH: 3, max: 2, minScore: 78 },
  VALIDATOR: { on: false, minRoomR: 1, htfVeto: true },
  ML_SHADOW: false,   // true = compute + log p(win) but never block
  PROBATION_MIN_TRADES: 10,
  DISABLE_MIN_TRADES: 20,
  DISABLE_EXPECTANCY_R: -0.15,
};

export const CFG_DEFAULTS = JSON.parse(JSON.stringify(CFG)) as typeof CFG;
// Pure resolution is also used by GET status: a read must never change a running book.
// Nested option groups merge key-by-key so a partial override (e.g. {BODY_SL:{on:true}}) keeps the other defaults.
const NESTED = ["BODY_SL", "REENTRY", "VALIDATOR"] as const;
function overlayNested(base: typeof CFG, over?: Partial<typeof CFG>): Partial<typeof CFG> {
  const o: Record<string, unknown> = { ...over };
  for (const k of NESTED) if (over && over[k]) o[k] = { ...base[k], ...over[k] };
  return o as Partial<typeof CFG>;
}
export function resolvedCfg(over?: Partial<typeof CFG>): typeof CFG {
  return JSON.parse(JSON.stringify({ ...CFG_DEFAULTS, ...overlayNested(CFG_DEFAULTS, over) }));
}
export function applyCfg(over?: Partial<typeof CFG>) { Object.assign(CFG, resolvedCfg(over)); }

// ─── dynamic risk (v4 tiers, kept) ──────────────────────────────────────────
export function dynamicRisk(equity: number): number {
  if (equity < 500) return 0.02;
  if (equity < 1000) return 0.015;
  if (equity < 3000) return 0.012;
  return 0.01;
}

// ═══════════════════════════ INDICATOR SERIES ═══════════════════════════════
const NaNs = (n: number) => new Array<number>(n).fill(NaN);

export function atrSeries(b: Bar[], p = 14): number[] {
  const n = b.length, out = NaNs(n);
  if (n < p + 1) return out;
  const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)));
  let a = 0; for (let i = 1; i <= p; i++) a += tr[i]; a /= p; out[p] = a;
  for (let i = p + 1; i < n; i++) { a = (a * (p - 1) + tr[i]) / p; out[i] = a; }
  return out;
}

// SuperTrend — final-band continuity state machine (Pine ta.supertrend semantics)
export function stSeries(b: Bar[], p = 10, m = 3): { dir: number[]; val: number[] } {
  const n = b.length, atr = atrSeries(b, p), dir = new Array<number>(n).fill(0), val = NaNs(n);
  let fu = NaN, fl = NaN, trend = 0;
  for (let i = 0; i < n; i++) {
    if (isNaN(atr[i])) continue;
    const hl2 = (b[i].h + b[i].l) / 2, bu = hl2 + m * atr[i], bl = hl2 - m * atr[i];
    if (trend === 0) { fu = bu; fl = bl; trend = b[i].c >= hl2 ? 1 : -1; }
    else {
      const pc = b[i - 1].c;
      fu = (bu < fu || pc > fu) ? bu : fu;
      fl = (bl > fl || pc < fl) ? bl : fl;
      if (trend === 1 && b[i].c < fl) trend = -1;
      else if (trend === -1 && b[i].c > fu) trend = 1;
    }
    dir[i] = trend; val[i] = trend === 1 ? fl : fu;
  }
  return { dir, val };
}

export function chopSeries(b: Bar[], p = 14): number[] {
  const n = b.length, out = NaNs(n);
  for (let i = p; i < n; i++) {
    let s = 0, hh = -Infinity, ll = Infinity;
    for (let j = i - p + 1; j <= i; j++) {
      s += Math.max(b[j].h - b[j].l, Math.abs(b[j].h - b[j - 1].c), Math.abs(b[j].l - b[j - 1].c));
      if (b[j].h > hh) hh = b[j].h; if (b[j].l < ll) ll = b[j].l;
    }
    const r = hh - ll; out[i] = r > 0 ? 100 * Math.log10(s / r) / Math.log10(p) : 50;
  }
  return out;
}

export function emaSeries(b: Bar[], p: number): number[] {
  const n = b.length, out = NaNs(n); if (n < p) return out;
  let e = 0; for (let i = 0; i < p; i++) e += b[i].c; e /= p; out[p - 1] = e;
  const k = 2 / (p + 1); for (let i = p; i < n; i++) { e = b[i].c * k + e * (1 - k); out[i] = e; }
  return out;
}

export function rsiSeries(b: Bar[], p = 14): number[] {
  const n = b.length, out = NaNs(n); if (n <= p) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = b[i].c - b[i - 1].c; if (d > 0) g += d; else l -= d; }
  g /= p; l /= p; out[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = p + 1; i < n; i++) {
    const d = b[i].c - b[i - 1].c; g = (g * (p - 1) + Math.max(d, 0)) / p; l = (l * (p - 1) + Math.max(-d, 0)) / p;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

// VWAP anchored at 00:00 UTC each day (fixes v4's rolling-100h proxy)
export function vwapDaySeries(b: Bar[]): { vwap: number[]; sd: number[] } {
  const n = b.length, vwap = NaNs(n), sd = NaNs(n);
  let day = -1, pv = 0, pv2 = 0, vv = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.floor(b[i].t / 86400_000);
    if (d !== day) { day = d; pv = 0; pv2 = 0; vv = 0; }
    const tp = (b[i].h + b[i].l + b[i].c) / 3, v = Math.max(b[i].v, 1e-9);
    pv += tp * v; pv2 += tp * tp * v; vv += v;
    const w = pv / vv; vwap[i] = w; sd[i] = Math.sqrt(Math.max(0, pv2 / vv - w * w));
  }
  return { vwap, sd };
}

// highest high / lowest low of the n bars BEFORE i
export function priorExtremes(b: Bar[], n: number): { hi: number[]; lo: number[] } {
  const len = b.length, hi = NaNs(len), lo = NaNs(len);
  for (let i = n; i < len; i++) {
    let h = -Infinity, l = Infinity;
    for (let j = i - n; j < i; j++) { if (b[j].h > h) h = b[j].h; if (b[j].l < l) l = b[j].l; }
    hi[i] = h; lo[i] = l;
  }
  return { hi, lo };
}

export function smaVolSeries(b: Bar[], p = 20): number[] {
  const n = b.length, out = NaNs(n); let s = 0;
  for (let i = 0; i < n; i++) { s += b[i].v; if (i >= p) s -= b[i - p].v; if (i >= p - 1) out[i] = s / p; }
  return out;
}

export function pocOf(b: Bar[], buckets = 50): number {
  if (!b.length) return NaN;
  const hi = Math.max(...b.map(x => x.h)), lo = Math.min(...b.map(x => x.l)), size = (hi - lo) / buckets || 1;
  const vol = new Array(buckets).fill(0);
  for (const x of b) {
    const a = Math.max(0, Math.floor((x.l - lo) / size)), z = Math.min(buckets - 1, Math.floor((x.h - lo) / size));
    const per = x.v / (z - a + 1); for (let k = a; k <= z; k++) vol[k] += per;
  }
  let best = 0; for (let k = 1; k < buckets; k++) if (vol[k] > vol[best]) best = k;
  return lo + (best + 0.5) * size;
}

// range of bars whose open time falls in [startH, endH) UTC on the day of `t`
export function sessionRange(b: Bar[], uptoIdx: number, t: number, startH: number, endH: number): { hi: number; lo: number } | null {
  const day0 = Math.floor(t / 86400_000) * 86400_000, s = day0 + startH * 3600_000, e = day0 + endH * 3600_000;
  let hi = -Infinity, lo = Infinity, any = false;
  for (let i = uptoIdx; i >= 0 && b[i].t >= day0; i--) {
    if (b[i].t >= s && b[i].t < e && b[i].ct <= t) { any = true; if (b[i].h > hi) hi = b[i].h; if (b[i].l < lo) lo = b[i].l; }
  }
  return any ? { hi, lo } : null;
}

// complete UTC daily bars built from 4H bars (6 per day)
export function dailyFrom4h(h4: Bar[]): Bar[] {
  const out: Bar[] = []; let cur: Bar | null = null; let cnt = 0, day = -1;
  for (const b of h4) {
    const d = Math.floor(b.t / 86400_000);
    if (d !== day) { if (cur && cnt === 6) out.push(cur); day = d; cnt = 0; cur = { t: d * 86400_000, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, ct: (d + 1) * 86400_000 - 1 }; }
    else if (cur) { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
    cnt++;
  }
  if (cur && cnt === 6 && h4[h4.length - 1].ct >= cur.ct) out.push(cur);
  return out;
}

// ═══════════════════════════ MARKET MODEL ═══════════════════════════════════
// ─── US Eastern time (DST-aware: 2nd Sun of Mar 07:00 UTC → 1st Sun of Nov 06:00 UTC) ───
function nthSundayUTC(y: number, m: number, n: number) { const d = new Date(Date.UTC(y, m, 1)).getUTCDay(); return Date.UTC(y, m, 1 + ((7 - d) % 7) + 7 * (n - 1)); }
export function etOffsetH(t: number) { const y = new Date(t).getUTCFullYear(); return t >= nthSundayUTC(y, 2, 2) + 7 * 3600_000 && t < nthSundayUTC(y, 10, 1) + 6 * 3600_000 ? 4 : 5; }
export function etParts(t: number) { const lt = t - etOffsetH(t) * 3600_000, d = new Date(lt); return { h: d.getUTCHours() + d.getUTCMinutes() / 60, dow: d.getUTCDay(), day: Math.floor(lt / 86400_000) }; }

// break of structure on confirmed (k bars each side, non-repainting) swings: +1 last BOS up, −1 down, 0 none yet
export function bosSeries(b: Bar[], k = 2): number[] {
  const n = b.length, out = new Array<number>(n).fill(0); let sh = NaN, sl = NaN, dir = 0;
  for (let i = 0; i < n; i++) {
    const c = i - k;
    if (c >= k) {
      let isH = true, isL = true;
      for (let j = 1; j <= k; j++) { if (!(b[c].h > b[c - j].h && b[c].h > b[c + j].h)) isH = false; if (!(b[c].l < b[c - j].l && b[c].l < b[c + j].l)) isL = false; }
      if (isH) sh = b[c].h; if (isL) sl = b[c].l;
    }
    if (isFinite(sh) && b[i].c > sh) { dir = 1; sh = NaN; } else if (isFinite(sl) && b[i].c < sl) { dir = -1; sl = NaN; }
    out[i] = dir;
  }
  return out;
}

export type Frames = { m5: Bar[]; m15: Bar[]; h1: Bar[]; h4: Bar[] };
export type Context = { funding?: number | null; oi?: number | null; markPx?: number | null; fng?: number | null; fngLabel?: string | null };

export type Series = ReturnType<typeof buildSeries>;
export function buildSeries(f: Frames) {
  return {
    f,
    st5: stSeries(f.m5), st15: stSeries(f.m15), st1h: stSeries(f.h1), st4h: stSeries(f.h4),
    atr5: atrSeries(f.m5), atr15: atrSeries(f.m15),
    chop5: chopSeries(f.m5), chop15: chopSeries(f.m15),
    ema20: emaSeries(f.m5, 20), ema50: emaSeries(f.m5, 50),
    rsi15: rsiSeries(f.m15), rsi1h: rsiSeries(f.h1),
    vw15: vwapDaySeries(f.m15),
    ext15: priorExtremes(f.m15, 20), ext5: priorExtremes(f.m5, 10),
    vol15: smaVolSeries(f.m15, 20),
    atr4h: atrSeries(f.h4), ema50_4h: emaSeries(f.h4, 50), ext4h: priorExtremes(f.h4, CFG.HTF_DONCHIAN),
    ema20_1h: emaSeries(f.h1, 20), ema50_1h: emaSeries(f.h1, 50), ema20_15: emaSeries(f.m15, 20), ema50_15: emaSeries(f.m15, 50),
    ema200_15: emaSeries(f.m15, 200), atr1h: atrSeries(f.h1), ema200_1h: emaSeries(f.h1, 200), bos4h: bosSeries(f.h4, 2),
    ...dailySeries(f.h4),
  };
}
function dailySeries(h4: Bar[]) {
  const d1 = dailyFrom4h(h4);
  return { d1, atrD: atrSeries(d1, 14), ema50D: emaSeries(d1, 50) };
}

// last index whose bar has CLOSED at or before T
export function idxAt(b: Bar[], T: number): number {
  let lo = 0, hi = b.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (b[mid].ct <= T) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

export type Snap = ReturnType<typeof snapshot>;
export function snapshot(S: Series, i5: number, ctx: Context = {}) {
  const f = S.f, T = f.m5[i5].ct;
  const i15 = idxAt(f.m15, T), i1h = idxAt(f.h1, T), i4h = idxAt(f.h4, T);
  const b5 = f.m5[i5], b15 = i15 >= 0 ? f.m15[i15] : null;
  const price = b5.c;
  const vw = i15 >= 0 ? S.vw15.vwap[i15] : NaN, vsd = i15 >= 0 ? S.vw15.sd[i15] : NaN;
  const hour = new Date(T + 1).getUTCHours(), minute = new Date(T + 1).getUTCMinutes();
  const chop15 = S.chop15[i15], chop5 = S.chop5[i5];
  const regime = chop15 >= 61.8 ? "RANGE" : (chop5 < 50 && chop15 < 55 ? "TREND" : "MIXED");
  const h1slice = f.h1.slice(Math.max(0, i1h - 49), i1h + 1);
  return {
    T, i5, i15, i1h, i4h, price, b5, b15,
    new15: !!b15 && b15.ct === T,             // a 15m bar closed exactly at this 5m close
    new1h: i1h >= 0 && f.h1[i1h].ct === T, i1d: idxAt(S.d1, T),
    new4h: i4h >= 0 && f.h4[i4h].ct === T, b4h: i4h >= 0 ? f.h4[i4h] : null,
    atr4h: i4h >= 0 ? S.atr4h[i4h] : NaN, ema50_4h: i4h >= 0 ? S.ema50_4h[i4h] : NaN, hi4h: i4h >= 0 ? S.ext4h.hi[i4h] : NaN, lo4h: i4h >= 0 ? S.ext4h.lo[i4h] : NaN,
    st5: S.st5.dir[i5], st5prev: S.st5.dir[i5 - 1], st15: S.st15.dir[i15], st1h: S.st1h.dir[i1h], st4h: i4h >= 0 ? S.st4h.dir[i4h] : 0,
    atr5: S.atr5[i5], atr15: S.atr15[i15], chop5, chop15, regime,
    ema20: S.ema20[i5], ema50: S.ema50[i5], rsi15: S.rsi15[i15], rsi1h: S.rsi1h[i1h],
    vwap: vw, vwapSd: vsd, vwapDev: vsd > 0 ? (price - vw) / vsd : 0,
    hi20_15: S.ext15.hi[i15], lo20_15: S.ext15.lo[i15], swingHi5: S.ext5.hi[i5], swingLo5: S.ext5.lo[i5],
    vol15: b15 ? b15.v : 0, volAvg15: S.vol15[i15],
    roc5: i5 >= 10 ? (price - f.m5[i5 - 10].c) / f.m5[i5 - 10].c : 0,
    poc: pocOf(h1slice),
    asian: hour >= 7 ? sessionRange(f.m15, i15, T, 0, 7) : null,
    london: (hour > 13 || (hour === 13 && minute >= 30)) ? sessionRange(f.m15, i15, T, 7, 13.5) : null,
    hour, minute,
    funding: ctx.funding ?? null, fng: ctx.fng ?? null, oi: ctx.oi ?? null,
  };
}

// ═══════════════════════════ STRATEGIES ═════════════════════════════════════
export type Signal = {
  strategy: StrategyId; dir: Dir; entryRef: number; stop: number; score: number;
  why: string[]; regime: string; barT: number;
  bodyStop?: boolean;   // stop was set by the risk agent (candle-body rule): skip the MIN_STOP floor widening
  reentry?: boolean;    // re-entry after a stop-out
};
export type Reject = { strategy: StrategyId; reason: string };

const sgn = (d: Dir) => (d === "long" ? 1 : -1);

// shared context scoring (v4.3 heuristics — NOT a probability, uncalibrated)
function contextScore(s: Snap, dir: Dir, kind: "trend" | "revert", why: string[]): number {
  let c = 0;
  if (s.funding != null) {
    const pct = s.funding * 100; // HL hourly rate in %
    // crowd short (negative funding) favours longs, crowd long favours shorts
    const crowd = dir === "long" ? -pct : pct;
    const b = crowd > 0.005 ? 10 : crowd > 0.001 ? 5 : crowd < -0.005 ? -10 : crowd < -0.001 ? -5 : 0;
    if (b) { c += b; why.push(`Funding ${(pct).toFixed(4)}%/h (${b > 0 ? "+" : ""}${b})`); }
  }
  if (s.fng != null) {
    let b = 0;
    if (dir === "long") b = s.fng <= 20 ? 10 : s.fng <= 35 ? 5 : s.fng >= 80 ? -8 : s.fng >= 65 ? -4 : 0;
    else b = s.fng >= 80 ? 10 : s.fng >= 65 ? 5 : s.fng <= 20 ? -8 : s.fng <= 35 ? -4 : 0;
    if (b) { c += b; why.push(`F&G ${s.fng} (${b > 0 ? "+" : ""}${b})`); }
  }
  const r = s.rsi1h;
  if (kind === "trend") {
    if (dir === "long" && r > 72) { c -= 8; why.push("RSI1h overbought (−8)"); }
    else if (dir === "short" && r < 28) { c -= 8; why.push("RSI1h oversold (−8)"); }
    else if (r >= 40 && r <= 60) { c += 4; why.push("RSI1h neutral room (+4)"); }
    const dev = s.vwapDev * sgn(dir);
    if (dev < -0.5) { c += 6; why.push("Entry at VWAP discount (+6)"); }
    else if (dev > 2) { c -= 7; why.push("Extended from VWAP (−7)"); }
    if (s.roc5 * sgn(dir) > 0.001) { c += 5; why.push("ROC momentum (+5)"); }
  }
  if (isFinite(s.poc) && Math.abs(s.price - s.poc) / s.price < 0.003) { c += 5; why.push("Near 1h POC (+5)"); }
  return c;
}

function inSession(s: Snap) { return !(s.hour >= CFG.SESSION_BLOCK_UTC[0] && s.hour < CFG.SESSION_BLOCK_UTC[1]); }

// S1 — v3 core (5m ST flip + 15m/1h agree + chop) + v4 gates (4H bias, EMA)
function sTrend(s: Snap, rej: Reject[]): Signal | null {
  const id: StrategyId = "TREND_MTF";
  const flip = s.st5 !== s.st5prev && s.st5prev !== 0 ? s.st5 : 0;
  if (!flip) { rej.push({ strategy: id, reason: "No 5m SuperTrend flip" }); return null; }
  const dir: Dir = flip === 1 ? "long" : "short", d = sgn(dir);
  if (s.st15 !== d || s.st1h !== d) { rej.push({ strategy: id, reason: `15m/1h not aligned (${s.st15}/${s.st1h})` }); return null; }
  if (s.st4h !== 0 && s.st4h !== d) { rej.push({ strategy: id, reason: "Against 4H bias" }); return null; }
  if (!(s.chop5 < 50)) { rej.push({ strategy: id, reason: `Chop ${s.chop5.toFixed(1)} ≥ 50` }); return null; }
  if ((s.ema20 - s.ema50) * d <= 0) { rej.push({ strategy: id, reason: "EMA20/50 against" }); return null; }
  if (!inSession(s)) { rej.push({ strategy: id, reason: "Asian session block" }); return null; }
  const swing = dir === "long" ? s.swingLo5 - 0.15 * s.atr5 : s.swingHi5 + 0.15 * s.atr5;
  let stop = dir === "long" ? Math.min(swing, s.price - 0.5 * s.atr5) : Math.max(swing, s.price + 0.5 * s.atr5);
  const risk = Math.abs(s.price - stop);
  if (!(risk > 0) || risk > 4 * s.atr5) { rej.push({ strategy: id, reason: "Swing stop out of bounds" }); return null; }
  const why = ["5m ST flip", "15m+1h aligned", s.st4h === d ? "4H bias aligned" : "4H neutral", `Chop ${s.chop5.toFixed(1)}`, "EMA aligned"];
  const score = 66 + (s.st4h === d ? 6 : 0) + contextScore(s, dir, "trend", why);
  return { strategy: id, dir, entryRef: s.price, stop, score, why, regime: s.regime, barT: s.T };
}

// S2 — liquidity sweep reversal (journal finding: indicator ≈ sweep + rejection detector)
function sSweep(s: Snap, rej: Reject[]): Signal | null {
  const id: StrategyId = "SWEEP_REV";
  if (!s.new15 || !s.b15) { rej.push({ strategy: id, reason: "Waits for 15m close" }); return null; }
  const b = s.b15, rng = b.h - b.l; if (!(rng > 0)) return null;
  const levelsHi: [number, string][] = [[s.hi20_15, "20-bar high"]], levelsLo: [number, string][] = [[s.lo20_15, "20-bar low"]];
  if (s.asian) { levelsHi.push([s.asian.hi, "Asian high"]); levelsLo.push([s.asian.lo, "Asian low"]); }
  let dir: Dir | null = null, lvlName = "", sweepExt = 0;
  for (const [L, nm] of levelsHi) if (isFinite(L) && b.h > L && b.c < L && (b.h - Math.max(b.o, b.c)) >= 0.5 * rng) { dir = "short"; lvlName = nm; sweepExt = b.h; break; }
  if (!dir) for (const [L, nm] of levelsLo) if (isFinite(L) && b.l < L && b.c > L && (Math.min(b.o, b.c) - b.l) >= 0.5 * rng) { dir = "long"; lvlName = nm; sweepExt = b.l; break; }
  if (!dir) { rej.push({ strategy: id, reason: "No sweep + rejection on 15m" }); return null; }
  const d = sgn(dir);
  if (CFG.SWEEP_REQUIRE_HTF && s.st4h === -d) { rej.push({ strategy: id, reason: "Sweep against 4H bias" }); return null; }
  const stop = sweepExt - d * 0.1 * s.atr15, risk = Math.abs(s.price - stop);
  if (!(risk >= 0.3 * s.atr15) || risk > 2.5 * s.atr15) { rej.push({ strategy: id, reason: "Sweep stop out of bounds" }); return null; }
  const why = [`Swept ${lvlName}`, "Rejection wick ≥50%"];
  let score = 68;
  if (s.st4h === d) { score += 8; why.push("With 4H bias (+8)"); } else if (s.st4h === -d) { score -= 8; why.push("Against 4H bias (−8)"); }
  if (dir === "short" && s.rsi15 > 60) { score += 4; why.push("RSI15 elevated (+4)"); }
  if (dir === "long" && s.rsi15 < 40) { score += 4; why.push("RSI15 depressed (+4)"); }
  score += contextScore(s, dir, "revert", why);
  return { strategy: id, dir, entryRef: s.price, stop, score, why, regime: s.regime, barT: s.T };
}

// S3 — VWAP ±2σ mean reversion, RANGE regime only
function sVwap(s: Snap, rej: Reject[]): Signal | null {
  const id: StrategyId = "VWAP_REVERT";
  if (!s.new15 || !s.b15) { rej.push({ strategy: id, reason: "Waits for 15m close" }); return null; }
  if (s.regime !== "RANGE") { rej.push({ strategy: id, reason: `Regime ${s.regime} (needs RANGE)` }); return null; }
  if (!(s.vwapSd > 0)) return null;
  const b = s.b15; let dir: Dir | null = null;
  if (s.vwapDev >= 2 && s.rsi15 >= 68 && b.c < b.o) dir = "short";
  else if (s.vwapDev <= -2 && s.rsi15 <= 32 && b.c > b.o) dir = "long";
  if (!dir) { rej.push({ strategy: id, reason: `VWAP dev ${s.vwapDev.toFixed(2)}σ, RSI15 ${s.rsi15.toFixed(0)} — no extreme` }); return null; }
  const d = sgn(dir), stop = (dir === "short" ? b.h : b.l) - d * 0.5 * s.atr15;
  const why = [`VWAP ${s.vwapDev.toFixed(2)}σ`, `RSI15 ${s.rsi15.toFixed(0)}`, "Reversal candle", "Range regime"];
  const score = 70 + contextScore(s, dir, "revert", why) - (s.st4h === -d ? 4 : 0);
  return { strategy: id, dir, entryRef: s.price, stop, score, why, regime: s.regime, barT: s.T };
}

// S4 — London/NY session range breakout with volume, trend-aligned
function sSession(s: Snap, rej: Reject[]): Signal | null {
  const id: StrategyId = "SESSION_BO";
  if (!s.new15 || !s.b15) { rej.push({ strategy: id, reason: "Waits for 15m close" }); return null; }
  const ldn = s.hour >= 7 && s.hour < 10, ny = (s.hour === 13 && s.minute >= 30) || (s.hour >= 14 && s.hour < 16);
  if (!ldn && !ny) { rej.push({ strategy: id, reason: "Outside London/NY open window" }); return null; }
  if (s.regime === "RANGE") { rej.push({ strategy: id, reason: "Range regime" }); return null; }
  const R = ldn ? s.asian : s.london; if (!R) return null;
  const b = s.b15; let dir: Dir | null = null;
  if (b.c > R.hi && b.o <= R.hi + 0.25 * s.atr15) dir = "long"; else if (b.c < R.lo && b.o >= R.lo - 0.25 * s.atr15) dir = "short";
  if (!dir) { rej.push({ strategy: id, reason: "No range break on 15m close" }); return null; }
  const d = sgn(dir);
  if (s.st4h === -d) { rej.push({ strategy: id, reason: "Breakout against 4H bias" }); return null; }
  if (!(s.vol15 > 1.3 * s.volAvg15)) { rej.push({ strategy: id, reason: "Breakout volume < 1.3× avg" }); return null; }
  const stop = (dir === "long" ? b.l : b.h) - d * 0.2 * s.atr15, risk = Math.abs(s.price - stop);
  if (!(risk > 0) || risk > 3 * s.atr15) { rej.push({ strategy: id, reason: "Breakout stop too wide" }); return null; }
  const why = [`${ldn ? "London" : "NY"} break of ${ldn ? "Asian" : "London"} range`, "Volume ≥1.3×", s.st4h === d ? "4H aligned" : "4H neutral"];
  const score = 68 + (s.st4h === d ? 6 : 0) + contextScore(s, dir, "trend", why);
  return { strategy: id, dir, entryRef: s.price, stop, score, why, regime: s.regime, barT: s.T };
}

// S5 — 4H Donchian breakout with the 4H trend (desk foundation: HTF trend-following; fees small vs move)
function sHtf(s: Snap, rej: Reject[]): Signal | null {
  const id: StrategyId = "HTF_TREND";
  if (!s.new4h || !s.b4h) { rej.push({ strategy: id, reason: "Waits for 4H close" }); return null; }
  if (!isFinite(s.atr4h) || !isFinite(s.hi4h) || !isFinite(s.ema50_4h)) { rej.push({ strategy: id, reason: "4H warming up" }); return null; }
  const b = s.b4h; let dir: Dir | null = null;
  if (b.c > s.hi4h && s.st4h === 1 && b.c > s.ema50_4h) dir = "long";
  else if (b.c < s.lo4h && s.st4h === -1 && b.c < s.ema50_4h) dir = "short";
  if (!dir) { rej.push({ strategy: id, reason: `No 4H ${CFG.HTF_DONCHIAN}-bar breakout with trend` }); return null; }
  const d = sgn(dir), stop = s.price - d * CFG.HTF_ATR_STOP * s.atr4h;
  const why = [`4H close beyond ${CFG.HTF_DONCHIAN}-bar ${dir === "long" ? "high" : "low"}`, "4H SuperTrend aligned", "Above/below 4H EMA50", `Stop ${CFG.HTF_ATR_STOP}×ATR4h`];
  const score = 76 + contextScore(s, dir, "revert", why);
  return { strategy: id, dir, entryRef: s.price, stop, score, why, regime: s.regime, barT: s.T };
}

// S6 — research P5: daily bear-trap reclaim in a daily bull regime (long only)
//   day k: bearish engulfing while day k-1 closed above daily EMA50; within the next 3 days a day m
//   trades below day k's low and closes back above it → long at the next open, stop = lowest low k..m − 0.1%.
function sBearTrap(s: Snap, S: Series, rej: Reject[]): Signal | null {
  const id: StrategyId = "D_BEARTRAP";
  const D = S.d1, m = s.i1d;
  if (m < 2 || D[m].ct !== s.T) { rej.push({ strategy: id, reason: "Waits for daily close" }); return null; }
  for (let k = m - 1; k >= Math.max(1, m - 3); k--) {
    const a = D[k], p = D[k - 1];
    const bearEng = a.c < a.o && p.c > p.o && a.o >= p.c && a.c <= p.o && isFinite(S.ema50D[k - 1]) && p.c > S.ema50D[k - 1];
    if (!bearEng) continue;
    // the reclaim must be the FIRST sweep after day k
    let first = true; for (let j = k + 1; j < m; j++) if (D[j].l < a.l) { first = false; break; }
    if (!first) break;
    if (D[m].l < a.l && D[m].c > a.l) {
      let lo = Infinity; for (let j = k; j <= m; j++) lo = Math.min(lo, D[j].l);
      const stop = lo * 0.999;
      if (!(stop < s.price)) { rej.push({ strategy: id, reason: "Bear-trap stop above price" }); return null; }
      const why = ["Daily bearish engulfing in bull regime", `Low ${a.l.toFixed(0)} swept and reclaimed`, "Research P5: PF 1.20, OOS +0.19R (2017–2026)"];
      return { strategy: id, dir: "long", entryRef: s.price, stop, score: 90, why, regime: s.regime, barT: s.T };
    }
    break;
  }
  rej.push({ strategy: id, reason: "No daily bear-trap reclaim" }); return null;
}

// S7 — research P1: daily thrust (body > 2×ATR, close > EMA50) → first 1H pullback to EMA20 within 72h (long only)
function sThrust(s: Snap, S: Series, rej: Reject[]): Signal | null {
  const id: StrategyId = "D_THRUST";
  if (!s.new1h) { rej.push({ strategy: id, reason: "Waits for 1H close" }); return null; }
  const D = S.d1, h1 = S.f.h1, e20 = S.ema20_1h, i = s.i1h;
  const touch = (j: number) => isFinite(e20[j]) && h1[j].l <= e20[j] && h1[j].c > e20[j];
  if (!touch(i)) { rej.push({ strategy: id, reason: "No 1H EMA20 pullback" }); return null; }
  for (let k = s.i1d; k >= Math.max(1, s.i1d - 3); k--) {
    const day = D[k], t0 = day.ct + 1, t1 = t0 + 72 * 3600_000;
    if (h1[i].t < t0 || h1[i].t >= t1) continue;
    const thrust = isFinite(S.atrD[k - 1]) && day.c - day.o > 2 * S.atrD[k - 1] && isFinite(S.ema50D[k]) && day.c > S.ema50D[k];
    if (!thrust) continue;
    for (let j = i - 1; j >= 0 && h1[j].t >= t0; j--) if (touch(j)) { rej.push({ strategy: id, reason: "Thrust pullback already taken" }); return null; }
    const stop = (day.o + day.c) / 2 - S.atrD[k];
    if (!(stop < s.price)) { rej.push({ strategy: id, reason: "Thrust stop above price" }); return null; }
    const why = [`Daily thrust ${((day.c - day.o) / S.atrD[k - 1]).toFixed(1)}×ATR in bull regime`, "First 1H pullback to EMA20 within 72h", "Research P1: PF 4.5 (small sample)"];
    return { strategy: id, dir: "long", entryRef: s.price, stop, score: 88, why, regime: s.regime, barT: s.T };
  }
  rej.push({ strategy: id, reason: "No recent daily thrust" }); return null;
}

// S8 — failed breakout at the 4H 55-bar extreme ("sell where it starts dropping"):
//   a bar trades through the prior 55-bar 4H high (low), closes back inside with a rejection wick → short (long).
//   Stop just beyond the wick. Fires at the level instead of after the move.
function sHtfSweep(s: Snap, S: Series, rej: Reject[]): Signal | null {
  const id: StrategyId = "HTF_SWEEP";
  const tf = CFG.HSW_TF, isNew = tf === "4h" ? s.new4h : s.new1h;
  if (!isNew) { rej.push({ strategy: id, reason: `Waits for ${tf.toUpperCase()} close` }); return null; }
  const b = tf === "4h" ? s.b4h : (s.i1h >= 0 ? S.f.h1[s.i1h] : null);
  if (!b || !isFinite(s.hi4h) || !isFinite(s.atr4h)) { rej.push({ strategy: id, reason: "4H warming up" }); return null; }
  // for 1h triggers use the 55-bar range of 4H bars closed BEFORE this 1h bar's 4H bucket (no look-ahead: snapshot already uses closed 4H only)
  const hi = s.hi4h, lo = s.lo4h, rng = b.h - b.l; if (!(rng > 0)) return null;
  let dir: Dir | null = null, ext = 0;
  if (b.h > hi && b.c < hi && (b.h - Math.max(b.o, b.c)) >= CFG.HSW_WICK * rng) { dir = "short"; ext = b.h; }
  else if (b.l < lo && b.c > lo && (Math.min(b.o, b.c) - b.l) >= CFG.HSW_WICK * rng) { dir = "long"; ext = b.l; }
  if (!dir) { rej.push({ strategy: id, reason: `No failed break of 4H high/low ($${hi.toFixed(0)}/$${lo.toFixed(0)})` }); return null; }
  const d = sgn(dir), stop = ext - d * 0.1 * s.atr4h, risk = Math.abs(s.price - stop);
  if (!(risk > 0) || risk > CFG.HSW_MAX_RISK_ATR * s.atr4h) { rej.push({ strategy: id, reason: "Sweep stop too wide" }); return null; }
  const why = [`${tf.toUpperCase()} bar swept the 4H ${dir === "short" ? "high" : "low"} ($${(dir === "short" ? hi : lo).toFixed(0)}) and closed back inside`, "Rejection wick", "Stop beyond the wick"];
  return { strategy: id, dir, entryRef: s.price, stop, score: 80 + contextScore(s, dir, "revert", why), why, regime: s.regime, barT: s.T };
}

// S9 — EMA20/EMA50 crossover on 15m or 1h closes (from the user's chart observation).
function sEmaCross(s: Snap, S: Series, rej: Reject[]): Signal | null {
  const id: StrategyId = "EMA_CROSS";
  const tf = CFG.XC_TF, isNew = tf === "15m" ? s.new15 : s.new1h, i = tf === "15m" ? s.i15 : s.i1h;
  if (!isNew || i < 1) { rej.push({ strategy: id, reason: `Waits for ${tf} close` }); return null; }
  const f = tf === "15m" ? S.ema20_15 : S.ema20_1h, sl = tf === "15m" ? S.ema50_15 : S.ema50_1h;
  if (!isFinite(f[i - 1]) || !isFinite(sl[i - 1])) { rej.push({ strategy: id, reason: "EMAs warming up" }); return null; }
  const prev = f[i - 1] - sl[i - 1], cur = f[i] - sl[i];
  let dir: Dir | null = null;
  if (prev <= 0 && cur > 0 && CFG.XC_LONGS) dir = "long"; else if (prev >= 0 && cur < 0 && CFG.XC_SHORTS) dir = "short";
  if (!dir) { rej.push({ strategy: id, reason: `No ${tf} EMA20/50 cross` }); return null; }
  const d = sgn(dir);
  if (CFG.XC_REQUIRE_4H && s.st4h !== d) { rej.push({ strategy: id, reason: "Cross against 4H SuperTrend" }); return null; }
  const stop = s.price - d * CFG.XC_STOP_ATR * s.atr15;
  const why = [`${tf} EMA20 crossed ${dir === "long" ? "above" : "below"} EMA50`, `Stop ${CFG.XC_STOP_ATR}×ATR15`];
  return { strategy: id, dir, entryRef: s.price, stop, score: 80, why, regime: s.regime, barT: s.T };
}

// SSR — your STRATEGY.md v1.4 "Session Sweep Reversal with 4H bias", ported to the bot (15m trigger, ET windows).
// Bias: 4H close vs EMA50 AND last 4H BOS agree. Window: London 03–05 ET or NY 08–11 ET. Sweep of the Asian range
// (20:00–02:00 ET), then within 6 bars a 15m close back inside + MSS (close beyond a confirmed swing formed after the sweep).
// Stop: sweep extreme ± 0.25×ATR15. Target: single 3R. Filters: stop ≤ 2×ATR1h and ≥ 0.5×ATR15. First trigger only.
function sSSR(s: Snap, S: Series, rej: Reject[]): Signal | null {
  const id: StrategyId = "SSR";
  if (!s.new15 || !s.b15) { rej.push({ strategy: id, reason: "Waits for 15m close" }); return null; }
  const f = S.f.m15, i = s.i15, et = etParts(f[i].t);
  const win = et.h >= 3 && et.h < 5 ? [3, 5] : et.h >= 8 && et.h < 11 ? [8, 11] : null;
  if (!win) { rej.push({ strategy: id, reason: "Outside London 03–05 / NY 08–11 ET window" }); return null; }
  if (s.i4h < 0 || !s.b4h || !isFinite(s.ema50_4h)) { rej.push({ strategy: id, reason: "4H warming up" }); return null; }
  const bos = S.bos4h[s.i4h], bias = s.b4h.c > s.ema50_4h && bos === 1 ? 1 : s.b4h.c < s.ema50_4h && bos === -1 ? -1 : 0;
  if (!bias) { rej.push({ strategy: id, reason: "4H bias neutral (EMA50 and last BOS disagree)" }); return null; }
  let asHi = -Infinity, asLo = Infinity, ws = -1;
  for (let j = i; j >= Math.max(0, i - 80); j--) {
    const e = etParts(f[j].t);
    if ((e.day === et.day - 1 && e.h >= 20) || (e.day === et.day && e.h < 2)) { asHi = Math.max(asHi, f[j].h); asLo = Math.min(asLo, f[j].l); }
    if (e.day === et.day && e.h >= win[0] && e.h < win[1]) ws = j;
  }
  if (!isFinite(asHi) || ws < 0) { rej.push({ strategy: id, reason: "No Asian range yet" }); return null; }
  const d = bias, lvl = d === 1 ? asLo : asHi;
  let k0 = -1; for (let j = ws; j <= i; j++) if (d === 1 ? f[j].l < lvl : f[j].h > lvl) { k0 = j; break; }
  if (k0 < 0) { rej.push({ strategy: id, reason: `No sweep of the Asian ${d === 1 ? "low" : "high"} ($${lvl.toFixed(0)}) in this window` }); return null; }
  let trig = -1, ext = d === 1 ? Infinity : -Infinity;
  for (let j = k0; j <= Math.min(i, k0 + 6) && trig < 0; j++) {
    ext = d === 1 ? Math.min(ext, f[j].l) : Math.max(ext, f[j].h);
    const reclaim = d === 1 ? f[j].c > lvl : f[j].c < lvl;
    let sw = NaN;
    for (let c = j - 2; c >= Math.max(k0, 2); c--) {
      const isSw = d === 1 ? f[c].h > f[c - 1].h && f[c].h > f[c - 2].h && f[c].h > f[c + 1].h && f[c].h > f[c + 2].h
                           : f[c].l < f[c - 1].l && f[c].l < f[c - 2].l && f[c].l < f[c + 1].l && f[c].l < f[c + 2].l;
      if (isSw) { sw = d === 1 ? f[c].h : f[c].l; break; }
    }
    if (reclaim && isFinite(sw) && (d === 1 ? f[j].c > sw : f[j].c < sw)) trig = j;
  }
  if (trig !== i) { rej.push({ strategy: id, reason: trig < 0 ? "Swept, no reclaim + MSS yet" : "Trigger already fired this window" }); return null; }
  const atr1h = s.i1h >= 0 ? S.atr1h[s.i1h] : NaN, stop = ext - d * 0.25 * s.atr15, risk = Math.abs(s.price - stop);
  if (!(risk >= 0.5 * s.atr15)) { rej.push({ strategy: id, reason: "Stop inside noise (< 0.5×ATR15)" }); return null; }
  if (isFinite(atr1h) && risk > 2 * atr1h) { rej.push({ strategy: id, reason: "Stop too wide (> 2×ATR1h)" }); return null; }
  const dir: Dir = d === 1 ? "long" : "short";
  const why = [`4H bias ${dir === "long" ? "bull" : "bear"} (EMA50 + BOS)`, `${win[0] === 3 ? "London" : "NY"} sweep of Asian ${d === 1 ? "low" : "high"} $${lvl.toFixed(0)}`, "15m reclaim + MSS", "3R target"];
  return { strategy: id, dir, entryRef: s.price, stop, score: 82, why, regime: s.regime, barT: s.T };
}

// EMA_PB — "XAU Pullback v1" (your saved gold strategy), ported: M15 trend (close > EMA50 > EMA200, EMA200 rising),
// M5 pullback to EMA20 then a bullish close above the prior high; 08:00–11:30 ET weekdays; stop 1.5×ATR(5m); 1R/2R/3R; 2h max.
function sEmaPb(s: Snap, S: Series, rej: Reject[]): Signal | null {
  const id: StrategyId = "EMA_PB";
  const b = S.f.m5, i = s.i5, et = etParts(b[i].t);
  if (!(et.h >= 8 && et.h < 11.5) || et.dow === 0 || et.dow === 6) { rej.push({ strategy: id, reason: "Outside 08:00–11:30 ET weekdays" }); return null; }
  const j = s.i15, c15 = j >= 0 ? S.f.m15[j].c : NaN, e50 = S.ema50_15[j], e200 = S.ema200_15[j], e200p = S.ema200_15[j - 4];
  if (!isFinite(e200p)) { rej.push({ strategy: id, reason: "EMAs warming up" }); return null; }
  const bias = c15 > e50 && e50 > e200 && e200 > e200p ? 1 : c15 < e50 && e50 < e200 && e200 < e200p ? -1 : 0;
  if (!bias) { rej.push({ strategy: id, reason: "No clean M15 EMA50/200 trend" }); return null; }
  const p = b[i - 1], c = b[i], e20 = S.ema20, atr = s.atr5;
  if (c.h - c.l > 2 * atr) { rej.push({ strategy: id, reason: "Bar > 2×ATR (chase)" }); return null; }
  const ok = bias === 1 ? p.l <= e20[i - 1] && c.c > p.h && c.c > e20[i] && c.c > c.o && e20[i] > e20[i - 1]
                        : p.h >= e20[i - 1] && c.c < p.l && c.c < e20[i] && c.c < c.o && e20[i] < e20[i - 1];
  if (!ok) { rej.push({ strategy: id, reason: "No 5m pullback-to-EMA20 trigger" }); return null; }
  const dir: Dir = bias === 1 ? "long" : "short", stop = s.price - bias * 1.5 * atr;
  return { strategy: id, dir, entryRef: s.price, stop, score: 78, why: ["M15 EMA50/200 trend", "5m pullback to EMA20 + break of prior bar", "Stop 1.5×ATR5"], regime: s.regime, barT: s.T };
}

// ─── AI/ML layer: market-state features at signal time + logistic trade filter ──────────────────
export const STRAT_FAMILY_REV: StrategyId[] = ["SWEEP_REV", "VWAP_REVERT", "HTF_SWEEP", "SSR", "D_BEARTRAP"];
export const BASE_FEATURES = ["score", "stop_atr15", "risk_pct", "st5", "st15", "st1h", "st4h", "chop5", "chop15", "rsi15", "rsi1h", "vwap_dev",
  "atr5_pct", "atr15_pct", "atr4h_pct", "atrD_pct", "roc5", "ema_gap5", "ema50_4h_dist", "ema200_1h_dist", "ema50D_dist",
  "r1h", "r4h", "r24h", "r72h", "r7d", "rv24", "rv168", "rv_ratio", "vol15_ratio", "hour_sin", "hour_cos", "is_long", "reg_trend", "reg_range"];
function rv(b: Bar[], i: number, n: number) { if (i - n < 1) return NaN; let q = 0; for (let j = i - n + 1; j <= i; j++) { const r = Math.log(b[j].c / b[j - 1].c); q += r * r; } return Math.sqrt(q / n); }
/** Direction-signed market state when a signal fires (same function for mining, training and the live filter). */
export function signalFeatures(s: Snap, S: Series, sig: Signal): number[] {
  const d = sgn(sig.dir), px = s.price, h1 = S.f.h1, i = s.i1h, risk = Math.abs(s.price - sig.stop);
  const ret = (n: number) => (i - n >= 0 ? (h1[i].c / h1[i - n].c - 1) * d : NaN);
  const r24 = rv(h1, i, 24), r168 = rv(h1, i, 168), iD = s.i1d;
  const v: Record<string, number> = {
    score: sig.score, stop_atr15: risk / s.atr15, risk_pct: risk / px, st5: s.st5 * d, st15: s.st15 * d, st1h: s.st1h * d, st4h: s.st4h * d,
    chop5: s.chop5, chop15: s.chop15, rsi15: (s.rsi15 - 50) * d, rsi1h: (s.rsi1h - 50) * d, vwap_dev: s.vwapDev * d,
    atr5_pct: s.atr5 / px, atr15_pct: s.atr15 / px, atr4h_pct: s.atr4h / px, atrD_pct: iD >= 0 ? S.atrD[iD] / px : NaN,
    roc5: s.roc5 * d, ema_gap5: (s.ema20 - s.ema50) / px * d, ema50_4h_dist: (px - s.ema50_4h) / px * d,
    ema200_1h_dist: i >= 0 ? (px - S.ema200_1h[i]) / px * d : NaN, ema50D_dist: iD >= 0 ? (px - S.ema50D[iD]) / px * d : NaN,
    r1h: ret(1), r4h: ret(4), r24h: ret(24), r72h: ret(72), r7d: ret(168), rv24: r24, rv168: r168, rv_ratio: r24 / r168,
    vol15_ratio: s.volAvg15 > 0 ? s.vol15 / s.volAvg15 : NaN, hour_sin: Math.sin(2 * Math.PI * s.hour / 24), hour_cos: Math.cos(2 * Math.PI * s.hour / 24),
    is_long: d > 0 ? 1 : 0, reg_trend: s.regime === "TREND" ? 1 : 0, reg_range: s.regime === "RANGE" ? 1 : 0,
  };
  return BASE_FEATURES.map((k) => v[k]);
}
/** Model input = base features + (base × reversal-family flag) + strategy one-hots + asset flag. */
export function modelInput(base: number[], strategy: string, isGold: boolean): number[] {
  const rev = STRAT_FAMILY_REV.includes(strategy as StrategyId) ? 1 : 0;
  return [...base, ...base.map((x) => x * rev), ...STRATEGIES.map((id) => (id === strategy ? 1 : 0)), isGold ? 1 : 0];
}
export function mlProb(x: number[], m: NonNullable<typeof CFG.ML_FILTER>): number {
  let z = m.b;
  for (let k = 0; k < m.w.length; k++) { const v = isFinite(x[k]) ? (x[k] - m.mean[k]) / (m.std[k] || 1) : 0; z += m.w[k] * Math.max(-6, Math.min(6, v)); }
  return 1 / (1 + Math.exp(-z));
}
export let ML_IS_GOLD = false; export function setMlAsset(gold: boolean) { ML_IS_GOLD = gold; }

const RUNNERS: Record<StrategyId, (s: Snap, S: Series, r: Reject[]) => Signal | null> = {
  D_BEARTRAP: sBearTrap, D_THRUST: sThrust,
  HTF_TREND: (s, _S, r) => sHtf(s, r), TREND_MTF: (s, _S, r) => sTrend(s, r), SWEEP_REV: (s, _S, r) => sSweep(s, r), VWAP_REVERT: (s, _S, r) => sVwap(s, r), SESSION_BO: (s, _S, r) => sSession(s, r), HTF_SWEEP: sHtfSweep, EMA_CROSS: sEmaCross, SSR: sSSR, EMA_PB: sEmaPb,
};

// ─── v5.8 desk agents (pure functions; the same code runs live and in the backtester) ──────────────
// Chart agent — reads every timeframe and lists the levels the bot respects, nearest first.
export type ChartLevel = { px: number; name: string; side: "support" | "resistance"; distAtr: number; blocks: boolean };
export type ChartRead = {
  price: number; bias: "bull" | "bear" | "mixed"; regime: string;
  trend: { m1: number | null; m5: number; m15: number; h1: number; h4: number };
  levels: ChartLevel[]; support: ChartLevel | null; resistance: ChartLevel | null;
};
// levels that physically block a move (swing / session / prior-day / 4H extremes); VWAP, POC and EMAs are reference only
const BLOCKING = /high|low/i;
export function chartLevels(s: Snap, S: Series): { px: number; name: string; blocks: boolean }[] {
  const out = liquidityLevels(s, S).map((l) => ({ ...l, blocks: BLOCKING.test(l.name) }));
  if (isFinite(s.hi4h)) out.push({ px: s.hi4h, name: "4H 55-bar high", blocks: true });
  if (isFinite(s.lo4h)) out.push({ px: s.lo4h, name: "4H 55-bar low", blocks: true });
  if (isFinite(s.ema50_4h)) out.push({ px: s.ema50_4h, name: "4H EMA50", blocks: false });
  if (s.i1d >= 0 && isFinite(S.ema50D[s.i1d])) out.push({ px: S.ema50D[s.i1d], name: "Daily EMA50", blocks: false });
  return out.filter((l) => isFinite(l.px));
}
export function chartRead(s: Snap, S: Series, m1: M1View = null): ChartRead {
  const atr = s.atr15 > 0 ? s.atr15 : s.price * 0.003, seen: ChartLevel[] = [];
  const all = chartLevels(s, S).map((l) => ({ ...l, side: (l.px >= s.price ? "resistance" : "support") as ChartLevel["side"], distAtr: Math.abs(l.px - s.price) / atr }))
    .sort((a, b) => a.distAtr - b.distAtr);
  for (const l of all) if (!seen.some((x) => Math.abs(x.px - l.px) < 0.1 * atr)) seen.push(l);
  const levels = seen.slice(0, 14), score = s.st15 + s.st1h + s.st4h;
  return {
    price: s.price, regime: s.regime, bias: score >= 2 ? "bull" : score <= -2 ? "bear" : "mixed",
    trend: { m1: m1 ? m1.st : null, m5: s.st5, m15: s.st15, h1: s.st1h, h4: s.st4h },
    levels, support: levels.find((l) => l.side === "support") ?? null, resistance: levels.find((l) => l.side === "resistance") ?? null,
  };
}

// Risk agent — stop at the candle BODY, not the wick. Trigger timeframe depends on the strategy.
const BODY_TF: Record<StrategyId, "5m" | "15m" | "1h"> = {
  TREND_MTF: "5m", EMA_PB: "5m", SWEEP_REV: "15m", VWAP_REVERT: "15m", SESSION_BO: "15m", EMA_CROSS: "15m", SSR: "15m",
  HTF_TREND: "1h", HTF_SWEEP: "1h", D_BEARTRAP: "1h", D_THRUST: "1h",
};
/** Returns a stop strictly tighter than sig.stop, or null when the body rule can't improve it. */
export function bodyStop(s: Snap, S: Series, sig: Signal): { stop: number; tf: string; basis: string } | null {
  const tf = BODY_TF[sig.strategy], d = sgn(sig.dir), C = CFG.BODY_SL;
  const bars = tf === "5m" ? S.f.m5 : tf === "15m" ? S.f.m15 : S.f.h1;
  const i = tf === "5m" ? s.i5 : tf === "15m" ? s.i15 : s.i1h;
  const atr = tf === "5m" ? s.atr5 : tf === "15m" ? s.atr15 : (i >= 0 ? S.atr1h[i] : NaN);
  if (i < C.n || !isFinite(atr)) return null;
  let ext = d === 1 ? Infinity : -Infinity;
  for (let j = i - C.n + 1; j <= i; j++) ext = d === 1 ? Math.min(ext, Math.min(bars[j].o, bars[j].c)) : Math.max(ext, Math.max(bars[j].o, bars[j].c));
  let stop = ext - d * C.buf * atr;
  const floor = C.minPct * s.price;
  if ((s.price - stop) * d < floor) stop = s.price - d * floor;           // never tighter than the noise floor
  if ((s.price - stop) * d <= 0) return null;
  if (!((stop - sig.stop) * d > 0)) return null;                           // only ever tighten
  return { stop, tf, basis: `${C.n}×${tf} body ${d === 1 ? "low" : "high"} ${ext.toFixed(ext > 1000 ? 0 : 2)}` };
}

// Signal validator agent — independent second opinion on a signal that already passed its strategy rules.
export type Vote = { check: string; pass: boolean; note: string };
export function validateSignal(s: Snap, S: Series, sig: Signal): { ok: boolean; votes: Vote[]; roomR: number | null } {
  const d = sgn(sig.dir), R = Math.abs(s.price - sig.stop), V = CFG.VALIDATOR, votes: Vote[] = [];
  let roomR: number | null = null;
  if (R > 0) {
    const ahead = chartLevels(s, S).filter((l) => l.blocks && (l.px - s.price) * d > 0.05 * s.atr15).sort((a, b) => (a.px - b.px) * d)[0];
    roomR = ahead ? Math.abs(ahead.px - s.price) / R : null;
    votes.push({ check: "room", pass: roomR === null || roomR >= V.minRoomR, note: ahead ? `${roomR!.toFixed(2)}R to ${ahead.name} ${ahead.px.toFixed(ahead.px > 1000 ? 0 : 2)} (needs ≥${V.minRoomR}R)` : "open space ahead" });
  }
  if (V.htfVeto && !STRAT_FAMILY_REV.includes(sig.strategy)) {
    const against = s.st1h === -d && s.st4h === -d;
    votes.push({ check: "htf", pass: !against, note: against ? "1H and 4H trend both against a trend-following entry" : "higher timeframes not both against" });
  }
  return { ok: votes.every((v) => v.pass), votes, roomR };
}

// Re-entry agent — after a losing stop-out, re-take the same setup if price reclaims the stopped level and the trend still agrees.
function sReentry(s: Snap, S: Series, st: State, rej: Reject[]): Signal | null {
  const r = st.reentry, C = CFG.REENTRY; if (!r) return null;
  const id = r.strategy;
  if (s.T - r.t > C.windowH * 3600_000) { rej.push({ strategy: id, reason: "Re-entry window expired" }); return null; }
  if (r.n > C.max) { rej.push({ strategy: id, reason: `Re-entry limit (${C.max}) reached` }); return null; }
  const d = sgn(r.dir);
  if ((s.price - r.level) * d <= 0) { rej.push({ strategy: id, reason: `Re-entry waits for reclaim of ${r.level.toFixed(r.level > 1000 ? 0 : 2)}` }); return null; }
  if (s.st15 !== d || s.st1h !== d) { rej.push({ strategy: id, reason: "Re-entry: 15m/1h no longer aligned" }); return null; }
  if (s.st4h === -d || s.st5 !== d || (s.ema20 - s.ema50) * d <= 0 || !(s.chop5 < 55) || !inSession(s)) { rej.push({ strategy: id, reason: "Re-entry: 5m trend/chop/session not clean" }); return null; }
  const swing = r.dir === "long" ? s.swingLo5 - 0.15 * s.atr5 : s.swingHi5 + 0.15 * s.atr5;
  const stop = r.dir === "long" ? Math.min(swing, s.price - 0.5 * s.atr5) : Math.max(swing, s.price + 0.5 * s.atr5);
  const risk = Math.abs(s.price - stop); if (!(risk > 0) || risk > 4 * s.atr5) { rej.push({ strategy: id, reason: "Re-entry stop out of bounds" }); return null; }
  const why = [`RE-ENTRY #${r.n} after stop at ${r.level.toFixed(r.level > 1000 ? 0 : 2)}`, "Level reclaimed", "5m/15m/1h aligned", s.st4h === d ? "4H bias aligned" : "4H neutral"];
  const score = 68 + (s.st4h === d ? 6 : 0) + 4 + contextScore(s, r.dir, "trend", why);
  return { strategy: id, dir: r.dir, entryRef: s.price, stop, score, why, regime: s.regime, barT: s.T, reentry: true };
}

export function evaluate(s: Snap, enabled: Record<string, boolean> = {}, S?: Series, st?: State): { signals: Signal[]; rejects: Reject[] } {
  const signals: Signal[] = [], rejects: Reject[] = [];
  if (!isFinite(s.atr5) || !isFinite(s.atr15) || !isFinite(s.chop15) || !isFinite(s.price)) { rejects.push({ strategy: "TREND_MTF", reason: "Indicators warming up" }); return { signals, rejects }; }
  const off = (id: StrategyId) => enabled[id] === false || CFG.RISK_SCALE[id] === 0 || (OPT_IN.includes(id) && !(CFG.RISK_SCALE[id] > 0));
  // shared pipeline for every candidate: regime gate → AI filter → risk agent (body stop) → validator agent
  const admit = (id: StrategyId, sig: Signal) => {
    const gate = CFG.REGIME_GATE[id];
    if (gate !== undefined && S) {
      const e = s.i1d >= 0 ? S.ema50D[s.i1d] : NaN, dist = isFinite(e) ? ((s.price - e) / s.price) * sgn(sig.dir) : NaN;
      if (!(dist > gate)) { rejects.push({ strategy: id, reason: `Daily regime gate: ${isFinite(dist) ? (dist * 100).toFixed(1) + "%" : "n/a"} vs EMA50D, needs >${(gate * 100).toFixed(1)}% in trade direction` }); return; }
      sig.why.push(`Daily regime aligned (${(dist * 100).toFixed(1)}% beyond EMA50D)`);
    }
    sig.score = Math.max(10, Math.min(97, Math.round(sig.score)));
    const M = CFG.ML_FILTER;
    if (M && S) {
      const p = mlProb(modelInput(signalFeatures(s, S, sig), id, ML_IS_GOLD), M);
      sig.why.push(`AI filter p(win) ${(p * 100).toFixed(0)}% vs ${(M.thr * 100).toFixed(0)}% needed${CFG.ML_SHADOW ? " (shadow)" : ""}`);
      if (p < M.thr && !CFG.ML_SHADOW) { rejects.push({ strategy: id, reason: `AI filter: p(win) ${(p * 100).toFixed(0)}% < ${(M.thr * 100).toFixed(0)}%` }); return; }
    }
    if (CFG.BODY_SL.on && S) {
      const b = bodyStop(s, S, sig);
      if (b) { sig.why.push(`Body stop ${b.stop.toFixed(b.stop > 1000 ? 0 : 2)} (${b.basis}) vs ${sig.stop.toFixed(sig.stop > 1000 ? 0 : 2)}`); sig.stop = b.stop; sig.bodyStop = true; }
    }
    if (CFG.VALIDATOR.on && S) {
      const v = validateSignal(s, S, sig);
      if (!v.ok) { rejects.push({ strategy: id, reason: "Validator: " + v.votes.filter((x) => !x.pass).map((x) => x.note).join("; ") }); return; }
      sig.why.push("Validator agreed" + (v.roomR !== null ? ` (${v.roomR.toFixed(1)}R of room)` : ""));
    }
    signals.push(sig);
  };
  for (const id of STRATEGIES) {
    if (off(id)) { rejects.push({ strategy: id, reason: "Strategy switched off" }); continue; }
    if (!S && (id === "D_BEARTRAP" || id === "D_THRUST" || id === "HTF_SWEEP" || id === "EMA_CROSS" || id === "SSR" || id === "EMA_PB")) continue;
    const sig = RUNNERS[id](s, S as Series, rejects);
    if (sig) admit(id, sig);
  }
  if (CFG.REENTRY.on && st?.reentry && S && !st.pos && !off(st.reentry.strategy)) {
    const sig = sReentry(s, S, st, rejects);
    if (sig) admit(sig.strategy, sig);
  }
  signals.sort((a, b) => b.score - a.score);
  return { signals, rejects };
}

// ═══════════════════════════ STATE / ACCOUNTING ═════════════════════════════
export type Exit = { kind: "tp1" | "tp2" | "tp3" | "stop" | "time" | "manual"; px: number; qty: number; pnl: number; fee: number; t: number };
export type Position = {
  id: string; strategy: StrategyId; dir: Dir; entry: number; stop: number; stop0: number;
  tp1: number; tp2: number; tp3: number; originalQty: number; remainingQty: number; closedQty: number;
  riskAmt: number; entryFee: number; fundingPaid: number; exits: Exit[];
  tp1Done: boolean; tp2Done: boolean; tp3Done: boolean; openT: number; lastFundT: number; maxHoldH: number;
  plan?: { t: number; msg: string }[]; planned?: boolean;
  reN?: number; bodyStop?: boolean; // re-entry chain depth; stop came from the candle-body rule
  score: number; why: string[]; regime: string;
};
export type Trade = {
  id: string; strategy: StrategyId; dir: Dir; entry: number; exitAvg: number; stop0: number;
  originalQty: number; riskAmt: number; gross: number; fees: number; funding: number; net: number; r: number;
  openT: number; closeT: number; reason: string; exits: Exit[]; score: number; why: string[]; regime: string;
};
export type Stat = { n: number; wins: number; losses: number; sumR: number; grossWin: number; grossLoss: number; net: number };
export type State = {
  version: string; schema: 1; equity: number; startEquity: number; peak: number; maxDD: number;
  markedEquity?: number;
  carried?: Record<string, unknown>; pos: Position | null; lastBarT: number; lastEvalT: number;
  lastSig: Record<string, number>; day: { date: string; startEquity: number; trades: number; pnl: number; halted?: boolean };
  cb: { consec: number; cooldownUntil: number; trips: number };
  stats: { all: Stat; by: Record<string, Stat> };
  enabled: Record<string, boolean>; created: number;
  reentry?: { strategy: StrategyId; dir: Dir; level: number; t: number; n: number } | null; // armed by a losing stop-out (REENTRY)
  cfg?: Partial<typeof CFG>; // live overrides chosen from backtests (applied each run)
};

const emptyStat = (): Stat => ({ n: 0, wins: 0, losses: 0, sumR: 0, grossWin: 0, grossLoss: 0, net: 0 });
export function initState(equity: number, now: number, carried?: Record<string, unknown>): State {
  const by: Record<string, Stat> = {}; const enabled: Record<string, boolean> = {};
  for (const s of STRATEGIES) { by[s] = emptyStat(); enabled[s] = true; }
  return {
    version: VERSION, schema: 1, equity, markedEquity: equity, startEquity: equity, peak: equity, maxDD: 0, carried, pos: null,
    lastBarT: now, lastEvalT: 0, lastSig: {}, day: { date: dayKey(now), startEquity: equity, trades: 0, pnl: 0 },
    cb: { consec: 0, cooldownUntil: 0, trips: 0 }, stats: { all: emptyStat(), by }, enabled, created: now,
  };
}
export const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
// forward-compatible state: add slots for strategies introduced after the state was created
export function ensureState(st: State): State {
  for (const id of STRATEGIES) { st.stats.by[id] ??= emptyStat(); if (st.enabled[id] === undefined) st.enabled[id] = true; }
  st.lastSig ??= {}; st.cb ??= { consec: 0, cooldownUntil: 0, trips: 0 };
  return st;
}

export function rollDay(st: State, t: number) {
  const k = dayKey(t); if (k > st.day.date) st.day = { date: k, startEquity: st.markedEquity ?? st.equity, trades: 0, pnl: 0, halted: false };
}

// Sampled marked equity (bar closes/live snapshot), not a tick-level drawdown claim.
// Existing history cannot be reconstructed from legacy realized-only state.
export function markEquity(st: State, px: number): number {
  const value = st.equity + unrealized(st.pos, px);
  if (!Number.isFinite(value)) throw new Error("Invalid equity mark");
  st.markedEquity = value;
  st.peak = Math.max(st.peak, value);
  if (st.peak > 0) st.maxDD = Math.max(st.maxDD, (st.peak - value) / st.peak);
  if (value <= st.day.startEquity * (1 - CFG.DAILY_LOSS_LIMIT)) st.day.halted = true;
  return value;
}

export function riskMultiplier(st: State, id: StrategyId): number {
  const s = st.stats.by[id]; if (!s || s.n < CFG.PROBATION_MIN_TRADES) return 1;
  const exp = s.sumR / s.n; return exp < 0 ? 0.5 : 1;
}

export function updateProbation(st: State) {
  for (const id of STRATEGIES) {
    const s = st.stats.by[id];
    if (s && s.n >= CFG.DISABLE_MIN_TRADES && s.sumR / s.n < CFG.DISABLE_EXPECTANCY_R) st.enabled[id] = false;
  }
}

export type GateResult = { ok: true } | { ok: false; reason: string };
export function entryGates(st: State, sig: Signal, t: number): GateResult {
  if (st.pos) return { ok: false, reason: "Position already open" };
  if (sig.score < CFG.MIN_SCORE) return { ok: false, reason: `Score ${sig.score} < ${CFG.MIN_SCORE}` };
  if (st.cb.cooldownUntil > t) return { ok: false, reason: `Circuit-breaker cooldown until ${new Date(st.cb.cooldownUntil).toISOString().slice(11, 16)} UTC` };
  rollDay(st, t);
  if (st.day.trades >= CFG.MAX_TRADES_PER_DAY) return { ok: false, reason: "Daily trade cap reached" };
  if (st.day.halted || (st.markedEquity ?? st.equity) <= st.day.startEquity * (1 - CFG.DAILY_LOSS_LIMIT)) return { ok: false, reason: "Daily marked loss limit hit" };
  if ((st.lastSig[sig.strategy] ?? 0) >= sig.barT) return { ok: false, reason: "Signal already acted on" };
  if (sig.reentry && sig.score < CFG.REENTRY.minScore) return { ok: false, reason: `Re-entry needs score ≥ ${CFG.REENTRY.minScore} (got ${sig.score})` };
  return { ok: true };
}

// Open at fillRef (market, taker + slippage). Size so a full stop-out ≈ riskAmt incl. costs.
export function openPosition(st: State, sig: Signal, fillRef: number, t: number): Position | null {
  const d = sgn(sig.dir);
  const entry = fillRef * (1 + d * CFG.SLIPPAGE);
  if ((sig.stop - entry) * d >= 0) return null; // price already through stop
  const minStop = Math.max(CFG.MIN_STOP_PCT, CFG.MIN_STOP_BY[sig.strategy] ?? 0);
  if (!sig.bodyStop && minStop > 0 && Math.abs(entry - sig.stop) < minStop * entry) sig = { ...sig, stop: entry - d * minStop * entry };
  const stopDist = Math.abs(entry - sig.stop);
  if ((entry * (2 * CFG.TAKER_FEE + 2 * CFG.SLIPPAGE)) / stopDist > CFG.MAX_COST_R) return null;
  const costPerUnit = entry * CFG.TAKER_FEE + sig.stop * (CFG.TAKER_FEE + CFG.SLIPPAGE);
  const riskAmt = st.equity * dynamicRisk(st.equity) * riskMultiplier(st, sig.strategy) * (CFG.RISK_SCALE[sig.strategy] ?? 1);
  let qty = riskAmt / (stopDist + costPerUnit);
  const maxQty = (st.equity * CFG.MAX_LEVERAGE) / entry; if (qty > maxQty) qty = maxQty;
  if (!(qty > 0)) return null;
  const T = CFG.TARGETS[sig.strategy], R = stopDist;
  const entryFee = qty * entry * CFG.TAKER_FEE;
  st.equity -= entryFee;
  const p: Position = {
    id: `V5-${t}`, strategy: sig.strategy, dir: sig.dir, entry, stop: sig.stop, stop0: sig.stop,
    tp1: entry + d * T.tp1 * R, tp2: entry + d * T.tp2 * R, tp3: entry + d * T.tp3 * R,
    originalQty: qty, remainingQty: qty, closedQty: 0, riskAmt, entryFee, fundingPaid: 0, exits: [],
    tp1Done: false, tp2Done: false, tp3Done: false, openT: t, lastFundT: t, maxHoldH: T.maxHoldH,
    score: sig.score, why: sig.why, regime: sig.regime, reN: sig.reentry ? (st.reentry?.n ?? 0) : 0, bodyStop: !!sig.bodyStop,
  };
  st.pos = p; st.lastSig[sig.strategy] = sig.barT; rollDay(st, t); st.day.trades++;
  markEquity(st, entry);
  return p;
}

const CUM = { tp1: 0.5, tp2: 0.75, tp3: 1 };
function fill(st: State, kind: Exit["kind"], px: number, t: number): Trade | null {
  const p = st.pos!; const d = sgn(p.dir);
  let qty: number;
  if (kind === "tp1" || kind === "tp2" || kind === "tp3") {
    const flag = (kind + "Done") as "tp1Done"; if (p[flag]) return null;
    qty = p.originalQty * CUM[kind] - p.closedQty; p[flag] = true;
  } else qty = p.remainingQty;
  qty = Math.max(0, Math.min(qty, p.remainingQty));
  const isTP = kind.startsWith("tp");
  const fillPx = isTP ? px : px * (1 - d * CFG.SLIPPAGE);
  const fee = qty * fillPx * (isTP ? CFG.MAKER_FEE : CFG.TAKER_FEE);
  const pnl = (fillPx - p.entry) * d * qty;
  p.remainingQty -= qty; p.closedQty += qty;
  p.exits.push({ kind, px: fillPx, qty, pnl, fee, t });
  st.equity += pnl - fee;
  if (CFG.EXIT_MODE === "BE_AT_TP1") {
    if (kind === "tp1") p.stop = p.entry;         // breakeven
    if (kind === "tp2") p.stop = p.tp1;           // lock TP1 on the runner
  } else if (kind === "tp2") p.stop = p.entry;    // HOLD: original stop until TP2, then breakeven
  if (p.remainingQty <= p.originalQty * 1e-9) return finalize(st, t, kind);
  return null;
}

function finalize(st: State, t: number, lastKind: string): Trade {
  const p = st.pos!;
  const gross = p.exits.reduce((a, e) => a + e.pnl, 0), fees = p.entryFee + p.exits.reduce((a, e) => a + e.fee, 0);
  const net = gross - fees - p.fundingPaid, r = p.riskAmt > 0 ? net / p.riskAmt : 0;
  const exitAvg = p.exits.reduce((a, e) => a + e.px * e.qty, 0) / p.originalQty;
  const reason = p.exits.map(e => e.kind.toUpperCase()).join("→") + (lastKind === "stop" && p.stop !== p.stop0 ? " (BE/locked)" : "");
  const tr: Trade = {
    id: p.id, strategy: p.strategy, dir: p.dir, entry: p.entry, exitAvg, stop0: p.stop0, originalQty: p.originalQty,
    riskAmt: p.riskAmt, gross, fees, funding: p.fundingPaid, net, r, openT: p.openT, closeT: t, reason,
    exits: p.exits, score: p.score, why: p.why, regime: p.regime,
  };
  for (const s of [st.stats.all, st.stats.by[p.strategy]]) {
    s.n++; s.sumR += r; s.net += net;
    if (net > 0) { s.wins++; s.grossWin += net; } else { s.losses++; s.grossLoss += -net; }
  }
  if (net > 0) st.cb.consec = 0;
  else { st.cb.consec++; if (st.cb.consec >= CFG.CB_LOSSES) { st.cb.cooldownUntil = t + CFG.CB_COOLDOWN_MS; st.cb.trips++; st.cb.consec = 0; } }
  rollDay(st, t); st.day.pnl += net;
  st.peak = Math.max(st.peak, st.equity); st.maxDD = Math.max(st.maxDD, (st.peak - st.equity) / st.peak);
  // arm / clear the re-entry agent: only a losing stop-out arms it; anything else ends the chain
  if (CFG.REENTRY.on && lastKind === "stop" && net < 0 && !p.tp1Done) st.reentry = { strategy: p.strategy, dir: p.dir, level: p.stop, t, n: (p.reN ?? 0) + 1 };
  else if (st.reentry) st.reentry = null;
  st.pos = null; updateProbation(st);
  return tr;
}

// Walk bars (1m live / 5m backtest) after the position opened. Stop-first when a bar
// touches both stop and a target (conservative). Returns closed trades.
export function managePosition(st: State, bars: Bar[], fundingPerHour: number | null): Trade[] {
  const out: Trade[] = [];
  for (const raw of bars) {
    const p = st.pos; if (!p) break;
    if (raw.ct <= p.openT) continue;
    // A candle straddling entry contains unknowable PRE-entry extremes. Only its
    // closing observation is available after entry; never use the earlier range.
    const b = raw.t < p.openT ? { ...raw, o: raw.c, h: raw.c, l: raw.c } : raw;
    rollDay(st, b.t);
    // funding accrual per elapsed hour on remaining notional (signed rate; null → backtest cost)
    while (b.ct - p.lastFundT >= 3600_000) {
      p.lastFundT += 3600_000;
      const rate = fundingPerHour == null ? CFG.BT_FUNDING_PER_HOUR : fundingPerHour * sgn(p.dir);
      const cost = p.remainingQty * b.c * rate; p.fundingPaid += cost; st.equity -= cost;
    }
    const d = sgn(p.dir);
    const hitStop = d === 1 ? b.l <= p.stop : b.h >= p.stop;
    if (hitStop) { const gapPx = d === 1 ? Math.min(p.stop, b.o) : Math.max(p.stop, b.o); const tr = fill(st, "stop", gapPx, b.ct); if (tr) out.push(tr); markEquity(st, b.c); continue; }
    for (const k of ["tp1", "tp2", "tp3"] as const) {
      const cur = st.pos; if (!cur) break;
      if (!cur[(k + "Done") as "tp1Done"] && (d === 1 ? b.h >= cur[k] : b.l <= cur[k])) {
        const oldStop = cur.stop;
        const tr = fill(st, k, cur[k], b.ct); if (tr) out.push(tr);
        const remaining = st.pos;
        // OHLC cannot order a target and a newly activated stop. Resolve the
        // remaining quantity adversely before awarding any later target.
        if (remaining && remaining.stop !== oldStop && (d === 1 ? b.l <= remaining.stop : b.h >= remaining.stop)) {
          const stopped = fill(st, "stop", remaining.stop, b.ct); if (stopped) out.push(stopped);
          break;
        }
      }
    }
    const cur = st.pos;
    if (cur && b.ct - cur.openT >= cur.maxHoldH * 3600_000) { const tr = fill(st, "time", b.c, b.ct); if (tr) out.push(tr); }
    markEquity(st, b.c);
  }
  return out;
}

export function unrealized(p: Position | null, px: number): number {
  if (!p) return 0; return (px - p.entry) * sgn(p.dir) * p.remainingQty;
}

// ═══════════════════════════ BACKTEST ═══════════════════════════════════════
// Walk-forward over 5m closes using ONLY data closed at each step. Entries fill at
// the NEXT 5m bar open. Position path uses 5m high/low (stop-first). Funding and
// F&G history are not available here → context terms neutral, funding charged as cost.
export function backtest(f: Frames, opts: { startEquity?: number; only?: StrategyId; warmupBars?: number; cfg?: Partial<typeof CFG> } = {}) {
  const saved = { ...CFG }; if (opts.cfg) Object.assign(CFG, overlayNested(CFG, opts.cfg));
  try { return backtestInner(f, opts); } finally { Object.assign(CFG, saved); }
}
function backtestInner(f: Frames, opts: { startEquity?: number; only?: StrategyId; warmupBars?: number }) {
  const S = buildSeries(f);
  const st = initState(opts.startEquity ?? 1000, f.m5[0].t);
  const trades: Trade[] = []; const curve: [number, number][] = [];
  const signalsSeen: Record<string, number> = {};
  const start = Math.max(opts.warmupBars ?? 300, 60);
  for (let i = start; i < f.m5.length - 1; i++) {
    const b = f.m5[i];
    if (st.pos) trades.push(...managePosition(st, [b], null));
    if (st.pos && CFG.TRADER) { const sn = snapshot(S, i), r = traderManage(st, sn, S, { st: sn.st5, bos: sn.st5, c: b.c }, b.c, b.ct); if (r.closed) trades.push(r.closed); }
    const sampledEquity = markEquity(st, b.c);
    if (!st.pos) {
      const snap = snapshot(S, i);
      const { signals } = evaluate(snap, opts.only ? Object.fromEntries(STRATEGIES.map(s => [s, s === opts.only])) : st.enabled, S, st);
      for (const sig of signals) {
        signalsSeen[sig.strategy] = (signalsSeen[sig.strategy] ?? 0) + 1;
        const g = entryGates(st, sig, b.ct); if (!g.ok) continue;
        openPosition(st, sig, f.m5[i + 1].o, f.m5[i + 1].t); break;
      }
    }
    if (i % 12 === 0) curve.push([b.ct, +sampledEquity.toFixed(2)]);
  }
  const last = f.m5[f.m5.length - 1];
  if (st.pos) trades.push(...managePosition(st, [last], null));
  if (st.pos) { const tr = fill(st, "manual", last.c, last.ct); if (tr) trades.push(tr); }
  markEquity(st, last.c);
  return { state: st, trades, curve, signalsSeen, from: f.m5[start]?.t, to: f.m5[f.m5.length - 1].ct, bars: f.m5.length };
}

export function summarize(trades: Trade[], startEquity: number) {
  const by: Record<string, Stat & { expR: number; pf: number; wr: number }> = {};
  const all = emptyStat();
  for (const t of trades) {
    for (const s of [all, (by[t.strategy] ??= { ...emptyStat(), expR: 0, pf: 0, wr: 0 })]) {
      s.n++; s.sumR += t.r; s.net += t.net; if (t.net > 0) { s.wins++; s.grossWin += t.net; } else { s.losses++; s.grossLoss -= t.net; }
    }
  }
  const fin = (s: Stat) => ({ ...s, expR: s.n ? s.sumR / s.n : 0, pf: s.grossLoss > 0 ? s.grossWin / s.grossLoss : (s.grossWin > 0 ? Infinity : 0), wr: s.n ? s.wins / s.n : 0 });
  let eq = startEquity, peak = startEquity, mdd = 0;
  for (const t of trades) { eq += t.net; peak = Math.max(peak, eq); mdd = Math.max(mdd, (peak - eq) / peak); }
  return { all: fin(all), by: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, fin(v)])), maxDD: mdd, endEquity: eq };
}

// ─── v5.7 trade manager ("think like a trader") ─────────────────────────────────────────────────
// Runs every check while a position is open. Deterministic, logged, never widens a stop, never changes size.
//  1. Structure stop: once the trade is not losing, pull an oversized stop to the 1H swing that invalidates it
//     (never tighter than the strategy's MIN_STOP_BY floor or 1.5×ATR15 from price).
//  2. Realistic targets: re-base TP ladder on the current stop distance, and front-run the nearest liquidity
//     level (Asian/prior-day high-low, 1H swing, VWAP, POC). Targets only ever move closer.
//  3. 1m reversal guard: ≥60% of the way to TP1 and the 1m SuperTrend + structure turn against → stop to breakeven.
//  4. Stall exit: half the max hold gone, <20% progress to TP1, and 5m + 1m trend against → close at market.
export function closeNow(st: State, px: number, t: number): Trade | null { return st.pos ? fill(st, "manual", px, t) : null; }
export type M1View = { st: number; bos: number; c: number } | null;
export function m1View(m1: Bar[]): M1View {
  if (m1.length < 40) return null;
  const s = stSeries(m1, 10, 3).dir, b = bosSeries(m1, 2), n = m1.length - 1;
  return { st: s[n], bos: b[n], c: m1[n].c };
}
export function liquidityLevels(s: Snap, S: Series): { px: number; name: string }[] {
  const out: { px: number; name: string }[] = [];
  if (s.asian) out.push({ px: s.asian.hi, name: "Asian high" }, { px: s.asian.lo, name: "Asian low" });
  if (s.i1d >= 0) { const d = S.d1[s.i1d]; out.push({ px: d.h, name: "prior-day high" }, { px: d.l, name: "prior-day low" }); }
  const h = S.f.h1, i = s.i1h;
  for (let c = i - 2; c >= Math.max(2, i - 48); c--) {
    if (h[c].h > h[c - 1].h && h[c].h > h[c - 2].h && h[c].h > h[c + 1].h && h[c].h > h[c + 2].h) out.push({ px: h[c].h, name: "1H swing high" });
    if (h[c].l < h[c - 1].l && h[c].l < h[c - 2].l && h[c].l < h[c + 1].l && h[c].l < h[c + 2].l) out.push({ px: h[c].l, name: "1H swing low" });
  }
  if (isFinite(s.vwap)) out.push({ px: s.vwap, name: "VWAP" });
  if (isFinite(s.poc)) out.push({ px: s.poc, name: "1H POC" });
  return out.filter((l) => isFinite(l.px));
}
export function traderManage(st: State, s: Snap, S: Series, m1: M1View, px: number, t: number): { acts: string[]; closed: Trade | null } {
  const p = st.pos, acts: string[] = [];
  if (!p || !CFG.TRADER) return { acts, closed: null };
  const d = sgn(p.dir), say = (m: string) => { acts.push(m); (p.plan ??= []).push({ t, msg: m }); if (p.plan.length > 12) p.plan.shift(); };
  const atr15 = s.atr15, i1h = s.i1h, atr1h = i1h >= 0 ? S.atr1h[i1h] : NaN;
  if (!isFinite(atr15) || !isFinite(atr1h)) return { acts, closed: null };
  const fmt = (x: number) => x.toFixed(x > 1000 ? 0 : 1), on = (k: string) => CFG.TRADER_PARTS.split(",").includes(k);
  if (!p.tp1Done) {
    // 1. structure stop
    const R = Math.abs(p.entry - p.stop), prog = (px - p.entry) * d;
    if (on("stop") && prog > -0.25 * R) {
      let ext = d === 1 ? Infinity : -Infinity;
      for (let j = i1h; j >= Math.max(0, i1h - 5); j--) ext = d === 1 ? Math.min(ext, S.f.h1[j].l) : Math.max(ext, S.f.h1[j].h);
      const floor = Math.max(CFG.MIN_STOP_PCT, CFG.MIN_STOP_BY[p.strategy] ?? 0) * p.entry;
      let ns = ext - d * 0.25 * atr1h;
      if ((p.entry - ns) * d < floor) ns = p.entry - d * floor;
      if ((px - ns) * d < 1.5 * atr15) ns = px - d * 1.5 * atr15;
      if ((ns - p.stop) * d > 0.1 * atr15 && (px - ns) * d > 0) { say(`Stop tightened ${fmt(p.stop)} → ${fmt(ns)} (1H structure; risk now ${fmt(Math.abs(p.entry - ns))} pts)`); p.stop = ns; }
    }
    // 2. realistic targets
    const R2 = Math.abs(p.entry - p.stop), T = CFG.TARGETS[p.strategy];
    let t1 = p.entry + d * T.tp1 * R2, t2 = p.entry + d * T.tp2 * R2, t3 = p.entry + d * T.tp3 * R2, why = `${T.tp1}R of current stop`;
    const lv = liquidityLevels(s, S).filter((l) => (l.px - px) * d > 0.5 * atr15 && (l.px - p.entry) * d >= 0.8 * T.tp1 * R2).sort((a, b) => (a.px - b.px) * d);
    if (lv[0] && (lv[0].px - p.entry) * d <= 1.6 * T.tp1 * R2) { t1 = lv[0].px - d * 0.15 * atr15; why = `front-runs ${lv[0].name} ${fmt(lv[0].px)}`; }
    if ((t2 - t1) * d < 0) t2 = t1; if ((t3 - t2) * d < 0) t3 = t2;
    const closer = (n: number, o: number) => (o - n) * d > 0.1 * atr15;
    if (on("targets") && closer(t1, p.tp1)) { say(`TP1 ${fmt(p.tp1)} → ${fmt(t1)} (${why})`); p.tp1 = t1; }
    if (on("targets") && closer(t2, p.tp2) && !p.tp2Done) { p.tp2 = t2; } if (on("targets") && closer(t3, p.tp3) && !p.tp3Done) { p.tp3 = t3; }
    // 3. 1m reversal guard
    const toTp1 = Math.abs(p.tp1 - p.entry), done = toTp1 > 0 ? ((px - p.entry) * d) / toTp1 : 0;
    const be = p.entry + d * p.entry * (CFG.TAKER_FEE * 2 + CFG.SLIPPAGE);
    if (on("be") && m1 && done >= 0.6 && m1.st === -d && m1.bos === -d && (be - p.stop) * d > 0 && (px - be) * d > 0.3 * atr15) { say(`1m turned against at ${(done * 100).toFixed(0)}% to TP1 — stop to breakeven ${fmt(be)}`); p.stop = be; }
    // 4. stall exit
    const held = (t - p.openT) / 3600_000;
    if (on("stall") && held >= 0.5 * p.maxHoldH && done < 0.2 && s.st5 === -d && (!m1 || m1.st === -d)) { say(`No follow-through after ${held.toFixed(1)}h (${(done * 100).toFixed(0)}% to TP1, 5m${m1 ? "+1m" : ""} against) — closing`); return { acts, closed: closeNow(st, px, t) }; }
  }
  return { acts, closed: null };
}
