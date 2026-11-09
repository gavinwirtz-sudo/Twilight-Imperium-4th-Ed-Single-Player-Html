// Left-hand reference panels (planet key + planet list, unit stats, reinforcement pool) and the technology tree viewer.
(function (root) {
  const TI = (root.TI = root.TI || {});
  const ui = (TI.ui = TI.ui || {});
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const TRAITS = { cultural: ['Cultural', '#8fc2ff', '#2c5fb8'], industrial: ['Industrial', '#8de3a6', '#238a4a'], hazardous: ['Hazardous', '#ff9a8e', '#a8322b'], none: ['No trait', '#c9cfe6', '#5b6485'] };
  const SPEC = { biotic: ['Biotic', '#2fbf71', 'green'], propulsion: ['Propulsion', '#4aa3ff', 'blue'], cybernetic: ['Cybernetic', '#f5d142', 'yellow'], warfare: ['Warfare', '#ff5a50', 'red'] };
  const TECHCOL = { blue: ['Propulsion', '#4aa3ff'], green: ['Biotic', '#2fbf71'], yellow: ['Cybernetic', '#f5d142'], red: ['Warfare', '#ff5a50'] };
  const sphere = (t) => `<span class="sph" style="background:radial-gradient(circle at 35% 30%, ${TRAITS[t][1]}, ${TRAITS[t][2]})"></span>`;
  const diamond = (c) => `<span class="dia" style="background:${c}"></span>`;

  ui.leftPlayer = null;   // whose units / pool are shown (defaults to the human)
  const who = (state) => state.players[ui.leftPlayer !== null && state.players[ui.leftPlayer] ? ui.leftPlayer : (ui.ctx.humanId || 0)];

  function planetKey() {
    return `<div class="pkey">
      <div class="pk-grid">
        ${['cultural', 'industrial', 'hazardous', 'none'].map((t) => `<div>${sphere(t)} ${TRAITS[t][0]}</div>`).join('')}
        ${Object.entries(SPEC).map(([k, v]) => `<div>${diamond(v[1])} ${v[0]} specialty <span class="note">(${v[2]} tech)</span></div>`).join('')}
      </div>
      <div class="note" style="margin-top:6px">The <b>R/I</b> number on a planet is its resources / influence. A <b>coloured ring</b> shows the owner (thin grey = unclaimed); a <b>darkened</b> planet is exhausted. Small icons above a planet are its infantry, space dock and PDS. A concentric ring in a tile marks a wormhole (orange α, cyan β); purple cloud = nebula, rocks = asteroid field, orange burst = supernova, swirl = gravity rift, gold hex = Mecatol Rex.</div>
    </div>`;
  }

  function planetList(state) {
    const rows = [];
    for (const id of state.map.order) for (const pl of state.map.systems[id].planets) rows.push({ pl, id });
    const me = ui.ctx.humanId;
    const rank = (r) => (r.pl.owner === me ? 0 : r.pl.owner === null ? 2 : 1);
    rows.sort((a, b) => rank(a) - rank(b) || (a.pl.owner || 0) - (b.pl.owner || 0) || (b.pl.res + b.pl.inf) - (a.pl.res + a.pl.inf));
    const body = rows.map(({ pl, id }) => {
      const col = pl.owner === null ? '#4a5578' : ui.COLORS[pl.owner];
      const spec = pl.tech && SPEC[pl.tech] ? diamond(SPEC[pl.tech][1]) : '';
      return `<tr class="pl-row" data-sys="${esc(id)}" title="System ${esc(id)}${pl.owner === null ? ' · unclaimed' : ' · ' + esc(state.players[pl.owner].name)}"><td><span class="dot" style="background:${col}"></span></td><td>${esc(pl.name)}${pl.exhausted ? ' <span class="note">(exh.)</span>' : ''}</td><td>${sphere(pl.trait || 'none')}${spec}</td><td class="num">${pl.res}/${pl.inf}</td></tr>`;
    }).join('');
    return `<div class="pl-scroll"><table class="mini"><thead><tr><th></th><th>Planet</th><th>Type</th><th class="num">R/I</th></tr></thead><tbody>${body}</tbody></table></div><div class="note">Click a row to zoom to that system.</div>`;
  }

  function unitTable(p) {
    const order = ['fighter', 'destroyer', 'cruiser', 'carrier', 'dreadnought', 'warsun', 'flagship', 'infantry', 'pds', 'spacedock'];
    const rows = order.filter((t) => p.stats[t] && (t !== 'warsun' || TI.canBuildWarsun(p))).map((t) => {
      const st = p.stats[t], notes = [];
      if (st.sustain) notes.push('sustain');
      if (st.afb) notes.push(`AFB ${st.afb.value}${st.afb.dice > 1 ? ' ×' + st.afb.dice : ''}`);
      if (st.bombard) notes.push(`bombard ${st.bombard.value}${st.bombard.dice > 1 ? ' ×' + st.bombard.dice : ''}`);
      if (st.cannon) notes.push(`cannon ${st.cannon.value}${st.cannon.dice > 1 ? ' ×' + st.cannon.dice : ''}`);
      if (st.statusInfantry) notes.push('+infantry at status');
      const nm = ui.unitName(p, t).replace(' (flagship)', '');
      const combat = st.dice ? `${st.combat}${st.dice > 1 ? ' ×' + st.dice : ''}` : '–';
      return `<tr><td><b>${esc(nm[0].toUpperCase() + nm.slice(1))}</b></td><td class="num">${st.cost}${st.batch > 1 ? '<span class="note"> ×' + st.batch + '</span>' : ''}</td><td class="num">${combat}</td><td class="num">${st.type === 'ship' && t !== 'fighter' || st.move ? st.move : '–'}</td><td class="num">${st.cap || '–'}</td><td class="note">${notes.join(', ')}</td></tr>`;
    }).join('');
    return `<table class="mini"><thead><tr><th>Unit</th><th class="num" title="Cost in resources (×N = that many units for the cost)">Cost</th><th class="num" title="Hits on this roll or higher; ×N = number of dice">Combat</th><th class="num">Move</th><th class="num" title="Capacity: fighters and ground forces carried">Cap</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="note">Stats include ${esc(p.name)}'s researched upgrades and faction units.</div>`;
  }

  function poolTable(state, p) {
    const rows = [['carrier', 'carrier'], ['cruiser', 'cruiser'], ['destroyer', 'destroyer'], ['dreadnought', 'dreadnought'], ['warsun', 'warsun'], ['flagship', 'flagship'], ['pds', 'pds'], ['dock', 'spacedock']];
    const body = rows.filter(([k]) => k !== 'warsun' || TI.canBuildWarsun(p)).map(([k, nameKey]) => {
      const lim = TI.UNIT_LIMITS[k], left = Math.max(0, TI.unitsLeft(state, p, k)), used = lim - left;
      const nm = (k === 'dock' ? 'space dock' : k === 'pds' ? 'PDS' : ui.unitName(p, nameKey).replace(' (flagship)', ''));
      const pips = Array.from({ length: lim }, (_, i) => `<span class="pip${i < used ? ' used' : ''}" style="${i < used ? 'background:' + ui.COLORS[p.id] : ''}"></span>`).join('');
      return `<tr><td>${esc(nm)}</td><td class="pips">${pips}</td><td class="num"><b${left === 0 ? ' class="warn"' : ''}>${left}</b> <span class="note">/ ${lim}</span></td></tr>`;
    }).join('');
    const fighters = TI.countShips(state, p, ['fighter']);
    let inf = 0;
    for (const id of state.map.order) { const s = state.map.systems[id]; s.planets.forEach((pl) => { if (pl.owner === p.id) inf += pl.ground.filter((u) => u.type === 'infantry').length; }); inf += ((s.cargo || {})[p.id] || []).filter((u) => u.type === 'infantry').length; }
    const fl = TI.fleetLimit(p);
    return `<table class="mini"><thead><tr><th>Unit</th><th>In play</th><th class="num">Left</th></tr></thead><tbody>${body}</tbody></table>
      <div class="note">Filled = on the board, hollow = still in your reinforcements. Fighters (${fighters} in play) and infantry (${inf} in play) use tokens, so they never run out. Fleet supply: <b>${fl}</b> non-fighter ships per system. Command tokens: tactic ${p.tokens.tactic}, fleet ${p.tokens.fleet}, strategy ${p.tokens.strategy}.</div>`;
  }

  // ---- treasury: trade goods and commodities at a glance, plus the trade button and ledger -------------
  function treasury(state) {
    const me = state.players[ui.ctx.humanId];
    if (!me) return '';
    const max = TI.commMax(me);
    const pips = Array.from({ length: max }, (_, i) => `<span class="cpip${i < TI.commOf(me) ? ' on' : ''}"></span>`).join('');
    const others = state.players.filter((q) => q.id !== me.id).map((q) =>
      `<tr><td><span class="dot" style="background:${ui.COLORS[q.id]}"></span> ${esc(q.name)}</td><td class="num"><b>${q.tg}</b> TG</td><td class="num">${TI.commOf(q)}/${TI.commMax(q)} <span class="note">comm</span></td></tr>`).join('');
    const log = (state.tradeLog || []).slice(-4).reverse().map((t) => `<div class="note">R${t.round}: ${esc(state.players[t.from].name)} gave ${esc(t.give)} ⇄ ${esc(state.players[t.to].name)} gave ${esc(t.get)}</div>`).join('');
    return `<div class="panel lp treasury"><div class="tre-top">
        <div class="tre-big"><span class="tg-coin">TG</span><b>${me.tg}</b><small>trade goods</small></div>
        <div class="tre-big comm"><b>${TI.commOf(me)}<span class="of">/${max}</span></b><small>commodities</small><div class="cpips">${pips}</div></div>
      </div>
      <div class="note">Commodities become trade goods when you give them to another player. Trade goods can pay for anything (1 each).</div>
      <button id="btn-trade" class="${state.turnPlayer === me.id ? '' : 'secondary'}">Trade with a player…</button>
      <table class="mini" style="margin-top:6px"><tbody>${others}</tbody></table>${log ? '<div style="margin-top:4px">' + log + '</div>' : ''}</div>`;
  }

  let lastKey = '';
  ui.renderLeft = function (state) {
    const node = $('left-body'); if (!node || !state) return;
    const p = who(state);
    // Only rebuild when something shown has changed (keeps open sections and scroll positions).
    const key = JSON.stringify([p.id, state.players.map((q) => [q.tg, q.comm]), state.turnPlayer, (state.tradeLog || []).length, p.hand.length, p.stats, p.techs, p.tokens, state.map.order.map((id) => { const s = state.map.systems[id]; return [s.planets.map((x) => [x.owner, x.exhausted, x.pds, x.dock, x.ground.length]), Object.values(s.ships).map((l) => l.length), Object.values(s.cargo || {}).map((l) => l.length)]; })]);
    if (key === lastKey) return;
    lastKey = key;
    const open = {}; node.querySelectorAll('details').forEach((d) => { open[d.dataset.k] = d.open; });
    const sc = {}; node.querySelectorAll('.pl-scroll').forEach((d) => { sc.pl = d.scrollTop; });
    const sel = `<div class="row"><label>Showing</label><select id="left-who">${state.players.map((q) => `<option value="${q.id}"${q.id === p.id ? ' selected' : ''}>${esc(q.name)} (${esc(TI.faction(q).name)})</option>`).join('')}</select></div>`;
    const sect = (k, title, html, dflt) => `<details class="panel lp" data-k="${k}"${(open[k] === undefined ? dflt : open[k]) ? ' open' : ''}><summary>${title}</summary>${html}</details>`;
    node.innerHTML = treasury(state) + sect('planets', 'Planet key &amp; planets', planetKey() + planetList(state), true)
      + sel
      + sect('units', 'Unit stats', unitTable(p), true)
      + sect('pool', 'Reinforcements pool', poolTable(state, p), true);
    const tb = $('btn-trade'); if (tb) tb.addEventListener('click', () => ui.openTrade && ui.openTrade());
    $('left-who').addEventListener('change', (e) => { ui.leftPlayer = +e.target.value; lastKey = ''; ui.renderLeft(ui.ctx.state); });
    node.querySelectorAll('.pl-row').forEach((r) => r.addEventListener('click', () => { if (ui.view) ui.view.zoomTo(r.dataset.sys, 220); }));
    if (sc.pl) node.querySelector('.pl-scroll').scrollTop = sc.pl;
  };

  // ---- technology tree --------------------------------------------------------------------------
  ui.showTechTree = function () {
    const state = ui.ctx.state, me = state ? state.players[ui.ctx.humanId] : null;
    const have = me ? TI.techCountByColor(me) : {};
    const dots = (pre) => Object.entries(pre).map(([c, n]) => `<span class="pre" style="color:${TECHCOL[c][1]}">${'●'.repeat(n)}</span>`).join(' ') || '<span class="note">no prerequisites</span>';
    const card = (id) => {
      const T = TI.TECHS[id];
      let st = '', cls = '';
      if (me) {
        if (me.techs.includes(id)) { st = '<span class="chip gold">researched</span>'; cls = ' owned'; }
        else if (!TI.techAllowed(me, id)) { st = '<span class="chip">not available to you</span>'; cls = ' locked'; }
        else if (!Object.keys(TI.missingPrereqs(me, id)).length) { st = '<span class="chip good">can research</span>'; cls = ' ready'; }
        else { const m = TI.missingPrereqs(me, id); st = `<span class="note">missing ${Object.entries(m).map(([c, n]) => `${n} ${TECHCOL[c][0].toLowerCase()}`).join(', ')}</span>`; }
      }
      const tags = [T.effect.upgrade ? '<span class="chip">unit upgrade</span>' : '', T.faction ? `<span class="chip">${esc((TI.FACTIONS.find((f) => f.id === T.faction) || { name: T.faction }).name)} only</span>` : ''].join(' ');
      return `<div class="tcard${cls}"><div class="tt-h"><b>${esc(T.name)}</b> ${dots(T.prereq)}</div><div class="note">${esc(T.text)}</div><div>${tags} ${st}</div></div>`;
    };
    const ids = Object.keys(TI.TECHS);
    const weight = (id) => Object.values(TI.TECHS[id].prereq).reduce((a, b) => a + b, 0);
    const cols = ['blue', 'green', 'yellow', 'red'].map((c) => {
      const list = ids.filter((id) => TI.TECHS[id].color === c && !TI.TECHS[id].faction).sort((a, b) => weight(a) - weight(b));
      return `<div class="tcol"><h4 style="color:${TECHCOL[c][1]}">${TECHCOL[c][0]}${me ? ` <span class="note">(you have ${have[c] || 0})</span>` : ''}</h4>${list.map(card).join('')}</div>`;
    }).join('');
    const upg = ids.filter((id) => !TI.TECHS[id].color && !TI.TECHS[id].faction).sort((a, b) => weight(a) - weight(b));
    const fac = ids.filter((id) => TI.TECHS[id].faction);
    const body = document.createElement('div');
    body.innerHTML = `<p class="note">Each <span style="color:#4aa3ff">●</span> is a prerequisite: you need that many technologies of that colour already. A planet with a matching tech specialty can be exhausted to ignore one prerequisite. Researching costs the technology card's resources via the Technology strategy card (primary: 1 free + 1 for 6 resources; secondary: 1 for 4).</p>
      <div class="tt-grid">${cols}</div>
      <h4 class="tt-sec">Unit upgrades &amp; War Sun</h4><div class="tt-row">${upg.map(card).join('')}</div>
      <h4 class="tt-sec">Faction technologies</h4><div class="tt-row">${fac.map(card).join('')}</div>`;
    ui.viewer({ title: 'Technology tree', body, wide: true });
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
