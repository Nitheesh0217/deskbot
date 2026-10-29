// Browser smoke test using explicitly synthetic account/candle fixtures. Never calls the bot.
// npm install --prefix /tmp/deskbot-ui-test playwright (or point PLAYWRIGHT_MODULE at an existing install).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../web/', import.meta.url));
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox','--disable-dev-shm-usage'] });
let checks = 0;
try {
  const page = await browser.newPage({ locale: "en-US", viewport: { width: 1440, height: 1080 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const now = Date.now(), iso = new Date(now - 60000).toISOString();
  const state = equity => ({ equity, startEquity: 300, pos: null, stats: {all:{n:1,wins:0,sumR:-1,net:-4},by:{SESSION_BO:{n:1,net:-4,sumR:-1}}},cfg:{RISK_SCALE:{SESSION_BO:0,EMA_CROSS:0.5}},enabled:{},maxDD:0.03 });
  const lr = {ts:iso,action:'SKIP',source:'hyperliquid',upnl:0,market:{price:80000,barT:now-600000},decision:{signals:[],rejects:[{strategy:'D_BEARTRAP',reason:'Waits for daily close'}]}};
  let fixture = {mode:'PAPER',version:'5.8.0',updated:iso,state:state(296),lastRun:lr,curve:[],events:[],agents:[],trades:[{symbol:'BTC',strategy:'SESSION_BO',dir:'long',entry:81000,exit_avg:80000,net:-4,r:-1,open_t:iso,close_t:iso,reason:'STOP'}],books:{GOLD:{updated:iso,state:state(290),lastRun:{...lr,market:{price:4000,barT:now-600000}}}}};
  let connected = true;
  await page.route('https://xevymbzgpcsdhygswxlk.supabase.co/functions/v1/deskbot-v5',r=>connected?r.fulfill({json:fixture}):r.abort());
  await page.route('https://api.hyperliquid.xyz/info',r=>{
    const req = r.request().postDataJSON().req, step = {'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000}[req.interval];
    const end = Math.floor(now/step)*step, base=req.coin==='PAXG'?4000:80000;
    const bars=Array.from({length:200},(_,i)=>({t:end-(200-i)*step,o:base+i,h:base+i+3,l:base+i-2,c:base+i+1}));
    return r.fulfill({json:bars});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#eq').filter({hasText:'296.00'}).waitFor(); checks++;
  for (const width of [1440,768,390]) {
    await page.setViewportSize({width,height:900});
    for (const name of ['desk','strategies','trades','activity','system']) {
      await page.locator('#tab-'+name).click(); assert.equal(await page.locator('#v-'+name).isVisible(),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} overflow at ${width}`); checks++;
    }
  }
  await page.locator('#tab-strategies').click(); assert.equal(await page.locator('#stratList .strat').count(),11); checks++;
  await page.locator('#strategySearch').fill('bear trap'); assert.equal(await page.locator('#stratList .strat').count(),1); assert.match(await page.locator('#stratList').innerText(),/WAITING FOR BAR/); checks++;
  await page.locator('#strategySearch').fill(''); await page.locator('[data-filter=disabled]').click(); assert.equal(await page.locator('#stratList .strat').count(),4); checks++;
  await page.locator('#tab-trades').click(); const download=page.waitForEvent('download');await page.locator('#exportTrades').click();assert.match((await download).suggestedFilename(),/btc.*csv/);checks++;
  await page.locator('#tradeSearch').fill('NO_MATCH'); assert.match(await page.locator('#trades').innerText(),/No matching/);checks++;
  await page.locator('#tab-chart').click(); await page.locator('#chartNote').filter({hasText:'Candles: Hyperliquid'}).waitFor(); assert.equal(await page.locator('#lwBox canvas').count()>0,true); checks++;
  assert.equal(await page.locator('#lwMsg').isVisible(),false); checks++;
  await page.locator('#bookSeg [data-b=GOLD]').click(); await page.locator('#eq').filter({hasText:'290.00'}).waitFor({state:'attached'}); assert.match(await page.locator('#deskInstrument').innerText(),/not XAUUSD/);checks++;
  await page.locator('#tab-system').click(); assert.match(await page.locator('#btSub').innerText(),/No instrument-matched/);checks++;
  await page.locator('#chatFab').click(); assert.equal(await page.locator('#chat').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#chat').isVisible(),false);checks++;
  connected=false; await page.locator('#globalRefresh').click();await page.locator('#srcBanner').filter({hasText:'Disconnected'}).waitFor();assert.match(await page.locator('#eq').innerText(),/290/);checks++;
  connected=true;fixture={...fixture,books:{}}; await page.reload(); await page.locator('#srcBanner').filter({hasText:'Disconnected'}).waitFor(); assert.equal(await page.locator('#eq').innerText(),'—');checks++;

  connected=true; fixture={...fixture,books:{GOLD:{updated:iso,state:state(290),lastRun:lr}}};
  await page.reload();await page.locator('#globalRefresh').waitFor();
  await page.locator('#tab-desk').click();
  assert.equal(await page.locator('#agentGrid .agent-tile').count(),8);checks++;
  assert.equal(await page.locator('#setupList .setup-tile').count(),11);checks++;
  await page.locator('#setupFamily').selectOption('Mean reversion');assert.equal(await page.locator('#setupList .setup-tile').count(),1);checks++;
  await page.locator('#setupFamily').selectOption('all');await page.locator('#setupSearch').fill('daily close');assert.equal(await page.locator('#setupList .setup-tile').count(),1);checks++;
  await page.locator('#setupSearch').fill('not_a_setup');assert.match(await page.locator('#setupList').innerText(),/No setup types/);checks++;
  await page.locator('#setupSearch').fill('');
  assert.equal(await page.evaluate(()=>typeof globalThis.Motion?.animate),'function');checks++;
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#tab-strategies').click();await page.locator('#tab-desk').click();
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#v-desk .pulse-hero')).opacity),'1');checks++;
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');checks++;
  assert.deepEqual(errors,[]);checks++;
  console.log(`${checks} browser checks passed: responsive views, 11 strategies, filters, CSV, chart, books, assistant UI, disconnected/missing-book states, setup families/search, agent catalog and reduced motion. Synthetic fixtures only.`);
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
