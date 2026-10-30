// Dashboard drawing helpers for the trade-setup view and chart zones. No network. Zones come from zones.js (DeskZones).
// Everything drawn here is derived from closed candles by fixed rules, or from the bot's own recorded plan. It is not a forecast.
(function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rgba = (hex, a) => { if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex; const n = parseInt(hex.replace("#", ""), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

  // A filled price box from time t1 to the right edge (or t2), drawn on the series pane.
  class Box {
    constructor(b) { this.b = b; }
    attached(p) { this.chart = p.chart; this.series = p.series; this.req = p.requestUpdate; }
    detached() { this.chart = this.series = null; }
    updateAllViews() {}
    paneViews() {
      const self = this;
      return [{
        zOrder: () => "bottom",
        renderer: () => ({
          draw(target) {
            target.useBitmapCoordinateSpace(({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
              const b = self.b, s = self.series, ts = self.chart && self.chart.timeScale(); if (!s || !ts) return;
              const y1 = s.priceToCoordinate(b.top), y2 = s.priceToCoordinate(b.bot); if (y1 == null || y2 == null) return;
              let x1 = b.t1 == null ? 0 : ts.timeToCoordinate(b.t1); if (x1 == null) x1 = 0;
              const x2 = b.t2 == null ? bitmapSize.width / hr : (ts.timeToCoordinate(b.t2) ?? bitmapSize.width / hr);
              const top = Math.min(y1, y2) * vr, h = Math.max(1, Math.abs(y2 - y1) * vr), left = Math.max(0, x1) * hr, w = Math.max(1, (x2 - Math.max(0, x1)) * hr);
              c.fillStyle = b.fill; c.fillRect(left, top, w, h);
              c.lineWidth = Math.max(1, hr); c.strokeStyle = b.line; c.setLineDash(b.dash ? [4 * hr, 3 * hr] : []); c.strokeRect(left, top, w, h); c.setLineDash([]);
              if (b.label) {
                c.font = `${Math.round(11 * hr)}px IBM Plex Mono, monospace`; c.textBaseline = "middle"; c.fillStyle = b.text || b.line;
                if (b.labelRight) { c.textAlign = "right"; c.fillText(b.label, left + w - 6 * hr, Math.max(9 * vr, top - 7 * vr)); c.textAlign = "left"; }
                else c.fillText(b.label, left + 6 * hr, top + Math.min(h / 2, 9 * vr));
              }
            });
          },
        }),
      }];
    }
  }

  const KIND_NAME = { FVG: "FVG", IFVG: "IFVG", OB: "OB" };
  /** Zone boxes for the layers that are switched on. `snap(ms)` maps a time to a drawn bar time (or null). */
  function zoneBoxes(read, layers, pal, snap, firstT) {
    const out = []; let named = 0;
    for (const z of read.zones) {
      if (!layers[z.kind]) continue;
      if (Math.min(Math.abs(read.price - z.top), Math.abs(read.price - z.bot)) > 14 * read.atr && !(read.price >= z.bot && read.price <= z.top)) continue;
      const bull = z.side === "bull", base = z.kind === "OB" ? (bull ? pal.obBull : pal.obBear) : (bull ? pal.bull : pal.bear);
      const t1 = snap(z.t0); if (t1 == null && z.t0 < firstT) { /* started before the window: clamp left */ }
      out.push({ top: z.top, bot: z.bot, t1: t1 == null ? null : t1, t2: null, fill: rgba(base, z.touched ? 0.1 : 0.17), line: rgba(base, 0.75), dash: z.kind === "IFVG", labelRight: true, label: named++ < 5 ? `${z.label}${z.touched ? ` · ${Math.round(z.filled * 100)}% filled` : ""}` : null, text: base });
    }
    return out;
  }

  /** The trade as boxes: red from entry to the ORIGINAL stop, green blocks entry->TP1->TP2->TP3. */
  function tradeBoxes(p, pal, snap, opts) {
    const caption = !(opts && opts.labels === false);   // the chart's labelled plan lines carry the text; boxes stay as shading
    const R = Math.abs(p.entry - p.stop0), t1 = snap(p.openT), rr = (x) => (Math.abs(x - p.entry) / R).toFixed(2);
    const out = [{ top: Math.max(p.entry, p.stop0), bot: Math.min(p.entry, p.stop0), t1, t2: null, fill: rgba(pal.sl, 0.22), line: pal.sl, label: caption ? `STOP LOSS −1R` : "", text: pal.slText }];
    const levels = [["TP1", p.tp1, p.tp1Done], ["TP2", p.tp2, p.tp2Done], ["TP3", p.tp3, p.tp3Done]]; let prev = p.entry;
    levels.forEach(([n, px, done], i) => {
      out.push({ top: Math.max(prev, px), bot: Math.min(prev, px), t1, t2: null, fill: rgba(pal.tp, done ? 0.12 : 0.2 + i * 0.04), line: pal.tp, dash: !!done, label: caption ? `${n}${done ? " ✓ hit" : ""} +${rr(px)}R` : "", text: pal.tpText }); prev = px;
    });
    return out;
  }

  /** Static ladder drawing of the setup (price up the page): red stop block, green target blocks, entry line. */
  function setupSVG(p, pal, fmtPx) {
    const W = 320, pad = 10, lv = [p.stop0, p.entry, p.tp1, p.tp2, p.tp3], hi = Math.max(...lv), lo = Math.min(...lv), H = 220, span = hi - lo || 1;
    const y = (px) => pad + ((hi - px) / span) * (H - 2 * pad), R = Math.abs(p.entry - p.stop0), rr = (x) => (Math.abs(x - p.entry) / R).toFixed(1);
    const rect = (a, b, color, a1, label, sub) => `<rect x="70" y="${Math.min(y(a), y(b)).toFixed(1)}" width="${W - 80}" height="${Math.max(2, Math.abs(y(a) - y(b))).toFixed(1)}" fill="${rgba(color, a1)}" stroke="${color}" stroke-width="1"/><text x="78" y="${((y(a) + y(b)) / 2 + 4).toFixed(1)}" fill="${color}" font-size="11" font-family="IBM Plex Mono, monospace">${esc(label)}${sub ? `  ${esc(sub)}` : ""}</text>`;
    const tick = (px, t) => `<text x="4" y="${(y(px) + 4).toFixed(1)}" fill="${pal.muted}" font-size="10" font-family="IBM Plex Mono, monospace">${esc(fmtPx(px))}</text>`;
    let g = rect(p.entry, p.stop0, pal.sl, 0.25, "STOP LOSS", `−1R`);
    let prev = p.entry;
    [["TP1", p.tp1, p.tp1Done, 0.2], ["TP2", p.tp2, p.tp2Done, 0.26], ["TP3", p.tp3, p.tp3Done, 0.32]].forEach(([n, px, done, a]) => { g += rect(prev, px, pal.tp, a, `${n}${done ? " ✓" : ""}`, `+${rr(px)}R`); prev = px; });
    g += `<line x1="62" x2="${W - 6}" y1="${y(p.entry).toFixed(1)}" y2="${y(p.entry).toFixed(1)}" stroke="${pal.fg}" stroke-width="2"/><text x="${W - 8}" y="${(y(p.entry) - 4).toFixed(1)}" text-anchor="end" fill="${pal.fg}" font-size="10" font-family="IBM Plex Mono, monospace">ENTRY ${esc(fmtPx(p.entry))}</text>`;
    if (p.stop !== p.stop0) g += `<line x1="62" x2="${W - 6}" y1="${y(p.stop).toFixed(1)}" y2="${y(p.stop).toFixed(1)}" stroke="${pal.sl}" stroke-width="1.5" stroke-dasharray="4 3"/><text x="${W - 8}" y="${(y(p.stop) - 3).toFixed(1)}" text-anchor="end" fill="${pal.sl}" font-size="10" font-family="IBM Plex Mono, monospace">stop moved ${esc(fmtPx(p.stop))}</text>`;
    g += [p.stop0, p.entry, p.tp1, p.tp2, p.tp3].map((v) => tick(v)).join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Trade setup: ${esc(p.dir)} entry ${esc(fmtPx(p.entry))}, stop loss ${esc(fmtPx(p.stop0))}, targets ${esc(fmtPx(p.tp1))}, ${esc(fmtPx(p.tp2))}, ${esc(fmtPx(p.tp3))}">${g}</svg>`;
  }

  function checksHTML(conf) {
    return `<ul class="checks">${conf.checks.map((c) => `<li class="${c.met ? "met" : "no"}"><span aria-hidden="true">${c.met ? "✔" : "✘"}</span><span><b>${esc(c.label)}</b><br><small>${esc(c.detail)}</small></span></li>`).join("")}</ul>`;
  }
  window.DeskSetup = { Box, zoneBoxes, tradeBoxes, setupSVG, checksHTML, rgba };
})();
