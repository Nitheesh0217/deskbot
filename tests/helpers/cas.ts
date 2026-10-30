// Test helper: the book-state PATCH guard as PostgREST evaluates it (persist.ts saveStateCAS). `state->>_rev=eq.N` matches
// a row whose state._rev is N; `state->_rev=is.null` matches a row without _rev. A non-matching PATCH writes nothing and
// returns no rows. Used by every handler-test database mock so tests exercise the same concurrency rule as production.
export function casMatches(path: string, current: { _rev?: unknown } | null | undefined): boolean {
  const cur = current && typeof current._rev === "number" ? current._rev : null;
  const m = path.match(/state->>_rev=eq\.(\d+)/);
  if (m) return cur === +m[1];
  if (path.includes("state->_rev=is.null")) return cur === null;
  return true;   // unguarded PATCH (not used by the edge function any more)
}
