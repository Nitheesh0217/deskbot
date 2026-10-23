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
} as const;
export type Sym = keyof typeof SYMBOLS;
export const isSym = (x: unknown): x is Sym => typeof x === "string" && x in SYMBOLS;

async function withTimeout<T>(p: (s: AbortSignal) => Promise<T>, ms = 8000): Promise<T> {
  const c = new AbortController(); const id = setTimeout(() => c.abort(), ms);
  try { return await p(c.signal); } finally { clearTimeout(id); }
}

async function hlCandles(interval: string, startTime: number, endTime: number, sym: Sym = "BTC"): Promise<Bar[]> {
  const res = await withTimeout(s => fetch(HL, {
    method: "POST", signal: s, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin: SYMBOLS[sym].hl, interval, startTime, endTime } }),
  }));
  if (!res.ok) throw new Error(`HL ${interval} HTTP ${res.status}`);
  const j = await res.json() as Array<{ t: number; T: number; o: string; h: string; l: string; c: string; v: string }>;
  return j.map(k => ({ t: +k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, ct: +k.t + TF_MS[interval] - 1 }));
}

async function bnCandles(interval: string, limit: number, sym: Sym = "BTC"): Promise<Bar[]> {
  const res = await withTimeout(s => fetch(`${BN}/klines?symbol=${SYMBOLS[sym].bn}&interval=${interval}&limit=${Math.min(limit, 1000)}`, { signal: s }));
  if (!res.ok) throw new Error(`Binance ${interval} HTTP ${res.status}`);
  const j = await res.json() as unknown[][];
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
  const out: Bar[] = []; let s = startTime;
  for (let guard = 0; s < endTime && guard < 130; guard++) {
    const res = await withTimeout(sig => fetch(`${BN}/klines?symbol=${SYMBOLS[sym].bn}&interval=${interval}&startTime=${s}&endTime=${endTime}&limit=1000`, { signal: sig }), 12000);
    if (!res.ok) throw new Error(`Binance ${interval} HTTP ${res.status}`);
    const j = await res.json() as unknown[][]; if (!j.length) break;
    for (const k of j) out.push({ t: +k[0]!, o: +k[1]!, h: +k[2]!, l: +k[3]!, c: +k[4]!, v: +k[5]!, ct: +k[6]! });
    s = +j[j.length - 1][0]! + TF_MS[interval]; if (j.length < 1000) break;
  }
  return out.filter(b => b.ct < endTime);
}

export async function hlContext(sym: Sym = "BTC"): Promise<{ funding: number; oi: number; markPx: number; premium: number } | null> {
  try {
    const res = await withTimeout(s => fetch(HL, { method: "POST", signal: s, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }) }));
    if (!res.ok) return null;
    const [meta, ctxs] = await res.json();
    const i = meta.universe.findIndex((u: { name: string }) => u.name === SYMBOLS[sym].hl); if (i < 0) return null;
    const c = ctxs[i];
    return { funding: +c.funding, oi: +c.openInterest, markPx: +c.markPx, premium: +(c.premium ?? 0) };
  } catch { return null; }
}

export async function fearGreed(): Promise<{ value: number; label: string } | null> {
  try {
    const res = await withTimeout(s => fetch("https://api.alternative.me/fng/?limit=1", { signal: s }));
    if (!res.ok) return null; const j = await res.json();
    return { value: +j.data[0].value, label: j.data[0].value_classification };
  } catch { return null; }
}

// Order flow (taker imbalance) from Binance spot 1h klines: field 9 = taker-buy base volume.
// imbN = Σ(2·takerBuy − volume) / Σ volume over the last N CLOSED hours, in [−1, 1]. >0 = aggressive buyers dominate.
// Research (docs/ML_REPORT.md §8): 24h imbalance on the trade's side had better results in both periods, but the effect is small,
// so it is logged (shadow), not used to gate entries.
export async function orderFlow(now = Date.now(), sym: Sym = "BTC"): Promise<{ imb4: number; imb24: number; bars: number } | null> {
  try {
    const res = await withTimeout(s => fetch(`${BN}/klines?symbol=${SYMBOLS[sym].bn}&interval=1h&limit=26`, { signal: s }));
    if (!res.ok) return null;
    const j = (await res.json() as unknown[][]).filter(k => +k[6]! < now);
    const imb = (n: number) => { const w = j.slice(-n); const v = w.reduce((a, k) => a + +k[5]!, 0); return v > 0 ? w.reduce((a, k) => a + 2 * +k[9]! - +k[5]!, 0) / v : NaN; };
    return { imb4: +imb(4).toFixed(4), imb24: +imb(24).toFixed(4), bars: j.length };
  } catch { return null; }
}
