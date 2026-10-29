// Chart indicators for the dashboard (display only; the trading engine computes its own in engine.ts).
// Ported from OpenTerminal web/lib/indicators.ts, MIT License, Copyright (c) 2026 OpenTerminal contributors
// (https://github.com/ErTasselli/OpenTerminal). Changes: plain JS, candles as {time, open, high, low, close, volume},
// rolling-sum Bollinger (same result, O(n)).
(function (root) {
  'use strict';
  function sma(c, period) {
    const out = []; let sum = 0;
    for (let i = 0; i < c.length; i++) { sum += c[i].close; if (i >= period) sum -= c[i - period].close; if (i >= period - 1) out.push({ time: c[i].time, value: sum / period }); }
    return out;
  }
  function ema(c, period) {
    const out = [], k = 2 / (period + 1); let prev = null;
    for (const x of c) { prev = prev === null ? x.close : x.close * k + prev * (1 - k); out.push({ time: x.time, value: prev }); }
    return out.slice(period - 1);
  }
  function vwap(c) {
    const out = []; let pv = 0, v = 0;
    for (const x of c) { pv += ((x.high + x.low + x.close) / 3) * (x.volume || 0); v += x.volume || 0; if (v > 0) out.push({ time: x.time, value: pv / v }); }
    return out;
  }
  function rsi(c, period = 14) {
    const out = []; let g = 0, l = 0;
    for (let i = 1; i < c.length; i++) {
      const d = c[i].close - c[i - 1].close, gain = Math.max(d, 0), loss = Math.max(-d, 0);
      if (i <= period) { g += gain / period; l += loss / period; if (i === period) out.push({ time: c[i].time, value: l === 0 ? 100 : 100 - 100 / (1 + g / l) }); }
      else { g = (g * (period - 1) + gain) / period; l = (l * (period - 1) + loss) / period; out.push({ time: c[i].time, value: l === 0 ? 100 : 100 - 100 / (1 + g / l) }); }
    }
    return out;
  }
  function macd(c, fast = 12, slow = 26, signal = 9) {
    const all = (p) => { const k = 2 / (p + 1), v = []; let prev = null; for (const x of c) { prev = prev === null ? x.close : x.close * k + prev * (1 - k); v.push(prev); } return v; };
    const f = all(fast), s = all(slow);
    const line = c.map((x, i) => ({ time: x.time, value: f[i] - s[i] })).slice(slow - 1);
    const k = 2 / (signal + 1); let prev = null;
    const sig = line.map((p) => { prev = prev === null ? p.value : p.value * k + prev * (1 - k); return { time: p.time, value: prev }; });
    return { macd: line, signal: sig, histogram: line.map((p, i) => ({ time: p.time, value: p.value - sig[i].value })) };
  }
  function bollinger(c, period = 20, mult = 2) {
    const upper = [], middle = [], lower = []; let s = 0, s2 = 0;
    for (let i = 0; i < c.length; i++) {
      s += c[i].close; s2 += c[i].close * c[i].close;
      if (i >= period) { s -= c[i - period].close; s2 -= c[i - period].close * c[i - period].close; }
      if (i >= period - 1) { const m = s / period, sd = Math.sqrt(Math.max(0, s2 / period - m * m)); middle.push({ time: c[i].time, value: m }); upper.push({ time: c[i].time, value: m + mult * sd }); lower.push({ time: c[i].time, value: m - mult * sd }); }
    }
    return { upper, middle, lower };
  }
  const api = { sma, ema, vwap, rsi, macd, bollinger };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DeskIndicators = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
