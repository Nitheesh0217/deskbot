// Broker-neutral account registry and READ-ONLY adapter contract (real-account preparation). Pure: imports nothing, never touches the
// trading loop, the paper state or the network. Funded order submission is not part of this contract: an adapter can only READ
// balances, positions, orders and fills. Market research desks (data sources) are a separate registry from broker connections.
//
// Instrument classes are explicit. A prediction contract is its own class (resolution rules, executable price 0..1, settlement, event
// exposure); it carries no stop/target/R fields, so BTC target logic cannot be applied to it by construction.

export type Mode = "paper" | "live";
export type OrderType = "market" | "limit" | "stop" | "stop_limit" | "trailing_stop" | "ioc" | "fok" | "post_only";
export type Permission = "read_balances" | "read_positions" | "read_orders" | "read_fills" | "market_data" | "trade";   // "trade" is never granted here
export type AssetClass = "crypto_spot" | "crypto_perp" | "equity" | "etf" | "option" | "future" | "prediction";

export type Session = { tz: string; open: string; close: string; days: number[] } | { always: true };
type InstrumentBase = { id: string; venue: string; symbol: string; currency: string; tick: number; lot: number; minQty?: number; sessions: Session[]; dataSource: string };
export type LinearInstrument = InstrumentBase & { cls: Exclude<AssetClass, "prediction">; multiplier: number; expiry?: string | null; settlement?: "cash" | "physical" | null };
export type PredictionInstrument = InstrumentBase & {
  cls: "prediction"; eventId: string; outcome: string; resolutionSource: string; resolutionRules: string; closesAt: string; settlesAt?: string | null;
  payout: number;                                  // per contract if the outcome resolves YES (e.g. 1.00)
  priceBounds: [number, number];                   // executable price range, e.g. [0.01, 0.99]
  fees: { taker: number; maker: number; settlement?: number };
};
export type Instrument = LinearInstrument | PredictionInstrument;

export type AccountRecord = {
  id: string;                                      // our id, e.g. "moomoo-us-1"
  broker: "paper" | "moomoo" | "ibkr" | "robinhood_crypto" | "polymarket_us" | string;
  externalRef: string;                             // broker account identifier, stored MASKED (last 4 only)
  credentialRef: string | null;                    // NAME of the secret holding credentials; never the secret itself
  mode: Mode; baseCurrency: string;
  permissions: Permission[];                       // what this connection may do; validation rejects "trade"
  orderTypes: OrderType[];                         // what the broker supports for this account (information only)
  instruments: AssetClass[];
  marketData: { source: string; entitlement: "realtime" | "delayed" | "snapshot" | "none"; note?: string };
  fundedOrders: "disabled";                        // the only allowed value in this contract
};

export type Balance = { currency: string; cash: number; equity: number; buyingPower?: number | null; marginUsed?: number | null };
export type HeldPosition = { instrumentId: string; qty: number; avgPrice: number; markPrice: number | null; notional: number; unrealizedPnl: number | null };
export type OpenOrder = { id: string; instrumentId: string; side: "buy" | "sell"; type: OrderType; qty: number; price: number | null; status: string; placedAt: string };
export type Fill = { id: string; orderId: string | null; instrumentId: string; side: "buy" | "sell"; qty: number; price: number; fee: number; at: string };
export type Health = { connected: boolean; lastOkAt: string | null; error: string | null; latencyMs: number | null };
export type Snapshot = { accountId: string; asOf: string; balances: Balance[]; positions: HeldPosition[]; orders: OpenOrder[]; fills: Fill[]; health: Health };

/** The whole adapter surface. There is deliberately no method that places, changes or cancels an order. */
export interface ReadOnlyAdapter {
  readonly broker: string;
  health(): Promise<Health>;
  balances(): Promise<Balance[]>;
  positions(): Promise<HeldPosition[]>;
  openOrders(): Promise<OpenOrder[]>;
  fills(sinceIso: string): Promise<Fill[]>;
  instruments(ids: string[]): Promise<Instrument[]>;
}
export const ADAPTER_METHODS = ["health", "balances", "positions", "openOrders", "fills", "instruments"] as const;

/** Registry validation: refuses anything that could submit funded orders or store a raw credential. */
export function validateAccount(a: AccountRecord): string[] {
  const e: string[] = [];
  if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(a.id)) e.push("id: lowercase letters, digits, - or _");
  if (a.fundedOrders !== "disabled") e.push("fundedOrders must be 'disabled'");
  if (a.permissions.includes("trade")) e.push("permission 'trade' is not allowed (read-only contract)");
  if (!/^\*{2,}[A-Za-z0-9]{0,4}$/.test(a.externalRef)) e.push("externalRef must be masked (e.g. ****1234)");
  if (a.credentialRef != null && !/^[A-Z][A-Z0-9_]{2,63}$/.test(a.credentialRef)) e.push("credentialRef must be a secret NAME (UPPER_SNAKE), not a value");
  if (a.mode === "live" && a.broker === "paper") e.push("a paper broker cannot be live");
  return e;
}
export function validateInstrument(i: Instrument): string[] {
  const e: string[] = [];
  if (!(i.tick > 0)) e.push("tick must be > 0"); if (!(i.lot > 0)) e.push("lot must be > 0");
  if (i.cls === "prediction") {
    const [lo, hi] = i.priceBounds;
    if (!(lo >= 0 && hi <= i.payout && lo < hi)) e.push("prediction price bounds must lie within [0, payout]");
    if (!i.resolutionRules || !i.resolutionSource) e.push("prediction contracts need resolution rules and source");
    if ("stop" in i || "tp1" in i || "multiplier" in i) e.push("prediction contracts carry no stop/target/multiplier");
  } else if (!(i.multiplier > 0)) e.push("multiplier must be > 0");
  return e;
}

/** Freshness of a snapshot against a limit; stale data is shown as STALE, never as current. */
export const freshness = (s: Snapshot, nowMs: number, maxAgeMs: number) => {
  const age = nowMs - Date.parse(s.asOf);
  return { ageMs: age, state: !s.health.connected ? "DISCONNECTED" as const : !(age >= 0) ? "INVALID" as const : age > maxAgeMs ? "STALE" as const : "FRESH" as const };
};

/** Reconciliation: positions implied by fills since a baseline vs positions reported by the broker. */
export function reconcile(baseline: Record<string, number>, fills: Fill[], reported: HeldPosition[], tolQty = 1e-9) {
  const implied: Record<string, number> = { ...baseline };
  for (const f of fills) implied[f.instrumentId] = (implied[f.instrumentId] ?? 0) + (f.side === "buy" ? f.qty : -f.qty);
  const rep = Object.fromEntries(reported.map((p) => [p.instrumentId, p.qty]));
  const ids = [...new Set([...Object.keys(implied), ...Object.keys(rep)])].sort();
  const breaks = ids.map((id) => ({ instrumentId: id, implied: implied[id] ?? 0, reported: rep[id] ?? 0 })).filter((x) => Math.abs(x.implied - x.reported) > tolQty);
  return { ok: breaks.length === 0, breaks };
}

/** Consolidated exposure across accounts, grouped by an underlying key (e.g. "BTC"), with each account's share. Prediction contracts
 *  are reported as EVENT exposure (max payout at risk and cost), never netted against price exposure of the underlying. */
export function consolidate(snaps: Snapshot[], instruments: Record<string, Instrument>, underlyingOf: (i: Instrument) => string) {
  const price: Record<string, { netNotional: number; grossNotional: number; byAccount: Record<string, number> }> = {};
  const events: Record<string, { contracts: number; maxPayout: number; cost: number; byAccount: Record<string, number> }> = {};
  const unknown: string[] = [];
  for (const s of snaps) for (const p of s.positions) {
    const ins = instruments[p.instrumentId]; if (!ins) { unknown.push(`${s.accountId}:${p.instrumentId}`); continue; }
    if (ins.cls === "prediction") {
      const k = `${ins.eventId}:${ins.outcome}`, g = (events[k] ??= { contracts: 0, maxPayout: 0, cost: 0, byAccount: {} });
      g.contracts += p.qty; g.maxPayout += p.qty * ins.payout; g.cost += p.qty * p.avgPrice; g.byAccount[s.accountId] = (g.byAccount[s.accountId] ?? 0) + p.qty;
    } else {
      const k = underlyingOf(ins), g = (price[k] ??= { netNotional: 0, grossNotional: 0, byAccount: {} });
      const n = p.qty * (p.markPrice ?? p.avgPrice) * ins.multiplier;
      g.netNotional += n; g.grossNotional += Math.abs(n); g.byAccount[s.accountId] = (g.byAccount[s.accountId] ?? 0) + n;
    }
  }
  return { price, events, unknown };
}

/** Research desks (data sources) are registered separately: a desk can never hold credentials or account permissions. */
export type ResearchDesk = { id: string; source: string; instruments: AssetClass[]; entitlement: "public" | "delayed" | "licensed"; credentialRef: null };

/** Reference adapter over the existing PAPER book state (read-only view of dbv5_state). Proves the contract against real data. */
export function paperSnapshot(accountId: string, st: { equity: number; markedEquity?: number; pos: null | { id: string; dir: string; remainingQty: number; entry: number; exits?: { kind: string; px: number; qty: number; fee?: number; t: number }[]; openT?: number; entryFee?: number } },
  sym: string, mark: number | null, asOfMs: number): Snapshot {
  const p = st.pos, d = p?.dir === "long" ? 1 : -1, id = `paper:${sym}`;
  const positions: HeldPosition[] = p ? [{ instrumentId: id, qty: d * p.remainingQty, avgPrice: p.entry, markPrice: mark, notional: d * p.remainingQty * (mark ?? p.entry), unrealizedPnl: mark == null ? null : (mark - p.entry) * d * p.remainingQty }] : [];
  const fills: Fill[] = p ? [
    { id: `${p.id}:entry`, orderId: null, instrumentId: id, side: d === 1 ? "buy" : "sell", qty: p.remainingQty + (p.exits ?? []).reduce((a, e) => a + e.qty, 0), price: p.entry, fee: p.entryFee ?? 0, at: new Date(p.openT ?? asOfMs).toISOString() },
    ...(p.exits ?? []).map((e) => ({ id: `${p.id}:${e.kind}:${e.t}`, orderId: null, instrumentId: id, side: (d === 1 ? "sell" : "buy") as "buy" | "sell", qty: e.qty, price: e.px, fee: e.fee ?? 0, at: new Date(e.t).toISOString() })),
  ] : [];
  return { accountId, asOf: new Date(asOfMs).toISOString(), balances: [{ currency: "USD", cash: st.equity, equity: st.markedEquity ?? st.equity }], positions, orders: [], fills, health: { connected: true, lastOkAt: new Date(asOfMs).toISOString(), error: null, latencyMs: null } };
}
