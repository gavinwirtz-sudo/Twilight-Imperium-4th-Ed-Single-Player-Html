// Action cards (base game). Agenda-phase cards, Repeal Law (no laws yet) and Salvage (no commodities/trade) are left out.
//
// Two kinds of card:
//   kind 'action'   played as your whole action on your turn. options(state, p) lists legal targets
//                   [{ label, value, score }]; score is how much a bot wants it (>= ~0.6 means "worth an action").
//   kind 'window'   played in response to something, at a named point of play (see WINDOWS). eligible() says whether
//                   the card could be played now, bot() whether a bot wants to, play() does it.
// Every card goes to the discard pile as it is played; Sabotage (or Xxcha's Instinct Training) can cancel the effect.
(function (root) {
  const TI = (root.TI = root.TI || {});

  // ---- helpers ----------------------------------------------------------------------------------
  const COST = { fighter: 1, destroyer: 1, cruiser: 2, carrier: 3, dreadnought: 4, warsun: 12, flagship: 8 };
  const others = (state, p) => state.players.filter((o) => o.id !== p.id);
  const allPlanets = (state) => {
    const out = [];
    for (const id of state.map.order) state.map.systems[id].planets.forEach((pl, i) => out.push({ pl, sysId: id, idx: i, sys: state.map.systems[id] }));
    return out;
  };
  const isHome = (sys) => sys.home !== null;
  const ref = (e) => ({ s: e.sysId, i: e.idx });
  const planetAt = (state, r) => state.map.systems[r.s].planets[r.i];
  const ships = (sys, pid) => sys.ships[pid] || (sys.ships[pid] = []);
  const nonFighters = (list) => list.filter((u) => u.type !== 'fighter');
  const sysLabel = (state, id) => { const s = state.map.systems[id]; return id + (s.planets.length ? ' (' + s.planets.map((x) => x.name).join(', ') + ')' : ''); };
  const strength = (list, stats) => (TI.fleetStrength ? TI.fleetStrength(list, stats) : list.length);
  const isLeader = (state, o) => state.players.every((x) => x.vp <= o.vp);
  const mySide = (ctx, p) => (ctx.attacker && ctx.attacker.id === p.id ? 'attacker' : 'defender');
  const unitsOf = (state, ctx, p) => ((ctx.cx ? (mySide(ctx, p) === 'attacker' ? ctx.cx.attackers : ctx.cx.defenders) : []) || []);
  const foeUnits = (state, ctx, p) => ((ctx.cx ? (mySide(ctx, p) === 'attacker' ? ctx.cx.defenders : ctx.cx.attackers) : []) || []);
  const foeOf = (ctx, p) => (ctx.attacker.id === p.id ? ctx.defender : ctx.attacker);

  // Place a ship from reinforcements if there is room (fleet limit for non-fighters, unit limit).
  function placeShip(state, p, sysId, type) {
    if (TI.unitsLeft(state, p, type) < 1) return false;
    const list = ships(state.map.systems[sysId], p.id);
    if (type !== 'fighter' && nonFighters(list).length >= TI.fleetLimit(p)) return false;
    list.push(TI.makeUnit(type));
    return true;
  }
  function removeShip(state, ownerId, sysId, unit) {
    const sys = state.map.systems[sysId], list = sys.ships[ownerId] || [], i = list.indexOf(unit);
    if (i >= 0) list.splice(i, 1);
    if (TI.trimCargo) TI.trimCargo(state, state.players[ownerId], sys);
  }
  const bestUnused = (state, p) => TI.planetsOwned(state, p).filter((x) => x.exhausted).sort((a, b) => (b.res + b.inf) - (a.res + a.inf));

  // ---- the cards ----------------------------------------------------------------------------------
  const CARDS = [];
  const A = (id, name, text, weight, options, play) => CARDS.push({ id, name, kind: 'action', count: 1, text: 'As an Action: ' + text, weight, options, play });
  const W = (spec) => CARDS.push(Object.assign({ kind: 'window', count: 1, weight: 1 }, spec));

  A('cripple_defenses', 'Cripple Defenses', 'Choose 1 planet. Destroy each PDS on that planet.', 2, (state, p) =>
    allPlanets(state).filter((e) => e.pl.owner !== null && e.pl.owner !== p.id && e.pl.pds > 0).map((e) => ({
      label: `${e.pl.name} (${state.players[e.pl.owner].name}) — ${e.pl.pds} PDS`, value: ref(e), score: 0.8 * e.pl.pds + (e.sys.adj.some((a) => (state.map.systems[a].ships[p.id] || []).length) ? 0.5 : 0) })),
    async (state, ag, p, v) => { const pl = planetAt(state, v); TI.log(state, `${p.name} destroys ${pl.pds} PDS on ${pl.name}.`); pl.pds = 0; });

  A('economic_initiative', 'Economic Initiative', 'Ready each cultural planet you control.', 1, (state, p) => {
    const n = TI.planetsOwned(state, p).filter((x) => x.trait === 'cultural' && x.exhausted).length;
    return n ? [{ label: `Ready ${n} cultural planet(s)`, value: true, score: 0.5 * n }] : [];
  }, async (state, ag, p) => { TI.planetsOwned(state, p).forEach((x) => { if (x.trait === 'cultural') x.exhausted = false; }); });

  A('focused_research', 'Focused Research', 'Spend 4 trade goods to research 1 technology.', 2, (state, p) =>
    p.tg >= 4 && TI.researchOptions(state, p).length ? [{ label: 'Spend 4 trade goods and research a technology', value: true, score: 1.5 }] : [],
    async (state, ag, p) => { p.tg -= 4; await TI.research(state, ag, p, 0, 'Focused Research'); });

  A('frontline_deployment', 'Frontline Deployment', 'Place 3 infantry from your reinforcements on 1 planet you control.', 2, (state, p) =>
    TI.unitsLeft(state, p, 'infantry') < 1 ? [] : TI.planetsOwned(state, p).map((x) => {
      const sys = state.map.systems[x.systemId];
      const threat = state.players.some((o) => o.id !== p.id && (sys.ships[o.id] || []).length) ? 0.6 : 0;
      return { label: `${x.name} (${x.ground.length} ground forces)`, value: { s: x.systemId, i: sys.planets.indexOf(x) }, score: 1.1 + threat - Math.min(0.5, x.ground.length * 0.05) };
    }),
    async (state, ag, p, v) => { const pl = planetAt(state, v); const n = Math.min(3, TI.unitsLeft(state, p, 'infantry')); for (let i = 0; i < n; i++) pl.ground.push(TI.makeUnit('infantry')); TI.log(state, `${p.name} places ${n} infantry on ${pl.name}.`); });

  A('ghost_ship', 'Ghost Ship', 'Place 1 destroyer in a non-home system that contains a wormhole and no other players\' ships.', 1, (state, p) =>
    state.map.order.filter((id) => { const s = state.map.systems[id]; return s.wormhole && !isHome(s) && !TI.hasOtherShips(s, p.id) && TI.unitsLeft(state, p, 'destroyer') > 0 && nonFighters(ships(s, p.id)).length < TI.fleetLimit(p); })
      .map((id) => ({ label: `System ${sysLabel(state, id)}`, value: id, score: 0.7 + (state.map.systems[id].planets.some((x) => x.owner === p.id) ? 0.2 : 0) })),
    async (state, ag, p, id) => { if (placeShip(state, p, id, 'destroyer')) TI.log(state, `${p.name} places a destroyer in ${id}.`); });

  A('industrial_initiative', 'Industrial Initiative', 'Gain 1 trade good for each industrial planet you control.', 1, (state, p) => {
    const n = TI.planetsOwned(state, p).filter((x) => x.trait === 'industrial').length;
    return n ? [{ label: `Gain ${n} trade good(s)`, value: true, score: 0.45 * n }] : [];
  }, async (state, ag, p) => { const n = TI.planetsOwned(state, p).filter((x) => x.trait === 'industrial').length; p.tg += n; TI.log(state, `${p.name} gains ${n} trade goods.`); });

  A('insubordination', 'Insubordination', 'Remove 1 token from another player\'s tactic pool and return it to their reinforcements.', 1, (state, p) =>
    others(state, p).filter((o) => o.tokens.tactic > 0).map((o) => ({ label: `${o.name} (${o.tokens.tactic} tactic tokens)`, value: o.id, score: 0.35 + 0.2 * Math.min(o.tokens.tactic, 4) + (isLeader(state, o) ? 0.3 : 0) })),
    async (state, ag, p, pid) => { const o = state.players[pid]; if (o.tokens.tactic > 0) { o.tokens.tactic--; TI.log(state, `${p.name} makes ${o.name} lose a tactic token.`); } });

  A('lucky_shot', 'Lucky Shot', 'Destroy 1 dreadnought, cruiser, or destroyer in a system that contains a planet you control.', 3, (state, p) => {
    const out = [];
    for (const id of state.map.order) {
      const s = state.map.systems[id];
      if (!s.planets.some((x) => x.owner === p.id)) continue;
      for (const o of others(state, p)) for (const t of ['dreadnought', 'cruiser', 'destroyer']) {
        if ((s.ships[o.id] || []).some((u) => u.type === t)) out.push({ label: `${o.name}'s ${t} in ${id}`, value: { s: id, o: o.id, t }, score: { dreadnought: 1.6, cruiser: 1.0, destroyer: 0.6 }[t] + (isLeader(state, o) ? 0.2 : 0) });
      }
    }
    return out;
  }, async (state, ag, p, v) => {
    const list = state.map.systems[v.s].ships[v.o] || [], u = list.find((x) => x.type === v.t && !x.damaged) || list.find((x) => x.type === v.t);
    if (u) { removeShip(state, v.o, v.s, u); TI.log(state, `${p.name} destroys ${state.players[v.o].name}'s ${v.t} in ${v.s}.`); }
  });

  A('mining_initiative', 'Mining Initiative', 'Gain trade goods equal to the resource value of 1 planet you control.', 1, (state, p) => {
    const best = TI.planetsOwned(state, p).sort((a, b) => b.res - a.res)[0];
    return best && best.res >= 2 ? [{ label: `${best.name}: gain ${best.res} trade goods`, value: best.res, score: 0.45 * best.res }] : [];
  }, async (state, ag, p, n) => { p.tg += n; TI.log(state, `${p.name} gains ${n} trade goods.`); });

  A('plague', 'Plague', 'Choose 1 planet controlled by another player: roll 1 die for each infantry on it; each 6 or higher destroys 1.', 2, (state, p) =>
    allPlanets(state).filter((e) => e.pl.owner !== null && e.pl.owner !== p.id && e.pl.ground.filter((u) => u.type === 'infantry').length >= 2).map((e) => {
      const n = e.pl.ground.filter((u) => u.type === 'infantry').length;
      return { label: `${e.pl.name} (${state.players[e.pl.owner].name}) — ${n} infantry`, value: ref(e), score: 0.45 * n };
    }),
    async (state, ag, p, v) => {
      const pl = planetAt(state, v); let killed = 0;
      for (const u of pl.ground.filter((x) => x.type === 'infantry')) if (state.rng.d10() >= 6) { pl.ground.splice(pl.ground.indexOf(u), 1); killed++; }
      TI.log(state, `${p.name}'s plague kills ${killed} infantry on ${pl.name}.`);
    });

  A('reactor_meltdown', 'Reactor Meltdown', 'Destroy 1 space dock in a non-home system.', 2, (state, p) =>
    allPlanets(state).filter((e) => e.pl.dock && e.pl.owner !== p.id && !isHome(e.sys)).map((e) => ({ label: `${e.pl.name} (${e.pl.owner === null ? 'nobody' : state.players[e.pl.owner].name})`, value: ref(e), score: 1.5 })),
    async (state, ag, p, v) => { const pl = planetAt(state, v); pl.dock = false; TI.log(state, `${p.name} destroys the space dock on ${pl.name}.`); });

  A('rise_of_a_messiah', 'Rise of a Messiah', 'Place 1 infantry from your reinforcements on each planet you control.', 1, (state, p) => {
    const n = TI.planetsOwned(state, p).length;
    return n >= 2 && TI.unitsLeft(state, p, 'infantry') > 0 ? [{ label: `Place an infantry on each of your ${n} planets`, value: true, score: 0.32 * n }] : [];
  }, async (state, ag, p) => { for (const x of TI.planetsOwned(state, p)) if (TI.unitsLeft(state, p, 'infantry') > 0) x.ground.push(TI.makeUnit('infantry')); TI.log(state, `${p.name} places an infantry on each of their planets.`); });

  A('signal_jamming', 'Signal Jamming', 'Choose 1 non-home system that contains or is adjacent to 1 of your ships. Place a command token from another player\'s reinforcements in that system.', 1, (state, p) => {
    const out = [];
    for (const id of state.map.order) {
      const s = state.map.systems[id];
      if (isHome(s)) continue;
      const near = (s.ships[p.id] || []).length || s.adj.some((a) => (state.map.systems[a].ships[p.id] || []).length);
      if (!near) continue;
      for (const o of others(state, p)) {
        if (TI.tokensOn(s).includes(o.id)) continue;
        const stake = s.planets.filter((x) => x.owner === o.id).length * 0.35 + ((s.ships[o.id] || []).length ? 0.3 : 0) + (isLeader(state, o) ? 0.25 : 0);
        out.push({ label: `${o.name}'s token in ${sysLabel(state, id)}`, value: { s: id, o: o.id }, score: 0.35 + stake });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 8);
  }, async (state, ag, p, v) => { TI.tokensOn(state.map.systems[v.s]).push(v.o); TI.log(state, `${p.name} jams ${state.players[v.o].name}'s signals: they cannot activate ${v.s} this round.`); });

  A('spy', 'Spy', 'Choose 1 player. That player gives you 1 random action card from their hand.', 1, (state, p) =>
    others(state, p).filter((o) => o.hand.length).map((o) => ({ label: `${o.name} (${o.hand.length} card${o.hand.length === 1 ? '' : 's'})`, value: o.id, score: 0.6 + 0.12 * o.hand.length })),
    async (state, ag, p, pid) => { const o = state.players[pid]; if (!o.hand.length) return; const [c] = o.hand.splice(state.rng.int(o.hand.length), 1); p.hand.push(c); TI.log(state, `${p.name} takes a random action card from ${o.name}.`); });

  A('tactical_bombardment', 'Tactical Bombardment', 'Choose 1 system that contains 1 or more of your units that have Bombardment. Exhaust each planet controlled by other players in that system.', 1, (state, p) =>
    state.map.order.filter((id) => {
      const s = state.map.systems[id];
      return (s.ships[p.id] || []).some((u) => p.stats[u.type].bombard) && s.planets.some((x) => x.owner !== null && x.owner !== p.id && !x.exhausted);
    }).map((id) => ({ label: `System ${sysLabel(state, id)}`, value: id, score: 0.7 * state.map.systems[id].planets.filter((x) => x.owner !== null && x.owner !== p.id && !x.exhausted).length })),
    async (state, ag, p, id) => { for (const x of state.map.systems[id].planets) if (x.owner !== null && x.owner !== p.id) x.exhausted = true; TI.log(state, `${p.name} bombards ${id}: planets controlled by others are exhausted.`); });

  A('unexpected_action', 'Unexpected Action', 'Remove 1 of your command tokens from the game board and return it to your reinforcements.', 1, (state, p) =>
    state.map.order.filter((id) => TI.tokensOn(state.map.systems[id]).includes(p.id)).map((id) => {
      const s = state.map.systems[id];
      return { label: `System ${sysLabel(state, id)}`, value: id, score: 0.7 + ((s.ships[p.id] || []).length ? 0.45 : 0) + (s.planets.some((x) => x.owner === p.id) ? 0.1 : 0) };
    }),
    async (state, ag, p, id) => { const t = TI.tokensOn(state.map.systems[id]); const i = t.indexOf(p.id); if (i >= 0) t.splice(i, 1); TI.log(state, `${p.name} removes their command token from ${id}.`); });

  A('unstable_planet', 'Unstable Planet', 'Choose 1 hazardous planet. Exhaust that planet and destroy up to 3 infantry on it.', 2, (state, p) =>
    allPlanets(state).filter((e) => e.pl.trait === 'hazardous').map((e) => {
      const inf = e.pl.ground.filter((u) => u.type === 'infantry').length, mine = e.pl.owner === p.id;
      return { label: `${e.pl.name} (${e.pl.owner === null ? 'unclaimed' : state.players[e.pl.owner].name}) — ${inf} infantry`, value: ref(e), score: mine ? -1 : (e.pl.owner === null ? 0 : 0.6 * Math.min(3, inf)) };
    }).filter((o) => o.score > -1),
    async (state, ag, p, v) => {
      const pl = planetAt(state, v); pl.exhausted = true; let n = 0;
      for (const u of pl.ground.filter((x) => x.type === 'infantry').slice(0, 3)) { pl.ground.splice(pl.ground.indexOf(u), 1); n++; }
      TI.log(state, `${p.name} destabilizes ${pl.name}: exhausted, ${n} infantry destroyed.`);
    });

  A('uprising', 'Uprising', 'Exhaust 1 non-home planet controlled by another player. Then gain trade goods equal to its resource value.', 1, (state, p) =>
    allPlanets(state).filter((e) => e.pl.owner !== null && e.pl.owner !== p.id && !isHome(e.sys) && !e.pl.exhausted).map((e) => ({ label: `${e.pl.name} (${state.players[e.pl.owner].name}) — ${e.pl.res} resources`, value: ref(e), score: 0.2 + 0.45 * e.pl.res })),
    async (state, ag, p, v) => { const pl = planetAt(state, v); pl.exhausted = true; p.tg += pl.res; TI.log(state, `${p.name} incites an uprising on ${pl.name} and gains ${pl.res} trade goods.`); });

  A('war_effort', 'War Effort', 'Place 1 cruiser from your reinforcements in a system that contains your ships.', 2, (state, p) =>
    state.map.order.filter((id) => { const s = state.map.systems[id]; return (s.ships[p.id] || []).length && TI.unitsLeft(state, p, 'cruiser') > 0 && nonFighters(s.ships[p.id]).length < TI.fleetLimit(p); })
      .map((id) => ({ label: `System ${sysLabel(state, id)}`, value: id, score: 1.0 + (TI.hasOtherShips(state.map.systems[id], p.id) ? 0.3 : 0) + Math.min(0.3, nonFighters(state.map.systems[id].ships[p.id]).length * 0.05) })),
    async (state, ag, p, id) => { if (placeShip(state, p, id, 'cruiser')) TI.log(state, `${p.name} places a cruiser in ${id}.`); });

  // ---- window cards (combat, reactions, tactical, phases) ---------------------------------------------
  W({ id: 'morale_boost', name: 'Morale Boost', count: 4, window: ['spaceRoundStart', 'groundRoundStart'], when: 'combat',
    text: 'At the start of a combat round: apply +1 to the result of each of your unit\'s combat rolls during this combat round.', weight: 1,
    eligible: (s, p, c) => c.attacker.id === p.id || c.defender.id === p.id,
    bot: (s, p, c) => { const mine = strength(unitsOf(s, c, p), p.stats), theirs = strength(foeUnits(s, c, p), foeOf(c, p).stats); return unitsOf(s, c, p).length >= 3 && mine >= theirs * 0.5 && mine <= theirs * 2.2; },
    prompt: (s, p, c) => `Round ${c.round} is about to start (${c.ground ? 'ground' : 'space'} battle at ${c.sysId}). Add +1 to all your combat rolls this round?`,
    play: async (s, ag, p, c) => { c.cx.buffs.push({ side: mySide(c, p), mod: 1 }); } });
  W({ id: 'fighter_prototype', name: 'Fighter Prototype', window: 'spaceRoundStart', when: 'combat',
    text: 'At the start of the first round of a space combat: apply +2 to the result of each of your fighters\' combat rolls during this combat round.',
    eligible: (s, p, c) => c.round === 1 && (c.attacker.id === p.id || c.defender.id === p.id) && unitsOf(s, c, p).some((u) => u.type === 'fighter'),
    bot: (s, p, c) => unitsOf(s, c, p).filter((u) => u.type === 'fighter').length >= 3,
    prompt: (s, p, c) => 'First round of the space battle: your fighters get +2 on their combat rolls this round.',
    play: async (s, ag, p, c) => { c.cx.buffs.push({ side: mySide(c, p), mod: 2, type: 'fighter' }); } });
  W({ id: 'emergency_repairs', name: 'Emergency Repairs', window: 'spaceRoundStart', when: 'combat',
    text: 'At the start or end of a combat round: repair all of your units that have Sustain Damage in the active system.',
    eligible: (s, p, c) => (c.attacker.id === p.id || c.defender.id === p.id) && unitsOf(s, c, p).some((u) => u.damaged && p.stats[u.type].sustain),
    bot: () => true,
    prompt: () => 'Repair all your damaged units in this battle before the round begins?',
    play: async (s, ag, p, c) => { for (const u of unitsOf(s, c, p)) if (u.damaged) u.damaged = false; TI.log(s, `${p.name} repairs their damaged units.`); } });
  W({ id: 'skilled_retreat', name: 'Skilled Retreat', count: 4, window: 'spaceRoundStart', when: 'combat',
    text: 'At the start of a combat round: move all of your ships from the active system into an adjacent system that does not contain another player\'s ships; the space combat ends in a draw. Then place a command token in that system.',
    eligible: (s, p, c) => (c.attacker.id === p.id || c.defender.id === p.id) && retreatTargets(s, p, c.sysId).length > 0,
    bot: (s, p, c) => { const mine = strength(unitsOf(s, c, p), p.stats), theirs = strength(foeUnits(s, c, p), foeOf(c, p).stats); return mine < theirs * 0.55; },
    prompt: (s, p, c) => `Pull your whole fleet out of ${c.sysId} and end the battle in a draw?`,
    play: async (s, ag, p, c) => {
      const opts = retreatTargets(s, p, c.sysId);
      let dest = ag[p.id] && ag[p.id].chooseRetreat ? await ag[p.id].chooseRetreat(s, p, c.sysId, opts, { mine: unitsOf(s, c, p), theirs: foeUnits(s, c, p), opponent: foeOf(c, p), forced: true }) : null;
      if (!opts.includes(dest)) dest = opts[0];
      TI.doRetreat(s, p, c.sysId, dest);
      c.ended = true;
      TI.log(s, `${p.name} makes a skilled retreat to ${dest}; the battle ends in a draw.`);
    } });
  W({ id: 'shields_holding', name: 'Shields Holding', count: 4, window: 'beforeAssign', when: 'combat',
    text: 'Before you assign hits to your ships during a space combat: cancel up to 2 hits.',
    eligible: (s, p, c) => c.player.id === p.id && c.hits > 0,
    bot: () => true,
    prompt: (s, p, c) => `${c.hits} hit${c.hits === 1 ? '' : 's'} are about to be assigned to your ships. Cancel up to 2?`,
    play: async (s, ag, p, c) => { const n = Math.min(2, c.roll[c.foeSide].hits); c.roll[c.foeSide].hits -= n; c.roll[c.foeSide].cancelled = (c.roll[c.foeSide].cancelled || 0) + n; TI.log(s, `${p.name}'s shields hold: ${n} hit(s) cancelled.`); } });
  W({ id: 'maneuvering_jets', name: 'Maneuvering Jets', count: 4, window: 'beforeCannon', when: 'combat',
    text: 'Before you assign hits produced by another player\'s Space Cannon roll: cancel 1 hit.',
    eligible: (s, p, c) => c.player.id === p.id && c.volley.hits > 0,
    bot: () => true,
    prompt: (s, p, c) => `${c.volley.hits} Space Cannon hit${c.volley.hits === 1 ? '' : 's'} are coming. Cancel 1?`,
    play: async (s, ag, p, c) => { c.volley.hits = Math.max(0, c.volley.hits - 1); TI.log(s, `${p.name} dodges a Space Cannon hit.`); } });
  W({ id: 'direct_hit', name: 'Direct Hit', count: 4, window: 'afterSustain', when: 'combat',
    text: 'After another player\'s ship uses Sustain Damage to cancel a hit produced by your units or abilities: destroy that ship.',
    eligible: (s, p, c) => c.by.id === p.id && c.owner.id !== p.id,
    bot: (s, p, c) => (COST[c.unit.type] || 2) >= 4,
    prompt: (s, p, c) => `${c.owner.name}'s ${c.unit.type} just sustained damage. Destroy it?`,
    play: async (s, ag, p, c) => { removeShip(s, c.owner.id, c.sysId, c.unit); const sys = s.map.systems[c.sysId]; if (c.state && c.state.map) { /* arrays are shared with the running combat */ } TI.log(s, `${p.name} scores a direct hit and destroys ${c.owner.name}'s ${c.unit.type}.`); } });
  W({ id: 'courageous_to_the_end', name: 'Courageous to the End', window: 'afterDestroyed', when: 'combat',
    text: 'After 1 of your ships is destroyed during a space combat: roll 2 dice. For each result equal to or greater than that ship\'s combat value, your opponent must choose and destroy 1 of their ships.',
    weight: 2,
    eligible: (s, p, c) => c.owner.id === p.id && c.units.length > 0 && nonFighters(ships(s.map.systems[c.sysId], c.foe.id)).length > 0,
    bot: (s, p, c) => c.units.some((u) => p.stats[u.type].combat <= 7) && ships(s.map.systems[c.sysId], c.foe.id).length >= 2,
    prompt: (s, p, c) => 'One of your ships was destroyed. Roll 2 dice against its combat value to make your opponent lose ships?',
    play: async (s, ag, p, c) => {
      const u = c.units.slice().sort((a, b) => p.stats[a.type].combat - p.stats[b.type].combat)[0], need = p.stats[u.type].combat;
      let kills = 0; const rolls = [s.rng.d10(), s.rng.d10()];
      rolls.forEach((r) => { if (r >= need) kills++; });
      TI.log(s, `${p.name} rolls ${rolls.join(' and ')} for Courageous to the End (needs ${need}): ${kills} hit(s).`);
      for (let k = 0; k < kills; k++) {
        const list = ships(s.map.systems[c.sysId], c.foe.id);
        if (!list.length) break;
        const agent = ag[c.foe.id];
        let pick = agent && agent.chooseShipToDestroy ? await agent.chooseShipToDestroy(s, c.foe, list) : null;
        if (!list.includes(pick)) pick = list.slice().sort((a, b) => (COST[a.type] || 1) - (COST[b.type] || 1))[0];
        removeShip(s, c.foe.id, c.sysId, pick);
        TI.log(s, `${c.foe.name} destroys a ${pick.type}.`);
      }
    } });
  W({ id: 'intercept', name: 'Intercept', window: 'retreatDeclared', when: 'combat',
    text: 'After your opponent declares a retreat during a space combat: your opponent cannot retreat during this round of space combat.',
    eligible: (s, p, c) => c.other.id === p.id,
    bot: (s, p, c) => { const mine = strength(ships(s.map.systems[c.sysId], p.id), p.stats), theirs = strength(ships(s.map.systems[c.sysId], c.retreater.id), c.retreater.stats); return mine >= theirs * 0.6; },
    prompt: (s, p, c) => `${c.retreater.name} announced a retreat. Stop it this round?`,
    play: async (s, ag, p, c) => { c.cancelled = true; } });
  W({ id: 'bunker', name: 'Bunker', window: 'invasionStart', when: 'combat',
    text: 'At the start of an invasion: during this invasion, apply -4 to the result of each Bombardment roll against planets you control.',
    eligible: (s, p, c) => !!c.defenderPlayer && c.defenderPlayer.id === p.id,
    bot: (s, p, c) => ships(s.map.systems[c.sysId], c.attacker.id).some((u) => c.attacker.stats[u.type].bombard),
    prompt: (s, p, c) => `${c.attacker.name} is invading ${c.planet.name} and has bombardment ships. Apply -4 to their bombardment rolls?`,
    play: async (s, ag, p, c) => { c.bombardMod -= 4; } });
  W({ id: 'disable', name: 'Disable', window: 'invasionStart', when: 'combat',
    text: 'At the start of an invasion in a system that contains 1 or more of your opponents\' PDS units: your opponents\' PDS units lose Planetary Shield and Space Cannon during this invasion.',
    eligible: (s, p, c) => c.attacker.id === p.id && !!c.defenderPlayer && c.planet.pds > 0,
    bot: () => true,
    prompt: (s, p, c) => `${c.planet.name} has ${c.planet.pds} PDS. Switch them off for this invasion?`,
    play: async (s, ag, p, c) => { c.noPDS = true; TI.log(s, `${p.name} disables the PDS on ${c.planet.name}.`); } });
  W({ id: 'parley', name: 'Parley', window: 'landing', when: 'combat',
    text: 'After another player commits units to land on a planet you control: return the committed units to the space area.',
    eligible: (s, p, c) => c.defenderPlayer && c.defenderPlayer.id === p.id,
    bot: (s, p, c) => c.landing.length >= c.planet.ground.length * 0.8,
    prompt: (s, p, c) => `${c.attacker.name} is landing ${c.landing.length} ground force(s) on ${c.planet.name}. Send them back to orbit?`,
    play: async (s, ag, p, c) => { c.cancelled = true; } });
  W({ id: 'fire_team', name: 'Fire Team', window: 'groundRolled', when: 'combat',
    text: 'After your ground forces make combat rolls during a round of ground combat: reroll any number of your dice.',
    eligible: (s, p, c) => c.player.id === p.id && c.roll[c.side].dice.some((d) => !d.hit),
    bot: () => true,
    prompt: (s, p, c) => `You rolled ${c.roll[c.side].hits} hit(s) with ${c.roll[c.side].dice.filter((d) => !d.hit).length} miss(es). Reroll all the misses?`,
    play: async (s, ag, p, c) => {
      const r = c.roll[c.side]; let gained = 0;
      for (const d of r.dice) if (!d.hit) { const n = s.rng.d10(); d.reroll = n; if (n >= d.need) { d.hit = true; gained++; } }
      r.hits += gained; TI.log(s, `${p.name} rerolls misses with Fire Team and gains ${gained} hit(s).`);
    } });
  W({ id: 'infiltrate', name: 'Infiltrate', window: 'planetGained', when: 'combat',
    text: 'When you gain control of a planet: replace each PDS and space dock that is on that planet with a matching unit from your reinforcements.',
    eligible: (s, p, c) => c.newOwner.id === p.id && (c.had.pds > 0 || c.had.dock),
    bot: () => true,
    prompt: (s, p, c) => `You took ${c.planet.name}. Keep its ${[c.had.pds ? c.had.pds + ' PDS' : '', c.had.dock ? 'space dock' : ''].filter(Boolean).join(' and ')} as your own?`,
    play: async (s, ag, p, c) => { c.infiltrate = true; } });
  W({ id: 'reparations', name: 'Reparations', window: 'planetGained', when: 'tactical',
    text: 'After another player gains control of a planet you control: exhaust 1 planet that player controls and ready 1 planet you control.',
    eligible: (s, p, c) => !!c.oldOwner && c.oldOwner.id === p.id,
    bot: (s, p, c) => TI.planetsOwned(s, c.newOwner).some((x) => !x.exhausted),
    prompt: (s, p, c) => `${c.newOwner.name} took ${c.planet.name}. Exhaust one of their planets and ready one of yours?`,
    play: async (s, ag, p, c) => {
      const theirs = TI.planetsOwned(s, c.newOwner).filter((x) => !x.exhausted).sort((a, b) => (b.res + b.inf) - (a.res + a.inf))[0];
      if (theirs) theirs.exhausted = true;
      const mine = bestUnused(s, p)[0]; if (mine) mine.exhausted = false;
      TI.log(s, `${p.name} claims reparations${theirs ? ` (exhausting ${theirs.name})` : ''}.`);
    } });
  W({ id: 'flank_speed', name: 'Flank Speed', count: 4, window: 'afterActivate', when: 'tactical',
    text: 'After you activate a system: apply +1 to the move value of each of your ships during this tactical action.',
    eligible: (s, p, c) => c.player.id === p.id,
    bot: (s, p, c, style) => planGain(s, p, c.sysId, { flank: 1 }, style) >= 1,
    prompt: (s, p, c) => `Give all your ships +1 move for this tactical action (activating ${c.sysId})?`,
    play: async (s, ag, p, c) => { s.tactical.flank = (s.tactical.flank || 0) + 1; TI.log(s, `${p.name}'s ships get +1 move this action.`); } });
  W({ id: 'in_the_silence_of_space', name: 'In The Silence Of Space', window: 'afterActivate', when: 'tactical',
    text: 'After you activate a system: choose 1 system. During this tactical action, your ships in the chosen system can move through systems that contain other players\' ships.',
    eligible: (s, p, c) => c.player.id === p.id && s.map.order.some((id) => (s.map.systems[id].ships[p.id] || []).length),
    bot: (s, p, c, style) => bestSilence(s, p, c.sysId, style) !== null,
    prompt: (s, p, c) => `Your ships in one system you choose may move through enemy ships this action (activating ${c.sysId}).`,
    options: (s, p) => s.map.order.filter((id) => (s.map.systems[id].ships[p.id] || []).length).map((id) => ({ label: `Ships in ${sysLabel(s, id)}`, value: id })),
    botOption: (s, p, c, style) => bestSilence(s, p, c.sysId, style),
    play: async (s, ag, p, c, choice) => { s.tactical.silence = choice; TI.log(s, `${p.name}'s ships in ${choice} slip through the silence of space.`); } });
  W({ id: 'lost_star_chart', name: 'Lost Star Chart', window: 'afterActivate', when: 'tactical',
    text: 'After you activate a system: during this tactical action, systems that contain alpha and beta wormholes are adjacent to each other.',
    eligible: (s, p, c) => c.player.id === p.id && s.map.systems[c.sysId].wormhole,
    bot: (s, p, c, style) => planGain(s, p, c.sysId, { lostStar: true }, style) >= 1,
    prompt: () => 'Treat alpha and beta wormhole systems as adjacent for this tactical action?',
    play: async (s, ag, p, c) => { s.tactical.lostStar = true; TI.log(s, `${p.name} opens a route between the wormholes.`); } });
  W({ id: 'upgrade', name: 'Upgrade', window: 'afterActivate', when: 'tactical',
    text: 'After you activate a system that contains 1 or more of your ships: replace 1 of your cruisers in that system with 1 of your dreadnoughts from your reinforcements.',
    eligible: (s, p, c) => c.player.id === p.id && ships(s.map.systems[c.sysId], p.id).some((u) => u.type === 'cruiser') && TI.unitsLeft(s, p, 'dreadnought') > 0,
    bot: () => true,
    prompt: (s, p, c) => `Swap one of your cruisers in ${c.sysId} for a dreadnought?`,
    play: async (s, ag, p, c) => { const list = ships(s.map.systems[c.sysId], p.id), i = list.findIndex((u) => u.type === 'cruiser'); if (i >= 0) { list.splice(i, 1, TI.makeUnit('dreadnought')); TI.log(s, `${p.name} upgrades a cruiser to a dreadnought in ${c.sysId}.`); } } });
  W({ id: 'experimental_battlestation', name: 'Experimental Battlestation', window: 'afterMove', when: 'tactical',
    text: 'After another player moves ships into a system during a tactical action: choose 1 of your space docks that is either in or adjacent to that system. That space dock uses Space Cannon 5 (x3) against ships in the active system.',
    eligible: (s, p, c) => c.mover.id !== p.id && ships(s.map.systems[c.sysId], c.mover.id).length > 0 && dockNear(s, p, c.sysId),
    bot: (s, p, c) => ships(s.map.systems[c.sysId], c.mover.id).length >= 2,
    prompt: (s, p, c) => `${c.mover.name} moved into ${c.sysId}, next to your space dock. Fire it (Space Cannon 5, 3 dice) at their ships?`,
    play: async (s, ag, p, c) => {
      let hits = 0; for (let i = 0; i < 3; i++) if (s.rng.d10() >= 5) hits++;
      const list = ships(s.map.systems[c.sysId], c.mover.id), killed = TI._assignHits(list, hits, c.mover.stats, {});
      if (TI.trimCargo) TI.trimCargo(s, c.mover, s.map.systems[c.sysId]);
      TI.log(s, `${p.name}'s space dock fires: ${hits} hit(s), ${killed} of ${c.mover.name}'s ships destroyed.`);
    } });
  W({ id: 'public_disgrace', name: 'Public Disgrace', window: 'strategyPick', when: 'strategy',
    text: 'When another player chooses a strategy card during the strategy phase: that player must choose a different strategy card instead, if able.',
    eligible: (s, p, c) => c.picker.id !== p.id && c.avail.length > 0,
    bot: (s, p, c) => c.cardId === 8 || c.cardId === 5 || isLeader(s, c.picker),
    prompt: (s, p, c) => `${c.picker.name} chose ${TI.STRATEGY_CARDS[c.cardId - 1].name}. Make them pick a different card?`,
    play: async (s, ag, p, c) => { c.forbid = true; } });
  W({ id: 'summit', name: 'Summit', window: 'strategyStart', when: 'strategy',
    text: 'At the start of the strategy phase: gain 2 command tokens.',
    eligible: () => true, bot: () => true,
    prompt: () => 'The strategy phase is starting. Gain 2 command tokens?',
    play: async (s, ag, p) => { await TI.giveTokens(s, ag, p, 2); TI.log(s, `${p.name} gains 2 command tokens from Summit.`); } });
  W({ id: 'political_stability', name: 'Political Stability', window: 'statusReturn', when: 'status',
    text: 'When you would return your strategy card(s) during the status phase: do not return your strategy card(s). You do not choose strategy cards during the next strategy phase.',
    weight: 2,
    eligible: (s, p) => p.cards.length > 0,
    bot: (s, p) => p.cards.includes(8) || (p.cards.includes(1) && p.cards.includes(4)),
    prompt: (s, p) => `Keep your strategy cards (${p.cards.map((id) => TI.STRATEGY_CARDS[id - 1].name).join(', ')}) for next round and skip the next strategy phase picks?`,
    play: async (s, ag, p) => { p.keepCards = true; TI.log(s, `${p.name} keeps their strategy cards (Political Stability).`); } });
  W({ id: 'sabotage', name: 'Sabotage', count: 4, window: 'sabotage', when: 'reaction',
    text: 'When another player plays an action card other than "Sabotage": cancel that action card.', weight: 1,
    eligible: (s, p, c) => c.player.id !== p.id && c.card.id !== 'sabotage',
    bot: (s, p, c, style) => (c.card.weight || 1) >= 2 || s.rng.next() < 0.3,
    prompt: (s, p, c) => `${c.player.name} plays ${c.card.name}. Cancel it with Sabotage?`,
    play: async () => {} });

  // ---- agenda-phase cards ------------------------------------------------------------------------------
  A('repeal_law', 'Repeal Law', 'Discard 1 law from play.', 2, (state, p) =>
    (state.laws || []).map((e) => ({ label: TI.AGENDA_BY_ID[e.id].name + (e.owner !== null && e.owner !== undefined ? ` (held by ${state.players[e.owner].name})` : ''), value: e.id, score: TI.lawHarm(state, p, e) })).filter((o) => o.score >= 0.4),
    async (state, ag, p, id) => { const e = (state.laws || []).find((x) => x.id === id); if (e) TI.discardLaw(state, e); });
  const others2 = (state, p) => state.players.filter((o) => o.id !== p.id);
  W({ id: 'ancient_burial_sites', name: 'Ancient Burial Sites', window: 'agendaPhaseStart', when: 'agenda',
    text: 'At the start of the agenda phase: choose 1 player; exhaust each cultural planet that player owns.', weight: 2,
    eligible: (s, p) => others2(s, p).some((o) => TI.planetsOwned(s, o).some((x) => x.trait === 'cultural' && !x.exhausted)),
    options: (s, p) => others2(s, p).map((o) => ({ label: `${o.name} (${TI.planetsOwned(s, o).filter((x) => x.trait === 'cultural').length} cultural planets)`, value: o.id })),
    botOption: (s, p) => others2(s, p).sort((a, b) => TI.planetsOwned(s, b).filter((x) => x.trait === 'cultural').reduce((n, x) => n + x.inf, 0) - TI.planetsOwned(s, a).filter((x) => x.trait === 'cultural').reduce((n, x) => n + x.inf, 0))[0].id,
    bot: (s, p) => others2(s, p).some((o) => TI.planetsOwned(s, o).filter((x) => x.trait === 'cultural' && !x.exhausted).reduce((n, x) => n + x.inf, 0) >= 3),
    prompt: () => 'The agenda phase is starting. Exhaust all cultural planets of one player?',
    play: async (s, ag, p, c, id) => { TI.planetsOwned(s, s.players[id]).forEach((x) => { if (x.trait === 'cultural') x.exhausted = true; }); TI.log(s, `${s.players[id].name}'s cultural planets are exhausted.`); } });
  W({ id: 'assassinate_representative', name: 'Assassinate Representative', window: 'agendaRevealed', when: 'agenda',
    text: 'After an agenda is revealed: choose 1 player. That player cannot vote on this agenda.', weight: 2,
    eligible: (s, p, c) => others2(s, p).some((o) => !c.banned.has(o.id)),
    options: (s, p, c) => others2(s, p).filter((o) => !c.banned.has(o.id)).map((o) => ({ label: `${o.name} (${TI.available(s, o).inf} influence)`, value: o.id })),
    botOption: (s, p, c) => { const base = TI.predictOutcome(s, c, null); let best = null, gain = 0.5; for (const o of others2(s, p)) { if (c.banned.has(o.id)) continue; const pr = TI.predictOutcome(s, c, o.id); const g = TI.agendaOutcomeScore(s, p, c, pr ? pr.key : null) - TI.agendaOutcomeScore(s, p, c, base ? base.key : null); if (g > gain) { gain = g; best = o.id; } } return best; },
    bot: (s, p, c) => { const t = TI.ACTION_BY_ID.assassinate_representative.botOption(s, p, c); return t !== null && t !== undefined; },
    prompt: (s, p, c) => `${c.agenda.name} was revealed. Stop one player from voting on it?`,
    play: async (s, ag, p, c, id) => { c.banned.add(id); TI.log(s, `${s.players[id].name} cannot vote on this agenda.`); } });
  const RIDERS = [['construction_rider', 'Construction Rider', 'construction', 'place 1 space dock on a planet you control'], ['diplomacy_rider', 'Diplomacy Rider', 'diplomacy', 'choose a system with a planet you control; each other player places a command token there'],
    ['imperial_rider', 'Imperial Rider', 'imperial', 'gain 1 victory point'], ['leadership_rider', 'Leadership Rider', 'leadership', 'gain 3 command tokens'],
    ['politics_rider', 'Politics Rider', 'politics', 'draw 3 action cards and gain the speaker token'], ['technology_rider', 'Technology Rider', 'technology', 'research 1 technology'],
    ['trade_rider', 'Trade Rider', 'trade', 'gain 5 trade goods'], ['warfare_rider', 'Warfare Rider', 'warfare', 'place 1 dreadnought in a system that contains your ships']];
  RIDERS.forEach(([id, name, kind, reward]) => W({ id, name, window: 'agendaRevealed', when: 'agenda', weight: 2,
    text: `After an agenda is revealed: you cannot vote on this agenda. Predict an outcome; if you are right, ${reward}.`,
    eligible: (s, p, c) => !c.banned.has(p.id),
    options: (s, p, c) => c.outcomes.map((o) => ({ label: o.label, value: o.key })),
    botOption: (s, p, c) => { const pr = TI.predictOutcome(s, c, p.id); return pr ? pr.key : null; },
    bot: (s, p, c) => { const pr = TI.predictOutcome(s, c, p.id); if (!pr || pr.margin < 2) return false; if (kind === 'technology' && !TI.researchOptions(s, p).length) return false; return TI.available(s, p).inf <= 3 || ['imperial', 'leadership', 'politics'].includes(kind) && TI.available(s, p).inf <= 6; },
    prompt: (s, p, c) => `${c.agenda.name} was revealed. Skip voting and predict the outcome for a reward?`,
    play: async (s, ag, p, c, key) => { c.banned.add(p.id); c.predictions.push({ pid: p.id, key, rider: kind, name }); TI.log(s, `${p.name} will not vote and predicts an outcome (${name}).`); } }));
  const bribeAmount = (s, p, c) => {
    const v = c.ctx.votes[p.id]; if (!v || !v.key || p.tg < 1) return 0;
    const t = {}; for (const x of Object.values(c.ctx.votes)) if (x.key) t[x.key] = (t[x.key] || 0) + x.n;
    if (TI.agendaOutcomeScore(s, p, c.ctx, v.key) < 0.6) return 0;
    const rival = Math.max(0, ...Object.entries(t).filter(([k]) => k !== v.key).map(([, n]) => n)), need = rival - (t[v.key] || 0) + 1;
    return need >= 1 && need <= p.tg ? need : 0;
  };
  W({ id: 'bribery', name: 'Bribery', window: 'afterSpeakerVote', when: 'agenda', weight: 2,
    text: 'After the speaker votes on an agenda: spend any number of trade goods. For each, cast 1 additional vote for the outcome you voted for.',
    eligible: (s, p, c) => !!(c.ctx.votes[p.id] && c.ctx.votes[p.id].key) && p.tg > 0,
    options: (s, p) => Array.from({ length: Math.min(p.tg, 12) }, (_, i) => ({ label: `Spend ${i + 1} trade good${i ? 's' : ''}: ${i + 1} extra vote${i ? 's' : ''}`, value: i + 1 })),
    botOption: (s, p, c) => bribeAmount(s, p, c) || null, bot: (s, p, c) => bribeAmount(s, p, c) > 0,
    prompt: (s, p, c) => `The speaker has voted. You voted ${c.ctx.votes[p.id].n} for ${c.ctx.outcomes.find((o) => o.key === c.ctx.votes[p.id].key).label}. Buy extra votes with trade goods?`,
    play: async (s, ag, p, c, n) => { n = Math.min(n, p.tg); p.tg -= n; c.ctx.votes[p.id].n += n; TI.log(s, `${p.name} bribes ${n} extra vote(s).`); } });
  W({ id: 'distinguished_councilor', name: 'Distinguished Councilor', window: 'afterVote', when: 'agenda', weight: 2,
    text: 'After you cast votes on an outcome of an agenda: cast 5 additional votes for that outcome.',
    eligible: (s, p, c) => c.voter.id === p.id && c.vote.n > 0,
    bot: (s, p, c) => TI.agendaOutcomeScore(s, p, c.ctx, c.key) >= 0.5,
    prompt: (s, p, c) => `You cast ${c.vote.n} vote(s). Add 5 more for the same outcome?`,
    play: async (s, ag, p, c) => { c.vote.n += 5; TI.log(s, `${p.name} casts 5 additional votes.`); } });
  W({ id: 'veto', name: 'Veto', window: 'agendaVeto', when: 'agenda', weight: 2,
    text: 'When an agenda is revealed: discard that agenda and reveal 1 agenda from the top of the deck. Players vote on that agenda instead.',
    eligible: (s, p, c) => !c.vetoed,
    bot: (s, p, c) => { const d = c.agenda, outs = d.elect ? d.candidates(s) : null; const sc = d.elect ? (d.escore ? outs.map((o) => d.escore(s, p, o)) : [0]) : [d.bias ? d.bias(s, p) : 0, d.bias ? -d.bias(s, p) : 0]; return Math.min(...sc) <= -1.8; },
    prompt: (s, p, c) => `${c.agenda.name} was just revealed. Discard it and reveal a different agenda?`,
    play: async (s, ag, p, c) => { c.vetoed = true; } });
  W({ id: 'confusing_legal_text', name: 'Confusing Legal Text', window: 'elected', when: 'agenda', weight: 1,
    text: 'When you are elected as the outcome of an agenda: choose 1 player. That player is the elected player instead.',
    eligible: (s, p, c) => c.elected.id === p.id,
    options: (s, p, c) => c.outcomes.filter((o) => o.value !== p.id).map((o) => ({ label: o.label, value: o.value })),
    botOption: (s, p, c) => { const outs = c.outcomes.filter((o) => o.value !== p.id); if (!outs.length) return null; return outs.sort((a, b) => c.def.escore(s, p, b) - c.def.escore(s, p, a))[0].value; },
    bot: (s, p, c) => c.def.escore(s, p, c.result) <= -0.5,
    prompt: (s, p, c) => `You were elected for ${c.def.name}. Pass the election to another player?`,
    play: async (s, ag, p, c, id) => { c.newTarget = id; } });

  // ---- helpers used by window cards -------------------------------------------------------------------
  function retreatTargets(state, p, sysId) {
    const S = state.map.systems;
    return S[sysId].adj.filter((id) => !TI.hasOtherShips(S[id], p.id) && S[id].anomaly !== 'supernova' && !(S[id].anomaly === 'asteroid' && !TI.hasTechEffect(p, 'throughAsteroids')));
  }
  function dockNear(state, p, sysId) {
    const S = state.map.systems;
    return [sysId].concat(S[sysId].adj).some((id) => S[id].planets.some((x) => x.owner === p.id && x.dock));
  }
  // How many more ships a bot could send at the target if the temporary movement change were in force.
  function planGain(state, p, sysId, patch, style) {
    if (!TI.botPlan) return 0;
    const st = style || TI.BOT_STYLES.expander, keep = state.tactical;
    try {
      state.tactical = Object.assign({ player: p.id, flank: 0, silence: null, lostStar: false }, keep && keep.player === p.id ? keep : {});
      const before = TI.botPlan(state, p, sysId, st);
      state.tactical = Object.assign({}, state.tactical, patch);
      const after = TI.botPlan(state, p, sysId, st);
      return after.plan.ships.length - before.plan.ships.length;
    } finally { state.tactical = keep; }
  }
  function bestSilence(state, p, sysId, style) {
    let best = null, gain = 0;
    for (const id of state.map.order) {
      if (!(state.map.systems[id].ships[p.id] || []).length) continue;
      const g = planGain(state, p, sysId, { silence: id }, style);
      if (g > gain) { gain = g; best = id; }
    }
    return best;
  }

  TI.ACTION_CARDS = CARDS;
  TI.ACTION_BY_ID = {};
  CARDS.forEach((c) => { TI.ACTION_BY_ID[c.id] = c; });
  TI.HAND_LIMIT = 7;

  // ---- deck and hand ----------------------------------------------------------------------------------
  TI.buildActionDeck = function (rng) {
    const deck = [];
    CARDS.forEach((c) => { for (let i = 0; i < c.count; i++) deck.push(c.id); });
    return rng.shuffle ? rng.shuffle(deck) : deck;
  };
  const keepValue = (id) => { const c = TI.ACTION_BY_ID[id]; return (c.weight || 1) + (c.kind === 'action' ? 0.5 : 0); };
  TI.discardActionCard = function (state, p, id) {
    const i = p.hand.indexOf(id); if (i < 0) return false;
    p.hand.splice(i, 1); state.actionDiscard.push(id); return true;
  };
  TI.drawActionCards = async function (state, agents, p, n, why) {
    let got = 0;
    for (let i = 0; i < n; i++) {
      if (!state.actionDeck.length) {
        if (!state.actionDiscard.length) break;
        state.actionDeck = state.rng.shuffle(state.actionDiscard.splice(0));
        TI.log(state, 'The action card discard pile is shuffled into a new deck.');
      }
      p.hand.push(state.actionDeck.pop()); got++;
    }
    if (got) TI.log(state, `${p.name} draws ${got} action card${got === 1 ? '' : 's'}${why ? ` (${why})` : ''}.`);
    // Hand limit: more than 7 and you discard down at once.
    while (p.hand.length > TI.HAND_LIMIT) {
      const agent = agents && agents[p.id];
      let pick = agent && agent.chooseActionDiscard ? await agent.chooseActionDiscard(state, p) : null;
      if (!p.hand.includes(pick)) pick = p.hand.slice().sort((a, b) => keepValue(a) - keepValue(b))[0];
      TI.discardActionCard(state, p, pick);
      TI.log(state, `${p.name} discards an action card (hand limit).`);
    }
    return got;
  };
  // Spend objective "Discard N action cards" (Form a Spy Network): the least useful cards go first.
  TI.discardCards = function (state, p, n) {
    const order = p.hand.slice().sort((a, b) => keepValue(a) - keepValue(b));
    for (let i = 0; i < n && i < order.length; i++) TI.discardActionCard(state, p, order[i]);
  };

  // ---- playing ------------------------------------------------------------------------------------------
  // Everyone else may cancel a card with Sabotage (or Xxcha's Instinct Training). Returns true if it was cancelled.
  TI.cancelWindow = async function (state, agents, player, card) {
    if (card.id === 'sabotage') return false;
    const order = state.players.filter((o) => o.id !== player.id).sort((a, b) => TI.initiative(a) - TI.initiative(b));
    for (const o of order) {
      const cands = [];
      if (o.hand.includes('sabotage')) cands.push('sabotage');
      if (TI.hasTechEffect(o, 'instinct') && o.tokens.strategy > 0 && !(o.exhausted && o.exhausted.instinct_training)) cands.push('instinct_training');
      if (!cands.length) continue;
      const agent = agents[o.id];
      const ctx = { player, card, state };
      const pick = agent && agent.chooseActionCard ? await agent.chooseActionCard(state, o, 'sabotage', cands, ctx) : null;
      if (pick === 'sabotage' && cands.includes('sabotage')) { TI.discardActionCard(state, o, 'sabotage'); TI.log(state, `${o.name} plays Sabotage and cancels ${card.name}.`); return true; }
      if (pick === 'instinct_training' && cands.includes(pick)) {
        o.tokens.strategy--; o.exhausted = o.exhausted || {}; o.exhausted.instinct_training = true;
        TI.log(state, `${o.name} spends a strategy token (Instinct Training) and cancels ${card.name}.`); return true;
      }
    }
    return false;
  };

  // Play a card: it leaves the hand first, others may cancel it, then `run` does the work.
  TI.playActionCard = async function (state, agents, p, id, run) {
    const card = TI.ACTION_BY_ID[id];
    if (!TI.discardActionCard(state, p, id)) return false;
    TI.log(state, `${p.name} plays ${card.name}.`);
    if (await TI.cancelWindow(state, agents, p, card)) return false;
    await run(card);
    return true;
  };

  // Offer cards for a named moment. players: who is asked, in order (default: initiative order).
  const inWindow = (card, w) => (Array.isArray(card.window) ? card.window.includes(w) : card.window === w);
  TI.cardWindow = async function (state, agents, window, ctx, players) {
    const list = players || state.players.slice().sort((a, b) => TI.initiative(a) - TI.initiative(b));
    const tp = state.phase === 'action' && state.turnPlayer !== undefined && state.turnPlayer !== null ? state.players[state.turnPlayer] : null;
    const shut = tp && TI.hasTechEffect(tp, 'transparasteel');   // Yssaril: passed players cannot play action cards on your turn
    for (const pl of list) {
      if (shut && pl.id !== tp.id && pl.passed) continue;
      for (let k = 0; k < 3; k++) {
        const cands = [...new Set(pl.hand.filter((id) => { const c = TI.ACTION_BY_ID[id]; return c.kind === 'window' && inWindow(c, window) && c.eligible(state, pl, ctx); }))];
        if (!cands.length) break;
        const agent = agents[pl.id];
        const pick = agent && agent.chooseActionCard ? await agent.chooseActionCard(state, pl, window, cands, ctx) : null;
        if (!pick || !cands.includes(pick)) break;
        const c0 = TI.ACTION_BY_ID[pick];
        let choice;
        if (c0.options) {
          const opts = c0.options(state, pl, ctx);
          choice = agent.chooseCardTarget ? await agent.chooseCardTarget(state, pl, c0, opts, ctx) : (c0.botOption ? c0.botOption(state, pl, ctx, agent.botStyle) : (opts[0] && opts[0].value));
          if (choice === null || choice === undefined) break;
        }
        await TI.playActionCard(state, agents, pl, pick, (card) => card.play(state, agents, pl, ctx, choice));
      }
    }
  };

  // ---- component actions --------------------------------------------------------------------------------
  // Playable "As an Action" cards in hand, each with its legal targets.
  TI.playableActionCards = function (state, p) {
    const out = [];
    for (const id of [...new Set(p.hand)]) {
      const c = TI.ACTION_BY_ID[id];
      if (c.kind !== 'action') continue;
      const options = c.options(state, p);
      if (options.length) out.push({ card: c, options });
    }
    return out;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  TI.componentActionCard = async function (state, agents, p, id, value) {
    const c = TI.ACTION_BY_ID[id];
    const options = c && p.hand.includes(id) ? c.options(state, p) : [];
    const opt = options.find((o) => same(o.value, value)) || options.slice().sort((a, b) => b.score - a.score)[0];
    if (!opt) return false;
    await TI.playActionCard(state, agents, p, id, (card) => card.play(state, agents, p, opt.value));
    return true;
  };
  // What a bot does with an action card on its turn: { id, value } or null.
  TI.botActionCard = function (state, p, mustAct) {
    let best = null;
    for (const { card, options } of TI.playableActionCards(state, p)) {
      const o = options.slice().sort((a, b) => b.score - a.score)[0];
      if (!best || o.score > best.score) best = { id: card.id, value: o.value, score: o.score };
    }
    if (!best) return null;
    return best.score >= 1.0 || (mustAct && best.score >= 0.5) ? best : null;
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
