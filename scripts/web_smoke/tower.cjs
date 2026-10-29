// Browser smoke test for the whole dashboard with mocked network, focused on the Trading Tower.
// Usage: node scripts/web_smoke/tower.cjs fixture.json outDir   (fixture from make_fixture.ts). Agent rows below are TEST DATA to exercise the UI.
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const [fixturePath, outDir] = process.argv.slice(2); fs.mkdirSync(outDir, { recursive: true });
const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8")); const web = path.join(__dirname, "..", "..", "web");
const nowIso = (ms = 0) => new Date(Date.now() - ms).toISOString();
const status = JSON.parse(JSON.stringify(fx.status));
status.agents = [
  { symbol: "BTC", ts: nowIso(60e3), agent: "chart", input_summary: "1m/5m/15m/1h/4h", output: {} },
  { symbol: "BTC", ts: nowIso(60e3), agent: "signals", input_summary: "1 signal(s) passed strategy rules", output: { signals: [] } },
  { symbol: "BTC", ts: nowIso(60e3), agent: "validator", input_summary: "validator advisory (off)", output: { enforcing: false, verdicts: [{ strategy: "HTF_TREND", dir: "long", ok: true, roomR: 2.1 }] } },
  { symbol: "BTC", ts: nowIso(60e3), agent: "risk", input_summary: "body-stop off", output: { plans: [{ strategy: "HTF_TREND", dir: "long", stop: 80000, stopPct: 1.2, tp1: 82000 }] } },
  { symbol: "BTC", ts: nowIso(50e3), agent: "desk-checks", input_summary: "x long HTF_TREND", output: { checks: [{ level: "warn", code: "round_trip_cost" }] } },
  { symbol: "BTC", ts: nowIso(45e3), agent: "desk-analyst", input_summary: "x", output: { summary: "Breakout with trend alignment.", key_facts: [] } },
  { symbol: "BTC", ts: nowIso(44e3), agent: "desk-bear", input_summary: "x", output: { case: "Costs are heavy." } },
  { symbol: "BTC", ts: nowIso(43e3), agent: "desk-bull", input_summary: "x", output: { case: "Clean breakout." } },
  { symbol: "BTC", ts: nowIso(42e3), agent: "desk-judge", input_summary: "x", output: { verdict: "agree", reason: "Rules satisfied." } },
];
status.curve = Array.from({ length: 120 }, (_, i) => ({ ts: nowIso((120 - i) * 3e5), equity: 350 + Math.sin(i / 9) * 2 + i * 0.03 })); // TEST DATA
status.experiment = { started: nowIso(864e5), open: 1, experiment: "FILTER-1", baseline: { n: 12, sumR: -1.4, meanR: -0.117, net: -4.1 }, caveats: ["", "", "A difference is not trading skill until replay discrepancies are resolved."],   // TEST DATA
  arms: [{ arm: "rules", decided: 12, abstained: 0, lateOrMissing: 0, kept: { n: 8, sumR: 0.6, meanR: 0.075, net: 2 }, skipped: { n: 4, sumR: -2, meanR: -0.5, net: -6 }, meanDeltaR: null, ci95: null, result: "INSUFFICIENT_DATA", calls: 0, ms: 0 },
    { arm: "ai", decided: 0, abstained: 12, lateOrMissing: 0, kept: { n: 0, sumR: 0, meanR: null, net: 0 }, skipped: { n: 0, sumR: 0, meanR: null, net: 0 }, meanDeltaR: null, ci95: null, result: "INSUFFICIENT_DATA", calls: 0, ms: 0 }] };
status.chat = { enabled: false, ai: [] };
const srv = http.createServer((q, r) => { const f = path.join(web, q.url === "/" ? "index.html" : q.url.split("?")[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".svg") ? "image/svg+xml" : "text/html" }); r.end(d); } }); });
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`; const browser = await chromium.launch(); const problems = [], result = {};
  for (const [name, vp] of [["desktop", { width: 1360, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const page = await (await browser.newContext({ viewport: vp })).newPage();
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${name} console: ${m.text()}`); }); page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
    await page.route("**/*", async (route) => {
      const u = route.request().url();
      if (u.startsWith(base + "api/feeds")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ feed: "calendar", data: [{ title: "FOMC Statement", country: "USD", date: new Date(Date.now() + 7200e3).toISOString(), impact: "High" }] }) });   // TEST DATA
      if (u.startsWith(base)) return route.continue();
      if (u.includes("fonts.g")) return route.fulfill({ contentType: "text/css", body: "" });
      if (u.includes("api.hyperliquid.xyz")) { const b = JSON.parse(route.request().postData()); if (b.type === "allMids") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ BTC: "81234.5" }) });
        const { interval, startTime, endTime } = b.req; const rows = (fx.frames[interval] || []).filter((x) => x[0] >= startTime && x[0] <= endTime);
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(rows.map((x) => ({ t: x[0], T: x[0], o: String(x[1]), h: String(x[2]), l: String(x[3]), c: String(x[4]), v: String(x[5]) }))) }); }
      if (u.includes("supabase.co/functions")) return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(status) });
      return route.abort();
    });
    await page.goto(base + "#tower"); await page.waitForTimeout(1200);
    const sawPacket = await page.evaluate(async () => { const seen = { pkt: 0, trail: 0, fresh: 0, typing: 0, motion: !!(window.Motion && window.Motion.animate) };
      for (let k = 0; k < 40; k++) { await new Promise((r) => setTimeout(r, 100)); seen.pkt = Math.max(seen.pkt, document.querySelectorAll(".pkt .av.mini").length); seen.trail = Math.max(seen.trail, document.querySelectorAll("#trails path").length);
        seen.fresh = Math.max(seen.fresh, document.querySelectorAll(".say.fresh").length); seen.typing = Math.max(seen.typing, document.querySelectorAll(".emp.typing").length); } return seen; });
    await page.screenshot({ path: path.join(outDir, `tower_${name}_motion.png`) });
    await page.waitForTimeout(9000);
    await page.click('.emp[data-emp="judge"]'); await page.waitForTimeout(300);
    const info = await page.evaluate(() => ({ floors: document.querySelectorAll(".floor").length, emps: document.querySelectorAll(".emp").length, desks: document.querySelectorAll(".sdesk").length,
      working: document.querySelectorAll('.emp[data-status="working"]').length, off: document.querySelectorAll('.emp[data-status="off"]').length,
      judge: document.querySelector('.emp[data-emp="judge"] .say').innerText, drawer: document.getElementById("drawer").innerText.slice(0, 160), now: document.getElementById("gNow").innerText, pct: document.getElementById("gPct").innerText, px: document.getElementById("towerPx").innerText,
      feed: document.querySelectorAll("#towerFeed div").length, steps: document.querySelectorAll("#towerFlow .step").length, fams: document.querySelectorAll(".fam").length, rdesks: document.querySelectorAll(".rdesk").length,
      board: document.getElementById("expBoard").innerText.slice(0, 200), allocator: document.querySelector('.emp[data-emp="pm"] .say').innerText, steward: document.querySelector('.emp[data-emp="steward"] .say').innerText, nora: document.querySelector('.emp[data-emp="news"] .say').innerText, hScroll: document.documentElement.scrollWidth > innerWidth + 1 }));
    info.packetsSeen = sawPacket; result[name] = info;
    await page.screenshot({ path: path.join(outDir, `tower_${name}.png`), fullPage: true });
    for (const v of ["chart", "strategies", "desk"]) { await page.click(`.tab[data-v="${v}"]`); await page.waitForTimeout(v === "chart" ? 2800 : 700); await page.screenshot({ path: path.join(outDir, `${v}_${name}.png`), fullPage: true }); }
    result[name].setupCard = await page.evaluate(() => (document.getElementById("setupCard") || {}).innerText.slice(0, 120));
    result[name].strategyCards = await page.evaluate(() => document.querySelectorAll("#stratList .strat").length);
  }
  await browser.close(); srv.close();
  console.log(JSON.stringify({ result, problems }, null, 1)); process.exit(problems.length ? 1 : 0);
})();
