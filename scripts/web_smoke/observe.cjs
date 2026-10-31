// Browser smoke for the System view's data-freshness cards and decision receipts (mocked network). Every value injected here is
// SYNTHETIC TEST DATA: per-timeframe frames (one stale 4h frame with 2 missing bars) and receipts for one evaluated bar.
// Usage: node scripts/web_smoke/observe.cjs fixture.json outDir
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const [fixturePath, outDir] = process.argv.slice(2); fs.mkdirSync(outDir, { recursive: true });
const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8")); const web = path.join(__dirname, "..", "..", "web");
const iso = (ms) => new Date(Date.now() - ms).toISOString();
const status = JSON.parse(JSON.stringify(fx.status));
if (status.lastRun) status.lastRun.ts = iso(2 * 60e3);
const now = Date.now(), M5 = 3e5, fr = (ms, src, ageBars, gaps) => ({ source: src, lastClosedBarT: Math.floor(now / ms) * ms - 1 - ageBars * ms, receivedAtMs: now - 60e3, bars: 400, gaps });
status.lastRun = { ...(status.lastRun || {}), sources: { m5: 'hyperliquid', m15: 'hyperliquid', h1: 'hyperliquid', h4: 'hyperliquid' },
  frames: { m5: fr(M5, 'hyperliquid', 0, 0), m15: fr(3 * M5, 'hyperliquid', 0, 0), h1: fr(12 * M5, 'hyperliquid', 0, 0), h4: fr(48 * M5, 'hyperliquid', 3, 2) },
  receipts: [{ strategy: 'HTF_TREND', outcome: 'WAIT', code: 'NOT_SELECTED', reason: 'Position already open', barT: now - M5 }, { strategy: 'SWEEP_REV', outcome: 'GATE_REJECTED', reason: 'Score 59 < 72', barT: now - M5 },
    { strategy: 'D_BEARTRAP', outcome: 'NOT_DUE', reason: 'Waits for daily close', barT: now - M5 }, { strategy: 'TREND_MTF', outcome: 'NO_SETUP', reason: 'No 5m SuperTrend flip', barT: now - M5 }, { strategy: 'EMA_CROSS', outcome: 'DISABLED', reason: 'Strategy switched off', barT: now - M5 }] };
if (status.state) status.state.last_run = status.lastRun;
const srv = http.createServer((q, r) => { const f = path.join(web, q.url === "/" ? "index.html" : q.url.split("?")[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".svg") ? "image/svg+xml" : "text/html" }); r.end(d); } }); });
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`; const browser = await chromium.launch(); const problems = [], result = {};
  for (const [name, vp] of [["desktop", { width: 1360, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const page = await (await browser.newContext({ viewport: vp, reducedMotion: "reduce" })).newPage();
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${name} console: ${m.text()}`); }); page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
    await page.route("**/*", (route) => { const u = route.request().url(); if (u.startsWith(base + "api/")) return route.fulfill({ contentType: "application/json", body: '{"data":null}' }); if (u.startsWith(base)) return route.continue(); if (u.includes("fonts.g")) return route.fulfill({ contentType: "text/css", body: "" }); if (u.includes("supabase.co/functions")) return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(status) }); if (u.includes("hyperliquid")) return route.fulfill({ contentType: "application/json", body: "[]" }); return route.abort(); });
    await page.goto(base + "#system"); await page.waitForTimeout(1800);
    await page.evaluate((sha) => { const b = document.createElement("div"); b.textContent = `SYNTHETIC frames + receipts · mocked network · build ${sha}`; b.setAttribute("style", "position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:9999;background:#d0414f;color:#fff;font:700 12px/1 monospace;padding:6px 10px;border-radius:6px;letter-spacing:.06em;pointer-events:none"); document.body.appendChild(b); }, process.env.BUILD_SHA || "local");
    result[name] = await page.evaluate(() => ({ cells: [...document.querySelectorAll('.obs-cell')].map((c) => c.dataset.tf + ':' + c.dataset.status), text: (document.getElementById('v-system').innerText || '').replace(/\s+/g, ' ').slice(0, 600), hScroll: document.documentElement.scrollWidth > innerWidth + 1 }));
    await page.evaluate(() => { const e = document.querySelector('.obs-book') || document.getElementById('v-system'); e.scrollIntoView(); });
    await page.screenshot({ path: path.join(outDir, `observe_${name}.png`) });
  }
  await browser.close(); srv.close(); console.log(JSON.stringify({ result, problems }, null, 1));
})();
