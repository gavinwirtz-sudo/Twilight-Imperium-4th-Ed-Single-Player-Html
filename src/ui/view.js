// Board camera: wheel / pinch zoom, drag to pan, +/-/fit buttons, double-click a system to zoom in, system inspector.
(function (root) {
  const TI = (root.TI = root.TI || {});
  const ui = (TI.ui = TI.ui || {});
  const $ = (id) => document.getElementById(id);

  const KS = (ui.SIZE || 52) / 52;
  const HOME = { x: -330 * KS, y: -300 * KS, w: 660 * KS, h: 600 * KS };
  const vb = Object.assign({}, HOME);
  const MIN_W = 120, MAX_W = 1000 * KS;
  let svg = null, dragged = false;

  const apply = () => { svg.setAttribute('viewBox', `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`); const z = $('zoom-level'); if (z) z.textContent = Math.round(HOME.w / vb.w * 100) + '%'; };
  function toSvg(cx, cy) { const p = svg.createSVGPoint(); p.x = cx; p.y = cy; return p.matrixTransform(svg.getScreenCTM().inverse()); }

  function zoomAt(factor, cx, cy) {
    const r = svg.getBoundingClientRect();
    const px = cx === undefined ? r.left + r.width / 2 : cx, py = cy === undefined ? r.top + r.height / 2 : cy;
    const before = toSvg(px, py);
    const w = Math.max(MIN_W, Math.min(MAX_W, vb.w / factor)), k = w / vb.w;
    vb.w = w; vb.h *= k;
    apply();
    const after = toSvg(px, py);
    vb.x += before.x - after.x; vb.y += before.y - after.y;
    apply();
  }
  // Fit the whole galaxy (with a margin) into the board element, whatever its shape.
  function fitToMap() {
    const st = ui.ctx && ui.ctx.state, r = svg.getBoundingClientRect();
    if (!st || !r.width || !r.height) { Object.assign(vb, HOME); return; }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const R = ui.SIZE || 52;
    for (const id of st.map.order) { const s2 = st.map.systems[id], c = ui.hexCenter(s2.q, s2.r); x0 = Math.min(x0, c.x - R * .87); x1 = Math.max(x1, c.x + R * .87); y0 = Math.min(y0, c.y - R); y1 = Math.max(y1, c.y + R); }
    const m = R * .25, w0 = x1 - x0 + 2 * m, h0 = y1 - y0 + 2 * m, asp = r.height / r.width;
    const w = Math.max(w0, h0 / asp), h = w * asp;
    Object.assign(vb, { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h });
    HOME.w = w;       // zoom % is relative to the fitted view
  }
  ui.view = {
    zoomIn: () => zoomAt(1.4), zoomOut: () => zoomAt(1 / 1.4),
    reset: () => { fitToMap(); apply(); },
    zoomTo(id, width) {
      const s = ui.ctx && ui.ctx.state && ui.ctx.state.map.systems[id]; if (!s) return;
      const c = ui.hexCenter(s.q, s.r), w = width || 200, r = svg.getBoundingClientRect(), h = w * (r.height / Math.max(1, r.width));
      Object.assign(vb, { x: c.x - w / 2, y: c.y - h / 2, w, h }); apply();
    },
  };

  ui.initView = function () {
    svg = $('board');
    // keep the aspect ratio of the viewBox in step with the element so zoom maths stays simple
    const fit = () => { const r = svg.getBoundingClientRect(); if (r.width && r.height) { vb.h = vb.w * r.height / r.width; apply(); } };
    window.addEventListener('resize', fit); fit();
    svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });

    const pts = new Map(); let last = null, pinch = 0, moved = 0;
    svg.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { x: e.clientX, y: e.clientY }; moved = 0; dragged = false;
      pinch = pts.size === 2 ? dist() : 0; });
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    svg.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {                       // pinch
        const d = dist(); if (pinch) { const [a, b] = [...pts.values()]; zoomAt(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2); } pinch = d; dragged = true; return;
      }
      moved += Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y);
      if (moved < 6) return;
      dragged = true;
      const a = toSvg(last.x, last.y), b = toSvg(e.clientX, e.clientY);
      vb.x += a.x - b.x; vb.y += a.y - b.y; apply();
      last = { x: e.clientX, y: e.clientY };
      svg.classList.add('panning');
    });
    const up = (e) => { pts.delete(e.pointerId); pinch = 0; svg.classList.remove('panning'); last = pts.size ? [...pts.values()][0] : null; };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up); svg.addEventListener('pointerleave', up);
    // a drag must not count as a click on a system
    svg.addEventListener('click', (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true);
    svg.addEventListener('dblclick', (e) => { const g = e.target.closest && e.target.closest('[data-sys]'); if (g) ui.view.zoomTo(g.getAttribute('data-sys'), 200); });

    $('zoom-in').addEventListener('click', ui.view.zoomIn);
    $('zoom-out').addEventListener('click', ui.view.zoomOut);
    $('zoom-fit').addEventListener('click', ui.view.reset);
    $('btn-legend').addEventListener('click', () => { ui.viewer({ title: 'Unit icons', body: ui.legendHtml() }); });
    document.addEventListener('keydown', (e) => {
      if (/INPUT|SELECT|TEXTAREA/.test((e.target.tagName || ''))) return;
      if (e.key === '+' || e.key === '=') ui.view.zoomIn();
      else if (e.key === '-') ui.view.zoomOut();
      else if (e.key === '0') ui.view.reset();
      else if (e.key === 'h' || e.key === 'H') ui.togglePeek && ui.togglePeek();
    });
    $('inspector-close').addEventListener('click', () => { ui.inspected = null; ui.redraw(); });
  };

  // ---- system inspector -------------------------------------------------------------------------
  ui.inspected = null;
  ui.inspect = function (id) { ui.inspected = ui.inspected === id ? null : id; ui.redraw(); };
  ui.renderInspector = function (state) {
    const box = $('inspector'), body = $('inspector-body');
    const sys = ui.inspected && state.map.systems[ui.inspected];
    if (!sys) { box.hidden = true; return; }
    box.hidden = false;
    const C = ui.COLORS, esc = ui.esc;
    const tags = [];
    if (sys.home !== null) tags.push(`${esc(state.players[sys.home].name)}'s home`);
    if (sys.mecatol) tags.push('Mecatol Rex');
    if (sys.anomaly) tags.push(sys.anomaly === 'rift' ? 'gravity rift' : sys.anomaly);
    if (sys.wormhole) tags.push(sys.wormhole + ' wormhole');
    const countBy = (list) => { const c = {}; list.forEach((u) => { const k = u.type + (u.damaged ? '!' : ''); c[k] = (c[k] || 0) + 1; }); return c; };
    let html = `<div class="ins-title">System ${esc(sys.tile || sys.id)} <span class="note">${tags.join(' · ')}</span></div>`;
    const toks = (sys.tokens || []).map((p) => `<span class="dot" style="background:${C[p]}" title="${esc(state.players[p].name)} command token"></span>`).join('');
    if (toks) html += `<div class="note">Command tokens: ${toks} <span class="note">(ships here cannot move out again this round)</span></div>`;
    const owners = state.players.filter((p) => (sys.ships[p.id] || []).length || ((sys.cargo || {})[p.id] || []).length);
    html += owners.length ? '<div class="ins-h">Space</div>' : '<div class="note">No ships here.</div>';
    owners.forEach((p) => {
      const col = C[p.id];
      const rows = Object.entries(countBy(sys.ships[p.id] || [])).map(([k, n]) => {
        const dmg = k.endsWith('!'), t = k.replace('!', '');
        return `<div class="ins-unit">${ui.iconSvg(t, col, 26, { damaged: dmg })}<b>×${n}</b> ${esc(ui.unitName(p, t))}${dmg ? ' <span class="chip">damaged</span>' : ''}</div>`;
      });
      const cargo = ((sys.cargo || {})[p.id] || []).length;
      if (cargo) rows.push(`<div class="ins-unit">${ui.iconSvg('infantry', col, 26)}<b>×${cargo}</b> ground forces aboard</div>`);
      html += `<div class="ins-owner"><div class="swatch" style="background:${col}"></div><div><div class="name">${esc(p.name)}</div>${rows.join('')}</div></div>`;
    });
    if (sys.planets.length) html += '<div class="ins-h">Planets</div>';
    sys.planets.forEach((pl) => {
      const col = pl.owner === null ? '#6b7699' : C[pl.owner], own = pl.owner === null ? 'unclaimed' : state.players[pl.owner].name;
      const g = pl.ground.length;
      const bits = [];
      if (g) bits.push(`${ui.iconSvg('infantry', col, 22)}<b>×${g}</b>`);
      if (pl.dock) bits.push(`${ui.iconSvg('spacedock', col, 22)}<b>dock</b>`);
      if (pl.pds) bits.push(`${ui.iconSvg('pds', col, 22)}<b>×${pl.pds}</b> PDS`);
      html += `<div class="ins-planet"><div class="name"><span class="dot" style="background:${col}"></span> ${esc(pl.name)} <span class="note">${pl.res}R / ${pl.inf}I${pl.trait ? ' · ' + esc(pl.trait) : ''}${pl.tech ? ' · ' + esc(pl.tech) + ' specialty' : ''}${pl.exhausted ? ' · exhausted' : ''}</span></div>
        <div class="note">${esc(own)}</div>${(pl.attach || []).map((id) => `<div class="note"><span class="chip gold">${esc(TI.AGENDA_BY_ID[id].name)}</span>${pl.team ? (pl.team.ready ? ' ready' : ' exhausted') : ''}</div>`).join('')}<div class="ins-bits">${bits.join('') || '<span class="note">nothing built or landed</span>'}</div></div>`;
    });
    body.innerHTML = html;
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
