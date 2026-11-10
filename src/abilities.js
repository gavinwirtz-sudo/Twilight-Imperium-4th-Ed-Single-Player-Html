// Faction abilities: everything the six faction sheets do beyond plain stat changes.
// The engine calls into this file from combat/tactical/phases/cards; data lives in data.js.
//
// Optional agent hooks used here (bots get defaults, the human UI asks through dialogs):
//   chooseOrbitalDrop(state, p, planets) -> planet | null
//   chooseTradePartner(state, p, others, gift) -> player | null     (Production Biomes)
//   wantNullify(state, p, activator, sysId) -> boolean              (Xxcha Nullification Field)
//   choosePeaceAccords(state, p, planets) -> planet | null          (Xxcha)
//   chooseDatahub(state, p) -> { take: cardId, give: cardId } | null  (Hacan Quantum Datahub Node)
(function (root) {
  const TI = (root.TI = root.TI || {});

  const ask = async (agent, name, def, ...args) => (agent && agent[name] ? agent[name](...args) : def(...args));
  const homeId = (state, p) => state.map.order.find((id) => state.map.systems[id].home === p.id);
  const cardValue = { 1: 8, 2: 4, 3: 4, 4: 6, 5: 7, 6: 5, 7: 7, 8: 9 }; // rough bot ranking of strategy cards

  // ---- combat sides ---------------------------------------------------------------------------
  // kind: 'space' | 'ground'. The returned object is described at the top of combat.js.
  TI.combatSide = function (state, player, kind, sysId) {
    const f = TI.faction(player), ab = f.ability, fl = player.stats.flagship;
    const hasFlagship = (force) => force.some((u) => u.type === 'flagship');
    const diceOf = (force) => force.reduce((n, u) => n + (player.stats[u.type].type === 'ship' ? player.stats[u.type].dice : 0), 0);
    const side = { rerollMisses: false, _force: null };

    side.unitMod = (u, force) => {
      let m = ab.combatMod || 0;
      if (kind === 'space' && fl.boostOthers && u.type !== 'flagship' && hasFlagship(force)) m += fl.boostOthers;
      if (u.type === 'fighter' && TI.lawOwner && TI.lawOwner(state, 'prophecy_of_ixth') === player.id) m += 1;
      return m;
    };
    if (kind === 'space') {
      side.duranium = TI.hasTechEffect(player, 'duranium');
      side.assaultCannon = TI.hasTechEffect(player, 'assaultCannon');
      side.extraHits = (u, r) => (u.type === 'flagship' && fl.hitsOn && r >= fl.hitsOn ? fl.extraHits : 0);
      // Hacan: pay 1 trade good to turn a die that missed by exactly 1 into a hit (flagship must be present).
      side.boost = (u, r, need) => {
        if (!fl.tgBoost || !side._force || !hasFlagship(side._force) || player.tg <= 0 || r !== need - 1) return false;
        player.tg--; return true;
      };
      side.roundStart = (force) => {
        side._force = force;
        if (fl.repair) force.forEach((u) => { if (u.type === 'flagship') u.damaged = false; });
        side.rerollMisses = false;
        if (ab.munitions && player.tg >= 2 && diceOf(force) >= 3) {
          player.tg -= 2; side.rerollMisses = true;
          TI.log(state, `${player.name} spends 2 trade goods on Munitions Reserves (re-roll misses).`);
        }
      };
      if (player.stats.dreadnought.selfDestruct) {
        // Exotrireme II: sacrifice a dreadnought to destroy up to 2 enemy ships when that is a good trade.
        const val = (u) => TI.UNITS[u.type].cost / TI.UNITS[u.type].batch;
        side.afterRound = (force, other) => {
          for (const u of force.slice()) {
            if (u.type !== 'dreadnought' || !other.length) continue;
            const targets = other.slice().sort((a, b) => val(b) - val(a)).slice(0, 2);
            if (targets.reduce((n, t) => n + val(t), 0) < 4) continue;
            force.splice(force.indexOf(u), 1);
            targets.forEach((t) => other.splice(other.indexOf(t), 1));
            TI.log(state, `${player.name} sacrifices an Exotrireme to destroy ${targets.map((t) => t.type).join(' and ')}.`);
          }
        };
      }
    } else {
      side.valkyrie = TI.hasTechEffect(player, 'valkyrie');
    }
    if (TI.combatSide2) TI.combatSide2(state, player, kind, sysId, side);
    return side;
  };

  // ---- space cannon offense ----------------------------------------------------------------
  // Defenders' PDS and cannon-carrying flagships fire at `attacker`'s ships in sysId. Returns ships destroyed.
  // Space cannon offense as a generator so action cards (Maneuvering Jets) can cancel hits before they are assigned.
  TI.cannonFlow = function* (state, attacker, sysId) {
    const sys = state.map.systems[sysId], mine = sys.ships[attacker.id] || [];
    const resist = TI.hasTechEffect(attacker, 'cannonResist') ? -1 : 0;
    let total = 0;
    state.lastCannonBy = [];
    for (const o of state.players) {
      if (o.id === attacker.id || !mine.length) continue;
      const shooters = [];
      for (const pl of sys.planets) if (pl.owner === o.id) for (let i = 0; i < (pl.pds || 0); i++) shooters.push(TI.makeUnit('pds'));
      // PDS II (range 1) also covers the adjacent systems.
      if (o.stats.pds.range) for (const id of sys.adj) for (const pl of state.map.systems[id].planets) {
        if (pl.owner === o.id) for (let i = 0; i < (pl.pds || 0); i++) shooters.push(TI.makeUnit('pds'));
      }
      const fs = o.stats.flagship;
      if (fs.cannon) {
        for (const id of [sysId].concat(sys.adj)) {
          if (id !== sysId && !fs.cannonAdjacent) continue;
          if ((state.map.systems[id].ships[o.id] || []).some((u) => u.type === 'flagship')) { shooters.push(TI.makeUnit('flagship')); break; }
        }
      }
      if (!shooters.length) continue;
      const rolls = [], need = [];
      const volley = { hits: TI.cannonRoll(shooters, state.rng, o.stats, { mod: resist, extraDie: TI.hasTechEffect(o, 'plasma'), rolls, need }) };
      TI.log(state, `Space Cannon: ${o.name}'s ${shooters.length} cannon unit${shooters.length === 1 ? '' : 's'} fire at ${attacker.name}'s fleet in ${sysId} — rolled [${rolls.join(', ')}] needing ${Math.min(...need)}+: ${volley.hits} hit${volley.hits === 1 ? '' : 's'}.`);
      if (volley.hits > 0) yield { kind: 'cards', window: 'beforeCannon', players: [attacker], ctx: { player: attacker, owner: o, volley, sysId, state } };
      const killed = TI._assignHits(mine, Math.max(0, volley.hits), attacker.stats, { nonFighter: TI.hasTechEffect(o, 'cannonNonFighter') });
      if (killed) { total += killed; state.lastCannonBy.push(o.id); TI.log(state, `${o.name}'s space cannon destroys ${killed} of ${attacker.name}'s ships at ${sysId}.`); }
    }
    return total;
  };
  TI.cannonOffense = function (state, attacker, sysId) {
    const g = TI.cannonFlow(state, attacker, sysId);
    let r = g.next();
    while (!r.done) r = g.next(null);
    return r.value;
  };

  // ---- Spec Ops II revival -----------------------------------------------------------------
  TI.reviveRolls = function (state, owner, dead) {
    const need = owner.stats.infantry.revive;
    if (!need) return;
    for (const u of dead) {
      if (u.type === 'infantry' && state.rng.d10() >= need) { owner.revive++; TI.log(state, `${owner.name}'s infantry will return.`); }
    }
  };
  TI.placeRevived = function (state, p) {
    if (!p.revive) return;
    const home = state.map.systems[homeId(state, p)];
    const planet = home.planets.find((pl) => pl.owner === p.id);
    if (planet) {
      for (let i = 0; i < p.revive; i++) planet.ground.push(TI.makeUnit('infantry'));
      TI.log(state, `${p.name} places ${p.revive} revived infantry on ${planet.name}.`);
    }
    p.revive = 0;
  };

  // ---- units / activation helpers ----------------------------------------------------------
  TI.systemHasUnits = (state, p, sysId) => {
    const sys = state.map.systems[sysId];
    return (sys.ships[p.id] || []).length > 0 || sys.planets.some((pl) => pl.owner === p.id && (pl.ground.length || pl.dock || pl.pds));
  };

  // Called right after `p` activates `sysId`. Returns true if p's turn is cancelled (Nullification Field).
  TI.onActivated = async function (state, agents, p, sysId) {
    const sys = state.map.systems[sysId];
    const holders = state.players.filter((o) => o.id !== p.id && (sys.ships[o.id] || []).length > 0);
    for (const o of holders) if (TI.hasTechEffect(o, 'siphons')) { o.tg += 4; TI.log(state, `${o.name}'s E-Res Siphons gain 4 trade goods.`); }
    for (const o of holders) {
      if (!TI.hasTechEffect(o, 'nullify') || o.exhausted.nullification || o.tokens.strategy < 1) continue;
      const def = (st, me, act, sid) => TI.movableShips(st, act, sid).some((m) => m.unit.type !== 'fighter');
      if (await ask(agents[o.id], 'wantNullify', def, state, o, p, sysId)) {
        o.exhausted.nullification = true; o.tokens.strategy--;
        TI.log(state, `${o.name} uses Nullification Field: ${p.name}'s turn ends.`);
        return true;
      }
    }
    if (TI.onActivated2) await TI.onActivated2(state, agents, p, sysId, holders);
    return false;
  };

  // Jol-Nar's Spacial Conduit Cylinder: used automatically when it lets more ships reach the activated system.
  TI.tryConduit = function (state, p, sysId) {
    if (!TI.hasTechEffect(p, 'conduit') || p.exhausted.spacial_conduit || !TI.systemHasUnits(state, p, sysId)) return;
    const before = TI.movableShips(state, p, sysId).length;
    state.conduit = { pid: p.id, sysId };
    if (TI.movableShips(state, p, sysId).length > before) { p.exhausted.spacial_conduit = true; TI.log(state, `${p.name} uses Spacial Conduit Cylinder on ${sysId}.`); }
    else state.conduit = null;
  };

  // ---- component actions (taken instead of a tactical or strategic action) ---------------
  TI.factionActions = function (state, p) {
    const out = [];
    if (p.factionId === 'sol') {
      out.push({ id: 'orbital_drop', label: 'Orbital Drop', sub: 'Spend 1 strategy token: place 2 infantry on a planet you control.',
                 ok: p.tokens.strategy >= 1 && TI.planetsOwned(state, p).length > 0 });
    }
    if (p.techs.includes('production_biomes')) {
      out.push({ id: 'production_biomes', label: 'Production Biomes', sub: 'Spend 1 strategy token: gain 4 trade goods, another player gains 2.',
                 ok: p.tokens.strategy >= 1 && !p.exhausted.production_biomes });
    }
    if (p.techs.includes('transit_diodes')) {
      out.push({ id: 'transit_diodes', label: 'Transit Diodes', sub: 'Exhaust: move up to 4 of your ground forces from the board onto planets you control.',
                 ok: !p.exhausted.transit_diodes && TI.diodesDefault(state, p) !== null });
    }
    return out;
  };

  // Transit Diodes: the planet that most needs reinforcing (it borders enemies) and what could be pulled in.
  const threatened = (state, p, sysId) => {
    const S = state.map.systems;
    return [sysId].concat(S[sysId].adj).some((id) => (state.players.some((o) => o.id !== p.id && (S[id].ships[o.id] || []).length)) ||
      (id !== sysId && S[id].planets.some((pl) => pl.owner !== null && pl.owner !== p.id)));
  };
  const sysOfPlanet = (state, pl) => state.map.order.find((id) => state.map.systems[id].planets.includes(pl));
  // Ground forces that could be pulled in (one defender stays on every planet); planets with no enemy fleet overhead first.
  TI.diodesSources = (state, p, dest) => {
    const out = [];
    for (const pl of TI.planetsOwned(state, p)) {
      if (pl === dest) continue;
      const risky = state.players.some((o) => o.id !== p.id && (state.map.systems[sysOfPlanet(state, pl)].ships[o.id] || []).length > 0);   // enemy fleet in orbit
      for (let i = 1; i < pl.ground.length; i++) out.push({ pl, unit: pl.ground[i], risky });
    }
    return out.sort((a, b) => a.risky - b.risky);
  };
  // Returns the best destination planet, or null when the move would not be worth an action.
  TI.diodesDefault = (state, p) => {
    let best = null, bestScore = 1.5;
    for (const pl of TI.planetsOwned(state, p)) {
      if (!threatened(state, p, sysOfPlanet(state, pl))) continue;
      const n = Math.min(4, TI.diodesSources(state, p, pl).filter((x) => !x.risky).length);
      const score = n - pl.ground.length * 0.3;
      if (score > bestScore) { best = pl; bestScore = score; }
    }
    return best;
  };

  // After a planet is won: Integrated Economy lets the player build on it (combined cost up to its resources).
  TI.integratedEconomy = async function (state, agents, p, sysId, planet) {
    if (!TI.hasTechEffect(p, 'integrated') || planet.owner !== p.id || planet.res <= 0) return;
    const def = (st, me, sid, pl) => [{ unit: 'infantry' }, { unit: 'infantry' }, { unit: 'infantry' }].slice(0, Math.max(0, pl.res));
    const order = (await ask(agents[p.id], 'chooseIntegrated', def, state, p, sysId, planet)) || [];
    const built = TI.produce(state, p, sysId, order, { planet, maxCost: planet.res });
    if (built.length) TI.log(state, `${p.name}'s Integrated Economy builds ${built.map((u) => u.type).join(', ')} on ${planet.name}.`);
  };

  TI.runFactionAction = async function (state, agents, p, id) {
    const agent = agents[p.id];
    if (id === 'transit_diodes') {
      const planets = TI.planetsOwned(state, p);
      let dest = await ask(agent, 'chooseDiodesTarget', (st, me) => TI.diodesDefault(st, me), state, p, planets);
      if (!planets.includes(dest)) return;   // cancelled, or nothing worth moving
      p.exhausted.transit_diodes = true;
      const src = TI.diodesSources(state, p, dest).slice(0, 4);
      for (const s of src) { s.pl.ground.splice(s.pl.ground.indexOf(s.unit), 1); dest.ground.push(s.unit); }
      TI.log(state, `${p.name} uses Transit Diodes: ${src.length} ground forces move to ${dest.name}.`);
      return;
    }
    if (id === 'orbital_drop') {
      const planets = TI.planetsOwned(state, p);
      const def = (st, me, list) => list.slice().sort((a, b) => (b.res + b.inf) - (a.res + a.inf) || a.ground.length - b.ground.length)[0];
      let pick = await ask(agent, 'chooseOrbitalDrop', def, state, p, planets);
      if (!planets.includes(pick)) pick = def(state, p, planets);
      p.tokens.strategy--;
      pick.ground.push(TI.makeUnit('infantry'), TI.makeUnit('infantry'));
      TI.log(state, `${p.name} uses Orbital Drop: 2 infantry land on ${pick.name}.`);
    } else if (id === 'production_biomes') {
      const others = state.players.filter((o) => o.id !== p.id);
      const def = (st, me, list) => list.slice().sort((a, b) => a.vp - b.vp || a.tg - b.tg)[0];
      let pick = await ask(agent, 'chooseTradePartner', def, state, p, others, 2);
      if (!others.includes(pick)) pick = def(state, p, others);
      p.tokens.strategy--; p.exhausted.production_biomes = true;
      p.tg += 4; if (pick) pick.tg += 2;
      TI.log(state, `${p.name} uses Production Biomes: +4 trade goods${pick ? `, ${pick.name} gains 2` : ''}.`);
    }
  };

  // ---- Hacan: Quantum Datahub Node (end of the strategy phase) -------------------------
  TI.afterStrategyPhase = async function (state, agents) {
    for (const p of state.players) {
      if (!TI.hasTechEffect(p, 'datahub') || p.exhausted.datahub || p.tokens.strategy < 1 || p.tg < 3 || !p.cards.length) continue;
      const def = (st, me) => {
        let best = null;
        const mineWorst = me.cards.slice().sort((a, b) => cardValue[a] - cardValue[b])[0];
        for (const o of st.players) {
          if (o.id === me.id) continue;
          for (const c of o.cards) if (!best || cardValue[c] > cardValue[best]) best = c;
        }
        return best && cardValue[best] - cardValue[mineWorst] >= 3 ? { take: best, give: mineWorst } : null;
      };
      const choice = await ask(agents[p.id], 'chooseDatahub', def, state, p);
      if (!choice) continue;
      const other = state.players.find((o) => o.id !== p.id && o.cards.includes(choice.take));
      if (!other || !p.cards.includes(choice.give)) continue;
      p.tokens.strategy--; p.tg -= 3; other.tg += 3;
      p.cards[p.cards.indexOf(choice.give)] = choice.take;
      other.cards[other.cards.indexOf(choice.take)] = choice.give;
      state.cards.find((c) => c.id === choice.take).owner = p.id;
      state.cards.find((c) => c.id === choice.give).owner = other.id;
      TI.log(state, `${p.name} uses Quantum Datahub Node: swaps ${TI.STRATEGY_CARDS[choice.give - 1].name} for ${other.name}'s ${TI.STRATEGY_CARDS[choice.take - 1].name} (+3 trade goods to ${other.name}).`);
    }
  };

  // ---- status phase ------------------------------------------------------------------------
  // Sol's Genesis flagship places 1 infantry in its space area at the end of the status phase.
  TI.statusAbilities = function (state) {
    for (const p of state.players) {
      if (!p.stats.flagship.statusInfantry) continue;
      for (const id of state.map.order) {
        const sys = state.map.systems[id], ships = sys.ships[p.id] || [];
        if (!ships.some((u) => u.type === 'flagship')) continue;
        const used = ships.filter((u) => u.type === 'fighter').length + TI.cargoOf(sys, p.id).length;
        if (used < TI.cargoCapacity(p, ships)) { TI.cargoOf(sys, p.id).push(TI.makeUnit('infantry')); TI.log(state, `${p.name}'s Genesis gains an infantry at ${id}.`); }
      }
    }
  };

  // ---- Xxcha: Peace Accords ---------------------------------------------------------------
  TI.peaceAccordsOptions = function (state, p) {
    const S = state.map.systems, mine = new Set(TI.planetsOwned(state, p).map((pl) => pl.systemId));
    const out = [];
    for (const id of state.map.order) {
      if (id === '0,0' || !S[id].adj.some((n) => mine.has(n))) continue;
      for (const pl of S[id].planets) {
        if (pl.owner === p.id || pl.ground.length || pl.dock || pl.pds) continue;
        out.push(Object.assign(pl, { systemId: id }));
      }
    }
    return out;
  };
  TI.peaceAccords = async function (state, agents, p) {
    if (!TI.faction(p).ability.peaceAccords) return;
    const options = TI.peaceAccordsOptions(state, p);
    if (!options.length) return;
    const def = (st, me, list) => list.slice().sort((a, b) => (b.res + b.inf) - (a.res + a.inf))[0];
    const pick = await ask(agents[p.id], 'choosePeaceAccords', def, state, p, options);
    if (!pick || !options.includes(pick)) return;
    const was = pick.owner !== null ? state.players[pick.owner] : null;
    pick.owner = p.id; pick.exhausted = true;
    if (TI.onPlanetControl) TI.onPlanetControl(state, pick, pick.systemId || state.map.order.find((id) => state.map.systems[id].planets.includes(pick)), p, was);
    TI.log(state, `${p.name} uses Peace Accords to take ${pick.name}.`);
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
