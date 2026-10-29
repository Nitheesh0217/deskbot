// Missed-bar catch-up: same evaluate()/snapshot() as the live loop, no look-ahead, strict validity, pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initState, applyCfg, buildSeries, snapshot, evaluate, ensureState, CFG, type Bar } from "../supabase/functions/deskbot-v5/engine.ts";
import { catchUp, CATCHUP } from "../supabase/functions/deskbot-v5/catchup.ts";

const M5 = 300_000, T0 = Date.UTC(2026, 0, 1);
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const closes = (() => { const r = seeded(1), c = [30000]; for (let i = 1; i < 36000; i++) c.push(c[i - 1] * (1 + 0.00003 * Math.sin(i / 900) + (r() - 0.5) * 0.004)); return c; })();
const base: Bar[] = closes.map((x, i) => { const o = i ? closes[i - 1] : x, w = x * 0.0015; return { t: T0 + i * M5, o, h: Math.max(o, x) + w, l: Math.min(o, x) - w, c: x, v: 10, ct: T0 + (i + 1) * M5 - 1 }; });
const agg = (m5: Bar[], k: number): Bar[] => { const out: Bar[] = []; for (let i = 0; i + k <= m5.length; i += k) { const s = m5.slice(i, i + k); out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((x) => x.h)), l: Math.min(...s.map((x) => x.l)), c: s[k - 1].c, v: 0, ct: s[k - 1].ct }); } return out; };
const series = (m5: Bar[]) => buildSeries({ m5, m15: agg(m5, 3), h1: agg(m5, 12), h4: agg(m5, 48) });
const CTX = { funding: 0.0001, oi: 5, markPx: null, fng: 50 };
applyCfg({ MIN_SCORE: 0 } as never);
const S = series(base), st = ensureState(initState(350, T0));
// boundary bars (15m close or later) where the engine produced at least one signal
const hits: number[] = []; for (let j = 34000; j < 35900 && hits.length < 6; j++) { const sn = snapshot(S, j, CTX); if (sn.new15 && evaluate(sn, {}, S, st).signals.length) hits.push(j); }

test("fixture: the synthetic series has boundary bars with signals", () => assert.ok(hits.length >= 2, `found ${hits.length}`));

test("a skipped boundary bar is re-evaluated: every signal on it is either a valid candidate or recorded as missed with a reason", () => {
  for (const j of hits) {
    const want = evaluate(snapshot(S, j, CTX), {}, S, st).signals.map((s) => s.strategy + s.dir).sort();
    const cu = catchUp(S, j + 1, S.f.m5[j - 1].ct, st, {}, CTX);
    const got = [...cu.candidates.map((s) => s.strategy + s.dir), ...cu.missed.filter((m) => m.T === S.f.m5[j].ct).map((m) => m.strategy + m.dir)].sort();
    assert.deepEqual(got, want, `bar ${j}`);
    assert.ok(cu.boundaryBars >= 1 && cu.scanned === 1);
    for (const c of cu.candidates) assert.ok(c.why.some((w) => w.startsWith("CATCH-UP:")), "candidate is labelled");
  }
});

test("no look-ahead: the bar's signals are identical when the future is removed from the series", () => {
  for (const j of hits.slice(0, 3)) {
    const T = base[j].ct, cut = base.slice(0, j + 1), S2 = series(cut);
    assert.ok(agg(cut, 3).every((b) => b.ct <= T));
    const a = evaluate(snapshot(S, j, CTX), {}, S, st).signals.map((s) => [s.strategy, s.dir, s.stop, s.entryRef]);
    const b = evaluate(snapshot(S2, j, CTX), {}, S2, st).signals.map((s) => [s.strategy, s.dir, s.stop, s.entryRef]);
    assert.deepEqual(a, b);
  }
});

test("validity is strict: a later stop touch or a reached first target turns a candidate into MISSED with that reason", () => {
  const j = hits[0], sig = evaluate(snapshot(S, j, CTX), {}, S, st).signals[0], d = sig.dir === "long" ? 1 : -1, R0 = Math.abs(sig.entryRef - sig.stop);
  const touch = base.map((b) => ({ ...b })); const k = j + 1;
  if (d > 0) touch[k].l = sig.stop - 1; else touch[k].h = sig.stop + 1;
  const cuStop = catchUp(series(touch), j + 2, base[j - 1].ct, st, {}, CTX);
  assert.ok(cuStop.missed.some((m) => m.strategy === sig.strategy && /stop was touched/.test(m.reason)));
  assert.ok(!cuStop.candidates.some((c) => c.strategy === sig.strategy && c.dir === sig.dir));
  const run = base.map((b) => ({ ...b })); const tp1 = sig.entryRef + d * CFG.TARGETS[sig.strategy].tp1 * R0;
  if (d > 0) run[k].h = tp1 + 1; else run[k].l = tp1 - 1;
  const cuTp = catchUp(series(run), j + 2, base[j - 1].ct, st, {}, CTX);
  assert.ok(cuTp.missed.some((m) => m.strategy === sig.strategy && /first target already reached/.test(m.reason)));
});

test("bounded: nothing at or before lastEvalT, nothing older than an hour, nothing when there was no previous evaluation; state untouched", () => {
  const j = hits[0], before = JSON.stringify(st);
  assert.equal(catchUp(S, j + 1, S.f.m5[j].ct, st, {}, CTX).scanned, 0, "already evaluated");
  const far = j + Math.ceil(CATCHUP.maxAgeMs / M5) + 2, old = catchUp(S, far, S.f.m5[j - 1].ct, st, {}, CTX);
  assert.ok(old.scanned <= CATCHUP.maxAgeMs / M5, "scan stops at one hour");
  assert.ok(!old.missed.some((m) => m.T === S.f.m5[j].ct) && !old.candidates.some((c) => c.barT === S.f.m5[j].ct), "an older skipped bar is out of scope");
  assert.equal(catchUp(S, j + 1, 0, st, {}, CTX).scanned, 0);
  assert.equal(JSON.stringify(st), before);
});
