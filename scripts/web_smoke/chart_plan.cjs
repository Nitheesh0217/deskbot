// Browser smoke for the chart plan (Part E). The position uses the STORED plan of BTC HTF_TREND short V5-1793318461202
// (dbv5_decisions D-V5-1793318461202); candles are SYNTHETIC around those prices; every screenshot carries a SYNTHETIC banner.
// Usage: node scripts/web_smoke/chart_plan.cjs fixture.json outDir
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const [fixturePath, outDir] = process.argv.slice(2); fs.mkdirSync(outDir, { recursive: true });
const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8")); const web = path.join(__dirname, "..", "..", "web");
const now = Date.now(), H = 3600e3;
const pos = { id: "V5-1793318461202", strategy: "HTF_TREND", dir: "short", entry: 77822.4324, stop: 80065.92995554466, stop0: 80065.92995554466, tp1: 74457.18606668302, tp2: 71091.93973336603, tp3: 64361.44706673206, tp1Done: false, tp2Done: false, tp3Done: false, openT: now - 2 * H, maxHoldH: 504, originalQty: 0.002940028069314983, remainingQty: 0.002940028069314983, closedQty: 0, riskAmt: 6.851913300748431, why: ["4H close beyond 55-bar low", "4H SuperTrend aligned", "Above/below 4H EMA50", "Stop 2×ATR4h"], exits: [], plan: [] };
const status = JSON.parse(JSON.stringify(fx.status)); status.state = { ...(status.state || {}), pos, cfg: { EXIT_MODE: "HOLD", TRADER_PARTS: "be" } }; status.lastRun = { ...(status.lastRun || {}), ts: new Date(now - 3 * 60e3).toISOString(), market: { ...((status.lastRun || {}).market || {}), price: 77300 } };
status.config = { ...(status.config || {}), EXIT_MODE: "HOLD", TRADER_PARTS: "be" };
// one SYNTHETIC closed trade before the open one, so the recorded-exit tag (chart marker + panel chip) has something to read
const closed = { symbol: "BTC", strategy: "SWEEP_REV", dir: "long", entry: 80400, exit_avg: 80520, net: -0.8, r: -0.12, fees: 0.4, funding: 0, open_t: new Date(now - 16 * H).toISOString(), close_t: new Date(now - 9 * H).toISOString(), reason: "TP1→STOP (BE/locked)" };
status.trades = [closed, ...(status.trades || [])];
// synthetic candles: drift from ~81k down to ~77.3k over the window, any interval
let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const bars = (ms, n) => { const out = []; let c = 81000; for (let i = 0; i < n; i++) { const t = Math.floor((now - (n - i) * ms) / ms) * ms, o = c; c = c * (1 - 0.0007 * (ms / H) ** 0.5 * (rnd() < 0.6 ? 1 : -1)) ; c = Math.max(c, 76800); const h = Math.max(o, c) * (1 + 0.002 * rnd()), l = Math.min(o, c) * (1 - 0.002 * rnd()); out.push({ t, T: t + ms - 1, o: String(o), h: String(h), l: String(l), c: String(i === n - 1 ? 77300 : c), v: "10" }); } return out; };
const MS = { "1m": 60e3, "5m": 3e5, "15m": 9e5, "1h": H, "4h": 4 * H, "1d": 24 * H };
const srv = http.createServer((q, r) => { const f = path.join(web, q.url === "/" ? "index.html" : q.url.split("?")[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".svg") ? "image/svg+xml" : "text/html" }); r.end(d); } }); });
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/`;
  const loading = /Loading the position plan/.test(fs.readFileSync(path.join(web, "index.html"), "utf8"));
  const browser = await chromium.launch(); const problems = [], result = {};
  for (const [name, vp] of [["desktop", { width: 1360, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const page = await (await browser.newContext({ viewport: vp, reducedMotion: "reduce" })).newPage();
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${name} console: ${m.text()}`); }); page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
    await page.route("**/*", async (route) => { const u = route.request().url();
      if (u.startsWith(base + "api/")) return route.fulfill({ contentType: "application/json", body: '{"data":null}' });
      if (u.startsWith(base)) return route.continue(); if (u.includes("fonts.g")) return route.fulfill({ contentType: "text/css", body: "" });
      if (u.includes("supabase.co/functions")) return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(status) });
      if (u.includes("api.hyperliquid.xyz")) { const b = JSON.parse(route.request().postData() || "{}"); if (b.type === "candleSnapshot") return route.fulfill({ contentType: "application/json", body: JSON.stringify(bars(MS[b.req.interval] || H, 400)) }); return route.fulfill({ contentType: "application/json", body: JSON.stringify({ BTC: "77300" }) }); }
      return route.abort(); });
    await page.goto(base + "#chart"); await page.waitForTimeout(2500);
    const banner = async () => page.evaluate((sha) => { if (document.getElementById("synth")) return; const b = document.createElement("div"); b.id = "synth"; b.textContent = `SYNTHETIC candles · stored plan of V5-1793318461202 · build ${sha}`; b.setAttribute("style", "position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:9999;background:#d0414f;color:#fff;font:700 12px/1 monospace;padding:6px 10px;border-radius:6px;pointer-events:none"); document.body.appendChild(b); }, process.env.BUILD_SHA || "local");
    await banner();
    const chips = await page.evaluate(() => { const q = (s) => [...document.querySelectorAll(s)].map((e) => e.innerText.replace(/\s+/g, " ").trim());
      return { header: q("#chartChips .pchip"), panel: q("#planPanel .plan-chips .pchip"), clockState: (document.querySelector('#chartChips [data-chip="clock"]') || {}).dataset?.state || null }; });
    if (!chips.header.some((t) => /^[+-]?\d+\.\d\dR open unrealised$/.test(t))) problems.push(`${name}: header live-R chip missing (${JSON.stringify(chips.header)})`);
    if (!chips.header.some((t) => /^held \d+[hm] of 504h \(\d+%\)/.test(t))) problems.push(`${name}: header hold clock missing (${JSON.stringify(chips.header)})`);
    if (!chips.panel.some((t) => /R open/.test(t)) || !chips.panel.some((t) => /^held /.test(t))) problems.push(`${name}: plan-panel chips missing (${JSON.stringify(chips.panel)})`);
    if (!chips.panel.some((t) => /^Last exit · STOP · /.test(t))) problems.push(`${name}: recorded exit tag missing from the panel (${JSON.stringify(chips.panel)})`);
    const panel = await page.evaluate(() => ({ text: document.getElementById("planPanel").innerText.replace(/\s+/g, " "), rows: document.querySelectorAll("#planPanel tbody tr").length, view: [...document.querySelectorAll("#planView button")].find((b) => b.getAttribute("aria-pressed") === "true").dataset.view, refs: document.querySelector('#layers input[data-layer="refs"]').checked, hScroll: document.documentElement.scrollWidth > innerWidth + 1 }));
    await page.evaluate(() => document.getElementById("chartChips").parentElement.scrollIntoView()); await page.screenshot({ path: path.join(outDir, `chart_price_${name}.png`) });
    await page.click('#planView button[data-view="plan"]'); await page.waitForTimeout(1500);
    await page.evaluate(() => document.getElementById("planView").scrollIntoView()); await page.screenshot({ path: path.join(outDir, `chart_plan_${name}.png`) });
    // context levels on: at most 5 "Ref ·" lines, nearest to price, grey dashed
    await page.click('#planView button[data-view="price"]'); await page.check('#layers input[data-layer="refs"]'); await page.waitForTimeout(1500);
    await page.mouse.move(2, 2); const refs = await page.evaluate(() => (CH.refs || []).map((x) => x.label)), refsPx = await page.evaluate(() => [(CH.refs || []).map((x) => Math.round(x.px)), CH.series.c.coordinateToPrice(0), CH.series.c.coordinateToPrice(400)]);
    if (!refs.length || refs.length > 5 || !refs.every((l) => /^Ref · /.test(l))) problems.push(`${name}: context refs not capped/labelled (${JSON.stringify(refs)})`);
    const hScrollRefs = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); if (hScrollRefs) problems.push(`${name}: horizontal scroll with refs on`);
    // whole chart card (header chips, plan panel, chart) as one image: fixed overlays hidden, a static SYNTHETIC banner on top
    await page.evaluate((sha) => { const card = document.getElementById("chartChips").closest(".card"); document.querySelectorAll(".bar, .fab, #synth").forEach((e) => (e.style.visibility = "hidden"));
      const b = document.createElement("div"); b.id = "synthCard"; b.textContent = `SYNTHETIC candles · stored plan of V5-1793318461202 · refs on · build ${sha}`; b.setAttribute("style", "background:#d0414f;color:#fff;font:700 12px/1.3 monospace;padding:6px 10px;border-radius:6px;margin-bottom:10px"); card.prepend(b); }, process.env.BUILD_SHA || "local");
    await page.waitForTimeout(400); await page.locator("#chartChips").locator("xpath=ancestor::div[contains(@class,'card')][1]").screenshot({ path: path.join(outDir, `chart_pro_${name}.png`) });
    await page.locator("#lwBox").screenshot({ path: path.join(outDir, `chart_levels_${name}.png`) });
    await page.evaluate(() => { document.getElementById("synthCard").remove(); document.querySelectorAll(".bar, .fab, #synth").forEach((e) => (e.style.visibility = "")); });
    await page.uncheck('#layers input[data-layer="refs"]');
    // error state: the candle source fails; the plan still comes from the stored position, without current price
    const ep = await (await browser.newContext({ viewport: vp, reducedMotion: "reduce" })).newPage();
    ep.on("pageerror", (e) => problems.push(`${name} error-state pageerror: ${e.message}`));
    await ep.route("**/*", async (route) => { const u = route.request().url();
      if (u.startsWith(base + "api/")) return route.fulfill({ contentType: "application/json", body: '{"data":null}' });
      if (u.startsWith(base)) return route.continue(); if (u.includes("fonts.g")) return route.fulfill({ contentType: "text/css", body: "" });
      if (u.includes("supabase.co/functions")) return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(status) });
      return route.abort(); });
    await ep.goto(base + "#chart"); await ep.waitForTimeout(2500);
    const errorState = await ep.evaluate(() => ({ msg: document.getElementById("lwMsg").innerText, panel: document.getElementById("planPanel").innerText.replace(/\s+/g, " ").slice(0, 400), rows: document.querySelectorAll("#planPanel tbody tr").length }));
    await ep.evaluate((sha) => { const b = document.createElement("div"); b.textContent = `ERROR STATE (candles blocked) · build ${sha}`; b.setAttribute("style", "position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:9999;background:#d0414f;color:#fff;font:700 12px/1 monospace;padding:6px 10px;border-radius:6px"); document.body.appendChild(b); document.getElementById("planView").scrollIntoView(); }, process.env.BUILD_SHA || "local");
    await ep.screenshot({ path: path.join(outDir, `chart_error_${name}.png`) });
    if (panel.hScroll) problems.push(`${name}: horizontal page scroll`);
    result[name] = { errorState, panel, chips, refs, refsPx, planView: await page.evaluate(() => [...document.querySelectorAll("#planView button")].find((b) => b.getAttribute("aria-pressed") === "true").dataset.view) };
  }
  await browser.close(); srv.close(); console.log(JSON.stringify({ loading, result, problems }, null, 1));
})();
