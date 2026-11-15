// Additional books (books.ts): ETH is a paper book (HTF_TREND only, ETH-PAPER-1); SOL is a SHADOW book. SYNTHETIC candles (the same series serves every coin).
// A shadow book records what it would have entered, at its own lot, minimum size and costs, and never opens a position or moves equity.
// Existing BTC and GOLD books behave exactly as without the new book.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOK_SPECS, bookSpec, roundLot, shadowEntry } from "../supabase/functions/deskbot-v5/books.ts";
import { validateInstrument, consolidate, paperSnapshot, type Instrument } from "../supabase/functions/deskbot-v5/accounts.ts";
import { initState, type State } from "../supabase/functions/deskbot-v5/engine.ts";

const asInstrument = (sym: string): Instrument => { const i = BOOK_SPECS[sym].instrument; return { id: `hl:${i.coin}`, venue: i.venue, symbol: i.coin, currency: "USD", tick: 10 ** -(6 - i.szDecimals), lot: i.lot, sessions: [{ always: true }], dataSource: i.dataFeed, cls: "crypto_perp", multiplier: i.multiplier, expiry: null, settlement: null }; };

test("book specs: ETH is a paper book on HTF_TREND only (ETH-PAPER-1), SOL is shadow; BTC/GOLD unchanged; unknown books default to shadow", () => {
  assert.equal(BOOK_SPECS.BTC.mode, "paper"); assert.equal(BOOK_SPECS.GOLD.mode, "paper"); assert.equal(BOOK_SPECS.BTC.initCfg, undefined); assert.equal(BOOK_SPECS.GOLD.initCfg, undefined);
  assert.equal(BOOK_SPECS.ETH.mode, "paper"); assert.equal(BOOK_SPECS.ETH.researchConfig, "ETH-PAPER-1"); assert.equal(BOOK_SPECS.ETH.instrument.szDecimals, 4);
  assert.deepEqual(Object.entries((BOOK_SPECS.ETH.initCfg as any).RISK_SCALE).filter(([, v]) => v !== 0).map(([k]) => k), ["HTF_TREND"]);
  assert.equal(BOOK_SPECS.SOL.mode, "shadow"); assert.equal(BOOK_SPECS.SOL.financialValidation, "UNVALIDATED"); assert.equal(BOOK_SPECS.SOL.researchConfig, "SOL-SHADOW-1");
  for (const s of ["ETH", "SOL"]) {
    const b = BOOK_SPECS[s];
    assert.equal(b.instrument.type, "perpetual"); assert.equal(b.instrument.expiry, null); assert.equal(b.instrument.multiplier, 1);
    assert.deepEqual(validateInstrument(asInstrument(s)), [], `${s} instrument passes the registry contract`);
  }
  assert.equal(bookSpec("DOGE").mode, "shadow"); assert.equal(bookSpec("DOGE").financialValidation, "UNVALIDATED");
});

test("shadow entry: quantity rounded down to the instrument's lot; minimum order value and round-trip cost in R reported", () => {
  assert.equal(roundLot(0.123456, 0.01), 0.12); assert.equal(roundLot(0.0099, 0.01), 0); assert.equal(+roundLot(1.23456, 0.0001).toFixed(4), 1.2345);
  const sig = { strategy: "HTF_TREND", dir: "short", score: 80, why: ["x"] };
  // ETH at 2,248 with a 2×ATR stop of ~3%: 2% of $350 → ~0.104 ETH → 0.1037 at 4 decimals; notional ≈ $233 (above $10)
  const eth = shadowEntry(BOOK_SPECS.ETH, sig, { entry: 2248, stop0: 2315.4, tp1: 2146.9, tp2: 2045.8, tp3: 1843.6, originalQty: 0.10378 }, 2248.4);
  assert.equal(eth.qtyAtLot, 0.1037); assert.equal(eth.executable, true); assert.equal(eth.reason, null); assert.ok(eth.costR! > 0.03 && eth.costR! < 0.05, String(eth.costR));
  // SOL at 98 with a tiny simulated size: below one lot (0.01 SOL) → not executable, stated
  const sol = shadowEntry(BOOK_SPECS.SOL, sig, { entry: 98, stop0: 101, tp1: 93.5, tp2: 89, tp3: 80, originalQty: 0.009 }, 98);
  assert.equal(sol.qtyAtLot, 0); assert.equal(sol.executable, false); assert.match(sol.reason!, /below one lot/);
  const small = shadowEntry(BOOK_SPECS.SOL, sig, { entry: 98, stop0: 101, tp1: 93.5, tp2: 89, tp3: 80, originalQty: 0.05 }, 98);
  assert.equal(small.executable, false); assert.match(small.reason!, /\$10 minimum/);
});

test("consolidated exposure keeps each book separate and nets by underlying across books", () => {
  const ins = Object.fromEntries(["BTC", "ETH"].map((s) => [`paper:${s}`, { ...asInstrument(s), id: `paper:${s}` }])) as Record<string, Instrument>;
  const btc = paperSnapshot("paper-btc", { equity: 350, pos: { id: "a", dir: "short", remainingQty: 0.003, entry: 78000 } }, "BTC", 77000, 0);
  const eth = paperSnapshot("paper-eth", { equity: 350, pos: null }, "ETH", 2248, 0);
  const r = consolidate([btc, eth], ins, (i) => i.symbol);
  assert.deepEqual(Object.keys(r.price), ["BTC"]); assert.deepEqual(Object.keys(r.price.BTC.byAccount), ["paper-btc"]);
});
