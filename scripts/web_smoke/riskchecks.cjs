// Browser smoke for riskchecks.js: Overview position checks + badges + market context, chart plan-panel chips, System config
// guard / intent / timings, privacy mode, and the "not reported" state of a fixture without these fields. Every lastRun field
// injected here (market.hl, market.rangeDiag, positionChecks, cfgGuard, intentCheck, timing) is SYNTHETIC TEST DATA; the open
// position reuses the stored plan of BTC HTF_TREND short V5-1793318461202 with a SYNTHETIC open time past its max hold, so the
// stale-plan check has something to show. Candles are SYNTHETIC. Network is mocked.
// Usage: node scripts/web_smoke/riskchecks.cjs fixture.json outDir
const { chromium } = require("playwright"); const http = require("http"), fs = require("fs"), path = require("path");
const [fixturePath, outDir] = process.argv.slice(2); fs.mkdirSync(outDir, { recursive: true });
const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8")); const web = path.join(__dirname, "..", "..", "web");
const now = Date.now(), H = 3600e3, M5 = 3e5, bar = Math.floor(now / M5) * M5 - 1;
const pos = { id: "V5-1793318461202", strategy: "HTF_TREND", dir: "short", entry: 77822.4324, stop: 80065.92995554466, stop0: 80065.92995554466, tp1: 74457.18606668302, tp2: 71091.93973336603, tp3: 64361.44706673206, tp1Done: false, tp2Done: false, tp3Done: false, openT: now - 506 * H, maxHoldH: 504, originalQty: 0.002940028069314983, remainingQty: 0.002940028069314983, closedQty: 0, riskAmt: 6.851913300748431, why: ["4H close beyond 55-bar low", "4H SuperTrend aligned"], exits: [], plan: [] };
const base = JSON.parse(JSON.stringify(fx.status));
base.state = { ...(base.state || {}), pos, cfg: { EXIT_MODE: "HOLD", TRADER_PARTS: "be" } };
base.lastRun = { ...(base.lastRun || {}), ts: new Date(now - 3 * 60e3).toISOString(), market: { ...((base.lastRun || {}).market || {}), price: 77300 } };
base.config = { ...(base.config || {}), EXIT_MODE: "HOLD", TRADER_PARTS: "be" };
const full = JSON.parse(JSON.stringify(base));
Object.assign(full.lastRun.market, { hl: { szDecimals: 5, maxLeverage: 40, delisted: false, oraclePx: 77310, premium: -0.00031, fundingAprPct: 10.95, oi: 31234.6 }, rangeDiag: { efficiency: 0.18, touches: 4, isRange: true } });
Object.assign(full.lastRun, {
  positionChecks: { impliedLeverage: 0.23, liqBufferX: 2.4, liqOk: false, notionalUsd: 227.27, minNotionalOk: true, qtyRepresentable: true, degenerateStop: false, ok: false, notes: ["SYNTHETIC note: liquidation estimate uses the reported max leverage"] },
  cfgGuard: { ok: false, violations: [{ rule: "RISK_CAP", msg: "SYNTHETIC: risk per trade above the cap" }, { rule: "TP_ORDER", msg: "SYNTHETIC: targets out of order" }, { rule: "MAX_HOLD", msg: "SYNTHETIC: max hold missing" }] },
  intentCheck: { ok: true, mismatches: [] }, timing: { barCloseT: bar, evalStartMs: bar + 41000, fillMs: null, lagMs: 41000 } });
let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const bars = (ms, n) => { const out = []; let c = 81000; for (let i = 0; i < n; i++) { const t = Math.floor((now - (n - i) * ms) / ms) * ms, o = c; c = c * (1 - 0.0007 * (ms / H) ** 0.5 * (rnd() < 0.6 ? 1 : -1)); c = Math.max(c, 76800); const h = Math.max(o, c) * (1 + 0.002 * rnd()), l = Math.min(o, c) * (1 - 0.002 * rnd()); out.push({ t, T: t + ms - 1, o: String(o), h: String(h), l: String(l), c: String(i === n - 1 ? 77300 : c), v: "10" }); } return out; };
const MS = { "1m": 60e3, "5m": 3e5, "15m": 9e5, "1h": H, "4h": 4 * H, "1d": 24 * H };
const srv = http.createServer((q, r) => { const f = path.join(web, q.url === "/" ? "index.html" : q.url.split("?")[0]); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : f.endsWith(".svg") ? "image/svg+xml" : "text/html" }); r.end(d); } }); });
const route = (base, status) => async (rt) => { const u = rt.request().url();
  if (u.startsWith(base + "api/")) return rt.fulfill({ contentType: "application/json", body: '{"data":null}' });
  if (u.startsWith(base)) return rt.continue(); if (u.includes("fonts.g")) return rt.fulfill({ contentType: "text/css", body: "" });
  if (u.includes("supabase.co/functions")) return rt.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(status) });
  if (u.includes("api.hyperliquid.xyz")) { const b = JSON.parse(rt.request().postData() || "{}"); if (b.type === "candleSnapshot") return rt.fulfill({ contentType: "application/json", body: JSON.stringify(bars(MS[b.req.interval] || H, 400)) }); return rt.fulfill({ contentType: "application/json", body: JSON.stringify({ BTC: "77300" }) }); }
  return rt.abort(); };
const banner = (page, text) => page.evaluate(([t, sha]) => { let b = document.getElementById("synth"); if (!b) { b = document.createElement("div"); b.id = "synth"; b.setAttribute("style", "position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:9999;background:#d0414f;color:#fff;font:700 12px/1.2 monospace;padding:6px 10px;border-radius:6px;pointer-events:none;max-width:92vw;text-align:center"); document.body.appendChild(b); } b.textContent = `${t} · build ${sha}`; }, [text, process.env.BUILD_SHA || "local"]);
const shot = async (page, sel, file) => { await page.evaluate((s) => { const e = document.querySelector(s); if (e) { e.scrollIntoView({ block: "start" }); window.scrollBy(0, -110); } }, sel); await page.waitForTimeout(200); await page.screenshot({ path: path.join(outDir, file) }); };
(async () => {
  await new Promise((r) => srv.listen(0, r)); const baseUrl = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch(); const problems = [], result = {};
  for (const [name, vp] of [["desktop", { width: 1360, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport: vp, reducedMotion: "reduce" }), page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${name} console: ${m.text()}`); }); page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
    await page.route("**/*", route(baseUrl, full));
    await page.goto(baseUrl + "#desk"); await page.waitForTimeout(1800);
    await banner(page, "SYNTHETIC lastRun checks + candles · stored plan V5-1793318461202");
    const ov = await page.evaluate(() => { const q = (s) => [...document.querySelectorAll(s)];
      return { title: (document.querySelector("#rcSafety h2") || {}).innerText, chips: q("#rcSafety .rc-chip[data-rc]").map((c) => c.dataset.rc + ":" + c.dataset.state), aria: q("#rcSafety .rc-chip").map((c) => c.getAttribute("aria-label") || ""),
        rr: (document.querySelector('#rcSafety [data-rc="rr"]') || {}).innerText, dir: (document.querySelector('#rcSafety [data-rc="dir"]') || {}).innerText, guard: (document.querySelector("#rcSafety .rc-guard") || {}).innerText,
        market: (document.getElementById("rcMarket") || {}).innerText, after: (document.getElementById("rcSafety") || {}).previousElementSibling?.id, hScroll: document.documentElement.scrollWidth > innerWidth + 1 }; });
    const planR = await page.evaluate(() => { const p = DATA.state.state.pos, plan = planOf(p, 77300); return "R:R " + plan.rows.filter((r) => /^tp/.test(r.key)).map((r) => "1:" + r.r.toFixed(2)).join(" · "); });
    if (ov.title !== "Paper position checks (observe-only)") problems.push(`${name}: safety title ${ov.title}`);
    if (ov.after !== "posCard") problems.push(`${name}: safety card not after the position card`);
    if (ov.rr !== planR) problems.push(`${name}: R:R badge ${ov.rr} != plan ${planR}`);
    if (ov.dir !== "▼ SHORT") problems.push(`${name}: direction badge ${ov.dir}`);
    for (const want of ["leverage:ok", "liq:warn", "minOrder:ok", "size:ok", "stop:ok", "overHold:warn"]) if (!ov.chips.includes(want)) problems.push(`${name}: chip ${want} missing (${ov.chips})`);
    if (!ov.aria.every((a) => a.length > 20)) problems.push(`${name}: chip without aria-label`);
    if (ov.guard !== "Config guard: RISK_CAP (+2 more)") problems.push(`${name}: guard summary ${ov.guard}`);
    if (!/\+10\.95% APR · longs pay shorts/.test(ov.market) || !/Range-like/.test(ov.market) || !/observe-only, not used for decisions/.test(ov.market)) problems.push(`${name}: market card text`);
    if (ov.hScroll) problems.push(`${name}: horizontal scroll on Overview`);
    await shot(page, "#rcSafety", `overview_checks_${name}.png`);
    await shot(page, "#rcMarket", `overview_market_${name}.png`);
    // privacy on: $ amounts and sizes hidden on Overview + plan panel, R/%/prices kept; remembered across reloads
    await page.click("#rcSafety [data-rc-privacy]"); await page.waitForTimeout(300);
    const priv = await page.evaluate(() => ({ pos: document.getElementById("posCard").innerText, safety: document.getElementById("rcSafety").innerText, metric: document.getElementById("metricRisk").innerText }));
    if (/\$\d/.test(priv.pos) || /0\.0029/.test(priv.pos) || /\$227/.test(priv.safety) || /\d/.test(priv.metric)) problems.push(`${name}: privacy leaves amounts on Overview`);
    if (!/77,822/.test(priv.pos)) problems.push(`${name}: privacy hid a price`);
    await banner(page, "SYNTHETIC · PRIVACY ON"); await shot(page, "#posCard", `overview_privacy_${name}.png`);
    await page.reload(); await page.waitForTimeout(1500);
    const remembered = await page.evaluate(() => document.querySelector("#rcSafety [data-rc-privacy]").getAttribute("aria-pressed"));
    if (remembered !== "true") problems.push(`${name}: privacy not remembered`);
    await page.evaluate(() => show("chart")); await page.waitForTimeout(2500);
    const chart = await page.evaluate(() => ({ chips: [...document.querySelectorAll("#planPanel .plan-chips > *")].map((e) => e.innerText.replace(/\s+/g, " ").trim()), panel: document.getElementById("planPanel").innerText, labels: (CH.lines || []).map((l) => l.options().title) }));
    if (!chart.chips.some((t) => t === planR)) problems.push(`${name}: plan panel R:R missing (${chart.chips})`);
    if (!chart.chips.some((t) => /^Plan check: open \d+h, past its max hold of 504h$/.test(t))) problems.push(`${name}: plan panel stale chip missing`);
    if (/0\.00\d/.test(chart.panel) || /= \$\d/.test(chart.panel)) problems.push(`${name}: privacy leaves sizes/amounts in the plan panel`);
    if (chart.labels.some((t) => /\$|0\.00\d/.test(t || ""))) problems.push(`${name}: chart label carries an amount/size (${chart.labels})`);
    await banner(page, "SYNTHETIC candles + checks · PRIVACY ON"); await shot(page, "#planPanel", `chart_panel_privacy_${name}.png`);
    await page.click("#planPanel [data-rc-privacy]"); await page.waitForTimeout(1200);
    const off = await page.evaluate(() => document.getElementById("planPanel").innerText);
    if (!/0\.00\d/.test(off)) problems.push(`${name}: sizes not restored after privacy off`);
    await banner(page, "SYNTHETIC candles + checks · privacy off"); await shot(page, "#planPanel", `chart_panel_${name}.png`);
    await page.evaluate(() => show("system")); await page.waitForTimeout(500);
    const sys = await page.evaluate(() => ({ text: (document.getElementById("rcSystem") || {}).innerText || "", rules: [...document.querySelectorAll("#rcSystem .rc-rules b")].map((b) => b.innerText), hScroll: document.documentElement.scrollWidth > innerWidth + 1 }));
    if (!/Config guard: RISK_CAP \(\+2 more\)/.test(sys.text) || sys.rules.join() !== "RISK_CAP,TP_ORDER,MAX_HOLD") problems.push(`${name}: system guard list (${sys.rules})`);
    if (!/Intent check: recorded action matches/.test(sys.text) || !/no fill this run/.test(sys.text) || !/41\.0 s/.test(sys.text)) problems.push(`${name}: system intent/timing text`);
    if (sys.hScroll) problems.push(`${name}: horizontal scroll on System`);
    await banner(page, "SYNTHETIC cfgGuard / intentCheck / timing"); await shot(page, "#rcSystem", `system_checks_${name}.png`);
    // fixture WITHOUT the new fields: every panel says "not reported"; privacy defaults OFF in a fresh browser
    const p2 = await (await browser.newContext({ viewport: vp, reducedMotion: "reduce" })).newPage();
    p2.on("pageerror", (e) => problems.push(`${name} bare pageerror: ${e.message}`)); p2.on("console", (m) => { if (m.type() === "error") problems.push(`${name} bare console: ${m.text()}`); });
    await p2.route("**/*", route(baseUrl, base)); await p2.goto(baseUrl + "#desk"); await p2.waitForTimeout(1500);
    const bare = await p2.evaluate(() => ({ safety: document.getElementById("rcSafety").innerText, market: document.getElementById("rcMarket").innerText, sys: document.getElementById("rcSystem").innerText, priv: document.querySelector("#rcSafety [data-rc-privacy]").getAttribute("aria-pressed") }));
    if (!/Position checks not reported/.test(bare.safety) || !/Config guard: not reported/.test(bare.safety)) problems.push(`${name}: bare safety not 'not reported'`);
    if (!/Hyperliquid market fields not reported/.test(bare.market) || !/Range diagnostic not reported/.test(bare.market)) problems.push(`${name}: bare market not 'not reported'`);
    if (!/Intent check: not reported/.test(bare.sys) || !/Phase timings not reported/.test(bare.sys)) problems.push(`${name}: bare system not 'not reported'`);
    if (bare.priv !== "false") problems.push(`${name}: privacy not default off`);
    await banner(p2, "Fixture WITHOUT new lastRun fields (not reported)"); await shot(p2, "#rcSafety", `overview_not_reported_${name}.png`);
    result[name] = { overview: ov, planR, remembered, chartChips: chart.chips, systemRules: sys.rules, bare: { priv: bare.priv } };
  }
  await browser.close(); srv.close(); console.log(JSON.stringify({ result, problems }, null, 1));
})();
