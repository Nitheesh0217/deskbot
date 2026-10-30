# Research: "jev"/"matrix" trading repos, intraday setup practice, UI references (2026-10-31)

Gathered by a research agent through web search and the GitHub search API. github.com READMEs were fetched; hummingbot.org was unreachable from the sandbox. Patterns are borrowed, code is not copied. Evidence key: **[E]** = study or data; **[P]** = practitioner convention.

## 1. Repositories
**"jev" repositories.** Almost all are built on TypeSafe AI's Jev "System One" model, which returns a typed choice plus a probability. Reviews note that it can pick the wrong option and is weak on raw numbers.

| Repo | License | Pattern for DeskBot |
|---|---|---|
| OpenByteInc/QuantDinger (13k★) | Apache-2.0 backend; frontends are source-available | Long loops in a worker, finite jobs in a queue. Strategy leases with heartbeats and fencing tokens. The AI gate may veto entries, never exits or stops. A per-order decision timeline. |
| jarrodwatts/jev-trader | MIT | Swappable model interface with a mock default. HOLD when the model misses its deadline. An SSE `/events` stream for the UI. Dry-run fills only when a real print crosses the order. |
| imikerussell/beebots | MIT | The model chooses from a menu of currently valid moves, with a deterministic fallback. Each decision and who made it is written before acting. Stops run on a separate watcher. The README reports that all three agents lost money over 30 days. |
| arimanyus/warrenduffer | MIT | The model ranks, code sizes the trade (qty = risk ÷ stop). Daily loss cap with flatten and halt, pause after 3 straight losses, kill switch, day replay on a virtual clock. |
| mars-tw/jev-trading-command-center | MIT (three.js has its own notice) | 3D agent "pets", each showing a name and a state: working, standby, cooldown or offline. Multi-timeframe freshness cards. Missing data means no decision. WAIT and risk-rejected outcomes are kept separate from executed trades. |
| VGabriel45/polymarket-btc5m-jev-trading | **No license**, so all rights reserved | Look only; do not copy. |

**"matrix" repositories.** No relevant trading project was found; `matrix-org` is the chat protocol. bigsk1/matrix-crypto (a cmatrix-style price screensaver) is useful only as an aesthetic reference.

**Established projects**

| Project | License | Most transferable idea |
|---|---|---|
| NautilusTrader | LGPL-3.0 | Backtest and live parity: a message bus plus a swappable clock |
| Freqtrade | GPL-3.0 (copying code imposes the license) | A narrow strategy interface, with dry-run as a first-class mode |
| Hummingbot | Apache-2.0 | "Triple-barrier" position executor: stop, target, **time limit** and trailing. Every close is tagged with its reason. |
| TradingAgents | Apache-2.0 | Firm-style roles: analysts → bull/bear debate → trader → risk team → PM. This is the Tower's model. |
| QuantConnect Lean | Apache-2.0 | Universe → Alpha → Portfolio → Risk → Execution as separate modules |
| OpenBB | AGPL-3.0 (copying code imposes the license) | One provider interface over many data vendors |

## 2. How professional intraday setups are structured (trades of 10-30 minutes)
**Base rate [E].** Of Brazilian futures day traders who persisted at least 300 days, about 97% lost money (Chague, De-Losso and Giovannetti).

**Levels marked before the session**
- Prior day high, low and close, and the overnight/Asia range **[P]**. For 24/7 crypto, define sessions by UTC blocks.
- Bitcoin's first half-hour predicts its last half-hour when sessions are defined by volume (Shen, Urquhart and Wang 2022) **[E]**.
- Session VWAP and anchored VWAP **[P as support/resistance]**.
- Opening range **[E, small effect, sensitive to costs]**: Zarattini and Aziz's ORB backtest assumed zero costs; a replication found an edge of about 0.1R.
- Volume-profile POC and value area **[P]**.
- Round numbers and stop clusters **[E]**: in Osler's FX order data, profit-taking orders cluster *at* round numbers and stops *just beyond* them, and price accelerates through the stops.
- ICT-style "liquidity sweeps" have no peer-reviewed support **[P]**.

**Setup families [P]**

| Setup | Trigger | Stop | Target |
|---|---|---|---|
| Opening-range breakout | A close outside the opening range | The other side, or the midpoint | 1-2R or the next level |
| VWAP reclaim/rejection | A close back across VWAP, then a retest that holds | Beyond the retest swing | Prior day high/low or a VWAP band |
| Liquidity sweep & reclaim | A trade through the level, then a close back inside within N bars | Beyond the sweep extreme | Far side of the range, or VWAP/POC |
| EMA pullback in trend | Higher-timeframe trend, a pullback to the 5m 20 EMA, then a close with the trend | Beyond the pullback swing | Prior swing; trail after 1R |
| Range fade | At least 2 touches per side and flat ATR | Outside the range | Midpoint, then the far edge |
| Break & retest | A close beyond the level, then a hold on retest | Back inside the level plus a buffer | Next level, or a measured move |

**Clean chart [P]**
- Show only the active trade's entry, stop and targets (labelled with their R) plus at most 3-5 context levels.
- Put labels at the right edge. Stop is red, targets green, entry neutral.
- Show live R and a **time-in-trade clock** that turns amber, then red, as the time limit nears.
- After an exit, show the exit reason.

**Risk practice [P]:** fixed fractional R; a daily loss limit sized to hold about 8-10 straight losses; a maximum number of trades; a pause after 3 straight losses; no trading around scheduled macro releases, in thin hours, with abnormal funding, or on stale data.

## 3. UI references
- **Linear.** Themes are derived in LCH from three inputs (base, accent, contrast). Elevation comes from lightness steps. Inter and Inter Display. Dense rows, one accent colour, keyboard-first with Cmd/Ctrl+K reaching everything.
- **A readable "Matrix/terminal" theme**
  - Background near-black grey (#0d1110-#121212), not #000.
  - Body text in a light green-grey; saturated green only for accents and live values.
  - Check contrast with both APCA and WCAG.
  - Monospace with tabular figures for numbers.
  - Effects (scanlines, "rain") off by default, honouring reduced motion.
  - Red and green keep their meaning and are backed up by a sign or shape.
- **3D building on a static site**
  - CSS 3D transforms: no dependencies, accessible DOM, and fine for about 5 floors × 6 desks. **Recommended.**
  - Isometric SVG: Isomer (MIT) or Zdog (README says MIT; verify before using).
  - three.js (MIT): about 600 KB and needs WebGL; only worth it if camera orbit is essential.

## Sources
Repositories: github.com/OpenByteInc/QuantDinger, jarrodwatts/jev-trader, imikerussell/beebots, arimanyus/warrenduffer, mars-tw/jev-trading-command-center, VGabriel45/polymarket-btc5m-jev-trading, bigsk1/matrix-crypto, nautechsystems/nautilus_trader, freqtrade/freqtrade, hummingbot/hummingbot, TauricResearch/TradingAgents, QuantConnect/Lean, tradingview/lightweight-charts, jdan/isomer, metafizzy/zdog, mrdoob/three.js.

Studies and articles:
- Opening-range breakout: concretumgroup.com (ORB study); SSRN 4416622; econpapers JFE 129(2) 2018 (Gao, Han, Li and Zhou); mql5.com blog post 776235 (replication)
- Bitcoin intraday: research.birmingham.ac.uk (Bitcoin intraday time-series momentum); arxiv.org/pdf/2109.12142; researchportal.hw.ac.uk (intraday dynamics of Bitcoin)
- Stop and take-profit clustering: newyorkfed.org staff reports SR125 and SR150; Journal of Finance 2003 (Osler)
- Day-trader base rate: repositorio.fgv.br (Chague, De-Losso and Giovannetti)
- UI: linear.app/now/how-we-redesigned-the-linear-ui; github.com/Myndex/SAPC-APCA
- Hummingbot position executor: hummingbot.org/v2-strategies/executors/positionexecutor (search snippet only)
