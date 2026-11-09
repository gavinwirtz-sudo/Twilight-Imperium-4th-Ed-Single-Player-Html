// Game state creation and read-only queries over the state.
(function (root) {
  const TI = (root.TI = root.TI || {});

  // ---- queries ------------------------------------------------------------------------------
  TI.planetsOwned = function (state, player) {
    const out = [];
    for (const id of state.map.order) {
      for (const pl of state.map.systems[id].planets) if (pl.owner === player.id) out.push(Object.assign(pl, { systemId: id }));
    }
    return out;
  };
  TI.systemsWithShips = (state, player) =>
    state.map.order.filter((id) => (state.map.systems[id].ships[player.id] || []).length > 0).length;
  // Ids of the systems holding at least one of the player's ships.
  TI.shipSystems = (state, player) => state.map.order.filter((id) => (state.map.systems[id].ships[player.id] || []).length > 0);
  TI.shipCount = (state, player) =>
    state.map.order.reduce((n, id) => n + (state.map.systems[id].ships[player.id] || []).length, 0);
  TI.countShips = (state, player, types) =>
    state.map.order.reduce((n, id) => n + (state.map.systems[id].ships[player.id] || []).filter((u) => types.includes(u.type)).length, 0);
  TI.structureCount = (state, player, kind) => {
    let n = 0;
    for (const pl of TI.planetsOwned(state, player)) n += kind === 'dock' ? (pl.dock ? 1 : 0) : (pl.pds || 0);
    return n;
  };
  TI.groundCount = (state, player) => TI.planetsOwned(state, player).reduce((n, pl) => n + pl.ground.length, 0);
  TI.mecatolHeld = (state, player) => {
    const pl = state.map.systems['0,0'].planets[0];
    return pl.owner === player.id ? Math.max(1, pl.ground.length) : 0;
  };
  TI.holdsForeignHome = (state, player) =>
    state.map.order.some((id) => {
      const s = state.map.systems[id];
      return s.home !== null && s.home !== player.id && s.planets.some((pl) => pl.owner === player.id);
    });

  // Resources and influence available (unexhausted planets only).
  TI.available = function (state, player) {
    let res = 0, inf = 0;
    for (const pl of TI.planetsOwned(state, player)) if (!pl.exhausted) { res += pl.res; inf += pl.inf; }
    return { res, inf };
  };
  // ---- spending for objectives -------------------------------------------------------------
  // Resources/influence may be paid with planets or trade goods; "tg" only with trade goods; "tokens" from the
  // tactic and strategy pools. spendable() is how much the player could pay right now.
  TI.spendable = function (state, player, kind) {
    if (kind === 'tg') return player.tg;   // (objective costs count trade goods one for one)
    if (kind === 'cards') return (player.hand || []).length;
    if (kind === 'tokens') return player.tokens.tactic + player.tokens.strategy;
    return TI.available(state, player)[kind] + player.tg * TI.tgValue(player);
  };
  TI.canSpend = (state, player, kind, n) => TI.spendable(state, player, kind) >= n;
  // Pay the cost. For tokens, `split` ({tactic, strategy}) says where they come from; default takes the larger pool first.
  TI.paySpend = function (state, player, kind, n, split) {
    if (!TI.canSpend(state, player, kind, n)) return false;
    if (kind === 'tg') { player.tg -= n; return true; }
    if (kind === 'cards') { TI.discardCards(state, player, n); return true; }
    if (kind === 'tokens') {
      let t = 0, st = 0, tac = player.tokens.tactic, str = player.tokens.strategy;
      if (split && split.tactic + split.strategy === n && split.tactic >= 0 && split.strategy >= 0 && split.tactic <= tac && split.strategy <= str) { t = split.tactic; st = split.strategy; }
      else for (let i = 0; i < n; i++) { if (tac >= str) { tac--; t++; } else { str--; st++; } }
      player.tokens.tactic -= t; player.tokens.strategy -= st;
      return true;
    }
    return TI.pay(state, player, n, kind);
  };

  // Combat code records what happened for the action-phase secret objectives (see TI.flushEvents in phases.js).
  TI.noteEvent = function (state, playerId, key) { (state.events = state.events || []).push({ player: playerId, key }); };
  TI.sysCargo = (sys, pid) => (sys.cargo && sys.cargo[pid]) || [];
  TI.canBuildWarsun = (p) => p.techs.includes('war_sun') || !!TI.faction(p).ability.warsunStart;
  TI.tgValue = (p) => (TI.hasTechEffect(p, 'mirror') ? 2 : 1);      // Mentak's Mirror Computing
  TI.faction = (player) => TI.FACTIONS.find((f) => f.id === player.factionId);

  // ---- effective stats (tech upgrades merged over the base table) -------------------------
  TI.refreshStats = function (player) {
    const f = TI.faction(player);
    const stats = {};
    for (const k of Object.keys(TI.UNITS)) stats[k] = Object.assign({}, TI.UNITS[k]);
    // Faction flagship and "I"-level special units override the base table.
    if (f.flagship) { const { name, ...patch } = f.flagship; Object.assign(stats.flagship, patch); }
    for (const [u, patch] of Object.entries(f.units || {})) Object.assign(stats[u], patch);
    let shipMove = (f.ability.shipMove) || 0, cancel = 1;
    for (const tid of player.techs) {
      const e = TI.TECHS[tid].effect;
      if (e.upgrade) for (const [u, patch] of Object.entries(e.upgrade)) Object.assign(stats[u], patch);
      if (e.shipMove) shipMove += e.shipMove;
      if (e.sustainCancel) cancel = Math.max(cancel, e.sustainCancel);
    }
    for (const k of Object.keys(stats)) {
      if (stats[k].type === 'ship' && stats[k].move > 0) stats[k].move += shipMove;
      if (stats[k].sustain && cancel > 1) stats[k].sustainCancel = cancel;
    }
    if (TI.rules && TI.rules.warsunFree && stats.warsun) stats.warsun.sustain = false;      // Publicize Weapon Schematics
    player.stats = stats;
    return stats;
  };
  TI.hasTechEffect = (player, key) => player.techs.some((t) => TI.TECHS[t].effect[key]);
  TI.techCountByColor = (player) => {
    const c = { blue: 0, yellow: 0, green: 0, red: 0 };
    for (const t of player.techs) if (TI.TECHS[t].color) c[TI.TECHS[t].color]++;   // unit upgrades grant no symbol
    return c;
  };
  // A faction tech is only for its own faction and replaces its generic counterpart for that faction.
  // Analytical (Jol-Nar): one missing prerequisite may be ignored for techs that are not unit upgrades.
  // Could this player ever research it (ignoring prerequisites)?
  TI.techAllowed = (player, techId) => {
    if (player.techs.includes(techId)) return false;
    const T = TI.TECHS[techId], f = TI.faction(player);
    if (T.faction && T.faction !== player.factionId) return false;
    return !(f.factionTechs || []).some((id) => TI.TECHS[id].replaces === techId);
  };
  // Symbols still missing for a tech: { color: n }.
  TI.missingPrereqs = (player, techId) => {
    const have = TI.techCountByColor(player), out = {};
    for (const [c, n] of Object.entries(TI.TECHS[techId].prereq)) if (n > have[c]) out[c] = n - have[c];
    return out;
  };
  // Technology specialties: an unexhausted planet with a matching specialty can be exhausted to ignore one prerequisite
  // symbol of that color (rule 79.14). Planet data uses the old four tech names.
  const SPEC_COLOR = { propulsion: 'blue', cybernetic: 'yellow', biotic: 'green', warfare: 'red' };
  // Which prerequisites would still be missing after the free ones (Jol-Nar's Analytical) and specialty planets,
  // and which planets would be exhausted. Returns { missing: n, planets: [...] }.
  TI.researchPlan = function (state, player, techId) {
    const T = TI.TECHS[techId], f = TI.faction(player);
    const need = TI.missingPrereqs(player, techId);
    if (TI.rules && TI.rules.warsunFree && techId === 'war_sun') for (const c of Object.keys(need)) need[c] = 0;
    let forgiven = f.ability.analytical && !T.effect.upgrade ? 1 : 0;
    for (const c of Object.keys(need).sort((a, b) => need[b] - need[a])) { while (forgiven > 0 && need[c] > 0) { need[c]--; forgiven--; } }
    const planets = [];
    if (state) {
      const spare = TI.planetsOwned(state, player).filter((pl) => !pl.exhausted && SPEC_COLOR[pl.tech])
        .sort((a, b) => (a.res + a.inf) - (b.res + b.inf));
      for (const c of Object.keys(need)) {
        while (need[c] > 0) {
          const pl = spare.find((x) => SPEC_COLOR[x.tech] === c && !planets.includes(x));
          if (!pl) break;
          planets.push(pl); need[c]--;
        }
      }
    }
    // Research Team laws: a ready card on one of your planets ignores 1 prerequisite of its colour.
    const teams = [];
    if (state) for (const pl of TI.planetsOwned(state, player)) if (pl.team && pl.team.ready && need[pl.team.color] > 0) { need[pl.team.color]--; teams.push(pl); }
    let missing = Object.values(need).reduce((a, b) => a + b, 0), inherit = false;
    // L1Z1X Inheritance Systems: exhaust it and spend 2 resources to ignore every prerequisite.
    if (missing > 0 && state && TI.hasTechEffect(player, 'inherit') && !player.exhausted.inheritance_systems && TI.available(state, player).res + player.tg >= 2) { inherit = true; missing = 0; }
    return { missing, planets, teams, inherit };
  };
  TI.canResearch = (player, techId, state) => TI.techAllowed(player, techId) && TI.researchPlan(state, player, techId).missing === 0;
  // Exhaust the specialty planets a research needs. Returns the planets (to undo with ready if the payment fails).
  TI.spendSpecialties = function (state, player, techId) {
    const plan = TI.researchPlan(state, player, techId);
    if (plan.inherit) { TI.pay(state, player, 2, 'res'); player.exhausted.inheritance_systems = true; TI.log(state, `${player.name} exhausts Inheritance Systems and spends 2 resources to ignore ${TI.TECHS[techId].name}'s prerequisites.`); return []; }
    plan.planets.forEach((pl) => { pl.exhausted = true; });
    plan.teams.forEach((pl) => { pl.team.ready = false; });
    return plan.planets;
  };

  // Component limits (rules 85.1 and 22): ships and structures run out; infantry and fighters have tokens, so no limit.
  TI.UNIT_LIMITS = { carrier: 4, cruiser: 8, destroyer: 8, dreadnought: 5, warsun: 2, flagship: 1, pds: 6, dock: 3 };
  TI.unitsLeft = function (state, player, type) {
    const lim = TI.UNIT_LIMITS[type];
    if (lim === undefined) return Infinity;
    const used = type === 'pds' || type === 'dock' ? TI.structureCount(state, player, type) : TI.countShips(state, player, [type]);
    return lim - used;
  };

  // ---- game creation ------------------------------------------------------------------------
  // config: { seed, mapMode: 'preset'|'random'|'balanced', players: [{ name, factionId, bot: 'expander'|'warmonger'|'builder'|null }] }
  TI.createGame = function (config) {
    const rng = TI.makeRng(config.seed || Date.now());
    const n = config.players.length;
    const factions = config.players.map((p) => TI.FACTIONS.find((f) => f.id === p.factionId));
    const map = TI.generateMap(n, rng, factions.map((f) => f.planets.map((p) => Object.assign({}, p))), { mode: config.mapMode });

    const players = config.players.map((c, i) => {
      const p = { id: i, name: c.name, factionId: c.factionId, bot: c.bot || null, tg: 0, comm: 0,
                  tokens: { tactic: 3, fleet: 3, strategy: 2 }, techs: factions[i].techs.slice(),
                  vp: 0, cards: [], passed: false, scored: [], secrets: [], stats: null,
                  exhausted: {}, revive: 0, hand: [], keepCards: false };   // exhausted: faction tech cards; revive: Spec Ops II units waiting to return
      TI.refreshStats(p);
      return p;
    });

    // Five-player galaxy: players in the weaker home positions start with extra trade goods.
    for (const p of players) p.tg += (map.homeBonus && map.homeBonus[p.id]) || 0;

    // Home system setup
    for (const p of players) {
      const f = factions[p.id];
      const sys = map.systems[map.order.find((id) => map.systems[id].home === p.id)];
      sys.planets.forEach((pl) => { pl.owner = p.id; });
      sys.planets[0].dock = true;
      sys.ships[p.id] = f.start.ships.map(TI.makeUnit);
      f.start.ground.forEach((g) => sys.planets[0].ground.push(TI.makeUnit(g)));
      for (let i = 0; i < (f.start.pds || 0); i++) sys.planets[i % sys.planets.length].pds++;
    }

    // Each game uses 5 random stage I and 5 random stage II public objectives (rules 52.13); the speaker reveals
    // two stage I cards at setup. Each player is dealt two secret objectives and keeps one (TI.chooseStartingSecrets).
    const stage1 = rng.shuffle(TI.deckObjectives(1).map((o) => o.id)).slice(0, 5);
    const stage2 = rng.shuffle(TI.deckObjectives(2).map((o) => o.id)).slice(0, 5);
    const secretDeck = rng.shuffle(TI.deckObjectives('secret').map((o) => o.id));
    players.forEach((p) => { p.secretOffer = [secretDeck.pop(), secretDeck.pop()]; p.secrets.push(p.secretOffer[0]); });

    const state = {
      rng, map, players, round: 1, phase: 'strategy', speaker: 0, winner: null, vpToWin: config.vpToWin || TI.VP_TO_WIN,
      deck: { stage1, stage2, secret: secretDeck },
      publicObjectives: [stage1.pop(), stage1.pop()],     // revealed objective ids
      custodians: null,     // id of the player who removed the custodians token from Mecatol Rex
      cards: TI.STRATEGY_CARDS.map((c) => ({ id: c.id, owner: null, tgBonus: 0, used: false })),
      actionDeck: TI.buildActionDeck ? TI.buildActionDeck(rng) : [], actionDiscard: [],
      tactical: null,
      log: [],
    };
    if (TI.setupFactions) TI.setupFactions(state);
    if (TI.resetAgenda) TI.resetAgenda(state); else TI.rules = {};
    return state;
  };

  TI.log = (state, msg) => { state.log.push(msg); if (TI.onLog) TI.onLog(msg); };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
