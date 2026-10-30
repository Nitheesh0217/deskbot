// Browser smoke for the W3 strategy coverage matrix (mocked network). The counters below are SYNTHETIC, modelled on the shape of
// the production counters; every screenshot carries a visible SYNTHETIC banner. Usage: node scripts/web_smoke/strategies.cjs fixture.json outDir
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const [fixturePath, outDir] = process.argv.slice(2); fs.mkdirSync(outDir, { recursive: true });
const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8")); const web = path.join(__dirname, "..", "..", "web");
const now = Date.now(), T = (m) => Math.floor((now - m * 60e3) / 300e3) * 300e3 - 1, since = now - 7 * 3600e3;
const c = (o) => ({ since, bars: 81, due: 27, completed: 27, windowClosed: 0, skippedData: 0, failed: 0, disabledBars: 0, notDue: 54, noSetup: 27, setups: 0, gateRejected: 0, portfolioBlocked: 0, notSelected: 0, entered: 0, lastEvalT: T(4), lastCompletedT: T(10), lastSetupT: null, lastCode: "NOT_DUE", lastReason: "Waits for 15m close", lastDueT: T(10), lastDueCode: "NO_SETUP", lastDueReason: "No setup", reasons: {}, ...o });
const off = c({ due: 0, completed: 0, noSetup: 0, disabledBars: 81, notDue: 0, lastDueT: null, lastDueCode: null, lastCode: "DISABLED", lastReason: "Strategy switched off" });
const cov = { D_BEARTRAP: c({ due: 1, completed: 1, noSetup: 1, lastDueT: T(30), reasons: { "NO_SETUP: No daily bear-trap reclaim": 1 } }), D_THRUST: c({ due: 7, completed: 7, noSetup: 7, lastDueT: T(30), reasons: { "NO_SETUP: No 1H EMA20 pullback": 6 } }),
  HTF_TREND: c({ due: 2, completed: 2, noSetup: 1, setups: 1, entered: 1, lastDueT: T(30), lastDueCode: "ENTERED", lastDueReason: "Entered" }), TREND_MTF: c({ due: 81, completed: 81, noSetup: 81, lastDueT: T(4), reasons: { "NO_SETUP: No 5m SuperTrend flip": 81 } }),
  SWEEP_REV: c({ noSetup: 26, setups: 1, gateRejected: 1, reasons: { "GATE_REJECTED: Score # < #": 1, "NO_SETUP: No sweep + rejection on 15m": 26 } }), VWAP_REVERT: c({ noSetup: 0, gateRejected: 27, lastDueCode: "GATE_REJECTED", reasons: { "GATE_REJECTED: Regime TREND (needs RANGE)": 16, "GATE_REJECTED: Regime MIXED (needs RANGE)": 11 } }),
  SESSION_BO: c({ noSetup: 0, windowClosed: 27, lastDueCode: "NOT_DUE", lastDueReason: "Outside London/NY open window" }), HTF_SWEEP: off, EMA_CROSS: off, SSR: off, EMA_PB: off };
const status = JSON.parse(JSON.stringify(fx.status));
// status.state IS the BTC book state; keep the fixture's open position and only relabel its strategy
status.state = { ...(status.state || {}), cov, covMeta: { since, evalBars: 81, missedBars: 0, missedDue: { "15m": 0, "1h": 0, "4h": 0, "1d": 0 }, missingDue: { "15m": 0, "1h": 0, "4h": 0, "1d": 0 }, lastEvalT: T(4) } };
if (status.state.pos) status.state.pos = { ...status.state.pos, strategy: "HTF_TREND" };
status.lastRun = { ...(status.lastRun || {}), ts: new Date(now - 3 * 60e3).toISOString(), risk: 0.02 };
status.registry = { strategies: Object.keys(cov), optIn: ["HTF_SWEEP", "EMA_CROSS", "SSR", "EMA_PB"] };
status.config = { ...(status.config || {}), RISK_SCALE: { D_BEARTRAP: 1, D_THRUST: 1, HTF_TREND: 1, TREND_MTF: 1, SWEEP_REV: 1, VWAP_REVERT: 1, SESSION_BO: 1, HTF_SWEEP: 0, EMA_CROSS: 0, SSR: 0, EMA_PB: 0 } };
const tr = (o) => ({ id: "T-" + Math.random().toString(36).slice(2, 7), dir: "short", entry: 81615, exit_avg: 80900, fees: 0.3, funding: 0, reason: "TP1→STOP", open_t: new Date(now - 10 * 3600e3).toISOString(), ...o });
status.trades = [{ symbol: "BTC", strategy: "SWEEP_REV", r: 1.3, net: 4.4, close_t: new Date(now - 4 * 3600e3).toISOString() }, { symbol: "BTC", strategy: "SWEEP_REV", r: -1, net: -3.4, close_t: new Date(now - 8 * 3600e3).toISOString() }, { symbol: "BTC", strategy: "SESSION_BO", r: -0.2, net: -1.5, close_t: new Date(now - 30 * 3600e3).toISOString() }].map(tr);
const srv = http.createServer((q, r) => { const f = path.join(web, q.url === "/" ? "index.html" : q.url.split("?")[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".svg") ? "image/svg+xml" : "text/html" }); r.end(d); } }); });
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`; const browser = await chromium.launch(); const problems = [], result = {};
  for (const [name, vp] of [["desktop", { width: 1360, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const page = await (await browser.newContext({ viewport: vp, reducedMotion: "reduce" })).newPage();
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${name} console: ${m.text()}`); }); page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
    await page.route("**/*", (route) => { const u = route.request().url(); if (u.startsWith(base + "api/")) return route.fulfill({ contentType: "application/json", body: '{"data":null}' }); if (u.startsWith(base)) return route.continue(); if (u.includes("fonts.g")) return route.fulfill({ contentType: "text/css", body: "" }); if (u.includes("supabase.co/functions")) return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(status) }); if (u.includes("hyperliquid")) return route.fulfill({ contentType: "application/json", body: "[]" }); return route.abort(); });
    await page.goto(base + "#strategies"); await page.waitForTimeout(1800);
    await page.evaluate((sha) => { const b = document.createElement("div"); b.textContent = `SYNTHETIC TEST DATA · mocked network · build ${sha}`; b.setAttribute("style", "position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:9999;background:#d0414f;color:#fff;font:700 12px/1 monospace;padding:6px 10px;border-radius:6px;pointer-events:none"); document.body.appendChild(b); }, process.env.BUILD_SHA || "local");
    await page.evaluate(() => document.getElementById("covMatrix").scrollIntoView());
    result[name] = await page.evaluate(() => ({ rows: document.querySelectorAll("#covMatrix tbody tr").length, text: document.getElementById("covMatrix").innerText.replace(/\s+/g, " ").slice(0, 600), full: /\(full\)/.test(document.getElementById("stratList").innerText), risk: (document.getElementById("stratList").innerText.match(/[\d.]+% of equity at risk per trade/) || [""])[0], hScroll: document.documentElement.scrollWidth > innerWidth + 1 }));
    await page.screenshot({ path: path.join(outDir, `strategies_${name}.png`) });
  }
  await browser.close(); srv.close(); console.log(JSON.stringify({ result, problems }, null, 1));
})();
