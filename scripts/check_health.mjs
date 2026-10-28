import { pathToFileURL } from "node:url";

// Freshness failures (stale/missing book) fail the heartbeat. A missing config-approval fingerprint is reported as a WARNING:
// approval is a governance state, not liveness, and treating it as a failure made every run red even while the bot was healthy,
// which hides a real outage. Set HEARTBEAT_REQUIRE_APPROVAL=1 to make it fail again.
function booksOf(status) {
  return { BTC: { state: status.state, updated: status.updated, integrity: status.integrity }, ...(status.books || {}) };
}
export function checkHealth(status, now = Date.now(), maxAgeMs = 20 * 60_000, { requireApproval = false } = {}) {
  const errors = [];
  for (const [symbol, book] of Object.entries(booksOf(status))) {
    if (!book.state && symbol !== "BTC") continue; // optional book deliberately not initialized
    const age = now - Date.parse(book.updated || "");
    if (!book.state || !Number.isFinite(age) || age < -60_000 || age > maxAgeMs) errors.push(`${symbol}: missing, stale or invalid update timestamp`);
    if (requireApproval && book.integrity && !book.integrity.approved) errors.push(`${symbol}: ${book.integrity.reason || "configuration not approved"}`);
  }
  return errors;
}
export function approvalWarnings(status) {
  const out = [];
  for (const [symbol, book] of Object.entries(booksOf(status))) {
    if (!book.state && symbol !== "BTC") continue;
    if (book.integrity && !book.integrity.approved) out.push(`${symbol}: ${book.integrity.reason || "configuration not approved"}`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const response = await fetch("https://xevymbzgpcsdhygswxlk.supabase.co/functions/v1/deskbot-v5", { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Status HTTP ${response.status}`);
    const status = await response.json(), errors = checkHealth(status, Date.now(), undefined, { requireApproval: process.env.HEARTBEAT_REQUIRE_APPROVAL === "1" });
    for (const w of approvalWarnings(status)) console.log(`::warning title=Config approval::${w}`);
    if (errors.length) throw new Error(errors.join("; "));
    console.log(`DeskBot ${status.version}: initialized books are fresh`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
