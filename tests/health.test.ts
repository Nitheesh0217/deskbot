import { test } from "node:test";
import assert from "node:assert/strict";
import { checkHealth } from "../scripts/check_health.mjs";

test("fresh BTC cannot hide a stale GOLD book", () => {
  const now = Date.UTC(2026, 9, 23), updated = new Date(now - 60_000).toISOString();
  const status = { state: {}, updated, books: { GOLD: { state: {}, updated: new Date(now - 31 * 60_000).toISOString() } } };
  assert.deepEqual(checkHealth(status, now), ["GOLD: missing, stale or invalid update timestamp"]);
  status.books.GOLD.updated = updated;
  assert.deepEqual(checkHealth(status, now), []);
});

test("heartbeat reports drift, handles optional books and rejects malformed status", () => {
  const now = Date.now(), updated = new Date(now).toISOString();
  assert.deepEqual(checkHealth({ state: {}, updated, books: { GOLD: { state: null } } }, now), []);
  assert.equal(checkHealth({ state: {}, updated, integrity: { approved: false, reason: "drift" } }, now)[0], "BTC: drift");
  assert.ok(checkHealth({}, now).length);
});
