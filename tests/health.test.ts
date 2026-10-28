import { test } from "node:test";
import assert from "node:assert/strict";
import { checkHealth, approvalWarnings } from "../scripts/check_health.mjs";

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
  assert.equal(checkHealth({ state: {}, updated, integrity: { approved: false, reason: "drift" } }, now, undefined, { requireApproval: true })[0], "BTC: drift");
  assert.ok(checkHealth({}, now).length);
});

test("missing approval is a warning, not a heartbeat failure; a stale book still fails (regression: every run was red while the bot was healthy)", () => {
  const now = Date.UTC(2026, 9, 28, 21, 17), fresh = new Date(now - 60_000).toISOString();
  const unapproved = { approved: false, reason: "Configuration has no approved fingerprint" };
  const status = { state: {}, updated: fresh, integrity: unapproved, books: { GOLD: { state: {}, updated: fresh, integrity: unapproved } } };
  assert.deepEqual(checkHealth(status, now), []);
  assert.deepEqual(approvalWarnings(status), ["BTC: Configuration has no approved fingerprint", "GOLD: Configuration has no approved fingerprint"]);
  assert.equal(checkHealth(status, now, undefined, { requireApproval: true }).length, 2);
  status.books.GOLD.updated = new Date(now - 45 * 60_000).toISOString();
  assert.deepEqual(checkHealth(status, now), ["GOLD: missing, stale or invalid update timestamp"]);
});
