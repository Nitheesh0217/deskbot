// Pure view models of web/freshness.js and web/receipts.js (vm-loaded like web_evidence.test.ts). SYNTHETIC inputs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx: any = {};
vm.runInNewContext(["freshness.js", "receipts.js"].map((f) => readFileSync(new URL("../web/" + f, import.meta.url), "utf8")).join("\n"), ctx);
const F = ctx.DeskFreshness, R = ctx.DeskReceipts;
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));   // values from the vm realm have foreign prototypes
const MIN = 60_000, now = Date.parse("2026-10-30T12:03:00Z");
const frame = (ageMin: number, source = "hyperliquid") => ({ source, lastClosedBarT: now - ageMin * MIN, receivedAtMs: now, bars: 300 });

test("freshness: stale threshold is two bar lengths plus two minutes, per timeframe", () => {
  assert.equal(F.staleAfterMs(5 * MIN), 12 * MIN); assert.equal(F.staleAfterMs(240 * MIN), 482 * MIN);
  assert.equal(F.frameStatus(frame(12), 5 * MIN, now).status, "FRESH");
  assert.equal(F.frameStatus(frame(12.1), 5 * MIN, now).status, "STALE");
  assert.equal(F.frameStatus(frame(61), 60 * MIN, now).status, "FRESH", "a 1h bar 61 minutes old is normal");
  assert.equal(F.frameStatus(frame(61), 15 * MIN, now).status, "STALE");
  assert.equal(F.frameStatus(frame(400), 240 * MIN, now).status, "FRESH");
  assert.equal(F.frameStatus(frame(483), 240 * MIN, now).status, "STALE");
});

test("freshness: missing, null, non-numeric or future close times are MISSING with no age number", () => {
  for (const f of [null, undefined, {}, { lastClosedBarT: null }, { lastClosedBarT: "123" }, { lastClosedBarT: NaN }, { lastClosedBarT: now + 10 * MIN }]) {
    const s = F.frameStatus(f, 5 * MIN, now); assert.equal(s.status, "MISSING"); assert.equal(s.ageMs, null);
  }
  assert.equal(F.fmtAge(null), "MISSING");
  const m = F.model({ BTC: { frames: { m5: frame(3), m15: { source: "hyperliquid", lastClosedBarT: null, bars: 0 } } } }, now)[0];
  assert.deepEqual(plain(m.rows.map((r: any) => r.status)), ["FRESH", "MISSING", "MISSING", "MISSING"]);
  assert.equal(m.rows[1].lastClosedBarT, null); assert.equal(m.rows[2].sourceLabel, "not reported");
  const h = F.html([m]); assert.ok(!/NaN|undefined|Invalid/.test(h)); assert.match(h, /MISSING/);
});

test("freshness: mixed sources across the four frames show the paused-entries banner; one feed does not", () => {
  const one = { frames: { m5: frame(3), m15: frame(5), h1: frame(30), h4: frame(100) } };
  const mixed = { frames: { ...one.frames, h1: frame(30, "binance") } };
  const [a, b] = F.model({ BTC: one, GOLD: mixed }, now);
  assert.equal(a.mixed, false); assert.equal(a.banner, null);
  assert.equal(b.mixed, true); assert.equal(b.banner, "Mixed feeds: new entries paused this run");
  assert.equal(b.rows[2].sourceLabel, "Binance"); assert.equal(b.rows[0].sourceLabel, "Hyperliquid");
  // an older backend that reports only lastRun.sources still gets the banner, but no rows
  const c = F.model({ BTC: { sources: { m5: "hyperliquid", m15: "binance", h1: "hyperliquid", h4: "hyperliquid" } } }, now)[0];
  assert.equal(c.reported, false); assert.equal(c.mixed, true); assert.equal(c.rows.length, 0);
});

test("freshness: a backend without frames renders 'not reported', never a number", () => {
  const m = F.model(F.booksFrom({ lastRun: { ts: "2026-10-30T12:01:00Z", market: { barT: now } }, books: null }, null, "BTC"), now);
  assert.equal(m.length, 1); assert.equal(m[0].reported, false);
  assert.match(F.html(m), /not reported by this backend version/);
  assert.deepEqual(plain(Object.keys(F.booksFrom(null, { state: { last_run: null } }, "GOLD"))), ["GOLD"]);
  assert.match(F.html(F.model(F.booksFrom(null, null, "BTC"), now)), /not reported/);
});

const rc = (strategy: string, outcome: string, extra: Record<string, unknown> = {}) => ({ strategy, outcome, reason: `${outcome} reason`, barT: now - 3 * MIN, ...extra });
test("receipts: grouped into Executed / Waiting / Rejected by gates / Not due / Off, reasons kept", () => {
  const m = R.model({ receipts: [rc("SSR", "EXECUTED"), rc("EMA_PB", "WAIT", { code: "NOT_SELECTED" }), rc("TREND_MTF", "NO_SETUP"), rc("HTF_TREND", "GATE_REJECTED"), rc("D_THRUST", "NOT_DUE"), rc("SWEEP_REV", "DISABLED"), rc("HTF_SWEEP", "SHADOW_SIGNAL", { barT: now - 30 * MIN })] });
  assert.equal(m.state, "ok"); assert.equal(m.total, 7);
  const by = plain(Object.fromEntries(m.groups.map((g: any) => [g.label, g.items.map((x: any) => x.strategy)])));
  assert.deepEqual(by, { "Executed": ["SSR"], "Waiting": ["EMA_PB", "TREND_MTF", "HTF_SWEEP"], "Rejected by gates": ["HTF_TREND"], "Not due": ["D_THRUST"], "Off": ["SWEEP_REV"] });
  assert.equal(m.barT, now - 3 * MIN, "shadow catch-up bars do not move the evaluated bar");
  const h = R.html(m, { nameOf: (x: string) => "N:" + x });
  assert.match(h, /GATE_REJECTED reason/); assert.match(h, /\[NOT_SELECTED\]/); assert.match(h, /N:SSR/);
  assert.match(h, /not predictions/); assert.ok(!/confidence \d|probabilit(y|ies) of|\d+%/.test(h.replace(R.DISCLAIMER, "")), "no confidence or probability numbers");
});

test("receipts: unknown outcomes are shown under Other; missing reasons say so", () => {
  const m = R.model({ receipts: [{ strategy: "X", outcome: "SOMETHING" }, null] });
  assert.equal(m.groups.at(-1).label, "Other"); assert.equal(m.groups.at(-1).items[0].reason, "reason not recorded");
});

test("receipts: absent field, null list and no run each render a distinct, honest message", () => {
  assert.equal(R.model({ ts: "x" }).state, "not-reported"); assert.match(R.html(R.model({ ts: "x" })), /not reported/);
  assert.equal(R.model({ receipts: null }).state, "no-new-bar"); assert.match(R.html(R.model({ receipts: null })), /no new 5m bar/);
  assert.equal(R.model(null).state, "none"); assert.match(R.html(R.model(undefined)), /No run reported/);
  assert.equal(R.model({ receipts: [] }).groups.every((g: any) => g.items.length === 0), true);
});
