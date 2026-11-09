// App shell: setup screen, game loop, redraw plumbing, pacing of bot turns.
(function (root) {
  const TI = (root.TI = root.TI || {});
  const ui = (TI.ui = TI.ui || {});
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const ctx = { state: null, mapOpts: {}, humanId: 0, speed: 450, scheduled: false, gameNo: 0 };
  ui.ctx = ctx;

  function draw() {
    ctx.scheduled = false;
    if (!ctx.state) return;
    ui.renderMap(ctx.state, $('board'), Object.assign({ humanId: ctx.humanId }, ctx.mapOpts));
    const active = ctx.activeId;
    ui.renderTracker(ctx.state, $('tracker'), { activeId: active });
    ui.renderPlayers(ctx.state, $('players'), { activeId: active });
    ui.renderObjectives(ctx.state, $('objectives'), ctx.humanId);
    ui.renderInspector(ctx.state);
    ui.renderLeft(ctx.state);
  }
  ui.refresh = (mapOpts) => { ctx.mapOpts = mapOpts || {}; draw(); };
  ui.redraw = () => { if (!ctx.scheduled) { ctx.scheduled = true; requestAnimationFrame(draw); } };
  ui.setStatus = (t) => { $('status-line').textContent = t; };

  function store(key, val) { try { if (val === undefined) return JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; } return null; }

  // ---- setup ----------------------------------------------------------------------------------
  const STYLE_OPTS = [['random', 'Random style'], ['expander', 'Expander'], ['warmonger', 'Warmonger'], ['builder', 'Builder']];

  async function setupDialog() {
    const saved = store('ti-setup') || {};
    const wrap = document.createElement('div');
    const facOpts = (sel) => TI.FACTIONS.map((f) => `<option value="${f.id}"${f.id === sel ? ' selected' : ''}>${ui.esc(f.name)} (${ui.esc(f.difficulty)})</option>`).join('');
    const styleOpts = (sel) => STYLE_OPTS.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');
    wrap.innerHTML = `
      <div class="row"><label>Your name</label><input id="s-name" type="text" value="${ui.esc(saved.name || 'You')}"></div>
      <div class="row"><label>Your faction</label><select id="s-fac">${facOpts(saved.faction || 'sol')}</select></div>
      <div id="s-facinfo" class="note"></div>
      <div class="row"><label>Opponents</label><select id="s-bots">${[2, 3, 4, 5].map((n) => `<option value="${n}"${n === (saved.bots || 3) ? ' selected' : ''}>${n} bots (${n + 1} players)</option>`).join('')}</select></div>
      <div id="s-botlist"></div>
      <div class="row"><label>Galaxy</label><select id="s-map">
        <option value="preset"${(saved.mapMode || 'preset') === 'preset' ? ' selected' : ''}>Rulebook map (pages 22-23)</option>
        <option value="random"${saved.mapMode === 'random' ? ' selected' : ''}>Random setup</option>
        <option value="balanced"${saved.mapMode === 'balanced' ? ' selected' : ''}>Random, balanced homes</option></select></div>
      <div class="row"><label>Bot speed</label><select id="s-speed">
        <option value="60">Fast</option><option value="450" selected>Normal</option><option value="1000">Slow</option></select></div>
      <div class="row"><label>Seed (optional)</label><input id="s-seed" type="text" placeholder="blank = random" value="${ui.esc(saved.seed || '')}"></div>
      <details style="margin-top:10px"><summary class="note" style="cursor:pointer">What is and isn't modeled (read me)</summary>${RULES_HTML}</details>`;
    const botList = wrap.querySelector('#s-botlist');
    const drawBots = () => {
      const n = +wrap.querySelector('#s-bots').value;
      const others = TI.FACTIONS.filter((f) => f.id !== wrap.querySelector('#s-fac').value);   // default bots to other factions
      botList.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const sv = (saved.botCfg || [])[i] || {};
        const row = document.createElement('div'); row.className = 'row';
        row.innerHTML = `<label>Bot ${i + 1}</label>
          <select class="b-fac">${facOpts(sv.faction || others[i % others.length].id)}</select>
          <select class="b-style">${styleOpts(sv.style || 'random')}</select>`;
        botList.appendChild(row);
      }
    };
    wrap.querySelector('#s-bots').addEventListener('change', drawBots);
    const facInfo = () => { const f = TI.FACTIONS.find((x) => x.id === wrap.querySelector('#s-fac').value); wrap.querySelector('#s-facinfo').textContent = f ? f.blurb + ' Full sheet: "Faction sheets" button in the top bar.' : ''; };
    wrap.querySelector('#s-fac').addEventListener('change', facInfo);
    facInfo();
    drawBots();
    wrap.querySelector('#s-speed').value = String(saved.speed || 450);

    await ui.modal({ title: 'New game', body: wrap, actions: [{ label: 'Start game', value: true }] }).promise;

    const cfg = {
      name: wrap.querySelector('#s-name').value.trim() || 'You',
      faction: wrap.querySelector('#s-fac').value,
      bots: +wrap.querySelector('#s-bots').value,
      speed: +wrap.querySelector('#s-speed').value,
      mapMode: wrap.querySelector('#s-map').value,
      seed: wrap.querySelector('#s-seed').value.trim(),
      botCfg: [...botList.querySelectorAll('.row')].map((r) => ({ faction: r.querySelector('.b-fac').value, style: r.querySelector('.b-style').value })),
    };
    store('ti-setup', cfg);
    return cfg;
  }

  const RULES_HTML = `
    <p><b>How to play.</b> Each round: pick strategy cards, take turns (tactical action, strategic action, or pass), then score objectives in the status phase. First to 10 VP wins.
    Tactical action: click a system to activate it, choose ships and cargo to move, fight, invade, and build at a space dock there. Hover nothing; everything is a click.</p>
    <p><b>Modeled:</b> the real base-game galaxy (the four rulebook maps for 3-6 players, or random / balanced random setups with the real system tiles and planets), Mecatol Rex, asteroid fields (impassable), nebulae (stop-only), gravity rifts (+1 move, 1-3 loses a ship), supernovas, alpha/beta wormholes; command tokens (tactic/fleet/strategy), fleet supply, cargo capacity; movement; space cannon, anti-fighter barrage, space combat with sustain damage, bombardment, ground combat; production at space docks; all 8 strategy cards (simplified); the base-game tech tree with unit upgrades (Gravity Drive, Fleet Logistics, Light/Wave, Transit Diodes, Integrated Economy, Dacxive, X-89, Magen Grid, Duranium, Assault Cannon and the rest; Neural Motivator waits for action cards); the 40 base-game objectives (public stage I and II, secret) with their costs, action-phase secrets and the end of the game when the objectives run out; custodians token; speaker.</p>
    <p><b>Factions:</b> Federation of Sol, Emirates of Hacan, Barony of Letnev, Universities of Jol-Nar, Sardakk N'orr and Xxcha Kingdom follow the faction booklet, including flagships, special units and faction techs (see "Faction sheets"; abilities marked "not modeled" need systems that do not exist yet).</p>
    <p><b>Not modeled yet:</b> the other faction sheets, exploration/relics, leaders, mechs, promissory notes, trade and diplomacy between players, Salvage and the Codex cards, Prophecy of Kings content.</p>
    <p><b>Trade:</b> commodities (faction value) are replenished by the Trade card and become trade goods when given away. On your turn use <b>Trade with a player…</b> (left panel) to swap trade goods/commodities with a neighbor (Hacan: anyone, plus action cards). Promissory notes are not modeled.</p>
    <p><b>Reading the map.</b> Planet circles show resources/influence; a ring in a player's color means they own it. <b>×4 D P1</b> = 4 ground forces, a space dock, 1 PDS. Fleet badges read <b>3+2f·4</b> = 3 ships, 2 fighters, 4 ground forces aboard (hover for details). Small dots in a corner are command tokens (activated this round).</p>
    <p class="note">Bots are rule-based and run entirely in your browser, so no internet connection is needed.</p>`;

  // Faction viewer: all six sheets, the ones in this game first. Ignored while a decision dialog is open.
  ui.showFactions = function (openId) {
    const inGame = ctx.state ? ctx.state.players.map((p) => p.factionId) : [];
    const list = TI.FACTIONS.slice().sort((a, b) => (inGame.includes(b.id) - inGame.includes(a.id)));
    const wrap = document.createElement('div');
    wrap.innerHTML = list.map((f) => `<details class="fac"${f.id === openId ? ' open' : ''}><summary>${ui.esc(f.name)}${inGame.includes(f.id) ? ' <span class="chip gold">in this game</span>' : ''}</summary>${ui.factionHtml(f)}</details>`).join('');
    ui.viewer({ title: 'Faction sheets', body: wrap });
  };

  // ---- game ---------------------------------------------------------------------------------
  function pace(agent, ms) {
    const wrapped = Object.create(agent);
    ['chooseAction', 'chooseCard'].forEach((k) => {
      const orig = agent[k].bind(agent);
      wrapped[k] = async (...a) => { ui.redraw(); await sleep(ms); return orig(...a); };
    });
    return wrapped;
  }

  // ---- saved games ----------------------------------------------------------------------------
  const SAVE_KEY = 'ti-save';
  function readSave() { try { return localStorage.getItem(SAVE_KEY); } catch (e) { return null; } }
  function writeSave(text) { try { text === null ? localStorage.removeItem(SAVE_KEY) : localStorage.setItem(SAVE_KEY, text); return true; } catch (e) { return false; } }
  function describeSave(text) {
    try { const st = JSON.parse(text); const me = st.players.find((p) => !p.bot) || st.players[0]; return `Round ${st.round} · ${st.phase} phase · ${me.name} (${me.factionId}) ${me.vp} VP · saved ${new Date(st.savedAt).toLocaleString()}`; } catch (e) { return 'saved game'; }
  }
  // Autosave at every turn boundary (and each round start).
  TI.onCheckpoint = (st) => { if (st.winner !== null) return; st.savedAt = Date.now(); st.uiSpeed = ctx.speed; writeSave(TI.serializeState(st)); };
  ui.saveToFile = function () {
    const text = readSave();            // the last turn-boundary checkpoint (never a half-finished action)
    if (!text) { alert('Nothing to save yet: the first autosave happens at the start of the first round.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = `ti-practice-round${JSON.parse(text).round}.json`; document.body.appendChild(a); a.click(); a.remove();
  };
  ui.loadFromFile = function () {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      const text = await f.text();
      try { TI.deserializeState(text); } catch (e) { alert('That file is not a saved game.'); return; }
      writeSave(text); location.reload();
    });
    inp.click();
  };

  async function startFlow() {
    const saved = readSave();
    if (saved) {
      const choice = await ui.modal({ title: 'Saved game found', body: `<p>${ui.esc(describeSave(saved))}</p><p class="note">Starting a new game replaces the saved one.</p>`,
        actions: [{ label: 'New game', value: 'new', cls: 'secondary' }, { label: 'Continue saved game', value: 'continue' }] }).promise;
      if (choice === 'continue') {
        try { const st = TI.deserializeState(saved); ctx.speed = st.uiSpeed || 450; return playGame(st, true); }
        catch (e) { console.error('load failed', e); alert('The saved game could not be loaded; starting a new one.'); }
      }
      writeSave(null);
    }
    const cfg = await setupDialog();
    ctx.speed = cfg.speed;
    const styles = ['expander', 'warmonger', 'builder'];
    const seed = cfg.seed ? (isNaN(+cfg.seed) ? [...cfg.seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) : +cfg.seed) : (Date.now() % 1e9);
    const rng = TI.makeRng(seed + 1);
    const players = [{ name: cfg.name, factionId: cfg.faction, bot: null }];
    cfg.botCfg.forEach((b, i) => {
      const style = b.style === 'random' ? rng.pick(styles) : b.style;
      players.push({ name: `${TI.BOT_STYLES[style].label} ${i + 1}`, factionId: b.faction, bot: style });
    });
    const state = TI.createGame({ seed, players, mapMode: cfg.mapMode });
    state.speaker = rng.int(players.length);
    return playGame(state, false, seed);
  }

  async function playGame(state, resume, seed) {
    const players = state.players;
    ctx.state = state; ctx.humanId = players.findIndex((p) => !p.bot); if (ctx.humanId < 0) ctx.humanId = 0; ctx.mapOpts = {}; ctx.activeId = null;
    ctx.gameNo++;
    const myGame = ctx.gameNo;

    $('log').innerHTML = ''; ui.lastEvent = '';
    TI.onRestore = (st) => { const L = $('log'); L.innerHTML = ''; st.log.forEach((x) => ui.appendLog(L, x)); ui.redraw(); };
    TI.onLog = (msg) => { ui.appendLog($('log'), msg); ui.redraw(); };
    if (resume) { state.log.forEach((m) => ui.appendLog($('log'), m)); TI.log(state, 'Game resumed from the saved checkpoint.'); }
    else {
    TI.log(state, `Game seed ${seed}. ${state.players[state.speaker].name} is the speaker.`);
    const modeName = { preset: 'the rulebook galaxy', random: 'a random galaxy', balanced: 'a random galaxy, balanced' }[state.map.mode] || 'a generated galaxy';
    TI.log(state, `Galaxy: ${modeName}${state.map.spread !== undefined ? ` (home-system spread ${(state.map.spread * 100).toFixed(0)}%)` : ''}.`);
    for (const p of state.players) if (state.map.homeBonus && state.map.homeBonus[p.id]) TI.log(state, `${p.name} starts with ${state.map.homeBonus[p.id]} extra trade goods (five-player home position).`);
    }
    draw();
    if (ui.view) ui.view.reset();

    const agents = players.map((p) => (p.bot ? pace(TI.makeBot(p.bot), ctx.speed) : TI.makeHuman()));
    ctx.agents = agents;
    agents.forEach((ag, i) => { const o = ag.chooseCard.bind(ag); ag.chooseCard = async (...a) => { ctx.activeId = i; ui.redraw(); try { return await o(...a); } finally { ctx.activeId = null; ui.redraw(); } }; });
    // Track whose turn it is so the player panel can highlight it.
    const origTake = TI.takeTurn;
    TI.takeTurn = async function (st, ag, p) { ctx.activeId = p.id; ui.setStatus(p.bot ? `${p.name} is thinking…` : `Your turn`); ui.redraw(); try { return await origTake(st, ag, p); } finally { ctx.activeId = null; } };

    try {
      await TI.runGame(state, agents, { maxRounds: 14, resume });
    } finally { TI.takeTurn = origTake; }
    if (ctx.gameNo !== myGame) return;
    ui.setStatus('Game over');
    writeSave(null);
    draw();
    await endDialog(state);
  }

  async function endDialog(state) {
    const w = state.players[state.winner];
    const rows = state.players.slice().sort((a, b) => b.vp - a.vp)
      .map((p) => `<div class="row"><span class="dot" style="background:${ui.COLORS[p.id]}"></span><b>${ui.esc(p.name)}</b> ${p.id === state.winner ? '🏆' : ''}<span class="note">${p.vp} VP · ${TI.planetsOwned(state, p).length} planets · ${p.techs.length} techs</span></div>`).join('');
    const again = await ui.modal({ title: w.bot ? `${w.name} wins` : 'You win!', body: (state.endedByObjectives ? '<p class="note">Every public objective had been revealed, so the game ended and the VP leader won.</p>' : state.endedByRoundLimit ? '<p class="note">The round limit was reached; the leader wins.</p>' : '') + rows,
      actions: [{ label: 'Close', value: false, cls: 'secondary' }, { label: 'New game', value: true }] }).promise;
    if (again) { ctx.state = null; startFlow(); }
  }

  window.addEventListener('DOMContentLoaded', () => {
    ui.initView(); ui.initViewer();
    $('log-filters').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $('log').dataset.f = b.dataset.f; $('log-filters').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); });
    $('btn-new').addEventListener('click', () => { if (confirm('Leave this game? It is autosaved, so you can continue it next time you open the page.')) location.reload(); });
    const ts = $('tile-style'); ts.innerHTML = ui.TILE_STYLES.map(([v, l]) => `<option value="${v}"${v === ui.tileStyle ? ' selected' : ''}>${l}</option>`).join('');
    ts.addEventListener('change', () => { ui.setTileStyle(ts.value); ui.redraw(); });
    $('btn-tech').addEventListener('click', ui.showTechTree);
    const setLeft = (on) => { $('left').hidden = !on; $('layout').classList.toggle('noleft', !on); try { localStorage.setItem('ti-left', on ? '1' : '0'); } catch (e) { /* ignore */ } if (ui.view) setTimeout(ui.view.reset, 0); };
    let leftOn = true; try { leftOn = localStorage.getItem('ti-left') !== '0'; } catch (e) { /* ignore */ }
    setLeft(leftOn);
    $('btn-panels').addEventListener('click', () => setLeft($('left').hidden));
    $('btn-save').addEventListener('click', ui.saveToFile);
    $('btn-undo').addEventListener('click', () => { if (!ui.doUndo()) { ui.setHint('<b>Nothing to undo right now.</b> Undo works while one of your own decisions is open.'); setTimeout(() => ui.setHint(''), 2500); } });
    setInterval(() => { $('btn-undo').disabled = !ui.canUndo(); }, 250);
    $('btn-load').addEventListener('click', ui.loadFromFile);
    $('btn-rules').addEventListener('click', () => { ui.viewer({ title: 'Rules notes', body: RULES_HTML }); });
    $('btn-factions').addEventListener('click', () => ui.showFactions(ctx.state ? ctx.state.players[ctx.humanId].factionId : null));
    $('players').addEventListener('click', (e) => { const a = e.target.closest('.faction-link'); if (a) { e.preventDefault(); ui.showFactions(a.dataset.faction); } });
    startFlow();
  });

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
