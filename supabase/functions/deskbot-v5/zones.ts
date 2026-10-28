// DeskBot chart zones — pure, deterministic price-structure reads from CLOSED candles. No network, no state, no randomness.
// These are REACTION AREAS derived from rules, not forecasts: nothing here predicts where price will go, and no score is a probability.
// The same code runs in the edge function (agent log) and, compiled to web/zones.js, in the dashboard.
// Terms: FVG = fair value gap (3-candle imbalance). IFVG = inverse FVG (a gap that price closed through, now acting with flipped polarity).
// OB = order block (last opposing candle before a displacement that broke structure). Value = volume-profile POC/VAH/VAL.
export type Bar = { t: number; o: number; h: number; l: number; c: number; v?: number };
export type Side = "bull" | "bear";
export type Zone = {
  kind: "FVG" | "IFVG" | "OB"; side: Side; top: number; bot: number; t0: number; i0: number; touched: boolean; filled: number; label: string;
};
export type Swing = { i: number; t: number; px: number; type: "high" | "low" };
export type StructureEvent = { kind: "BOS" | "CHoCH"; side: Side; t: number; px: number; i: number };
export type Pool = { kind: "EQH" | "EQL"; px: number; t: number; n: number; swept: boolean };
export type Value = { poc: number; vah: number; val: number; bins: number; bars: number };
export type ZoneRead = {
  atr: number; price: number; zones: Zone[]; swings: Swing[]; structure: StructureEvent[]; trend: Side | null;
  range: { hi: number; lo: number; eq: number; zone: "premium" | "discount" | "equilibrium" } | null; value: Value | null; pools: Pool[];
};
export type ZoneOpts = { swingLen?: number; minGapAtr?: number; dispBodyAtr?: number; maxZones?: number; valueBars?: number; valueBins?: number };

export function atrOf(b: Bar[], n = 14): number {
  if (b.length < 2) return NaN; const k = Math.min(n, b.length - 1); let s = 0;
  for (let i = b.length - k; i < b.length; i++) s += Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
  return s / k;
}

export function swingsOf(b: Bar[], len = 3): Swing[] {
  const out: Swing[] = [];
  for (let i = len; i < b.length - len; i++) {
    let hi = true, lo = true;
    for (let j = 1; j <= len; j++) { if (b[i].h <= b[i - j].h || b[i].h <= b[i + j].h) hi = false; if (b[i].l >= b[i - j].l || b[i].l >= b[i + j].l) lo = false; }
    if (hi) out.push({ i, t: b[i].t, px: b[i].h, type: "high" });
    if (lo) out.push({ i, t: b[i].t, px: b[i].l, type: "low" });
  }
  return out.sort((a, z) => a.i - z.i);
}

/** Fraction of a zone price has traded into since it formed (0..1) and whether a candle CLOSED through the far edge. */
function fillState(b: Bar[], from: number, z: { top: number; bot: number; side: Side }) {
  let deepest = 0, closedThrough = false, firstThrough = -1;
  const h = z.top - z.bot;
  for (let i = from; i < b.length; i++) {
    if (z.side === "bull") { if (b[i].l < z.top) deepest = Math.max(deepest, Math.min(1, (z.top - b[i].l) / h)); if (b[i].c < z.bot) { closedThrough = true; firstThrough = i; break; } }
    else { if (b[i].h > z.bot) deepest = Math.max(deepest, Math.min(1, (b[i].h - z.bot) / h)); if (b[i].c > z.top) { closedThrough = true; firstThrough = i; break; } }
  }
  return { deepest, closedThrough, firstThrough };
}

export function zonesOf(b: Bar[], o: ZoneOpts = {}): ZoneRead {
  const swingLen = o.swingLen ?? 3, minGap = o.minGapAtr ?? 0.25, dispBody = o.dispBodyAtr ?? 1.2, maxZones = o.maxZones ?? 10;
  const atr = atrOf(b), price = b.length ? b[b.length - 1].c : NaN;
  const empty: ZoneRead = { atr, price, zones: [], swings: [], structure: [], trend: null, range: null, value: null, pools: [] };
  if (b.length < 30 || !(atr > 0)) return empty;
  const zones: Zone[] = [];

  // Fair value gaps and their inverses
  for (let i = 2; i < b.length; i++) {
    const a = b[i - 2], c = b[i];
    let side: Side | null = null, top = 0, bot = 0;
    if (c.l > a.h) { side = "bull"; bot = a.h; top = c.l; } else if (c.h < a.l) { side = "bear"; top = a.l; bot = c.h; }
    if (!side || top - bot < minGap * atr) continue;
    const st = fillState(b, i + 1, { top, bot, side });
    if (!st.closedThrough) zones.push({ kind: "FVG", side, top, bot, t0: b[i - 1].t, i0: i - 1, touched: st.deepest > 0, filled: +st.deepest.toFixed(2), label: `${side === "bull" ? "Bull" : "Bear"} FVG` });
    else {
      // inverse FVG: only while the closing-through candle has not itself been re-closed through the other way
      const flipped: Side = side === "bull" ? "bear" : "bull", back = fillState(b, st.firstThrough + 1, { top, bot, side: flipped });
      if (!back.closedThrough) zones.push({ kind: "IFVG", side: flipped, top, bot, t0: b[st.firstThrough].t, i0: st.firstThrough, touched: back.deepest > 0, filled: +back.deepest.toFixed(2), label: `${flipped === "bull" ? "Bull" : "Bear"} IFVG` });
    }
  }

  // Structure from swings: BOS (continuation break) / CHoCH (break against the prevailing trend), by CLOSE through the last swing
  const sw = swingsOf(b, swingLen), structure: StructureEvent[] = [];
  let trend: Side | null = null, lastHigh: Swing | null = null, lastLow: Swing | null = null, si = 0;
  const brokenH = new Set<number>(), brokenL = new Set<number>();
  for (let i = 0; i < b.length; i++) {
    while (si < sw.length && sw[si].i + swingLen <= i) { if (sw[si].type === "high") lastHigh = sw[si]; else lastLow = sw[si]; si++; }
    if (lastHigh && !brokenH.has(lastHigh.i) && b[i].c > lastHigh.px) { brokenH.add(lastHigh.i); structure.push({ kind: trend === "bear" ? "CHoCH" : "BOS", side: "bull", t: b[i].t, px: lastHigh.px, i }); trend = "bull"; }
    if (lastLow && !brokenL.has(lastLow.i) && b[i].c < lastLow.px) { brokenL.add(lastLow.i); structure.push({ kind: trend === "bull" ? "CHoCH" : "BOS", side: "bear", t: b[i].t, px: lastLow.px, i }); trend = "bear"; }
  }

  // Order blocks: displacement candle (big body that also breaks structure) -> last opposite-colour candle within 6 bars before it
  for (const ev of structure) {
    // the displacement is the break candle or the one just before it
    const cands = [ev.i, ev.i - 1].filter((j) => j > 0 && Math.abs(b[j].c - b[j].o) >= dispBody * atr && ((ev.side === "bull") === (b[j].c > b[j].o)));
    if (!cands.length) continue;
    const dj = Math.min(...cands);
    for (let k = dj - 1; k >= Math.max(0, dj - 6); k--) {
      const opp = ev.side === "bull" ? b[k].c < b[k].o : b[k].c > b[k].o;
      if (!opp) continue;
      const z = { top: b[k].h, bot: b[k].l, side: ev.side };
      const st = fillState(b, dj + 1, z);
      if (!st.closedThrough) zones.push({ kind: "OB", side: ev.side, top: z.top, bot: z.bot, t0: b[k].t, i0: k, touched: st.deepest > 0, filled: +st.deepest.toFixed(2), label: `${ev.side === "bull" ? "Bull" : "Bear"} OB` });
      break;
    }
  }

  // Premium / discount of the latest completed swing range
  const hs = sw.filter((s) => s.type === "high").at(-1), ls = sw.filter((s) => s.type === "low").at(-1);
  let range: ZoneRead["range"] = null;
  if (hs && ls && hs.px > ls.px) { const eq = (hs.px + ls.px) / 2, band = (hs.px - ls.px) * 0.05; range = { hi: hs.px, lo: ls.px, eq, zone: Math.abs(price - eq) <= band ? "equilibrium" : price > eq ? "premium" : "discount" }; }

  // Value: volume profile over the last N bars, 70% value area grown outward from the POC
  let value: Value | null = null; const vb = o.valueBars ?? 240, nb = o.valueBins ?? 24, vs = b.slice(-vb);
  const lo = Math.min(...vs.map((x) => x.l)), hi = Math.max(...vs.map((x) => x.h));
  if (hi > lo && vs.some((x) => (x.v ?? 0) > 0)) {
    const w = (hi - lo) / nb, vol = new Array(nb).fill(0);
    for (const x of vs) { const v = x.v ?? 0, a = Math.max(0, Math.min(nb - 1, Math.floor((x.l - lo) / w))), z = Math.max(0, Math.min(nb - 1, Math.floor((x.h - lo) / w))); for (let j = a; j <= z; j++) vol[j] += v / (z - a + 1); }
    const tot = vol.reduce((s, x) => s + x, 0); let p = vol.indexOf(Math.max(...vol)), l = p, h = p, acc = vol[p];
    while (acc < 0.7 * tot && (l > 0 || h < nb - 1)) { const dn = l > 0 ? vol[l - 1] : -1, up = h < nb - 1 ? vol[h + 1] : -1; if (up >= dn) { h++; acc += vol[h]; } else { l--; acc += vol[l]; } }
    value = { poc: lo + (p + 0.5) * w, val: lo + l * w, vah: lo + (h + 1) * w, bins: nb, bars: vs.length };
  }

  // Liquidity pools: equal highs / lows (within 0.1 ATR) among recent swings; swept when a later wick pierced and the close came back
  const pools: Pool[] = [], recent = sw.slice(-14), tol = 0.1 * atr;
  for (const type of ["high", "low"] as const) {
    const pts = recent.filter((s) => s.type === type);
    for (let a = 0; a < pts.length; a++) for (let c = a + 1; c < pts.length; c++) {
      if (Math.abs(pts[a].px - pts[c].px) > tol) continue;
      const px = type === "high" ? Math.max(pts[a].px, pts[c].px) : Math.min(pts[a].px, pts[c].px);
      if (pools.some((p) => p.kind === (type === "high" ? "EQH" : "EQL") && Math.abs(p.px - px) <= tol)) continue;
      let swept = false; for (let i = pts[c].i + 1; i < b.length; i++) if (type === "high" ? b[i].h > px && b[i].c < px : b[i].l < px && b[i].c > px) swept = true;
      pools.push({ kind: type === "high" ? "EQH" : "EQL", px, t: pts[c].t, n: 2, swept });
    }
  }

  // Keep the nearest unfinished zones (relevance = distance to price in ATR), newest first on ties
  const rank = (z: Zone) => (price >= z.bot && price <= z.top ? 0 : Math.min(Math.abs(price - z.top), Math.abs(price - z.bot)) / atr);
  zones.sort((x, y) => rank(x) - rank(y) || y.i0 - x.i0);
  return { atr, price, zones: zones.slice(0, maxZones), swings: sw.slice(-8), structure: structure.slice(-4), trend, range, value, pools: pools.slice(-4) };
}

export type PlannedTrade = { dir: "long" | "short"; entry: number; stop: number; tp1: number; tp2: number; tp3: number };
export type Check = { label: string; met: boolean; detail: string };
/** Checklist of structure items that agree with a trade's direction near its entry. Counts rules; it is NOT a win probability. */
export function confluence(read: ZoneRead, tr: PlannedTrade): { checks: Check[]; met: number; of: number } {
  const long = tr.dir === "long", want: Side = long ? "bull" : "bear", near = 0.35 * read.atr;
  const inZone = (z: Zone) => tr.entry >= z.bot - near && tr.entry <= z.top + near;
  const checks: Check[] = [];
  const fvg = read.zones.find((z) => (z.kind === "FVG" || z.kind === "IFVG") && z.side === want && inZone(z));
  checks.push({ label: long ? "Entry at/near a bullish FVG or IFVG" : "Entry at/near a bearish FVG or IFVG", met: !!fvg, detail: fvg ? `${fvg.label} ${fmt(fvg.bot)}-${fmt(fvg.top)}` : "none within 0.35 ATR" });
  const ob = read.zones.find((z) => z.kind === "OB" && z.side === want && inZone(z));
  checks.push({ label: long ? "Entry at/near a bullish order block" : "Entry at/near a bearish order block", met: !!ob, detail: ob ? `${ob.label} ${fmt(ob.bot)}-${fmt(ob.top)}` : "none within 0.35 ATR" });
  if (read.range) { const ok = long ? tr.entry < read.range.eq : tr.entry > read.range.eq; checks.push({ label: long ? "Entry in discount (below range midpoint)" : "Entry in premium (above range midpoint)", met: ok, detail: `range ${fmt(read.range.lo)}-${fmt(read.range.hi)}, mid ${fmt(read.range.eq)}` }); }
  if (read.value) { const v = read.value, nearV = [v.poc, v.val, v.vah].some((p) => Math.abs(tr.entry - p) <= near); checks.push({ label: "Entry near value (POC / VAL / VAH)", met: nearV, detail: `POC ${fmt(v.poc)} · VAL ${fmt(v.val)} · VAH ${fmt(v.vah)}` }); }
  const swept = read.pools.find((p) => p.swept && (long ? p.kind === "EQL" : p.kind === "EQH"));
  checks.push({ label: long ? "Sell-side liquidity (equal lows) swept" : "Buy-side liquidity (equal highs) swept", met: !!swept, detail: swept ? `${swept.kind} ${fmt(swept.px)}` : "no swept equal level in the recent swings" });
  const last = read.structure.at(-1); checks.push({ label: long ? "Latest structure break is bullish" : "Latest structure break is bearish", met: !!last && last.side === want, detail: last ? `${last.kind} ${last.side} @ ${fmt(last.px)}` : "no break detected" });
  const room = long ? tr.tp1 - tr.entry : tr.entry - tr.tp1, risk = Math.abs(tr.entry - tr.stop);
  checks.push({ label: "TP1 is at least 1R away", met: room >= risk, detail: `${(room / risk).toFixed(2)}R to TP1` });
  const met = checks.filter((c) => c.met).length; return { checks, met, of: checks.length };
}
const fmt = (x: number) => (x >= 1000 ? x.toFixed(1) : x.toFixed(3));
