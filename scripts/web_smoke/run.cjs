// Browser smoke test for the dashboard chart/setup view with mocked network. Usage: node scripts/web_smoke/run.cjs fixture.json lightweight-charts.standalone.production.js outDir
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const [fixturePath, lwPath, outDir] = process.argv.slice(2); fs.mkdirSync(outDir, { recursive: true });
const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8")); const web = path.join(__dirname, "..", "..", "web");
const srv = http.createServer((q, r) => { const f = path.join(web, q.url === "/" ? "index.html" : q.url.split("?")[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".html") ? "text/html" : "text/plain" }); r.end(d); } }); });
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`; const browser = await chromium.launch(); const problems = []; let result = {};
  for (const [name, vp] of [["mobile", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 900 }]]) {
    const page = await (await browser.newContext({ viewport: vp })).newPage();
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${name} console: ${m.text()}`); }); page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
    await page.route("**/*", async (route) => {
      const u = route.request().url();
      if (u.startsWith(base)) return route.continue();
      if (u.includes("unpkg.com/lightweight-charts")) return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(lwPath) });
      if (u.includes("fonts.g")) return route.fulfill({ contentType: "text/css", body: "" });
      if (u.includes("api.hyperliquid.xyz")) { const b = JSON.parse(route.request().postData()); const { interval, startTime, endTime } = b.req; const rows = (fx.frames[interval] || []).filter((x) => x[0] >= startTime && x[0] <= endTime);
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(rows.map((x) => ({ t: x[0], T: x[0], o: String(x[1]), h: String(x[2]), l: String(x[3]), c: String(x[4]), v: String(x[5]) }))) }); }
      if (u.includes("supabase.co/functions")) return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(fx.status) });
      return route.abort();
    });
    await page.goto(base); await page.waitForTimeout(800);
    await page.evaluate(() => { const b = [...document.querySelectorAll("nav button, .tabs button, [data-tab]")].find((x) => /chart/i.test(x.textContent || x.dataset.tab || "")); if (b) b.click(); });
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => ({ prims: (window.CH && CH.prims && CH.prims.length) || (typeof CH !== "undefined" ? CH.prims.length : -1), setup: (document.getElementById("setupCard") || {}).innerText || "", zones: (window.__zoneRead && window.__zoneRead.zones.map((z) => z.label + " " + z.bot.toFixed(0) + "-" + z.top.toFixed(0))) || [], lwMsg: (document.getElementById("lwMsg") || {}).innerText }));
    result[name] = info; await page.screenshot({ path: path.join(outDir, `chart_${name}.png`), fullPage: true });
    await page.evaluate(() => { const b = [...document.querySelectorAll("nav button, .tabs button, [data-tab]")].find((x) => /overview|home|now/i.test(x.textContent || x.dataset.tab || "")); if (b) b.click(); }); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, `overview_${name}.png`), fullPage: true });
  }
  await browser.close(); srv.close();
  console.log(JSON.stringify({ result, problems }, null, 1));
  process.exit(problems.length ? 1 : 0);
})();
