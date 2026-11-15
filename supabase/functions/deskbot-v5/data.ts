// DeskBot v5 — market data (public endpoints, no keys). Hyperliquid primary, Binance fallback.
import type { Bar } from "./engine.ts";

const HL = "https://api.hyperliquid.xyz/info";
const BN = "https://data-api.binance.vision/api/v3";
const TF_MS: Record<string, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3600_000, "4h": 14400_000 };

// Tradable books. hl = Hyperliquid perp coin, bn = Binance spot pair (fallback + long backtest history).
// GOLD trades via PAXG (1 token = 1 troy oz of LBMA gold, 24/7) because spot XAUUSD has no free, keyless 5m API.
export const SYMBOLS = {
  BTC: { hl: "BTC", bn: "BTCUSDT", name: "Bitcoin" },
  GOLD: { hl: "PAXG", bn: "PAXGUSDT", name: "Gold (PAXG)" },
  ETH: { hl: "ETH", bn: "ETHUSDT", name: "Ethereum" },
  SOL: { hl: "SOL", bn: "SOLUSDT", name: "Solana" },
  XRP: { hl: "XRP", bn: "XRPUSDT", name: "XRP" },
  BNB: { hl: "BNB", bn: "BNBUSDT", name: "BNB" },
  DOGE: { hl: "DOGE", bn: "DOGEUSDT", name: "Dogecoin" },
  LINK: { hl: "LINK", bn: "LINKUSDT", name: "Chainlink" },
  AVAX: { hl: "AVAX", bn: "AVAXUSDT", name: "Avalanche" },
  SUI: { hl: "SUI", bn: "SUIUSDT", name: "Sui" },
  // paper basket (HTF_TREND only; docs/research/2026-11-15-oos-coins). bn "" = no matching Binance spot pair: no fallback feed.
  ZEC: { hl: "ZEC", bn: "ZECUSDT", name: "Zcash" },
  NEAR: { hl: "NEAR", bn: "NEARUSDT", name: "NEAR" },
  XMR: { hl: "XMR", bn: "", name: "Monero" },
  AAVE: { hl: "AAVE", bn: "AAVEUSDT", name: "Aave" },
  UNI: { hl: "UNI", bn: "UNIUSDT", name: "Uniswap" },
  ADA: { hl: "ADA", bn: "ADAUSDT", name: "Cardano" },
  PEPE: { hl: "kPEPE", bn: "", name: "Pepe (×1000)" },
  // Hyperliquid HIP-3 "xyz" perps on traditional markets: record-only (shadow); about a year of history, too short to test
  SPX: { hl: "xyz:SP500", bn: "", name: "S&P 500 (perp)" },
  NDX: { hl: "xyz:XYZ100", bn: "", name: "Nasdaq-100 (perp)" },
  NVDA: { hl: "xyz:NVDA", bn: "", name: "NVIDIA (perp)" },
  XAU: { hl: "xyz:GOLD", bn: "", name: "Gold (perp)" },
  XAG: { hl: "xyz:SILVER", bn: "", name: "Silver (perp)" },
  BRENT: { hl: "xyz:BRENTOIL", bn: "", name: "Brent oil (perp)" },
  WTI: { hl: "xyz:CL", bn: "", name: "WTI crude (perp)" },
} as const;
/** Traditional-market books: no crypto sentiment (Fear & Greed), no Binance fallback. */
export const TRADFI = new Set<string>(["SPX", "NDX", "NVDA", "XAU", "XAG", "BRENT", "WTI"]);
export type Sym = keyof typeof SYMBOLS;
export const isSym = (x: unknown): x is Sym => typeof x === "string" && x in SYMBOLS;

// Per-book identity in ONE place, so no caller re-derives it from a "BTC"/"GOLD" literal.
// rowId: its dbv5_state row; mlGold: the ML model's gold flag (engine.setMlAsset); isCrypto: crypto sentiment (Fear & Greed)
// applies; news: the crypto news layer applies (BTC only today).
export const bookOf = (sym: Sym) => ({ rowId: sym === "BTC" ? "main" : sym.toLowerCase(), mlGold: sym === "GOLD" || sym === "XAU", isCrypto: sym !== "GOLD" && !TRADFI.has(sym), news: sym === "BTC" });

// The whole request INCLUDING the body read runs inside the deadline: `p` must read the body itself. Clearing the timer when
// fetch resolved (headers only) left res.json() unbounded on a stalled stream. The race also bounds a body that ignores the abort.
export async function withTimeout<T>(p: (s: AbortSignal) => Promise<T>, ms = 8000): Promise<T> {
  const c = new AbortController(); let id: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, no) => { id = setTimeout(() => { c.abort(); no(new Error(`timed out after ${ms} ms`)); }, ms); });
  try { return await Promise.race([p(c.signal), late]); } finally { clearTimeout(id); }
}

async function hlCandles(interval: string, startTime: number, endTime: number, sym: Sym = "BTC"): Promise<Bar[]> {
  const j = await withTimeout(async s => {
    const res = await fetch(HL, {
      method: "POST", signal: s, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "candleSnapshot", req: { coin: SYMBOLS[sym].hl, interval, startTime, endTime } }),
    });
    if (!res.ok) throw new Error(`HL ${interval} HTTP ${res.status}`);
    return await res.json() as Array<{ t: number; T: number; o: string; h: string; l: string; c: string; v: string }>;
  });
  return j.map(k => ({ t: +k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, ct: +k.t + TF_MS[interval] - 1 }));
}

async function bnCandles(interval: string, limit: number, sym: Sym = "BTC"): Promise<Bar[]> {
  if (!SYMBOLS[sym].bn) throw new Error(`no Binance fallback for ${sym}`);
  const j = await withTimeout(async s => {
    const res = await fetch(`${BN}/klines?symbol=${SYMBOLS[sym].bn}&interval=${interval}&limit=${Math.min(limit, 1000)}`, { signal: s });
    if (!res.ok) throw new Error(`Binance ${interval} HTTP ${res.status}`);
    return await res.json() as unknown[][];
  });
  return j.map(k => ({ t: +k[0]!, o: +k[1]!, h: +k[2]!, l: +k[3]!, c: +k[4]!, v: +k[5]!, ct: +k[6]! }));
}

export type Source = "hyperliquid" | "binance";
// returns CLOSED bars only (ct < now)
export async function candles(interval: string, count: number, now = Date.now(), prefer: Source = "hyperliquid", sym: Sym = "BTC"): Promise<{ bars: Bar[]; source: Source }> {
  const start = now - (count + 2) * TF_MS[interval];
  const closed = (b: Bar[]) => b.filter(x => x.ct < now).sort((a, z) => a.t - z.t);
  try {
    if (prefer === "hyperliquid") { const hb = closed(await hlCandles(interval, start, now, sym)); if (hb.length >= Math.min(count, 50)) return { bars: hb, source: "hyperliquid" }; }
  } catch (_) { /* fall through */ }
  return { bars: closed(await bnCandles(interval, count + 2, sym)), source: "binance" };
}

// many candles for backtests (HL caps ~5000 per call)
export async function candlesRange(interval: string, startTime: number, endTime: number, sym: Sym = "BTC"): Promise<Bar[]> {
  const out: Bar[] = []; let s = startTime;
  while (s < endTime) {
    const chunk = await hlCandles(interval, s, endTime, sym);
    if (!chunk.length) break; out.push(...chunk);
    const last = chunk[chunk.length - 1].t; if (last <= s) break; s = last + TF_MS[interval];
    if (chunk.length < 4000) break;
  }
  const seen = new Set<number>();
  return out.filter(b => b.ct < endTime && !seen.has(b.t) && seen.add(b.t)).sort((a, z) => a.t - z.t);
}

// long history from Binance spot BTCUSDT (paged 1000/call) — HL only serves the latest ~5000 candles
export async function candlesRangeBinance(interval: string, startTime: number, endTime: number, sym: Sym = "BTC"): Promise<Bar[]> {
  if (!SYMBOLS[sym].bn) throw new Error(`no Binance history for ${sym}`);
  const out: Bar[] = []; let s = startTime;
  for (let guard = 0; s < endTime && guard < 130; guard++) {
    const j = await withTimeout(async sig => {
      const res = await fetch(`${BN}/klines?symbol=${SYMBOLS[sym].bn}&interval=${interval}&startTime=${s}&endTime=${endTime}&limit=1000`, { signal: sig });
      if (!res.ok) throw new Error(`Binance ${interval} HTTP ${res.status}`);
      return await res.json() as unknown[][];
    }, 12000);
    if (!j.length) break;
    for (const k of j) out.push({ t: +k[0]!, o: +k[1]!, h: +k[2]!, l: +k[3]!, c: +k[4]!, v: +k[5]!, ct: +k[6]! });
    s = +j[j.length - 1][0]! + TF_MS[interval]; if (j.length < 1000) break;
  }
  return out.filter(b => b.ct < endTime);
}

// Hyperliquid instrument metadata comes from the SAME metaAndAssetCtxs response (no extra request). Observe-only: nothing here
// changes sizing, entries or exits. `delisted` follows Hyperliquid's `isDelisted` flag on the universe entry (the pattern of
// Superior-Trade/trading-terminal lib/hl-universe.ts, re-implemented). fundingAprPct = hourly funding x 24 x 365 x 100 (simple).
export type HlCtx = {
  funding: number; oi: number; markPx: number; premium: number;
  oraclePx: number | null; szDecimals: number | null; maxLeverage: number | null; delisted: boolean; fundingAprPct: number;
};
/** Filled in place by hlContext: "missing" = coin not in the universe, "delisted" = listed with isDelisted, "unavailable" = request failed. */
export type HlDiag = { status?: "ok" | "missing" | "delisted" | "unavailable"; coin?: string };
const numOrNull = (x: unknown) => (x == null || x === "" || !Number.isFinite(+(x as number)) ? null : +(x as number));
/** Hourly funding rate (fraction) -> simple annualised percent. */
export const fundingApr = (hourly: number) => hourly * 24 * 365 * 100;

// one metaAndAssetCtxs response per dex reused for 60 s: a run with many books makes one call, not one per book (rate limit)
const META_CACHE = new Map<string, { t: number; v: unknown }>();
let metaCacheOn = false;
/** Turned on for the duration of one multi-book run (runLocked); off otherwise, so every other caller reads fresh data. */
export const metaCacheScope = (on: boolean) => { metaCacheOn = on; META_CACHE.clear(); };
export async function hlContext(sym: Sym = "BTC", diag: HlDiag = {}): Promise<HlCtx | null> {
  diag.coin = SYMBOLS[sym].hl; diag.status = "unavailable";
  try {
    const coin = SYMBOLS[sym].hl, dex = coin.includes(":") ? coin.split(":")[0] : "";
    const hit = metaCacheOn ? META_CACHE.get(dex) : undefined;
    const r = hit && Date.now() - hit.t < 60_000 ? hit.v : await withTimeout(async s => { const res = await fetch(HL, { method: "POST", signal: s, headers: { "Content-Type": "application/json" }, body: JSON.stringify(dex ? { type: "metaAndAssetCtxs", dex } : { type: "metaAndAssetCtxs" }) }); return res.ok ? await res.json() : null; });
    if (!r) return null;
    if (metaCacheOn && !(hit && Date.now() - hit.t < 60_000)) META_CACHE.set(dex, { t: Date.now(), v: r });
    const [meta, ctxs] = r;
    const i = meta.universe.findIndex((u: { name: string }) => u.name === SYMBOLS[sym].hl); if (i < 0) { diag.status = "missing"; return null; }
    const c = ctxs[i], u = meta.universe[i] as { szDecimals?: unknown; maxLeverage?: unknown; isDelisted?: unknown };
    const delisted = u.isDelisted === true; diag.status = delisted ? "delisted" : "ok";
    return {
      funding: +c.funding, oi: +c.openInterest, markPx: +c.markPx, premium: +(c.premium ?? 0),
      oraclePx: numOrNull(c.oraclePx), szDecimals: numOrNull(u.szDecimals), maxLeverage: numOrNull(u.maxLeverage), delisted, fundingAprPct: fundingApr(+c.funding),
    };
  } catch { return null; }
}

export async function fearGreed(): Promise<{ value: number; label: string } | null> {
  try {
    const j = await withTimeout(async s => { const res = await fetch("https://api.alternative.me/fng/?limit=1", { signal: s }); return res.ok ? await res.json() : null; });
    if (!j) return null;
    return { value: +j.data[0].value, label: j.data[0].value_classification };
  } catch { return null; }
}

// Order flow (taker imbalance) from Binance spot 1h klines: field 9 = taker-buy base volume.
// imbN = Σ(2·takerBuy − volume) / Σ volume over the last N CLOSED hours, in [−1, 1]. >0 = aggressive buyers dominate.
// Research (docs/ML_REPORT.md §8): 24h imbalance on the trade's side had better results in both periods, but the effect is small,
// so it is logged (shadow), not used to gate entries.
export async function orderFlow(now = Date.now(), sym: Sym = "BTC"): Promise<{ imb4: number; imb24: number; bars: number } | null> {
  if (!SYMBOLS[sym].bn) return null;
  try {
    const raw = await withTimeout(async s => { const res = await fetch(`${BN}/klines?symbol=${SYMBOLS[sym].bn}&interval=1h&limit=26`, { signal: s }); return res.ok ? await res.json() as unknown[][] : null; });
    if (!raw) return null;
    const j = raw.filter(k => +k[6]! < now);
    const imb = (n: number) => { const w = j.slice(-n); const v = w.reduce((a, k) => a + +k[5]!, 0); return v > 0 ? w.reduce((a, k) => a + 2 * +k[9]! - +k[5]!, 0) / v : NaN; };
    return { imb4: +imb(4).toFixed(4), imb24: +imb(24).toFixed(4), bars: j.length };
  } catch { return null; }
}
