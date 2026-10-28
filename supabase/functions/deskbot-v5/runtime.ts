// Request isolation and configuration provenance. No credentials or trading APIs.
export function serialExecutor() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  };
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function configIntegrity(version: string, symbol: string, config: unknown, expected: string) {
  const bytes = new TextEncoder().encode(canonical({ version, symbol, config }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
  const approved = /^[a-f0-9]{64}$/i.test(expected) && expected.toLowerCase() === hash;
  return { hash, approved, reason: approved ? null : expected ? "Configuration differs from approved fingerprint" : "Configuration has no approved fingerprint" };
}
