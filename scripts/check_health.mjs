import { pathToFileURL } from "node:url";

export function checkHealth(status, now = Date.now(), maxAgeMs = 20 * 60_000) {
  const errors = [];
  const books = { BTC: { state: status.state, updated: status.updated, integrity: status.integrity }, ...(status.books || {}) };
  for (const [symbol, book] of Object.entries(books)) {
    if (!book.state && symbol !== "BTC") continue; // optional book deliberately not initialized
    const age = now - Date.parse(book.updated || "");
    if (!book.state || !Number.isFinite(age) || age < -60_000 || age > maxAgeMs) errors.push(`${symbol}: missing, stale or invalid update timestamp`);
    if (book.integrity && !book.integrity.approved) errors.push(`${symbol}: ${book.integrity.reason || "configuration not approved"}`);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const response = await fetch("https://xevymbzgpcsdhygswxlk.supabase.co/functions/v1/deskbot-v5", { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Status HTTP ${response.status}`);
    const status = await response.json(), errors = checkHealth(status);
    if (errors.length) throw new Error(errors.join("; "));
    console.log(`DeskBot ${status.version}: initialized books are fresh; any reported configuration checks passed`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
