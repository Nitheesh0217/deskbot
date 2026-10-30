// Browser smoke for truthful worker states in the tower (mocked network). Everything injected here is SYNTHETIC TEST DATA:
// no AI provider configured, one fresh scan with per-worker telemetry, and one keyed manager work-log row.
// Usage: node scripts/web_smoke/workers.cjs fixture.json outDir
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const [fixturePath, outDir] = process.argv.slice(2); fs.mkdirSync(outDir, { recursive: true });
const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8")); const web = path.join(__dirname, "..", "..", "web");
const iso = (ms) => new Date(Date.now() - ms).toISOString();
const status = JSON.parse(JSON.stringify(fx.status));
if (status.lastRun) status.lastRun.ts = iso(2 * 60e3);
status.chat = { enabled: true, ai: [] }; status.ai = { providers: [], agentAi: true, deskWorkflow: true, newsAi: true, newsMode: "shadow" };
status.scan = { ts: iso(6 * 60e3), ms: 2100, note: "TEST DATA", markets: [{ sym: "BTC", ok: true, priority: 1, barT: Date.now() - 7 * 60e3, setups: [], call: { lean: "SHORT", votes: -4, source: "trend vote", cautions: [] } }, { sym: "GOLD", ok: true, priority: 1, barT: Date.now() - 7 * 60e3, setups: [], call: { lean: "NONE", votes: 1, cautions: [] } }],
  deriv: [{ currency: "BTC", dvol: { last: 36.9 }, options: { putCallOI: 0.6 }, futures: [], errors: [] }, { currency: "ETH", errors: ["deribit 503"] }], work: { calls: { new: 0, scored: 2, open: 3 }, tracker: { new: 0, resolved: 0, open: 2 }, errors: [] } };
status.track = { calls: [{ sym: "BTC", priority: 1, scored: 2, open: 1, hitRate: 50, verdict: "collecting (2/30)" }], markets: [{ sym: "BTC", priority: 1, resolved: 0, open: 2 }], promotion: "TEST DATA" };
status.agents = [{ agent: "manager", ts: iso(3 * 60e3), symbol: "BTC", input_summary: "V5-TEST TP2 @ 80879.3", output: { symbol: "BTC", ref: "V5-TEST", action: "target_fill", key: "V5-TEST:target_fill:tp2:1", authority: "deterministic" } }, ...(status.agents || [])];
const srv = http.createServer((q, r) => { const f = path.join(web, q.url === "/" ? "index.html" : q.url.split("?")[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".svg") ? "image/svg+xml" : "text/html" }); r.end(d); } }); });
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`; const browser = await chromium.launch(); const problems = [], result = {};
  for (const [name, vp] of [["desktop", { width: 1360, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const page = await (await browser.newContext({ viewport: vp, reducedMotion: "reduce" })).newPage();
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${name} console: ${m.text()}`); }); page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
    await page.route("**/*", (route) => { const u = route.request().url(); if (u.startsWith(base + "api/")) return route.fulfill({ contentType: "application/json", body: '{"data":null}' }); if (u.startsWith(base)) return route.continue(); if (u.includes("fonts.g")) return route.fulfill({ contentType: "text/css", body: "" }); if (u.includes("supabase.co/functions")) return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(status) }); if (u.includes("hyperliquid")) return route.fulfill({ contentType: "application/json", body: "[]" }); return route.abort(); });
    await page.goto(base + "#tower"); await page.waitForTimeout(1800);
    // visible label on every screenshot: these images are not production data
    await page.evaluate((sha) => { const b = document.createElement("div"); b.textContent = `SYNTHETIC TEST DATA · mocked network · build ${sha}`; b.setAttribute("style", "position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:9999;background:#d0414f;color:#fff;font:700 12px/1 monospace;padding:6px 10px;border-radius:6px;letter-spacing:.06em;pointer-events:none"); document.body.appendChild(b); }, process.env.BUILD_SHA || "local");
    const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".emp")].map((b) => [b.dataset.emp, b.dataset.state])));
    const drawers = {};
    for (const id of ["cio", "assistant", "scanner", "options", "manager"]) { await page.click(`.emp[data-emp="${id}"]`); await page.waitForTimeout(200); drawers[id] = await page.evaluate(() => document.getElementById("drawer").innerText.replace(/\s+/g, " ").slice(0, 420)); if (id === "cio" || id === "scanner") await page.screenshot({ path: path.join(outDir, `drawer_${id}_${name}.png`) }); }
    await page.screenshot({ path: path.join(outDir, `tower_${name}.png`), fullPage: name === "desktop" });
    result[name] = { seats: Object.keys(states).length, states, drawers, hScroll: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1) };
  }
  await browser.close(); srv.close(); console.log(JSON.stringify({ result, problems }, null, 1));
})();
