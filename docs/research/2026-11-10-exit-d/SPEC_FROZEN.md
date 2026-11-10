# Frozen spec: EXIT-D ratchet trail on HTF_TREND (written 2026-11-10, before any result was seen)

## Question
HTF_TREND winners give back a measured 1.45-2.0R before they close. Does a ratchet trail keep more of that without cutting the winners that run?

## Variant EXIT_D (one hook, management only, HTF_TREND only)
- R0 = |entry − original stop|.
- After each closed 5m bar, update the best favourable excursion: MFE = max(MFE, (high − entry)/R0) for longs, (entry − low)/R0 for shorts.
- Once MFE ≥ 1.5R, the stop becomes entry + dir × (MFE − 1.0) × R0, but only if that is tighter than the current stop. A stop never loosens.
- The new stop takes effect from the next bar. Entries, targets, partials, sizing and max hold are unchanged.
- The 1.5R / 1.0R values are fixed here and will not be tuned.

## Data, method and decision rules
As in `docs/research/2026-11-10-layer-agreement/SPEC_FROZEN.md`: frozen data, 3 years, isolated lanes, identity check, costs at 1× and 1.5×, 10-day block bootstrap.
- **ADOPT-CANDIDATE** (shadow lane first) needs all of: expectancy R per trade > 0 at 1.5× on both books; net R improves at both 1× and 1.5× on both books; the 90% bootstrap interval of ΔR is above 0 on at least one book and does not lie wholly below 0 on the other; max drawdown not worse.
- **REJECT** otherwise.
