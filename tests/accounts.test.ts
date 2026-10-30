// Account registry and read-only adapter contract (accounts.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateAccount, validateInstrument, freshness, reconcile, consolidate, paperSnapshot, ADAPTER_METHODS, type AccountRecord, type Instrument, type Snapshot } from "../supabase/functions/deskbot-v5/accounts.ts";

const acct = (o: Partial<AccountRecord> = {}): AccountRecord => ({ id: "moomoo-us-1", broker: "moomoo", externalRef: "****1234", credentialRef: "MOOMOO_OPEND_RSA_KEY", mode: "live", baseCurrency: "USD",
  permissions: ["read_balances", "read_positions", "read_orders", "read_fills"], orderTypes: ["market", "limit"], instruments: ["equity", "etf", "option"], marketData: { source: "moomoo", entitlement: "delayed" }, fundedOrders: "disabled", ...o });

test("registry refuses trading permission, funded orders, raw account numbers and raw credentials", () => {
  assert.deepEqual(validateAccount(acct()), []);
  assert.ok(validateAccount(acct({ permissions: ["read_positions", "trade"] })).some((e) => /trade/.test(e)));
  assert.ok(validateAccount(acct({ fundedOrders: "enabled" as never })).some((e) => /fundedOrders/.test(e)));
  assert.ok(validateAccount(acct({ externalRef: "U1234567" })).some((e) => /masked/.test(e)));
  assert.ok(validateAccount(acct({ credentialRef: "sk-live-abc123" })).some((e) => /secret NAME/.test(e)));
  assert.ok(validateAccount(acct({ broker: "paper", mode: "live" })).some((e) => /paper broker/.test(e)));
});

test("the adapter contract has read methods only; the module imports nothing", () => {
  assert.deepEqual([...ADAPTER_METHODS], ["health", "balances", "positions", "openOrders", "fills", "instruments"]);
  const src = readFileSync(new URL("../supabase/functions/deskbot-v5/accounts.ts", import.meta.url), "utf8");
  assert.ok(!/^import /m.test(src), "no imports: cannot reach engine, state or network");
  const iface = src.slice(src.indexOf("export interface ReadOnlyAdapter"), src.indexOf("export const ADAPTER_METHODS"));
  assert.ok(!/place|submit|cancel|modify|amend|order\s*\(/i.test(iface.replace(/openOrders/g, "")), "no order-writing method in the interface");
  const index = readFileSync(new URL("../supabase/functions/deskbot-v5/index.ts", import.meta.url), "utf8");
  assert.ok(!/accounts\.ts/.test(index), "not wired into the live loop");
});

const btcPerp: Instrument = { id: "hl:BTC", venue: "hyperliquid", symbol: "BTC", currency: "USD", tick: 1, lot: 0.00001, sessions: [{ always: true }], dataSource: "hyperliquid", cls: "crypto_perp", multiplier: 1 };
const btcSpot: Instrument = { id: "rh:BTC-USD", venue: "robinhood", symbol: "BTC-USD", currency: "USD", tick: 0.01, lot: 1e-8, sessions: [{ always: true }], dataSource: "robinhood", cls: "crypto_spot", multiplier: 1 };
const pm: Instrument = { id: "pmus:BTC-100K-DEC", venue: "polymarket_us", symbol: "BTC above 100k on Dec 31", currency: "USD", tick: 0.01, lot: 1, sessions: [{ always: true }], dataSource: "polymarket_us",
  cls: "prediction", eventId: "BTC-100K-DEC", outcome: "YES", resolutionSource: "named index at 23:59 UTC", resolutionRules: "YES if the index print is above 100,000.00", closesAt: "2026-12-31T23:59:00Z", payout: 1, priceBounds: [0.01, 0.99], fees: { taker: 0.01, maker: 0 } };

test("instrument classes: prediction contracts need resolution rules, bounded prices and carry no stop/target/multiplier", () => {
  assert.deepEqual(validateInstrument(btcPerp), []); assert.deepEqual(validateInstrument(pm), []);
  assert.ok(validateInstrument({ ...pm, resolutionRules: "" }).length > 0);
  assert.ok(validateInstrument({ ...pm, priceBounds: [0.5, 1.5] }).length > 0);
  assert.ok(validateInstrument({ ...(pm as any), tp1: 0.9 }).some((e: string) => /no stop\/target/.test(e)), "BTC target logic cannot be attached to a prediction contract");
});

const snap = (accountId: string, positions: Snapshot["positions"], asOf = "2026-10-30T04:41:00Z", connected = true): Snapshot =>
  ({ accountId, asOf, balances: [], positions, orders: [], fills: [], health: { connected, lastOkAt: asOf, error: null, latencyMs: 40 } });

test("consolidated exposure: price exposure nets across accounts by underlying; prediction contracts stay event exposure", () => {
  const r = consolidate([
    snap("paper-btc", [{ instrumentId: "hl:BTC", qty: -0.00294, avgPrice: 77822, markPrice: 77300, notional: 0, unrealizedPnl: null }]),
    snap("rh-1", [{ instrumentId: "rh:BTC-USD", qty: 0.01, avgPrice: 70000, markPrice: 77300, notional: 0, unrealizedPnl: null }]),
    snap("pm-1", [{ instrumentId: "pmus:BTC-100K-DEC", qty: 50, avgPrice: 0.22, markPrice: 0.2, notional: 0, unrealizedPnl: null }, { instrumentId: "x:unknown", qty: 1, avgPrice: 1, markPrice: 1, notional: 0, unrealizedPnl: null }]),
  ], { [btcPerp.id]: btcPerp, [btcSpot.id]: btcSpot, [pm.id]: pm }, (i) => (i.symbol.startsWith("BTC") ? "BTC" : i.symbol));
  assert.equal(+r.price.BTC.netNotional.toFixed(2), +(-0.00294 * 77300 + 0.01 * 77300).toFixed(2));
  assert.equal(+r.price.BTC.grossNotional.toFixed(2), +(0.00294 * 77300 + 0.01 * 77300).toFixed(2));
  assert.deepEqual(Object.keys(r.price.BTC.byAccount).sort(), ["paper-btc", "rh-1"]);
  assert.deepEqual(r.events["BTC-100K-DEC:YES"], { contracts: 50, maxPayout: 50, cost: 11, byAccount: { "pm-1": 50 } });
  assert.deepEqual(r.unknown, ["pm-1:x:unknown"], "unmapped positions are reported, never dropped silently");
});

test("freshness and reconciliation: stale or disconnected data is labelled; fills that do not explain positions are breaks", () => {
  const s = snap("a", []), now = Date.parse("2026-10-30T04:45:00Z");
  assert.equal(freshness(s, now, 10 * 60e3).state, "FRESH"); assert.equal(freshness(s, now, 60e3).state, "STALE");
  assert.equal(freshness(snap("a", [], s.asOf, false), now, 10 * 60e3).state, "DISCONNECTED");
  const fills = [{ id: "f1", orderId: null, instrumentId: "X", side: "buy" as const, qty: 2, price: 10, fee: 0, at: "t" }, { id: "f2", orderId: null, instrumentId: "X", side: "sell" as const, qty: 0.5, price: 11, fee: 0, at: "t" }];
  assert.deepEqual(reconcile({ X: 1 }, fills, [{ instrumentId: "X", qty: 2.5, avgPrice: 10, markPrice: null, notional: 0, unrealizedPnl: null }]), { ok: true, breaks: [] });
  assert.deepEqual(reconcile({}, fills, []).breaks, [{ instrumentId: "X", implied: 1.5, reported: 0 }]);
});

test("reference adapter over the paper book: the screenshot position maps and reconciles from its own fills", () => {
  const st = { equity: 342.49, pos: { id: "V5-1793318461202", dir: "short", remainingQty: 0.002940028069314983, entry: 77822.4324, exits: [], openT: 1793318461202, entryFee: 0.10296 } };
  const s = paperSnapshot("paper-btc", st, "BTC", 77300, 1793318461202 + 3600e3);
  assert.equal(s.positions[0].qty, -0.002940028069314983); assert.equal(+s.positions[0].unrealizedPnl!.toFixed(4), +((77822.4324 - 77300) * 0.002940028069314983).toFixed(4));
  assert.deepEqual(reconcile({}, s.fills, s.positions), { ok: true, breaks: [] });
  assert.deepEqual(paperSnapshot("paper-btc", { equity: 1, pos: null }, "BTC", null, 0).positions, []);
});
