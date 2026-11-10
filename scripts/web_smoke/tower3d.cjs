// Browser smoke for the Trading Tower building view (web/tower3d.js), mocked network. Everything injected here is SYNTHETIC TEST DATA
// (same shape as scripts/web_smoke/workers.cjs) and every screenshot carries a visible SYNTHETIC banner.
// Usage: node scripts/web_smoke/tower3d.cjs fixture.json outDir   (fixture from make_fixture.ts)
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const [fixturePath, outDir] = process.argv.slice(2); fs.mkdirSync(outDir, { recursive: true });
const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8")); const web = path.join(__dirname, "..", "..", "web");
const iso = (ms) => new Date(Date.now() - ms).toISOString();
const status = JSON.parse(JSON.stringify(fx.status));
if (status.lastRun) status.lastRun.ts = iso(2 * 60e3);
status.chat = { enabled: true, ai: [] }; status.ai = { providers: [], agentAi: true, deskWorkflow: true, newsAi: true, newsMode: "shadow" };
status.scan = { ts: iso(6 * 60e3), ms: 2100, note: "TEST DATA", markets: [{ sym: "BTC", ok: true, priority: 1, barT: Date.now() - 7 * 60e3, setups: [] }, { sym: "GOLD", ok: true, priority: 1, barT: Date.now() - 7 * 60e3, setups: [] }],
  deriv: [{ currency: "BTC", dvol: { last: 36.9 }, options: { putCallOI: 0.6 }, futures: [], errors: [] }, { currency: "ETH", errors: ["deribit 503"] }], work: { calls: { new: 0, scored: 2, open: 3 }, tracker: { new: 0, resolved: 0, open: 2 }, errors: [] } };
status.track = { calls: [{ sym: "BTC", priority: 1, scored: 2, open: 1 }], markets: [{ sym: "BTC", priority: 1, resolved: 0, open: 2 }], promotion: "TEST DATA" };
status.agents = [{ agent: "manager", ts: iso(3 * 60e3), symbol: "BTC", input_summary: "V5-TEST TP2 @ 80879.3", output: { symbol: "BTC", ref: "V5-TEST", action: "target_fill" } }, ...(status.agents || [])];
const type = (f) => (f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".svg") ? "image/svg+xml" : "text/html");
const srv = http.createServer((q, r) => { const f = path.join(web, q.url === "/" ? "index.html" : q.url.split("?")[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { "Content-Type": type(f) }); r.end(d); } }); });
const sha = process.env.BUILD_SHA || "local";
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`; const browser = await chromium.launch(); const problems = [], result = {};
  const open = async (name, opts) => {
    const page = await (await browser.newContext(opts)).newPage();
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${name} console: ${m.text()}`); }); page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
    await page.route("**/*", (route) => { const u = route.request().url(); if (u.startsWith(base + "api/")) return route.fulfill({ contentType: "application/json", body: '{"data":null}' }); if (u.startsWith(base)) return route.continue(); if (u.includes("fonts.g")) return route.fulfill({ contentType: "text/css", body: "" }); if (u.includes("supabase.co/functions")) return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(status) }); if (u.includes("hyperliquid")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ BTC: "81234.5" }) }); return route.abort(); });
    await page.goto(base + "#tower"); await page.waitForTimeout(1800);
    await page.evaluate((s) => { const b = document.createElement("div"); b.textContent = `SYNTHETIC fixture data · mocked network · build ${s}`; b.setAttribute("style", "position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:9999;background:#d0414f;color:#fff;font:700 11px/1.3 monospace;padding:5px 9px;border-radius:6px;letter-spacing:.04em;pointer-events:none;max-width:92vw;text-align:center"); document.body.appendChild(b); }, sha);
    return page;
  };
  const shot = async (page, file) => { await page.mouse.move(2, 600); await page.waitForTimeout(500); await page.screenshot({ path: path.join(outDir, file) }); };
  const top = (page, sel) => page.evaluate((s) => { const n = document.querySelector(s); window.scrollTo(0, window.scrollY + n.getBoundingClientRect().top - 110); }, sel);
  for (const [name, vp, seat] of [["desktop", { width: 1360, height: 900 }, "cio"], ["mobile", { width: 390, height: 844 }, "pm"]]) {
    const page = await open(name, { viewport: vp }); const r = (result[name] = {});
    // layout toggle: List shows the original tower, Building shows the 3D view; the choice is remembered
    await page.click('.t3d-toggle [data-mode="list"]'); r.listShowsBld = await page.isVisible("#bld .emp"); r.listHides3d = !(await page.isVisible("#t3d"));
    await page.click('.t3d-toggle [data-mode="building"]'); r.stored = await page.evaluate(() => localStorage.getItem("deskbot.towerView"));
    r.building = await page.evaluate(() => { const S = window.DeskTower3D.scene(window.DeskTower.build({}, Date.now()).staff, window.DeskTower.ROSTER, window.DeskTower.FLOORS);
      return { floors: document.querySelectorAll(".t3d-floor").length, windows: document.querySelectorAll(".t3d-win").length, roster: Object.keys(window.DeskTower.ROSTER).length, sceneSeats: S.seats,
        animatedNotRunning: [...document.querySelectorAll(".t3d-win[data-anim]")].filter((w) => w.dataset.state !== "RUNNING").length, data: document.querySelector(".t3d-chips").innerText.replace(/\s+/g, " "),
        floorOrder: [...document.querySelectorAll(".t3d-floor")].map((f) => f.dataset.floor).join(","), hScroll: document.documentElement.scrollWidth > innerWidth + 1 }; });
    await top(page, ".t3d-toggle"); await shot(page, `building_${name}.png`);
    await page.click('.t3d-floor[data-floor="portfolio"]'); await page.waitForTimeout(600);
    r.floor = await page.evaluate(() => ({ desks: document.querySelectorAll(".t3d-desk").length, typing: [...document.querySelectorAll(".t3d-desk[data-anim]")].map((d) => d.dataset.seat + ":" + d.dataset.state),
      still: [...document.querySelectorAll(".t3d-desk:not([data-anim])")].map((d) => d.dataset.seat + ":" + d.dataset.state), animatingStill: [...document.querySelectorAll(".t3d-desk:not([data-anim])")].filter((d) => d.getAnimations({ subtree: true }).some((a) => /t3d(Code|Type|Glow|Win)/.test(a.animationName))).length,
      focus: document.activeElement && document.activeElement.className, hScroll: document.documentElement.scrollWidth > innerWidth + 1 }));
    await top(page, "#t3d"); await shot(page, `floor_${name}.png`);
    await page.click(`.t3d-desk[data-seat="${seat}"]`); await page.waitForTimeout(400);
    r.panel = await page.evaluate(() => document.querySelector(".t3d-panel").innerText.replace(/\s+/g, " ").slice(0, 600));
    await page.evaluate((m) => { const p = document.querySelector(".t3d-panel"); window.scrollTo(0, window.scrollY + p.getBoundingClientRect().top - (m ? 330 : 420)); }, name === "mobile");
    await shot(page, `worker_${name}.png`);
    // keyboard: Escape clears the worker, Escape again returns to the building with focus on the floor; Enter opens a floor
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    r.keyboard = { backFocus: await page.evaluate(() => document.activeElement.dataset.floor || null) };
    await page.focus('.t3d-floor[data-floor="data"]'); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
    r.keyboard.enterOpens = await page.evaluate(() => document.querySelector("#t3d").dataset.view + " " + (document.querySelector(".t3d-roomhead h3") || {}).innerText);
    if (name === "desktop") { await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); }); r.pausedWhenHidden = await page.evaluate(() => document.querySelector("#t3d").classList.contains("paused")); }
    await page.close();
  }
  // reduced motion: no tilt, no running animations in the building or a floor
  const rm = await open("reduced", { viewport: { width: 1360, height: 900 }, reducedMotion: "reduce" });
  result.reducedMotion = await rm.evaluate(async () => { const a = { tilt: getComputedStyle(document.querySelector(".t3d-bld")).transform, anims: document.querySelector("#t3d").getAnimations({ subtree: true }).length };
    document.querySelector('.t3d-floor[data-floor="portfolio"]').click(); await new Promise((r) => setTimeout(r, 300)); a.floorAnims = document.querySelector("#t3d").getAnimations({ subtree: true }).length; return a; });
  await browser.close(); srv.close();
  console.log(JSON.stringify({ result, problems }, null, 1)); process.exit(problems.length ? 1 : 0);
})();
