// Market context feeds for the dashboard's Markets tab (Vercel serverless function, Node runtime, no dependencies).
// Pattern adapted from OpenTerminal (MIT, github.com/ErTasselli/OpenTerminal): free public endpoints, parsed server-side, cached.
// Security: the caller only picks a feed NAME from a fixed allowlist. No URL, host, symbol or query text from the request reaches
// an upstream fetch, so this cannot be used as an open proxy. Responses are parsed JSON, never relayed raw. Display only:
// nothing here feeds the trading engine.
"use strict";

const UA = "Mozilla/5.0 (DeskBot dashboard; +https://deskbot-azure.vercel.app)";
const TIMEOUT_MS = 8000;

async function get(url, accept) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r;
}
const decode = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/<[^>]*>/g, "").trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")); return m ? decode(m[1]) : null; };
const num = (x) => { const v = Number(x); return Number.isFinite(v) ? v : null; };
const httpsOnly = (u) => (/^https:\/\//i.test(u || "") ? u : null);

// Economic calendar: Forex Factory weekly JSON (schedule, impact, forecast, previous).
async function calendar() {
  const rows = await (await get("https://nfs.faireconomy.media/ff_calendar_thisweek.json", "application/json")).json();
  return (Array.isArray(rows) ? rows : []).map((e) => ({
    title: String(e.title || "").slice(0, 120), country: String(e.country || "").slice(0, 6), date: new Date(e.date).toISOString(),
    impact: ["High", "Medium", "Low", "Holiday"].includes(e.impact) ? e.impact : "Low", forecast: e.forecast ? String(e.forecast).slice(0, 20) : null, previous: e.previous ? String(e.previous).slice(0, 20) : null,
  })).filter((e) => e.title && !Number.isNaN(Date.parse(e.date))).sort((a, b) => a.date.localeCompare(b.date));
}

// News: Google News RSS for fixed queries, merged and de-duplicated by normalised title (OpenTerminal's dedupe), newest first.
const NEWS_QUERIES = { btc: "bitcoin OR BTC price", gold: "gold price OR XAU OR PAXG", macro: "Federal Reserve OR CPI OR treasury yields" };
async function rss(q) {
  const xml = await (await get(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, "application/rss+xml")).text();
  return (xml.match(/<item>[\s\S]*?<\/item>/gi) || []).slice(0, 25).map((it) => ({ title: (tag(it, "title") || "").slice(0, 200), link: httpsOnly(tag(it, "link")), publisher: (tag(it, "source") || "Google News").slice(0, 60), publishedAt: (() => { const d = Date.parse(tag(it, "pubDate") || ""); return Number.isFinite(d) ? new Date(d).toISOString() : null; })() }));
}
async function news() {
  const out = {};
  await Promise.all(Object.entries(NEWS_QUERIES).map(async ([k, q]) => {
    const seen = new Set(); out[k] = [];
    for (const it of await rss(q).catch(() => [])) { const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80); if (!it.title || seen.has(key)) continue; seen.add(key); out[k].push(it); }
    out[k].sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || "")); out[k] = out[k].slice(0, 15);
  }));
  return out;
}

// Macro: FRED public CSV (no key). Latest value, previous value and its date.
const FRED = [["DGS3MO", "US 3M"], ["DGS2", "US 2Y"], ["DGS10", "US 10Y"], ["DGS30", "US 30Y"], ["VIXCLS", "VIX"], ["DTWEXBGS", "Dollar index (broad)"], ["DFEDTARU", "Fed funds upper"]];
async function fredSeries(id) {
  const text = await (await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, "text/csv")).text();
  const pts = text.trim().split("\n").slice(1).map((l) => l.split(",")).filter(([d, v]) => d && Number.isFinite(Number(v))).map(([d, v]) => ({ date: d, value: Number(v) }));
  return pts.slice(-2);
}
async function macro() {
  const res = await Promise.allSettled(FRED.map(([id]) => fredSeries(id)));
  return FRED.map(([id, label], i) => { const p = res[i].status === "fulfilled" ? res[i].value : []; const last = p[p.length - 1], prev = p[p.length - 2];
    return { id, label, value: last ? last.value : null, date: last ? last.date : null, change: last && prev ? +(last.value - prev.value).toFixed(4) : null }; });
}

// Crypto board: CoinGecko markets (7-day sparkline) + global dominance. Binance 24h tickers as the fallback for prices.
async function crypto() {
  const [m, g, px] = await Promise.allSettled([
    get("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=15&page=1&sparkline=true&price_change_percentage=24h", "application/json").then((r) => r.json()),
    get("https://api.coingecko.com/api/v3/global", "application/json").then((r) => r.json()),
    // the gold book's instrument is rarely in the top 15, so it is always fetched by id
    get("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=pax-gold&sparkline=true&price_change_percentage=24h", "application/json").then((r) => r.json()),
  ]);
  if (m.status === "fulfilled" && Array.isArray(m.value) && px.status === "fulfilled" && Array.isArray(px.value) && !m.value.some((r) => r.id === "pax-gold")) m.value.push(...px.value.slice(0, 1));
  let rows = m.status === "fulfilled" && Array.isArray(m.value) ? m.value.map((r) => ({ symbol: String(r.symbol || "").toUpperCase().slice(0, 12), name: String(r.name || "").slice(0, 40), price: num(r.current_price), change24h: num(r.price_change_percentage_24h), marketCap: num(r.market_cap), volume24h: num(r.total_volume), rank: num(r.market_cap_rank),
    spark: Array.isArray(r.sparkline_in_7d && r.sparkline_in_7d.price) ? r.sparkline_in_7d.price.filter((x) => Number.isFinite(x)).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 56)) === 0) : [] })) : [];
  let source = "coingecko";
  if (!rows.length) {
    const syms = ["BTCUSDT", "PAXGUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
    const t = await (await get(`https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(syms))}`, "application/json")).json();
    rows = (Array.isArray(t) ? t : []).map((r) => ({ symbol: String(r.symbol).replace(/USDT$/, ""), name: String(r.symbol), price: num(r.lastPrice), change24h: num(r.priceChangePercent), marketCap: null, volume24h: num(r.quoteVolume), rank: null, spark: [] }));
    source = "binance";
  }
  const gd = g.status === "fulfilled" && g.value && g.value.data ? g.value.data : null;
  return { source, rows, global: gd ? { totalMarketCap: num(gd.total_market_cap && gd.total_market_cap.usd), btcDominance: num(gd.market_cap_percentage && gd.market_cap_percentage.btc), ethDominance: num(gd.market_cap_percentage && gd.market_cap_percentage.eth), change24h: num(gd.market_cap_change_percentage_24h_usd) } : null };
}

const FEEDS = { calendar: [calendar, 600], news: [news, 300], macro: [macro, 1800], crypto: [crypto, 60] };

module.exports = async function handler(req, res) {
  const k = String((req.query && req.query.k) || "");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET" || !Object.prototype.hasOwnProperty.call(FEEDS, k)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "unknown feed", feeds: Object.keys(FEEDS) })); }
  const [fn, ttl] = FEEDS[k], t0 = Date.now();
  try {
    const data = await fn();
    res.setHeader("Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}`);
    res.statusCode = 200; res.end(JSON.stringify({ feed: k, fetchedAt: new Date().toISOString(), ms: Date.now() - t0, data }));
  } catch (e) {
    res.setHeader("Cache-Control", "public, s-maxage=30");
    res.statusCode = 502; res.end(JSON.stringify({ feed: k, error: String((e && e.message) || e).slice(0, 160) }));
  }
};
module.exports.FEEDS = Object.keys(FEEDS);
module.exports._parse = { decode, tag, httpsOnly };
