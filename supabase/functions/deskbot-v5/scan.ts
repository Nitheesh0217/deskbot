// DeskBot multi-market scanner + derivatives context. READ-ONLY: it never opens, sizes or manages a position.
// scanMarket runs the bot's own deterministic strategies (engine.evaluate) on one market with a FRESH state, so it shows what the
// rules would say there right now. The strategies were tuned on BTC (and gold); on other markets they are untested, which is stated
// in every scan. Nothing here is a prediction or a probability: a "setup" is a rule firing, a "context" is a measured fact.
// Derivatives: Deribit public API (no key). Options: DVOL, put/call open interest, max pain of the nearest expiry, OTM put-minus-call
// IV skew. Futures: annualised basis per expiry. Parsers are pure so they are unit-tested on fixtures.
import { buildSeries, snapshot, evaluate, initState, ensureState, type Bar } from "./engine.ts";

export type Frames = { m5: Bar[]; m15: Bar[]; h1: Bar[]; h4: Bar[] };
export type MarketCtx = { funding: number; oi: number; markPx: number; premium: number } | null;
const r = (x: number, d = 2) => (Number.isFinite(x) ? +x.toFixed(d) : null);

// CALL-1 (frozen 29 Oct 2026, before any call was scored): one directional call per market per scan, 4-hour horizon.
//   votes = SuperTrend direction on 15m + 1h + 4h (each +1 / -1) + VWAP side (+1 above +0.5σ, -1 below -0.5σ): range -4..+4.
//   If a strategy fired, the call is that setup's direction ("rules setup"). Otherwise LONG at votes >= +3, SHORT at <= -3, else NO CALL.
//   Cautions (shown, never change the call): RSI15 stretched in the call's direction; funding crowded in the call's direction.
// Every call is scored 4 hours later on the price move (track.ts). It is a rule-based lean, not a probability or a price target.
export const CALL_HORIZON_H = 4;
export type Call = { lean: "LONG" | "SHORT" | "NONE"; votes: number; source: "rules setup" | "trend vote" | "none"; cautions: string[]; t: number; px: number; atr: number };
export function marketCall(s: { T: number; price: number; atr15: number; st15: number; st1h: number; st4h: number; vwapDev: number; rsi15: number }, setups: { dir: string; score: number }[], funding: number | null): Call {
  const sg = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
  const votes = sg(s.st15) + sg(s.st1h) + sg(s.st4h) + (s.vwapDev > 0.5 ? 1 : s.vwapDev < -0.5 ? -1 : 0);
  const best = [...setups].sort((a, b) => b.score - a.score)[0];
  const lean: Call["lean"] = best ? (best.dir === "long" ? "LONG" : "SHORT") : votes >= 3 ? "LONG" : votes <= -3 ? "SHORT" : "NONE";
  const cautions: string[] = [];
  if (lean === "LONG" && s.rsi15 >= 75) cautions.push(`RSI15 ${s.rsi15.toFixed(0)}: stretched up`);
  if (lean === "SHORT" && s.rsi15 <= 25) cautions.push(`RSI15 ${s.rsi15.toFixed(0)}: stretched down`);
  if (funding != null && lean === "LONG" && funding >= 0.0001) cautions.push("longs crowded (funding)");
  if (funding != null && lean === "SHORT" && funding <= -0.0001) cautions.push("shorts crowded (funding)");
  return { lean, votes, source: best ? "rules setup" : lean === "NONE" ? "none" : "trend vote", cautions, t: s.T, px: s.price, atr: s.atr15 };
}

export function scanMarket(sym: string, f: Frames, ctx: MarketCtx, now: number) {
  if (f.m5.length < 300 || f.m15.length < 100 || f.h1.length < 60 || f.h4.length < 60) return { sym, ok: false as const, error: "not enough history" };
  const S = buildSeries(f), i5 = f.m5.length - 1;
  const s = snapshot(S, i5, { funding: ctx?.funding ?? null, oi: ctx?.oi ?? null, markPx: ctx?.markPx ?? null, fng: null });
  const st = ensureState(initState(1000, now));
  st.lastEvalT = 0;
  const { signals, rejects } = evaluate(s, st.enabled, S, st);
  const h1 = f.h1, last = h1[h1.length - 1].c, d1 = h1.length > 24 ? h1[h1.length - 25].c : NaN;
  const trend = [s.st15, s.st1h, s.st4h], up = trend.filter((x) => x === 1).length, dn = trend.filter((x) => x === -1).length;
  const align = up === 3 ? "up on 15m/1h/4h" : dn === 3 ? "down on 15m/1h/4h" : "mixed";
  const why: string[] = [];
  if (Number.isFinite(s.rsi15) && s.rsi15 >= 75) why.push(`RSI15 ${s.rsi15.toFixed(0)} (stretched up)`);
  if (Number.isFinite(s.rsi15) && s.rsi15 <= 25) why.push(`RSI15 ${s.rsi15.toFixed(0)} (stretched down)`);
  if (Math.abs(s.vwapDev) >= 2) why.push(`${s.vwapDev.toFixed(1)}σ from VWAP`);
  if (ctx && Math.abs(ctx.funding) >= 0.0001) why.push(`funding ${(ctx.funding * 100).toFixed(4)}%/h (${ctx.funding > 0 ? "longs" : "shorts"} paying)`);
  // switched-off strategies (configuration) and "waits for a later close" (timing) are not market information: left out of the summary
  const reasons = new Map<string, number>(); for (const x of rejects) if (!/switched off|^waits for/i.test(x.reason)) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1);
  return {
    sym, ok: true as const, barT: s.T, price: r(s.price, s.price > 100 ? 2 : 5), chg24h: r(((last - d1) / d1) * 100, 2), regime: s.regime, trend: align,
    rsi15: r(s.rsi15, 1), rsi1h: r(s.rsi1h, 1), chop15: r(s.chop15, 1), atr15Pct: r((s.atr15 / s.price) * 100, 3), vwapDev: r(s.vwapDev, 2),
    funding: ctx ? ctx.funding : null, oi: ctx ? r(ctx.oi, 0) : null, notes: why,
    setups: signals.slice(0, 4).map((g) => ({ strategy: g.strategy, dir: g.dir, entry: r(g.entryRef, 5), stop: r(g.stop, 5), stopPct: r((Math.abs(g.entryRef - g.stop) / g.entryRef) * 100, 3), score: r(g.score, 2), why: g.why.slice(0, 4) })),
    blocked: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, n]) => ({ reason: reason.slice(0, 80), n })),
    call: marketCall(s, signals, ctx ? ctx.funding : null),
  };
}
export type ScanRow = ReturnType<typeof scanMarket>;

/** Rank: markets where a rule fired first (by its own score), then aligned trends, then the rest. Ordering, not a forecast. */
export function rankScan(rows: ScanRow[]) {
  const key = (x: ScanRow) => !x.ok ? -1e9 : x.setups.length ? 1e6 + Math.max(...x.setups.map((g) => g.score ?? 0)) : x.trend !== "mixed" ? 1e3 + Math.abs(x.chg24h ?? 0) : Math.abs(x.chg24h ?? 0);
  return [...rows].sort((a, b) => key(b) - key(a));
}

// ─── Deribit (options + futures) ────────────────────────────────────────────
type Summ = { instrument_name: string; open_interest?: number; mark_iv?: number; underlying_price?: number; mark_price?: number; estimated_delivery_price?: number; volume_usd?: number };
const MON: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
/** "27DEC26" -> 08:00 UTC that day (Deribit expiry time) */
export function expiryMs(code: string): number | null {
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(code); if (!m || !(m[2] in MON)) return null;
  return Date.UTC(2000 + +m[3], MON[m[2]], +m[1], 8);
}
export function parseOptions(rows: Summ[], now: number) {
  const opts = rows.map((x) => { const p = x.instrument_name.split("-"); return p.length === 4 ? { exp: p[1], t: expiryMs(p[1]), k: +p[2], cp: p[3] as "C" | "P", oi: x.open_interest ?? 0, iv: x.mark_iv ?? NaN, u: x.underlying_price ?? NaN } : null; })
    .filter((x): x is NonNullable<typeof x> => !!x && x.t !== null && x.t > now && Number.isFinite(x.k));
  if (!opts.length) return null;
  const callOI = opts.filter((o) => o.cp === "C").reduce((a, o) => a + o.oi, 0), putOI = opts.filter((o) => o.cp === "P").reduce((a, o) => a + o.oi, 0);
  const nearT = Math.min(...opts.map((o) => o.t as number)), near = opts.filter((o) => o.t === nearT), u = near.find((o) => Number.isFinite(o.u))?.u ?? NaN;
  // max pain: the strike at which option holders' total intrinsic value at expiry is smallest
  const strikes = [...new Set(near.map((o) => o.k))].sort((a, b) => a - b);
  let maxPain: number | null = null, best = Infinity;
  for (const s of strikes) { const pay = near.reduce((a, o) => a + o.oi * (o.cp === "C" ? Math.max(0, s - o.k) : Math.max(0, o.k - s)), 0); if (pay < best) { best = pay; maxPain = s; } }
  // nearest expiry at least 2 days out for the IV read (the front contract's IV is noisy near expiry). Deribit quotes one IV per strike,
  // so skew is read across strikes: out-of-the-money puts (strike 88–96% of spot) minus out-of-the-money calls (104–112%), in vol points.
  const ivT = Math.min(...opts.filter((o) => (o.t as number) - now > 2 * 86400_000).map((o) => o.t as number)), ivSet = opts.filter((o) => o.t === ivT && Number.isFinite(o.iv) && Number.isFinite(o.u));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN), m = (o: { k: number; u: number }) => o.k / o.u;
  const atm = avg(ivSet.filter((o) => Math.abs(m(o) - 1) <= 0.02).map((o) => o.iv));
  const pIV = avg(ivSet.filter((o) => o.cp === "P" && m(o) >= 0.88 && m(o) <= 0.96).map((o) => o.iv)), cIV = avg(ivSet.filter((o) => o.cp === "C" && m(o) >= 1.04 && m(o) <= 1.12).map((o) => o.iv));
  const byStrike = new Map<number, number>(); for (const o of opts) byStrike.set(o.k, (byStrike.get(o.k) ?? 0) + o.oi);
  return {
    putCallOI: callOI > 0 ? r(putOI / callOI, 3) : null, callOI: r(callOI, 0), putOI: r(putOI, 0), contracts: opts.length,
    nearestExpiry: new Date(nearT).toISOString(), maxPainNearest: maxPain, underlying: r(u, 2),
    atmIV: r(atm, 1), putMinusCallIV: Number.isFinite(pIV - cIV) ? r(pIV - cIV, 2) : null, ivExpiry: Number.isFinite(ivT) ? new Date(ivT).toISOString() : null,
    topOIStrikes: [...byStrike.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, oi]) => ({ strike: k, oi: r(oi, 0) })),
  };
}
export function parseFutures(rows: Summ[], index: number, now: number) {
  return rows.map((x) => {
    const code = x.instrument_name.split("-")[1], perp = code === "PERPETUAL", t = perp ? null : expiryMs(code), px = x.mark_price ?? NaN;
    if (!Number.isFinite(px) || !(index > 0) || (!perp && (t === null || t <= now))) return null;
    const basis = px / index - 1, days = t ? (t - now) / 86400_000 : null;
    return { instrument: x.instrument_name, expiry: t ? new Date(t).toISOString() : null, mark: r(px, 2), basisPct: r(basis * 100, 3), annualisedPct: days && days >= 1 ? r((basis * 365 / days) * 100, 2) : null, volumeUsd: r(x.volume_usd ?? NaN, 0) };
  }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => (a.expiry ?? "").localeCompare(b.expiry ?? ""));
}
export function parseDvol(data: unknown): { last: number | null; chg24h: number | null } {
  const d = (data as { data?: number[][] })?.data; if (!Array.isArray(d) || !d.length) return { last: null, chg24h: null };
  const last = d[d.length - 1][4], prev = d.length > 24 ? d[d.length - 25][4] : NaN;
  return { last: r(last, 2), chg24h: Number.isFinite(prev) ? r(last - prev, 2) : null };
}

const DB = "https://www.deribit.com/api/v2/public";
async function dget(path: string, fetchImpl: typeof fetch) {
  const c = new AbortController(), id = setTimeout(() => c.abort(), 9000);
  try { const res = await fetchImpl(`${DB}/${path}`, { signal: c.signal }); if (!res.ok) throw new Error(`deribit ${res.status}`); return (await res.json()).result; } finally { clearTimeout(id); }
}
/** Options + futures context for one currency (BTC or ETH). Each part fails on its own and is reported, never thrown. */
export async function derivatives(cur: "BTC" | "ETH", now: number, fetchImpl: typeof fetch = fetch) {
  const [o, f, i, v] = await Promise.allSettled([
    dget(`get_book_summary_by_currency?currency=${cur}&kind=option`, fetchImpl), dget(`get_book_summary_by_currency?currency=${cur}&kind=future`, fetchImpl),
    dget(`get_index_price?index_name=${cur.toLowerCase()}_usd`, fetchImpl), dget(`get_volatility_index_data?currency=${cur}&resolution=3600&start_timestamp=${now - 26 * 3600_000}&end_timestamp=${now}`, fetchImpl),
  ]);
  const index = i.status === "fulfilled" ? Number(i.value?.index_price) : NaN, errors = [o, f, i, v].filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason?.message ?? x).slice(0, 80));
  return {
    currency: cur, index: r(index, 2), dvol: v.status === "fulfilled" ? parseDvol(v.value) : null,
    options: o.status === "fulfilled" && Array.isArray(o.value) ? parseOptions(o.value, now) : null,
    futures: f.status === "fulfilled" && Array.isArray(f.value) && index > 0 ? parseFutures(f.value, index, now) : null, errors,
  };
}
export const SCAN_NOTE = "Rule-based scan, not a prediction. Each setup is the bot's own deterministic strategy firing on that market's last closed 5m bar with a fresh state. The rules were tuned on BTC and gold; on other markets they are untested. Only the BTC and gold paper books trade; options and futures are context only.";
