// Missed-bar catch-up ("no missed trade"). A late or failed cron run can skip a 15m / 1H / 4H / daily close, and the live loop only
// evaluates the newest closed 5m bar, so a setup that formed on the skipped close was never seen (coverage audit D5).
// This scans the skipped boundary bars of the last hour with the SAME evaluate() and snapshot() the live loop and the backtest use
// (snapshot(S, j) only sees bars closed at or before bar j: no look-ahead). A setup found there may still be entered now, at the
// current price, only if the trade is still the trade it was:
//   - the stop was never touched between the signal bar and now,
//   - the first target was not already reached (the move did not happen without us),
//   - price has not drifted more than MAX_DRIFT_R from the signal's reference price,
//   - the distance to the stop is still 0.75x..1.25x of the original (risk per trade is unchanged: size follows the stop distance).
// Anything else is recorded as MISSED with the reason. Entries still go through every normal gate (breaker, daily limits, approval, news).
import { evaluate, snapshot, CFG, type Series, type State, type Signal } from "./engine.ts";

export const CATCHUP = { maxAgeMs: 60 * 60_000, maxDriftR: 0.25, minStopRatio: 0.75, maxStopRatio: 1.25, bar: 300_000 } as const;
export type Missed = { T: number; strategy: string; dir: string; score: number; reason: string };
export type CatchUp = { scanned: number; boundaryBars: number; candidates: Signal[]; missed: Missed[] };

const isBoundary = (snap: ReturnType<typeof snapshot>, S: Series) => snap.new15 || snap.new1h || snap.new4h || (snap.i1d >= 0 && S.d1[snap.i1d].ct === snap.T);

/** Scan 5m bars strictly after lastEvalT and strictly before the newest bar i5. Pure: reads S and a copy of st, never mutates them. */
export function catchUp(S: Series, i5: number, lastEvalT: number, st: State, enabled: Record<string, boolean>, ctx: Parameters<typeof snapshot>[2] = {}): CatchUp {
  const out: CatchUp = { scanned: 0, boundaryBars: 0, candidates: [], missed: [] };
  if (!(lastEvalT > 0) || i5 < 1) return out;
  const nowT = S.f.m5[i5].ct, price = S.f.m5[i5].c;
  const stCopy = JSON.parse(JSON.stringify(st)) as State;
  for (let j = i5 - 1; j >= 0; j--) {
    const T = S.f.m5[j].ct;
    if (T <= lastEvalT) break;
    if (nowT - T > CATCHUP.maxAgeMs) break;
    out.scanned++;
    const snap = snapshot(S, j, ctx);
    if (!isBoundary(snap, S)) continue;   // non-boundary 5m bars only matter to 5m strategies, which re-arm on the next bar anyway
    out.boundaryBars++;
    const { signals } = evaluate(snap, enabled, S, stCopy);
    for (const sig of signals) {
      const why = (reason: string) => out.missed.push({ T, strategy: sig.strategy, dir: sig.dir, score: sig.score, reason });
      const d = sig.dir === "long" ? 1 : -1, R0 = Math.abs(sig.entryRef - sig.stop);
      if (!(R0 > 0)) { why("signal had no stop distance"); continue; }
      let hi = -Infinity, lo = Infinity;
      for (let k = j + 1; k <= i5; k++) { hi = Math.max(hi, S.f.m5[k].h); lo = Math.min(lo, S.f.m5[k].l); }
      const stopHit = d > 0 ? lo <= sig.stop : hi >= sig.stop;
      const tp1 = sig.entryRef + d * CFG.TARGETS[sig.strategy].tp1 * R0, tp1Hit = d > 0 ? hi >= tp1 : lo <= tp1;
      const driftR = ((price - sig.entryRef) * d) / R0, stopRatio = Math.abs(price - sig.stop) / R0;
      if (stopHit) { why("stop was touched after the signal"); continue; }
      if (tp1Hit) { why("first target already reached; the move happened without us"); continue; }
      if (Math.abs(driftR) > CATCHUP.maxDriftR) { why(`price drifted ${driftR.toFixed(2)}R from the signal`); continue; }
      if (stopRatio < CATCHUP.minStopRatio || stopRatio > CATCHUP.maxStopRatio) { why(`stop distance now ${stopRatio.toFixed(2)}x the original`); continue; }
      const ageMin = Math.round((nowT - T) / 60_000);
      out.candidates.push({ ...sig, why: [...sig.why, `CATCH-UP: setup formed on the ${new Date(T + 1).toISOString().slice(11, 16)} UTC close, ${ageMin} min ago, missed by a late run; price ${driftR >= 0 ? "+" : ""}${driftR.toFixed(2)}R from the signal, stop untouched`] });
    }
  }
  // newest valid catch-up first, then by score
  out.candidates.sort((a, b) => b.barT - a.barT || b.score - a.score);
  return out;
}
