// Paper book specifications: one per instrument. Imports nothing. A book's mode decides what it may do:
//   paper  : the existing BTC and GOLD books (unchanged behaviour; their own strategy evidence and limitations apply)
//   paper with initCfg: a NEW paper book created by init_book with a versioned research config (e.g. ETH-PAPER-1: HTF_TREND only,
//            the BTC live settings, evidence docs/research/2026-11-15-diversify). Simulated equity, its own row; BTC/GOLD untouched.
//   shadow : evaluates the rules and records what it WOULD have entered (with the instrument's own lot, minimum size and costs);
//            never opens a position, never changes equity. Paper entries need a later, explicit, versioned research config.
// Starting equity of every book is SIMULATED capital: it is never real money and is never added to real wealth.
// Instrument facts marked `verify` are to be confirmed at runtime from Hyperliquid metaAndAssetCtxs (szDecimals) before paper entries.

export type BookMode = "paper" | "shadow";
export type BookSpec = {
  sym: string; mode: BookMode; researchConfig: string | null; financialValidation: "UNVALIDATED" | "DEVELOPMENT-ONLY";
  simulatedStartEquity: number;
  instrument: {
    venue: "hyperliquid"; type: "perpetual"; coin: string; dataFeed: string; historyFeed: string; multiplier: 1; expiry: null; settlement: "none (perpetual)";
    sessions: "24/7"; quote: "USD (USDC margin)"; lot: number; szDecimals: number; tick: string; minNotionalUsd: number;
    fees: { taker: number; maker: number }; funding: "hourly, variable (paid or received)"; verify: string[];
  };
  limitations: string[];
  /** Config written once by init_book when the book is created (paper books other than BTC/GOLD only). */
  initCfg?: Record<string, unknown>;
};

// Every strategy off except the listed ones (opt-in strategies stay off because their RISK_SCALE is 0, too).
const ONLY = (...on: string[]) => Object.fromEntries(["D_BEARTRAP", "D_THRUST", "HTF_TREND", "TREND_MTF", "SWEEP_REV", "VWAP_REVERT", "SESSION_BO", "HTF_SWEEP", "EMA_CROSS", "SSR", "EMA_PB"].map((k) => [k, on.includes(k) ? 1 : 0]));
// BTC's live settings as captured for the research (live_cfg.json, 2026-10-28), with RISK_SCALE narrowed to the tested strategy.
const BTC_LIVE_SETTINGS = { TRADER: true, EXIT_MODE: "HOLD", TRADER_PARTS: "be", HTF_DONCHIAN: 55, MIN_STOP_BY: { TREND_MTF: 0.012 }, REGIME_GATE: { HTF_TREND: 0.03, TREND_MTF: 0.03, D_BEARTRAP: 0.03 } };

const HL = (coin: string, szDecimals: number, bn: string): BookSpec["instrument"] => ({
  venue: "hyperliquid", type: "perpetual", coin, dataFeed: `Hyperliquid candleSnapshot ${coin} (public)`, historyFeed: `Binance spot ${bn} 5m (public, research only)`,
  multiplier: 1, expiry: null, settlement: "none (perpetual)", sessions: "24/7", quote: "USD (USDC margin)", lot: 10 ** -szDecimals, szDecimals,
  tick: `price: at most 5 significant figures and ${6 - szDecimals} decimals`, minNotionalUsd: 10, fees: { taker: 0.00045, maker: 0.00015 },
  funding: "hourly, variable (paid or received)", verify: ["szDecimals", "minimum order value", "fee tier of the eventual account"],
});

export const BOOK_SPECS: Record<string, BookSpec> = {
  BTC: { sym: "BTC", mode: "paper", researchConfig: null, financialValidation: "DEVELOPMENT-ONLY", simulatedStartEquity: 352.56, instrument: HL("BTC", 5, "BTCUSDT"),
    limitations: ["Strategies tuned on development data; not validated out of sample", "5m history vs 1m live management"] },
  GOLD: { sym: "GOLD", mode: "paper", researchConfig: null, financialValidation: "DEVELOPMENT-ONLY", simulatedStartEquity: 350, instrument: { ...HL("PAXG", 3, "PAXGUSDT"), coin: "PAXG" },
    limitations: ["PAXG token as a gold proxy (not XAUUSD)", "Thin early PAXG history; replay matched 3/10 live trades"] },
  ETH: { sym: "ETH", mode: "paper", researchConfig: "ETH-PAPER-1", financialValidation: "DEVELOPMENT-ONLY", simulatedStartEquity: 350, instrument: { ...HL("ETH", 4, "ETHUSDT"), verify: ["fee tier of the eventual account"] },
    initCfg: { ...BTC_LIVE_SETTINGS, RISK_SCALE: ONLY("HTF_TREND") },
    limitations: ["HTF_TREND only, BTC's settings unchanged: 3y Binance ETHUSDT +0.11R/trade at 1.5x costs (83 trades), not significant alone",
      "Development evidence on one window; forward paper record is the test", "ML score component trained on BTC/gold data"] },
  SOL: { sym: "SOL", mode: "shadow", researchConfig: "SOL-SHADOW-1", financialValidation: "UNVALIDATED", simulatedStartEquity: 350, instrument: { ...HL("SOL", 2, "SOLUSDT"), verify: ["minimum order value", "fee tier of the eventual account"] },
    limitations: ["Shadow only: rules tuned on BTC/gold, untested on SOL", "ML score component trained on BTC/gold data", "Higher volatility: stop widths and costs differ from BTC"] },
};
/** Unknown symbols are shadow-only and unvalidated: a book is never paper-trading by default. */
export const bookSpec = (sym: string): BookSpec => BOOK_SPECS[sym] ?? { ...BOOK_SPECS.SOL, sym, researchConfig: null, instrument: { ...BOOK_SPECS.SOL.instrument, coin: sym }, limitations: ["No specification: shadow only"] };

/** Round a quantity DOWN to the instrument's lot. */
export const roundLot = (qty: number, lot: number) => (lot > 0 ? Math.floor(qty / lot + 1e-9) * lot : qty);

/** What a shadow book records instead of an entry: the hypothetical plan at THIS instrument's lot, minimum size and costs. */
export function shadowEntry(spec: BookSpec, sig: { strategy: string; dir: string; score: number; why: string[] }, p: { entry: number; stop0: number; tp1: number; tp2: number; tp3: number; originalQty: number }, fillRef: number) {
  const i = spec.instrument, qtyAtLot = +roundLot(p.originalQty, i.lot).toFixed(i.szDecimals), R = Math.abs(p.entry - p.stop0);
  const notional = qtyAtLot * p.entry, costR = R > 0 ? (p.entry * (2 * i.fees.taker) + p.entry * 0.0004) / R : null;   // round-trip taker fees + 2 × 0.02% slippage, in R
  return {
    book: spec.sym, mode: "shadow" as const, researchConfig: spec.researchConfig, financialValidation: spec.financialValidation,
    strategy: sig.strategy, dir: sig.dir, score: sig.score, why: sig.why.slice(0, 6), fillRef, entry: p.entry, stop: p.stop0, tp1: p.tp1, tp2: p.tp2, tp3: p.tp3,
    rawQty: p.originalQty, qtyAtLot, notionalUsd: +notional.toFixed(2), costR: costR == null ? null : +costR.toFixed(3),
    executable: qtyAtLot > 0 && notional >= i.minNotionalUsd, reason: qtyAtLot <= 0 ? "below one lot at simulated equity" : notional < i.minNotionalUsd ? `below the $${i.minNotionalUsd} minimum order value` : null,
  };
}
