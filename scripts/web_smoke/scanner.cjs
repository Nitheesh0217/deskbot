// Browser smoke for the Scanner and Committee views, grouped nav and the trading-state pill, with mocked network.
// The scan rows and committee rows injected below are TEST DATA. Usage: node scripts/web_smoke/scanner.cjs fixture.json outDir
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const [fixturePath, outDir] = process.argv.slice(2); fs.mkdirSync(outDir, { recursive: true });
const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8")); const web = path.join(__dirname, "..", "..", "web");
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const mk = (sym, price, setups = [], o = {}) => ({ sym, ok: true, name: sym, book: sym === "BTC" || sym === "GOLD", barT: Date.now() - 60e3, price, chg24h: 1.2, regime: "TREND", trend: "up on 15m/1h/4h", rsi15: 61, rsi1h: 58, chop15: 41, atr15Pct: 0.31, vwapDev: 0.8, funding: 0.0000125, oi: 1e6, notes: [], setups, blocked: [{ reason: "Score 0.4 < 0.55", n: 2 }], ...o });
const status = JSON.parse(JSON.stringify(fx.status));
status.scan = { ts: iso(-4 * 60e3), ms: 8200, note: "Rule-based scan, not a prediction. TEST DATA.", markets: [
  mk("SOL", 182.4, [{ strategy: "EMA_PB", dir: "long", entry: 182.4, stop: 180.9, stopPct: 0.82, score: 0.71, why: ["EMA20 pullback in an up-trend", "1h trend up"] }]),
  mk("BTC", 81234, [], { trend: "mixed", regime: "RANGE" }), mk("ETH", 3010, [], { chg24h: -0.6 }), { sym: "SUI", ok: false, error: "not enough history" }],
  deriv: [{ currency: "BTC", index: 81200, dvol: { last: 48.2, chg24h: -1.3 }, options: { putCallOI: 0.62, callOI: 250000, putOI: 155000, contracts: 800, nearestExpiry: iso(20 * 3600e3), maxPainNearest: 80000, underlying: 81200, atmIV: 46.1, putMinusCallIV: 2.4, ivExpiry: iso(8 * 86400e3), topOIStrikes: [{ strike: 100000, oi: 22000 }, { strike: 80000, oi: 18000 }] },
    futures: [{ instrument: "BTC-PERPETUAL", expiry: null, mark: 81230, basisPct: 0.037, annualisedPct: null }, { instrument: "BTC-26DEC26", expiry: iso(58 * 86400e3), mark: 82100, basisPct: 1.1, annualisedPct: 6.9 }], errors: [] },
    { currency: "ETH", index: 3010, dvol: null, options: null, futures: null, errors: ["deribit 503"] }] };
const ref = "V5-TEST-1", at = (s) => iso(-s * 1000), sp = (a) => ({ ref, authority: "advisory", argument: a, strongest_point: a.slice(0, 30) });
status.agents = [
  { agent: "desk-pm", ts: at(10), symbol: "BTC", provider: "groq/llama", ms: 900, output: { ref, authority: "advisory", rating: "Overweight", stance: "keep", direction: "long", executive_summary: "Keep the paper trade as planned.", thesis: "Sweep with rejection.", would_change_my_mind: "High-impact news." } },
  { agent: "desk-risk-neutral", ts: at(11), symbol: "BTC", provider: "groq/llama", ms: 800, output: sp("Both risk views hold.") },
  { agent: "desk-risk-conservative", ts: at(12), symbol: "BTC", provider: "groq/llama", ms: 800, output: sp("Range regime argues for caution.") },
  { agent: "desk-risk-aggressive", ts: at(13), symbol: "BTC", provider: "groq/llama", ms: 800, output: sp("Reward covers costs.") },
  { agent: "desk-trader", ts: at(14), symbol: "BTC", provider: "groq/llama", ms: 700, output: { ref, authority: "advisory", action: "take", reason: "Plan matches rules.", execution_note: "Filled at market." } },
  { agent: "desk-research", ts: at(15), symbol: "BTC", provider: "groq/llama", ms: 700, output: { ref, authority: "advisory", rating: "Overweight", rationale: "Bull case stronger on evidence.", stronger_side: "bull" } },
  { agent: "desk-bear", ts: at(16), symbol: "BTC", provider: "groq/llama", ms: 700, output: sp("Costs are a large share of the stop.") },
  { agent: "desk-bull", ts: at(17), symbol: "BTC", provider: "groq/llama", ms: 700, output: sp("Clean sweep of the low with rejection.") },
  { agent: "desk-analysts", ts: at(18), symbol: "BTC", output: { ref, authority: "advisory", market: { regime: "RANGE", supertrend_up_frames: 2, supertrend_down_frames: 1, rsi15: 44.1, vwap_dev_sigma: -0.6 }, sentiment: { fear_greed: 52 }, positioning: { funding_per_interval: 0.0000125 }, news: { risk: "LOW" } } },
  { agent: "desk-checks", ts: at(19), symbol: "BTC", output: { ref, authority: "advisory", checks: [{ id: "round_trip_cost", level: "info", text: "Round-trip costs 0.12R" }] } },
  ...(status.agents || []),
];
status.chat = { ...(status.chat || {}), ai: ["groq"] };
if (status.lastRun) status.lastRun.ts = iso(-3 * 60e3);
const srv = http.createServer((q, r) => { const f = path.join(web, q.url === "/" ? "index.html" : q.url.split("?")[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".svg") ? "image/svg+xml" : "text/html" }); r.end(d); } }); });
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`; const browser = await chromium.launch(); const problems = [], result = {};
  for (const [name, vp] of [["desktop", { width: 1360, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const page = await (await browser.newContext({ viewport: vp })).newPage();
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${name} console: ${m.text()}`); }); page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
    await page.route("**/*", async (route) => {
      const u = route.request().url();
      if (u.startsWith(base + "api/feeds")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ feed: "x", data: null }) });
      if (u.startsWith(base)) return route.continue();
      if (u.includes("fonts.g")) return route.fulfill({ contentType: "text/css", body: "" });
      if (u.includes("api.hyperliquid.xyz")) return route.fulfill({ contentType: "application/json", body: "[]" });
      if (u.includes("supabase.co/functions")) return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(status) });
      return route.abort();
    });
    await page.goto(base + "#scanner"); await page.waitForTimeout(1800);
    const sc = await page.evaluate(() => ({ title: document.getElementById("pageTitle").innerText, rows: document.querySelectorAll("#scanBody tbody tr").length, cards: document.querySelectorAll(".sc-card").length, deriv: document.querySelectorAll("#scanBody .mk-tile").length,
      text: document.getElementById("scanBody").innerText.slice(0, 400), pill: document.getElementById("tradeState").innerText, groups: [...document.querySelectorAll(".tabs-in > .nav-label")].map((x) => x.innerText), hScroll: document.documentElement.scrollWidth > innerWidth + 1 }));
    await page.screenshot({ path: path.join(outDir, `scanner_${name}.png`), fullPage: true });
    await page.click('.tab[data-v="committee"]'); await page.waitForTimeout(900);
    const cm = await page.evaluate(() => ({ title: document.getElementById("pageTitle").innerText, stages: document.querySelectorAll("details.cm[open] .cm-flow > li").length, summary: (document.querySelector("details.cm > summary") || {}).innerText, note: (document.querySelector("#committeeBody > .mk-note") || {}).innerText, hScroll: document.documentElement.scrollWidth > innerWidth + 1 }));
    await page.screenshot({ path: path.join(outDir, `committee_${name}.png`), fullPage: true });
    await page.click('.tab[data-v="tower"]'); await page.waitForTimeout(1200);
    const tw = await page.evaluate(() => ({ seats: ["analyst", "bull", "bear", "judge", "trader", "riskdebate", "cio"].map((id) => !!document.querySelector(`.emp[data-emp="${id}"]`)), cio: (document.querySelector('.emp[data-emp="cio"] .say') || {}).innerText }));
    result[name] = { sc, cm, tw };
  }
  await browser.close(); srv.close();
  console.log(JSON.stringify({ result, problems }, null, 1));
})();
