// Tile artwork. Three looks for the galaxy tiles; all are drawn with SVG (no image files, so it works offline):
//   classic   - the original flat tiles
//   deepspace - starfield tiles with shaded planet spheres and painted anomalies
//   blueprint - flat chart style: orbit rings, trait-coloured planet discs, hatched anomalies
(function (root) {
  const TI = (root.TI = root.TI || {});
  const ui = (TI.ui = TI.ui || {});
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const k in attrs || {}) n.setAttribute(k, attrs[k]); if (text !== undefined) n.textContent = text; return n; };

  ui.TILE_STYLES = [['deepspace', 'Deep space'], ['blueprint', 'Blueprint'], ['classic', 'Classic']];
  ui.tileStyle = 'deepspace';
  try { const s = localStorage.getItem('ti-tilestyle'); if (s && ui.TILE_STYLES.some((x) => x[0] === s)) ui.tileStyle = s; } catch (e) { /* storage unavailable */ }
  ui.setTileStyle = (s) => { ui.tileStyle = s; try { localStorage.setItem('ti-tilestyle', s); } catch (e) { /* ignore */ } };

  const TRAIT = { cultural: ['#8fc2ff', '#2c5fb8'], industrial: ['#8de3a6', '#238a4a'], hazardous: ['#ff9a8e', '#a8322b'], none: ['#c9cfe6', '#5b6485'] };
  const TECH = { biotic: '#2fbf71', propulsion: '#4aa3ff', cybernetic: '#f5d142', warfare: '#ff5a50' };
  const seeded = (str) => { let a = 7; for (const ch of String(str)) a = (a * 31 + ch.charCodeAt(0)) >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  // Shared gradients, added once per redraw.
  ui.tileDefs = function () {
    const d = el('defs');
    const rg = (id, stops, extra) => { const g = el('radialGradient', Object.assign({ id }, extra || {})); stops.forEach(([o, c, op]) => g.appendChild(el('stop', { offset: o, 'stop-color': c, 'stop-opacity': op === undefined ? 1 : op }))); d.appendChild(g); };
    rg('ds-space', [['0%', '#1c2650'], ['100%', '#080c1c']]);
    rg('ds-home', [['0%', '#2a3566'], ['100%', '#0a0f22']]);
    rg('ds-mecatol', [['0%', '#4a3d16'], ['100%', '#14100a']]);
    rg('ds-nebula', [['0%', '#7a4fc0', .9], ['60%', '#3b2468', .6], ['100%', '#1a1030', 0]]);
    rg('ds-supernova', [['0%', '#fff2b0'], ['25%', '#ff9a3a'], ['70%', '#a2231b', .7], ['100%', '#3a0c10', 0]]);
    rg('ds-rift', [['0%', '#000'], ['55%', '#10343a'], ['100%', '#58d6e0', .0]]);
    for (const [k, [hi, lo]] of Object.entries(TRAIT)) rg('ds-pl-' + k, [['0%', hi], ['100%', lo]], { cx: '35%', cy: '30%', r: '75%' });
    const pat = el('pattern', { id: 'bp-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pat.appendChild(el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#5b7cff', 'stroke-width': 1.2, opacity: .45 }));
    d.appendChild(pat);
    const pat2 = el('pattern', { id: 'bp-hatch-red', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(-45)' });
    pat2.appendChild(el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#ff7a59', 'stroke-width': 1.4, opacity: .6 }));
    d.appendChild(pat2);
    return d;
  };

  // Background art for one hex (clipped to the hex by the caller). c = centre, R = hex radius.
  ui.tileArt = function (sys, c, R, style, id) {
    const g = el('g', { 'pointer-events': 'none' });
    if (style === 'classic') return g;
    const rnd = seeded('tile' + (sys.tile || id));
    const a = sys.anomaly;
    if (style === 'deepspace') {
      g.appendChild(el('circle', { cx: c.x, cy: c.y, r: R * 1.1, fill: sys.mecatol ? 'url(#ds-mecatol)' : sys.home !== null ? 'url(#ds-home)' : 'url(#ds-space)' }));
      for (let i = 0; i < 16; i++) {
        const ang = rnd() * 6.283, rad = Math.sqrt(rnd()) * R * 0.92;
        g.appendChild(el('circle', { cx: (c.x + Math.cos(ang) * rad).toFixed(1), cy: (c.y + Math.sin(ang) * rad).toFixed(1), r: (0.4 + rnd() * 0.9).toFixed(2), fill: '#dfe6ff', opacity: (0.25 + rnd() * 0.6).toFixed(2) }));
      }
      if (a === 'nebula') {
        for (let i = 0; i < 4; i++) g.appendChild(el('ellipse', { cx: c.x + (rnd() - .5) * R * .7, cy: c.y + (rnd() - .5) * R * .6, rx: R * (.45 + rnd() * .25), ry: R * (.25 + rnd() * .2), fill: 'url(#ds-nebula)', transform: `rotate(${(rnd() * 80 - 40).toFixed(0)} ${c.x} ${c.y})` }));
      } else if (a === 'supernova') {
        g.appendChild(el('circle', { cx: c.x, cy: c.y, r: R * .95, fill: 'url(#ds-supernova)' }));
        for (let i = 0; i < 10; i++) { const ang = i * 0.6283 + rnd() * .3; g.appendChild(el('line', { x1: c.x, y1: c.y, x2: c.x + Math.cos(ang) * R * .9, y2: c.y + Math.sin(ang) * R * .9, stroke: '#ffd37a', 'stroke-width': 1, opacity: .55 })); }
      } else if (a === 'rift') {
        g.appendChild(el('circle', { cx: c.x, cy: c.y, r: R * .8, fill: 'url(#ds-rift)' }));
        for (let i = 1; i <= 4; i++) g.appendChild(el('ellipse', { cx: c.x, cy: c.y, rx: R * i * .17, ry: R * i * .1, fill: 'none', stroke: '#5fe0ea', 'stroke-width': .9, opacity: .75 - i * .12, transform: `rotate(${i * 28} ${c.x} ${c.y})` }));
      } else if (a === 'asteroid') {
        for (let i = 0; i < 16; i++) {
          const ang = rnd() * 6.283, rad = (0.25 + rnd() * .7) * R * .85, r = 2 + rnd() * 4, x = c.x + Math.cos(ang) * rad, y = c.y + Math.sin(ang) * rad;
          g.appendChild(el('polygon', { points: [0, 1, 2, 3, 4].map((k) => { const aa = k * 1.2566 + rnd() * .6, rr = r * (.7 + rnd() * .5); return (x + Math.cos(aa) * rr).toFixed(1) + ',' + (y + Math.sin(aa) * rr).toFixed(1); }).join(' '), fill: '#6c6f80', stroke: '#2b2d3a', 'stroke-width': .6, opacity: .95 }));
        }
      }
      if (sys.wormhole) {
        const col = sys.wormhole === 'alpha' ? '#ffb347' : '#6bd3ff';
        for (let i = 0; i < 3; i++) g.appendChild(el('circle', { cx: c.x, cy: c.y + R * .52, r: 5 + i * 3.5, fill: 'none', stroke: col, 'stroke-width': 1.2, opacity: .85 - i * .22 }));
      }
    } else if (style === 'blueprint') {
      g.appendChild(el('circle', { cx: c.x, cy: c.y, r: R * 1.1, fill: sys.mecatol ? '#2b2a16' : sys.home !== null ? '#162447' : '#0f1a36' }));
      for (const k of [.35, .62, .88]) g.appendChild(el('circle', { cx: c.x, cy: c.y, r: R * k, fill: 'none', stroke: '#3b4f86', 'stroke-width': .7, 'stroke-dasharray': '2 3', opacity: .7 }));
      g.appendChild(el('line', { x1: c.x - R, y1: c.y, x2: c.x + R, y2: c.y, stroke: '#2a3a68', 'stroke-width': .5 }));
      g.appendChild(el('line', { x1: c.x, y1: c.y - R, x2: c.x, y2: c.y + R, stroke: '#2a3a68', 'stroke-width': .5 }));
      if (a) g.appendChild(el('circle', { cx: c.x, cy: c.y, r: R * .72, fill: a === 'supernova' || a === 'asteroid' ? 'url(#bp-hatch-red)' : 'url(#bp-hatch)', stroke: a === 'supernova' ? '#ff7a59' : '#5b7cff', 'stroke-width': 1, 'stroke-dasharray': '5 3' }));
      if (sys.wormhole) {
        const col = sys.wormhole === 'alpha' ? '#ffb347' : '#6bd3ff';
        g.appendChild(el('circle', { cx: c.x, cy: c.y + R * .52, r: 6, fill: 'none', stroke: col, 'stroke-width': 1.6 }));
        g.appendChild(el('circle', { cx: c.x, cy: c.y + R * .52, r: 2, fill: col }));
      }
    }
    return g;
  };

  // Planet body drawn at (px, py), radius r; ring = owner colour or neutral. Returns a <g>.
  ui.planetBody = function (pl, px, py, r, ring, ownerless, style) {
    const g = el('g');
    const tr = TRAIT[pl.trait || 'none'];
    if (style === 'classic') {
      g.appendChild(el('circle', { cx: px, cy: py, r, fill: pl.exhausted ? '#0d1220' : '#1b2340', stroke: ring, 'stroke-width': ownerless ? 1.5 : 3 }));
    } else if (style === 'deepspace') {
      g.appendChild(el('circle', { cx: px, cy: py, r: r + 2.5, fill: 'none', stroke: ring, 'stroke-width': ownerless ? 1 : 3, opacity: ownerless ? .55 : 1 }));
      g.appendChild(el('circle', { cx: px, cy: py, r, fill: `url(#ds-pl-${pl.trait || 'none'})`, opacity: pl.exhausted ? .45 : 1 }));
      g.appendChild(el('circle', { cx: px - r * .3, cy: py - r * .35, r: r * .28, fill: '#fff', opacity: .16 }));
      if (pl.exhausted) g.appendChild(el('circle', { cx: px, cy: py, r, fill: '#050810', opacity: .45 }));
    } else {
      g.appendChild(el('circle', { cx: px, cy: py, r, fill: pl.exhausted ? '#0b1224' : tr[1], stroke: ring, 'stroke-width': ownerless ? 1.5 : 3, opacity: pl.exhausted ? .7 : 1 }));
      g.appendChild(el('path', { d: `M${px - r},${py} A${r},${r} 0 0 1 ${px + r},${py}`, fill: tr[0], opacity: pl.exhausted ? .25 : .55 }));
    }
    if (pl.tech && TECH[pl.tech]) {   // tech specialty: small diamond on the planet's upper right
      const tx = px + r * .75, ty = py - r * .75;
      g.appendChild(el('polygon', { points: `${tx},${ty - 4.5} ${tx + 4.5},${ty} ${tx},${ty + 4.5} ${tx - 4.5},${ty}`, fill: TECH[pl.tech], stroke: '#05070f', 'stroke-width': .8 }));
    }
    return g;
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
