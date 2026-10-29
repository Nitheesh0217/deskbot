// The Vercel feeds function: fixed allowlist, parsed output, safe links, fallbacks. Upstreams are mocked.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const handler = createRequire(import.meta.url)("../web/api/feeds.js");
const ALLOWED = new Set(["nfs.faireconomy.media", "news.google.com", "fred.stlouisfed.org", "api.coingecko.com", "data-api.binance.vision"]);

async function call(query: Record<string, string>, routes: (url: string) => Response | Promise<Response>, method = "GET") {
  const hosts: string[] = [], pF = globalThis.fetch;
  globalThis.fetch = (async (u: string) => { hosts.push(new URL(u).host); return routes(u); }) as typeof fetch;
  const res: any = { headers: {}, statusCode: 0, body: "", setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }, end(b: string) { this.body = b; } };
  try { await handler({ method, query }, res); } finally { globalThis.fetch = pF; }
  return { status: res.statusCode, headers: res.headers, json: JSON.parse(res.body), hosts };
}
const ok = (body: unknown, type = "application/json") => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": type } });

test("only allowlisted feed names; a URL in the query is ignored and no upstream is called", async () => {
  const bad = await call({ k: "http://169.254.169.254/latest" }, () => ok({}));
  assert.equal(bad.status, 400); assert.deepEqual(bad.hosts, []);
  const post = await call({ k: "calendar" }, () => ok([]), "POST"); assert.equal(post.status, 400);
  const sneaky = await call({ k: "calendar", url: "https://evil.example/x", host: "evil.example" } as any, () => ok([]));
  assert.equal(sneaky.status, 200); assert.ok(sneaky.hosts.every((h) => ALLOWED.has(h)), sneaky.hosts.join());
});
test("calendar: normalised, sorted, impact whitelisted, cached at the edge", async () => {
  const r = await call({ k: "calendar" }, () => ok([{ title: "CPI m/m", country: "USD", date: "2026-11-02T13:30:00-05:00", impact: "High", forecast: "0.3%", previous: "0.2%" }, { title: "x", country: "EUR", date: "2026-11-01T08:00:00Z", impact: "<script>", forecast: "", previous: "" }]));
  assert.equal(r.status, 200); assert.equal(r.json.data[0].country, "EUR"); assert.equal(r.json.data[0].impact, "Low"); assert.equal(r.json.data[1].date, "2026-11-02T18:30:00.000Z");
  assert.match(r.headers["cache-control"], /s-maxage=600/);
});
test("news: RSS parsed, entities decoded, markup stripped, javascript: links dropped, duplicates removed", async () => {
  const item = (t: string, l: string, d: string) => `<item><title><![CDATA[${t}]]></title><link>${l}</link><pubDate>${d}</pubDate><source url="x">Pub &amp; Co</source></item>`;
  const xml = `<rss><channel>${item("Bitcoin &amp; gold <b>rally</b>", "https://a.example/1", "Wed, 28 Oct 2026 10:00:00 GMT")}${item("Bitcoin & gold rally", "https://b.example/2", "Wed, 28 Oct 2026 09:00:00 GMT")}${item("Evil", "javascript:alert(1)", "Wed, 28 Oct 2026 11:00:00 GMT")}</channel></rss>`;
  const r = await call({ k: "news" }, () => ok(xml, "application/rss+xml"));
  const btc = r.json.data.btc; assert.equal(btc.length, 2, "duplicate title merged");
  assert.equal(btc[0].title, "Evil"); assert.equal(btc[0].link, null, "non-https link removed");
  assert.equal(btc[1].title, "Bitcoin & gold rally"); assert.equal(btc[1].publisher, "Pub & Co");
});
test("macro: FRED CSV latest, change, and missing points ('.') skipped", async () => {
  const r = await call({ k: "macro" }, (u) => ok(u.includes("DGS10") ? "DATE,DGS10\n2026-10-26,4.10\n2026-10-27,.\n2026-10-28,4.15\n" : "DATE,X\n2026-10-28,1\n", "text/csv"));
  const t = r.json.data.find((x: any) => x.id === "DGS10"); assert.equal(t.value, 4.15); assert.equal(t.change, 0.05); assert.equal(t.date, "2026-10-28");
});
test("crypto: CoinGecko rows with sparkline; Binance fallback when CoinGecko fails; upstream error is a 502, not a crash", async () => {
  const g = await call({ k: "crypto" }, (u) => u.includes("/global") ? ok({ data: { total_market_cap: { usd: 3e12 }, market_cap_percentage: { btc: 57.1, eth: 11 }, market_cap_change_percentage_24h_usd: 1.2 } })
    : ok([{ symbol: "btc", name: "Bitcoin", current_price: 81000, price_change_percentage_24h: 1.5, market_cap: 1.6e12, total_volume: 3e10, market_cap_rank: 1, sparkline_in_7d: { price: Array.from({ length: 168 }, (_, i) => 80000 + i) } }]));
  assert.equal(g.json.data.source, "coingecko"); assert.equal(g.json.data.rows[0].symbol, "BTC"); assert.ok(g.json.data.rows[0].spark.length <= 60); assert.equal(g.json.data.global.btcDominance, 57.1);
  const fb = await call({ k: "crypto" }, (u) => u.includes("coingecko") ? new Response("rate limited", { status: 429 }) : ok([{ symbol: "BTCUSDT", lastPrice: "81000.5", priceChangePercent: "-0.4", quoteVolume: "123" }]));
  assert.equal(fb.json.data.source, "binance"); assert.equal(fb.json.data.rows[0].symbol, "BTC"); assert.equal(fb.json.data.rows[0].price, 81000.5);
  const down = await call({ k: "calendar" }, () => new Response("x", { status: 503 })); assert.equal(down.status, 502); assert.match(down.headers["cache-control"], /s-maxage=30/);
});
