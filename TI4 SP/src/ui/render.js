// SVG rendering of the galaxy and the side panels. Pure view code: reads state, never mutates it.
(function (root) {
  const TI = (root.TI = root.TI || {});
  const ui = (TI.ui = TI.ui || {});

  const SIZE = 70;                 // on-screen hex radius
  const S0 = 52, K = SIZE / S0;    // unit icons, labels and planets are laid out for a 52-radius hex, then scaled up by K
  ui.SIZE = SIZE;
  const COLORS = ['#e5484d', '#3e8bff', '#2fbf71', '#f5a524', '#a855f7', '#14b8a6'];
  ui.COLORS = COLORS;
  const SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    return n;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  ui.esc = esc;

  // Display name of a unit type for a player: faction flagship / special unit names, else the type itself.
  ui.unitName = function (player, type) {
    const f = player && TI.faction ? TI.faction(player) : null;
    if (f && type === 'flagship') return f.flagship.name + ' (flagship)';
    if (f && f.unitNames && f.unitNames[type]) return f.unitNames[type];
    return type;
  };

  // One faction sheet as HTML (used by the faction viewer and the setup screen).
  ui.factionHtml = function (f) {
    const units = (list) => { const c = {}; list.forEach((t) => { c[t] = (c[t] || 0) + 1; }); return Object.entries(c).map(([t, n]) => `${n} ${t}`).join(', '); };
    const st = f.start;
    const home = f.planets.map((p) => `${esc(p.name)} ${p.res}/${p.inf}`).join(' · ');
    const rows = f.sheet.map((s) => `<div class="sheet-row${s.modeled ? '' : ' unmodeled'}"><b>${esc(s.name)}</b>${s.modeled ? '' : ' <span class="chip">not modeled</span>'}<div>${esc(s.text)}</div></div>`).join('');
    return `<div class="sheet">
      <div class="note">Difficulty: <b>${esc(f.difficulty)}</b> · Commodities ${f.commodities} · Home: ${home}</div>
      <div class="note">Start: ${units(st.ships)}, ${units(st.ground)}${st.pds ? ', ' + st.pds + ' PDS' : ''}, space dock · Techs: ${f.techs.length ? f.techs.map((t) => esc(TI.TECHS[t].name)).join(', ') : 'none'}</div>
      ${rows}</div>`;
  };

  const center = (q, r) => ({ x: SIZE * Math.sqrt(3) * (q + r / 2), y: SIZE * 1.5 * r });
  ui.hexCenter = center;

  // A row of icon + count pairs centred on (cx, cy); shrinks to fit maxW. items: [{type, n, damaged, aboard}]
  function iconRow(parent, items, cx, cy, color, maxW) {
    const step = 19, width = items.length * step * 1.3, k = Math.min(1, maxW / width);
    const row = el('g', { transform: `translate(${cx},${cy}) scale(${(k * 1.3).toFixed(2)})` });
    items.forEach((it, i) => {
      const x = (i - (items.length - 1) / 2) * step;
      const g = el('g', { transform: `translate(${x.toFixed(1)},0)` });
      g.innerHTML = ui.iconMarkup(it.type, color, { damaged: it.damaged });
      if (it.n > 1 || it.aboard) {
        const t = el('text', { x: 5, y: 10, class: 'ucount' }, (it.aboard ? '▲' : '') + (it.n > 1 ? it.n : ''));
        t.setAttribute('fill', '#fff');
        g.appendChild(t);
      }
      if (it.locked) {   // already activated this round: cannot leave
        g.setAttribute('opacity', '.42');
        g.appendChild(el('line', { x1: -7, y1: 7, x2: 7, y2: -7, stroke: '#ff6b6b', 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
      }
      row.appendChild(g);
    });
    parent.appendChild(row);
  }
  function hexPoints(cx, cy, s) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      pts.push((cx + s * Math.cos(a)).toFixed(1) + ',' + (cy + s * Math.sin(a)).toFixed(1));
    }
    return pts.join(' ');
  }

  // opts: { pick: Set<id>|null, onPick(id), selected: id|null, humanId }
  ui.renderMap = function (state, svg, opts) {
    opts = opts || {};
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const style = ui.tileStyle || 'deepspace';
    svg.appendChild(ui.tileDefs());
    const L1 = el('g'), L2 = el('g');     // all tile backgrounds first, then every system's pieces on top so no tile can cover a unit
    svg.appendChild(L1); svg.appendChild(L2);
    for (const id of state.map.order) {
      const sys = state.map.systems[id];
      const c = center(sys.q, sys.r);
      const g = el('g', { 'data-sys': id, transform: `translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) scale(${K.toFixed(4)}) translate(${(-c.x).toFixed(1)} ${(-c.y).toFixed(1)})` });
      const base = el('g', { 'data-sys': id });
      const classes = ['hex'];
      if (sys.home !== null) classes.push('home');
      if (sys.mecatol) classes.push('mecatol');
      if (sys.anomaly) classes.push(sys.anomaly);
      const canPick = opts.pick && opts.pick.has(id);
      if (opts.pick) classes.push(canPick ? 'pick' : 'dim');
      if (opts.selected === id || (!opts.pick && ui.inspected === id)) classes.push('sel');
      const poly = el('polygon', { points: hexPoints(c.x, c.y, SIZE - 1.5), class: classes.join(' ') });
      if (sys.home !== null) poly.setAttribute('stroke', COLORS[sys.home]);
      const click = canPick ? () => opts.onPick && opts.onPick(id) : !opts.pick ? () => ui.inspect && ui.inspect(id) : null;
      if (click) for (const t of [g, base]) { t.addEventListener('click', click); if (canPick) t.style.cursor = 'pointer'; }
      if (style !== 'classic') {
        const clip = el('clipPath', { id: 'clip-' + id.replace(/[^\w]/g, '_') });
        clip.appendChild(el('polygon', { points: hexPoints(c.x, c.y, SIZE - 1.5) }));
        base.appendChild(clip);
        const art = ui.tileArt(sys, c, SIZE, style, id);
        art.setAttribute('clip-path', `url(#clip-${id.replace(/[^\w]/g, '_')})`);
        if (opts.pick && !canPick) art.setAttribute('opacity', '.35');
        base.appendChild(art);
        poly.style.fill = 'transparent';
        if (sys.home === null && !sys.mecatol && !canPick && !(opts.selected === id || (!opts.pick && ui.inspected === id))) poly.setAttribute('stroke', sys.planets.length ? '#3d5fa8' : sys.anomaly ? '#a8483d' : '#44507a');
      }
      base.appendChild(poly);

      // header: id and special tags
      let tag = sys.tile ? String(sys.tile) : id;
      if (sys.wormhole) tag += '  ' + (sys.wormhole === 'alpha' ? 'α' : 'β');
      if (sys.anomaly) tag += '  ' + (sys.anomaly === 'rift' ? 'gravity rift' : sys.anomaly);
      if (sys.home !== null) tag = state.players[sys.home].name;
      g.appendChild(el('text', { x: c.x, y: c.y - S0 + 15, class: 'sys-label', fill: style === 'classic' ? '' : '#9aa8d6' }, tag));

      // planets
      const n = sys.planets.length;
      sys.planets.forEach((pl, i) => {
        const slots = n === 1 ? [[0, -4]] : n === 2 ? [[-19, -4], [19, -4]] : [[-30, -2], [30, -2], [0, -18]];
        const px = c.x + slots[Math.min(i, slots.length - 1)][0];
        const py = c.y + slots[Math.min(i, slots.length - 1)][1];
        const stroke = pl.owner === null ? '#4a5578' : COLORS[pl.owner];
        const pg = el('g', {});
        const ownerName = pl.owner === null ? 'unclaimed' : state.players[pl.owner].name;
        pg.appendChild(el('title', {}, `${pl.name}: ${pl.res} resources / ${pl.inf} influence · ${ownerName}` +
          (pl.ground.length ? ` · ${pl.ground.length} ground forces` : '') + (pl.dock ? ' · space dock' : '') + (pl.pds ? ` · ${pl.pds} PDS` : '') + (pl.exhausted ? ' · exhausted' : '')));
        pg.appendChild(ui.planetBody(pl, px, py, 14, stroke, pl.owner === null, style));
        pg.appendChild(el('text', Object.assign({ x: px, y: py + 4, class: 'planet-stat', fill: '#f4f7ff' }, style === 'classic' ? {} : { stroke: '#05070f', 'stroke-width': 2.6, 'paint-order': 'stroke' }), pl.res + '/' + pl.inf));
        const maxName = n === 1 ? 14 : n === 2 ? 7 : 6;
        pg.appendChild(el('text', { x: px, y: py + 25, class: 'planet-name' }, pl.name.length > maxName ? pl.name.slice(0, maxName - 1) + '…' : pl.name));
        const col = pl.owner === null ? '#aab' : COLORS[pl.owner];
        const items = [];
        if (pl.ground.length) items.push({ type: 'infantry', n: pl.ground.length });
        if (pl.dock) items.push({ type: 'spacedock', n: 1 });
        if (pl.pds) items.push({ type: 'pds', n: pl.pds });
        if (items.length) iconRow(pg, items, px, py - 26, col, n === 3 ? 46 : 60);
        g.appendChild(pg);
      });

      // fleets: one row of unit icons per player, stacked upward from the bottom of the hex
      const owners = Object.keys(sys.ships).filter((k) => sys.ships[k].length);
      const cargoOwners = Object.keys(sys.cargo || {}).filter((k) => sys.cargo[k].length && !owners.includes(k));
      const all = owners.concat(cargoOwners);
      const ORDER = ['fighter', 'destroyer', 'cruiser', 'carrier', 'dreadnought', 'warsun', 'flagship'];
      all.forEach((k, i) => {
        const ships = sys.ships[k] || [];
        const cargo = ((sys.cargo || {})[k] || []).length;
        const items = [];
        const locked = (sys.tokens || []).includes(+k) && state.phase === 'action';
        ORDER.forEach((t) => {
          const list = ships.filter((u) => u.type === t);
          if (!list.length) return;
          const hurt = list.filter((u) => u.damaged).length;
          items.push({ type: t, n: list.length, damaged: hurt > 0, locked });
        });
        if (cargo) items.push({ type: 'infantry', n: cargo, aboard: true });
        const counts = {};
        ships.forEach((u) => { counts[u.type] = (counts[u.type] || 0) + 1; });
        const fg = el('g', {});
        fg.appendChild(el('title', {}, `${state.players[k].name}: ` + (Object.entries(counts).map(([t, c2]) => `${c2} ${ui.unitName(state.players[k], t)}`).join(', ') || 'no ships') + (cargo ? ` · ${cargo} ground forces aboard` : '') + (locked ? ' — greyed: this system holds their command token, so these ships cannot move again this round' : '')));
        const y = c.y + S0 - 17 - (all.length - 1 - i) * 19;
        fg.appendChild(el('rect', { x: c.x - 41, y: y - 10, width: 82, height: 19, rx: 5, fill: 'rgba(5,8,15,.55)', stroke: COLORS[k], 'stroke-width': 1.2 }));
        iconRow(fg, items, c.x, y, COLORS[k], 76);
        g.appendChild(fg);
      });

      // command tokens
      (sys.tokens || []).forEach((pid, i) => g.appendChild(el('circle', { cx: c.x - S0 + 22 + i * 7, cy: c.y - 22, r: 3, fill: COLORS[pid], stroke: '#000', 'stroke-width': .5 })));
      L1.appendChild(base); L2.appendChild(g);
    }
    // Most recent activation: dashed ring on the system and arrows from where the ships came from.
    const lm = state.lastMove;
    if (lm && state.map.systems[lm.target]) {
      const col = COLORS[lm.player], T = state.map.systems[lm.target], tc = center(T.q, T.r);
      const o = el('g', { class: 'lastmove', 'pointer-events': 'none' });
      o.appendChild(el('polygon', { points: hexPoints(tc.x, tc.y, SIZE + 1), fill: 'none', stroke: col, 'stroke-width': 3.5, 'stroke-dasharray': '7 5' }));
      (lm.from || []).forEach((fid) => {
        const F = state.map.systems[fid]; if (!F || fid === lm.target) return;
        const fc = center(F.q, F.r), dx = tc.x - fc.x, dy = tc.y - fc.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        const x1 = fc.x + ux * 24, y1 = fc.y + uy * 24, x2 = tc.x - ux * 30, y2 = tc.y - uy * 30;
        o.appendChild(el('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': 3.5, opacity: .9, 'stroke-linecap': 'round' }));
        o.appendChild(el('polygon', { points: `${x2 + ux * 9},${y2 + uy * 9} ${x2 - uy * 6},${y2 + ux * 6} ${x2 + uy * 6},${y2 - ux * 6}`, fill: col }));
      });
      svg.appendChild(o);
    }
  };

  // ---- phase / turn tracker ---------------------------------------------------------------------
  ui.renderTracker = function (state, node, opts) {
    opts = opts || {};
    const PH = [['strategy', 'Strategy'], ['action', 'Action'], ['status', 'Status'], ['agenda', 'Agenda']];
    const agendaOn = state.custodians !== undefined && state.custodians !== null && !!TI.agendaPhase;
    const pills = PH.map(([k, n]) => {
      const cls = state.phase === k ? ' on' : (k === 'agenda' && !agendaOn ? ' off' : '');
      return `<span class="trk-pill${cls}"${k === 'agenda' && !agendaOn ? ' title="The agenda phase starts once someone removes the custodians token from Mecatol Rex"' : ''}>${n}</span>`;
    }).join('<span class="trk-sep">›</span>');
    const seats = state.players.map((_, i) => state.players[(state.speaker + i) % state.players.length]);
    const chip = (p, lead, extra) => {
      const cards = p.cards.map((id) => { const used = state.cards.find((c) => c.id === id).used; return `<span class="${used ? 'used' : ''}">${id}·${esc(TI.STRATEGY_CARDS[id - 1].name)}</span>`; }).join(' ');
      return `<span class="trk-chip${opts.activeId === p.id ? ' active' : ''}${p.passed && state.phase === 'action' ? ' passed' : ''}" style="--c:${COLORS[p.id]}">${lead ? `<i>${lead}</i>` : ''}<b>${esc(p.name)}</b>${state.speaker === p.id ? ' <em title="speaker">★</em>' : ''}${p.passed && state.phase === 'action' ? ' <em>passed</em>' : ''}${cards ? `<small>${cards}</small>` : ''}${extra || ''}</span>`;
    };
    let order = '', label = '';
    if (state.phase === 'strategy') {
      label = 'Pick order (from the speaker)';
      order = seats.map((p, i) => chip(p, i + 1)).join('');
    } else if (state.phase === 'action') {
      label = `Turn ${state.turnNo || 0} · play order by initiative`;
      order = state.players.slice().sort((a, b) => TI.initiative(a) - TI.initiative(b)).map((p) => chip(p, TI.initiative(p) === 99 ? '' : TI.initiative(p))).join('');
    } else if (state.phase === 'agenda') {
      label = 'Agenda phase: two agendas, vote with influence (speaker votes last)';
      order = seats.slice(1).concat(seats[0]).map((p, i) => chip(p, i + 1)).join('');
    } else if (state.phase === 'status') {
      label = 'Status phase: score objectives, reveal, draw, ready, repair';
    }
    node.innerHTML = `<div class="trk-round">Round <b>${state.round}</b></div><div class="trk-phases">${pills}</div>
      <div class="trk-lab">${esc(label)}</div><div class="trk-order">${order}</div>${ui.lastEvent ? `<div class="trk-last" title="${esc(ui.lastEvent)}">▸ ${esc(ui.lastEvent)}</div>` : ''}`;
  };

  // ---- side panels ---------------------------------------------------------------------------
  ui.renderPlayers = function (state, node, opts) {
    opts = opts || {};
    const rows = state.players.map((p) => {
      const f = TI.faction(p);
      const avail = TI.available(state, p);
      const planets = TI.planetsOwned(state, p).length;
      const TECH_DOT = { blue: '#4aa3ff', green: '#2fbf71', yellow: '#f5d142', red: '#ff5a50' };
      const techChips = p.techs.map((t) => `<span class="chip${p.exhausted && p.exhausted[t] ? ' used' : ''}" title="${esc(TI.TECHS[t].text || '')}">${TI.TECHS[t].color ? `<span class="tdot" style="color:${TECH_DOT[TI.TECHS[t].color] || '#aaa'}" title="${TI.TECHS[t].color} technology">●</span> ` : ''}${esc(TI.TECHS[t].name)}</span>`).join('') || '<span class="note">no techs</span>';
      const cardChips = p.cards.map((id) => {
        const used = state.cards.find((c) => c.id === id).used;
        return `<span class="chip gold${used ? ' used' : ''}">${id} ${esc(TI.STRATEGY_CARDS[id - 1].name)}</span>`;
      }).join('');
      const tag = p.bot ? `<span class="note">· ${esc(TI.BOT_STYLES[p.bot].label)} bot</span>` : '<span class="chip">YOU</span>';
      return `<div class="player${opts.activeId === p.id ? ' active' : ''}">
        <div class="swatch" style="background:${COLORS[p.id]}"></div>
        <div>
          <div class="name">${esc(p.name)} ${tag}${state.speaker === p.id ? ' <span class="chip gold">speaker</span>' : ''}${p.passed ? ' <span class="chip">passed</span>' : ''}</div>
          <div class="meta"><a href="#" class="faction-link" data-faction="${f.id}">${esc(f.name)}</a> · ${planets} planets · ${avail.res}R/${avail.inf}I ready</div>
          <div><span class="chip tgchip">${p.tg} TG</span><span class="chip cmchip">${TI.commOf(p)}/${TI.commMax(p)} comm</span></div>
          <div class="meta">tokens T${p.tokens.tactic} F${p.tokens.fleet} S${p.tokens.strategy} · ${TI.shipCount(state, p)} ships · ${p.hand.length} action card${p.hand.length === 1 ? '' : 's'}</div>
          <div>${cardChips}</div><div>${techChips}</div>
        </div>
        <div class="vp">${p.vp}<small>VP</small></div>
      </div>`;
    });
    const me = state.players.find((q) => !q.bot);
    const KIND = { action: 'Action', window: 'Reaction' };
    const hand = me ? `<h3 style="margin-top:10px">Your action cards (${me.hand.length}/${TI.HAND_LIMIT})</h3>` + (me.hand.length
      ? me.hand.map((id) => { const c = TI.ACTION_BY_ID[id]; return `<details class="hcard"><summary><b>${esc(c.name)}</b> <span class="chip${c.kind === 'action' ? ' gold' : ''}">${KIND[c.kind]}</span></summary><div class="note">${esc(c.text)}</div></details>`; }).join('')
      : '<div class="note">none yet — you draw one each status phase (and two with Politics).</div>') : '';
    node.innerHTML = '<h3>Players</h3>' + rows.join('') + hand;
  };

  ui.renderObjectives = function (state, node, humanId) {
    const me = humanId !== null && humanId !== undefined ? state.players[humanId] : null;
    const dotsFor = (id) => state.players.filter((p) => p.scored.includes(id)).map((p) => `<span class="dot" style="background:${COLORS[p.id]}"></span>`).join('');
    // "You: 3 / 4" meter for the player's own progress; spend objectives show what can be paid right now.
    const meter = (o) => {
      if (!me || me.scored.includes(o.id)) return '';
      if (o.timing === 'action') return '<span class="meter">scores when it happens</span>';
      if (!o.progress) return '';
      const [have, need] = o.progress(state, me), ok = have >= need;
      return `<span class="meter${ok ? ' ok' : ''}">you: ${Math.min(have, 99)} / ${need}${o.spend ? ' available' : ''}${ok ? ' ✓' : ''}</span>`;
    };
    const card = (o, tag) => `<div class="obj"><span class="dots">${dotsFor(o.id)}</span><div class="t">${esc(o.name)} <span class="note">(${o.vp} VP${tag})</span></div><div class="d">${esc(o.text)}</div>${meter(o)}</div>`;
    const pub = state.publicObjectives.map((id) => { const o = TI.objectiveById(id); return card(o, ` · stage ${o.stage === 1 ? 'I' : 'II'}`); }).join('');
    const left = state.deck.stage1.length + state.deck.stage2.length;
    let secret = '';
    if (me) {
      secret = '<h3 style="margin-top:10px">Your secret objectives</h3>' + (me.secrets.map((id) => {
        const o = TI.objectiveById(id);
        return card(o, me.scored.includes(id) ? ' · scored' : '');
      }).join('') || '<div class="note">none</div>');
    }
    const lawRows = (state.laws || []).map((e) => { const d = TI.AGENDA_BY_ID[e.id];
      const who = e.owner !== null && e.owner !== undefined ? ` <span class="chip gold">${esc(state.players[e.owner].name)}</span>` : e.outcome ? ` <span class="chip">${e.outcome === 'for' ? 'For' : 'Against'}</span>` : e.planet ? ` <span class="chip">${esc(state.map.systems[e.planet.s].planets[e.planet.i].name)}</span>` : '';
      return `<div class="obj"><div class="t">${esc(d.name)}${who}</div><div class="d">${esc(d.text)}</div></div>`; }).join('');
    const laws = `<h3 style="margin-top:10px">Laws in play (${(state.laws || []).length})</h3>` + (lawRows || '<div class="note">none</div>');
    node.innerHTML = `<h3>Public objectives · first to ${state.vpToWin} VP wins</h3>${pub}<div class="note" style="margin-top:4px">${left} more to be revealed; the game ends when none are left.</div>${secret}${laws}`;
  };

  ui.appendLog = function (node, msg) {
    const d = document.createElement('div');
    const st = ui.ctx && ui.ctx.state;
    if (/^===|^—/.test(msg)) d.className = 'round';
    else {
      const t = msg.trim();
      const p = st && st.players.find((q) => t.startsWith(q.name + ' ') || t.startsWith(q.name + "'"));
      if (p) { d.style.borderLeft = '3px solid ' + COLORS[p.id]; d.dataset.bot = p.bot ? '1' : '0'; d.dataset.me = p.bot ? '0' : '1'; }
      if (/battle|^Round \d+ at|Ground round|retreat|bombard|Space Cannon|Magen|lands \d+ ground/i.test(t)) d.dataset.k = 'combat';
      ui.lastEvent = t;
    }
    d.textContent = msg;
    node.appendChild(d);
    node.scrollTop = node.scrollHeight;
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
