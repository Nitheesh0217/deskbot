// Browser smoke for the Markets tab, command palette and chart indicators, with mocked network. /api/feeds responses are TEST DATA.
// Usage: node scripts/web_smoke/markets.cjs fixture.json outDir
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const [fixturePath, outDir] = process.argv.slice(2); fs.mkdirSync(outDir, { recursive: true });
const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8")); const web = path.join(__dirname, "..", "..", "web");
const H = 3600e3, iso = (ms) => new Date(Date.now() + ms).toISOString();
const FEEDS = {
  crypto: { source: "coingecko", global: { totalMarketCap: 3.1e12, btcDominance: 57.2, ethDominance: 10.4, change24h: 1.1 }, rows: [["BTC", "Bitcoin", 81234, 1.4], ["ETH", "Ethereum", 3010, -0.6], ["PAXG", "PAX Gold", 2712.5, 0.3], ["SOL", "Solana", 182, 3.2]].map(([s, n, p, c], i) => ({ symbol: s, name: n, price: p, change24h: c, marketCap: 1e11 / (i + 1), volume24h: 1e9, rank: i + 1, spark: Array.from({ length: 56 }, (_, k) => p * (1 + Math.sin(k / 6) * 0.02)) })) },
  macro: [["DGS3MO", "US 3M", 4.2], ["DGS2", "US 2Y", 3.9], ["DGS10", "US 10Y", 4.15], ["DGS30", "US 30Y", 4.5], ["VIXCLS", "VIX", 16.2], ["DTWEXBGS", "Dollar index (broad)", 121.3], ["DFEDTARU", "Fed funds upper", 4.25]].map(([id, label, v]) => ({ id, label, value: v, change: 0.03, date: "2026-10-28" })),
  calendar: [{ title: "CPI m/m", country: "USD", date: iso(-5 * H), impact: "High", forecast: "0.3%", previous: "0.2%" }, { title: "FOMC Statement", country: "USD", date: iso(2 * H), impact: "High", forecast: null, previous: null }, { title: "German Ifo", country: "EUR", date: iso(26 * H), impact: "Medium", forecast: "86.1", previous: "85.4" }],
  news: { btc: [{ title: "Bitcoin holds above $80k", link: "https://example.com/a", publisher: "Example", publishedAt: iso(-H) }], gold: [{ title: "Gold steady", link: "https://example.com/b", publisher: "Example", publishedAt: iso(-2 * H) }], macro: [] },
};
const srv = http.createServer((q, r) => { const f = path.join(web, q.url === "/" ? "index.html" : q.url.split("?")[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".svg") ? "image/svg+xml" : "text/html" }); r.end(d); } }); });
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`; const browser = await chromium.launch(); const problems = [], result = {};
  for (const [name, vp] of [["desktop", { width: 1360, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const page = await (await browser.newContext({ viewport: vp })).newPage();
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${name} console: ${m.text()}`); }); page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
    await page.route("**/*", async (route) => {
      const u = route.request().url();
      if (u.startsWith(base + "api/feeds")) { const k = new URL(u).searchParams.get("k"); return route.fulfill({ contentType: "application/json", body: JSON.stringify({ feed: k, fetchedAt: new Date().toISOString(), ms: 12, data: FEEDS[k] }) }); }
      if (u.startsWith(base)) return route.continue();
      if (u.includes("fonts.g")) return route.fulfill({ contentType: "text/css", body: "" });
      if (u.includes("api.hyperliquid.xyz")) { const b = JSON.parse(route.request().postData()); if (b.type === "allMids") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ BTC: "81234.5" }) });
        const { interval, startTime, endTime } = b.req; const rows = (fx.frames[interval] || []).filter((x) => x[0] >= startTime && x[0] <= endTime);
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(rows.map((x) => ({ t: x[0], T: x[0], o: String(x[1]), h: String(x[2]), l: String(x[3]), c: String(x[4]), v: String(x[5]) }))) }); }
      if (u.includes("supabase.co/functions")) return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(fx.status) });
      return route.abort();
    });
    await page.goto(base + "#markets"); await page.waitForTimeout(2500);
    const mk = await page.evaluate(() => ({ cryptoRows: document.querySelectorAll("#mkCrypto tbody tr").length, books: document.querySelectorAll("#mkCrypto tr.book").length, dom: document.getElementById("mkCryptoHead").innerText, tiles: document.querySelectorAll("#mkMacro .mk-tile").length,
      next: document.getElementById("mkNext").innerText, cal: document.querySelectorAll("#mkCal .cal-row").length, news: document.querySelectorAll("#mkNews .nw").length, clocks: document.getElementById("mkClocks").innerText.slice(0, 120), feeds: document.getElementById("mkFeeds").innerText,
      hScroll: document.documentElement.scrollWidth > innerWidth + 1 }));
    await page.screenshot({ path: path.join(outDir, `markets_${name}.png`), fullPage: true });
    await page.keyboard.press("Control+k"); await page.waitForTimeout(200); await page.keyboard.type("timeframe 15"); await page.waitForTimeout(150);
    const pal = await page.evaluate(() => ({ open: !document.getElementById("cmd").hidden, first: (document.querySelector("#cmdList .cmd-it.on") || {}).innerText }));
    await page.screenshot({ path: path.join(outDir, `palette_${name}.png`) });
    await page.keyboard.press("Enter"); await page.waitForTimeout(2600);
    for (const k of ["SMA50", "BOLL", "RSI", "MACD"]) { await page.click(`#indSeg button[data-ind="${k}"]`); await page.waitForTimeout(150); }
    await page.mouse.move(vp.width / 2, 600); await page.waitForTimeout(400);
    const ch = await page.evaluate(() => ({ view: location.hash, tf: (document.querySelector("#tfSeg button[aria-pressed=true]") || {}).innerText, legend: document.getElementById("hoverLegend").innerText, pressed: [...document.querySelectorAll("#indSeg button[aria-pressed=true]")].map((b) => b.dataset.ind) }));
    await page.screenshot({ path: path.join(outDir, `chart_ind_${name}.png`), fullPage: true });
    await page.keyboard.press("Alt+Digit1"); await page.waitForTimeout(300); const alt = await page.evaluate(() => location.hash);
    result[name] = { mk, pal, ch, alt };
  }
  await browser.close(); srv.close(); console.log(JSON.stringify({ result, problems }, null, 1)); process.exit(problems.length ? 1 : 0);
})();
