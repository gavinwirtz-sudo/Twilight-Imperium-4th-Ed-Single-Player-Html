// Abilities of the eleven later factions (Arborec, Saar, Muaat, Creuss, L1Z1X, Mentak, Naalu, Nekro, Winnu, Yin, Yssaril).
// Loaded after abilities.js / agenda.js / trade.js: it adds hooks and wraps a few functions rather than editing their bodies.
(function (root) {
  const TI = (root.TI = root.TI || {});
  const ask = async (agent, name, def, ...args) => (agent && agent[name] ? agent[name](...args) : def(...args));
  const ab = (p) => TI.faction(p).ability;
  const S = (state) => state.map.systems;
  const homeSys = (state, p) => state.map.order.find((id) => S(state)[id].home === p.id);
  const unitCost = (u) => TI.UNITS[u.type].cost / TI.UNITS[u.type].batch;
  // Valefactor Assimilator: Nekro may use other factions' faction technologies, so only base techs need the usual faction check.
  const copyable = (p, t) => !p.techs.includes(t) && (ab(p).techSingularity || TI.techAllowed(p, t));
  const isNonFighter = (u) => u.type !== 'fighter';

  // ---- game setup ---------------------------------------------------------------------------------
  TI.setupFactions = function (state) {
    for (const p of state.players) {
      if (!ab(p).creussHome) continue;
      S(state)[homeSys(state, p)].delta = true;          // the Creuss wormhole token starts on the home system
    }
    TI.buildAdjacency(state.map);
  };

  // ---- combat sides --------------------------------------------------------------------------------
  TI.combatSide2 = function (state, player, kind, sysId, side) {
    if (kind !== 'space') return;
    const a = ab(player), fl = player.stats.flagship;
    const ships = () => (sysId && S(state)[sysId] ? S(state)[sysId].ships[player.id] || [] : []);
    const foeNonFighters = () => state.players.reduce((n, o) => (o.id === player.id || !sysId ? n : n + (S(state)[sysId].ships[o.id] || []).filter(isNonFighter).length), 0);
    // L1Z1X 0.0.1: its hits (approximated as all of the side's hits) go to non-fighter ships first.
    if (fl.nonFighterHits) Object.defineProperty(side, 'nonFighterHits', { get: () => ships().some((u) => u.type === 'flagship') });
    // Winnu Salai Sai Corian: one die per non-fighter ship the opponent has here.
    if (fl.diceOpp) side.diceFor = (u, s) => (u.type === 'flagship' ? foeNonFighters() : s.dice);

    // Pre-combat hits: Mentak Ambush, Yin Impulse Core, Creuss Dimensional Splicer.
    const impulse = TI.hasTechEffect(player, 'impulse'), splicer = TI.hasTechEffect(player, 'splicer');
    if (a.ambush || impulse || splicer) {
      if (impulse) side.preHitsNonFighter = true;
      side.preHits = (own, foe, rng, ownStats) => {
        let hits = 0;
        if (a.ambush) {
          const rollers = own.filter((u) => u.type === 'cruiser' || u.type === 'destroyer').slice(0, 2);
          for (const u of rollers) if (rng.d10() >= ownStats[u.type].combat) hits++;
          if (rollers.length) TI.log(state, `${player.name}'s Ambush scores ${hits} hit${hits === 1 ? '' : 's'}.`);
        }
        if (impulse) {
          const cands = own.filter((u) => u.type === 'cruiser' || u.type === 'destroyer').sort((x, y) => unitCost(x) - unitCost(y));
          const worth = foe.some((u) => isNonFighter(u) && unitCost(u) >= 2);
          if (cands.length && own.length > 1 && worth) {
            own.splice(own.indexOf(cands[0]), 1); hits++;
            TI.log(state, `${player.name}'s Impulse Core destroys a ${cands[0].type} to produce 1 hit.`);
          }
        }
        if (splicer && own.length && sysId && (S(state)[sysId].wormhole || S(state)[sysId].delta)) {
          hits++; TI.log(state, `${player.name}'s Dimensional Splicer produces 1 hit.`);
        }
        return hits;
      };
    }

    // Yin Devotion: after a round, sacrifice a cruiser or destroyer for a hit when that kills something worth the price.
    if (a.devotion) {
      const prev = side.afterRound;
      side.afterRound = (force, other, otherStats) => {
        if (prev) prev(force, other, otherStats);
        const cands = force.filter((u) => u.type === 'cruiser' || u.type === 'destroyer').sort((x, y) => unitCost(x) - unitCost(y));
        if (!cands.length || !other.length || force.length < 2) return;
        const target = other.filter(isNonFighter).sort((x, y) => unitCost(y) - unitCost(x))[0];
        if (!target || unitCost(target) < unitCost(cands[0]) || (target.damaged === false && TI.UNITS[target.type].sustain && unitCost(target) < 4)) return;
        force.splice(force.indexOf(cands[0]), 1);
        if (!target.damaged && otherStats[target.type].sustain) target.damaged = true; else if (other.includes(target)) other.splice(other.indexOf(target), 1);
        TI.log(state, `${player.name}'s Devotion: a ${cands[0].type} is sacrificed for a hit on a ${target.type}.`);
      };
    }
  };

  // After a space combat: Mentak's Salvage Operations pays a trade good.
  TI.afterSpaceCombat = function (state, attacker, def) {
    for (const p of [attacker, def]) {
      if (p && TI.hasTechEffect(p, 'salvage')) { p.tg++; TI.log(state, `${p.name}'s Salvage Operations gain 1 trade good.`); }
    }
  };

  // Dock-less production offered through an agent: Arborec flagship (up to 5 units here) and Salvage Operations (1 ship).
  const specialProduce = async (state, agents, p, sysId, opts) => {
    opts = Object.assign({ noDock: true }, opts);
    const order = ((await ask(agents[p.id], 'chooseProduction', () => [], state, p, sysId, opts)) || []);
    const built = TI.produce(state, p, sysId, order, Object.assign({ noDock: true }, opts));
    if (built.length) TI.log(state, `${p.name}'s ${opts.why} produces ${built.map((u) => u.type).join(', ')} in ${sysId}.`);
    return built;
  };
  // Duha Menaimon: after you activate the flagship's system, produce up to 5 units there.
  TI.flagshipProduction = async function (state, agents, p, sysId) {
    if (!p.stats.flagship.production) return;
    if (!(S(state)[sysId].ships[p.id] || []).some((u) => u.type === 'flagship')) return;
    if (!S(state)[sysId].planets.some((pl) => pl.owner === p.id) && !p.stats.flagship.production) return;
    await specialProduce(state, agents, p, sysId, { limit: p.stats.flagship.production, why: 'Duha Menaimon' });
  };
  // Salvage Operations: after winning a space combat, produce 1 ship of a type destroyed in it.
  TI.afterSpaceAsync = async function (state, agents, attacker, sysId, result) {
    TI.syncFlagDelta(state);
    const def = result.defenderId !== undefined ? state.players.find((x) => x.id === result.defenderId) : null;
    for (const who of [attacker, def]) {
      if (!who || !TI.hasTechEffect(who, 'salvage')) continue;
      const won = (who === attacker) === (result.winner === 'attacker');
      if (!won || result.winner === 'draw' || !(S(state)[sysId].ships[who.id] || []).length) continue;
      const types = [...new Set(result.lost.filter((t) => TI.UNITS[t] && !['fighter'].includes(t)))];
      if (types.length) await specialProduce(state, agents, who, sysId, { limit: 1, types, why: 'Salvage Operations', salvage: true });
    }
  };

  // ---- production hooks --------------------------------------------------------------------------------
  TI.afterProduce = function (state, p, sysId, built, dockPlanet) {
    if (built.some((u) => u.type === 'flagship')) TI.syncFlagDelta(state);
    const sys = S(state)[sysId];
    if (TI.hasTechEffect(p, 'spinner')) {
      const pl = dockPlanet && dockPlanet.owner === p.id ? dockPlanet : sys.planets.find((x) => x.owner === p.id);
      if (pl) { pl.ground.push(TI.makeUnit('infantry')); TI.log(state, `${p.name}'s Yin Spinner places an infantry on ${pl.name}.`); }
    }
    if (TI.hasTechEffect(p, 'magmus')) {
      const warsun = (sys.ships[p.id] || []).some((u) => u.type === 'warsun');
      const nearSuper = sys.anomaly === 'supernova' || sys.adj.some((id) => S(state)[id].anomaly === 'supernova');
      if (warsun || nearSuper) { p.tg++; TI.log(state, `${p.name}'s Magmus Reactor gains 1 trade good.`); }
    }
  };

  // ---- planets gained / combats won ---------------------------------------------------------------------
  const basePlanetControl = TI.onPlanetControl;
  TI.onPlanetControl = function (state, planet, sysId, newOwner, oldOwner) {
    const a = ab(newOwner);
    if (a.scavenge) { newOwner.tg++; TI.log(state, `${newOwner.name} scavenges 1 trade good from ${planet.name}.`); }
    if (a.reclamation && planet.mecatol) {
      const pds = TI.structureCount(state, newOwner, 'pds'), docks = TI.structureCount(state, newOwner, 'dock');
      let placed = [];
      if (!planet.dock && docks < TI.UNIT_LIMITS.dock) { planet.dock = true; placed.push('a space dock'); }
      if (pds < TI.UNIT_LIMITS.pds) { planet.pds = (planet.pds || 0) + 1; placed.push('a PDS'); }
      if (placed.length) TI.log(state, `${newOwner.name}'s Reclamation places ${placed.join(' and ')} on Mecatol Rex.`);
    }
    return basePlanetControl ? basePlanetControl.apply(this, arguments) : undefined;
  };

  // Nekro Technology Singularity (approximated): winning a combat in which Nekro killed something steals a technology.
  const baseWon = TI.onCombatWon;
  TI.onCombatWon = function (state, winner, loser) {
    if (winner && loser && ab(winner).techSingularity) {
      const pool = loser.techs.filter((t) => !winner.techs.includes(t) && copyable(winner, t));
      if (pool.length) {
        const t = pool[state.rng.int(pool.length)];
        winner.techs.push(t); TI.refreshStats(winner);
        TI.log(state, `${winner.name}'s Technology Singularity takes ${TI.TECHS[t].name} from ${loser.name}.`);
      }
    }
    return baseWon ? baseWon.apply(this, arguments) : undefined;
  };

  // Yin Indoctrination: 2 influence converts one of the opponent's infantry (used whenever it can be paid).
  TI.indoctrinate = function (state, yin, mine, theirs) {
    const i = theirs.findIndex((u) => u.type === 'infantry');
    if (i < 0 || mine.length === 0 || TI.available(state, yin).inf + yin.tg < 3) return;   // keep a little influence in reserve
    if (!TI.pay(state, yin, 2, 'inf')) return;
    theirs.splice(i, 1); mine.push(TI.makeUnit('infantry'));
    TI.log(state, `${yin.name}'s Indoctrination converts an enemy infantry.`);
  };

  // ---- activation reactions: Naalu Neuroglaive and Foresight -------------------------------------------------
  TI.onActivated2 = async function (state, agents, p, sysId, holders) {
    for (const o of holders) {
      if (TI.hasTechEffect(o, 'neuroglaive') && p.tokens.fleet > 0) { p.tokens.fleet--; TI.log(state, `${o.name}'s Neuroglaive: ${p.name} loses a fleet token.`); }
    }
  };
  // Systems a Naalu fleet could slip into: adjacent, no other player's ships, not a hazard.
  const foresightTargets = (state, o, sysId) => S(state)[sysId].adj.filter((id) => {
    const t = S(state)[id];
    if (t.anomaly === 'supernova' || t.anomaly === 'asteroid' || t.anomaly === 'rift') return false;
    return !state.players.some((q) => q.id !== o.id && (t.ships[q.id] || []).length);
  });
  TI.afterMovement = async function (state, agents, p, sysId) {
    TI.syncFlagDelta(state);
    for (const o of state.players) {
      if (o.id === p.id || !ab(o).foresight || o.tokens.strategy < 1) continue;
      const sys = S(state)[sysId], mine = sys.ships[o.id] || [];
      if (!mine.length) continue;
      const options = foresightTargets(state, o, sysId);
      if (!options.length) continue;
      const def = (st, me, opts) => {
        const theirs = (sys.ships[p.id] || []);
        const strength = (arr) => arr.reduce((n, u) => n + unitCost(u), 0);
        return strength(theirs) > strength(mine) * 1.2 ? opts[0] : null;
      };
      const dest = await ask(agents[o.id], 'chooseForesight', def, state, o, p, sysId, options);
      if (!dest || !options.includes(dest)) continue;
      o.tokens.strategy--;
      const to = S(state)[dest];
      to.ships[o.id] = (to.ships[o.id] || []).concat(mine);
      sys.ships[o.id] = [];
      const cargo = TI.cargoOf(sys, o.id).splice(0);
      TI.cargoOf(to, o.id).push(...cargo);
      TI.log(state, `${o.name} uses Foresight: its fleet slips from ${sysId} to ${dest}.`);
    }
  };

  // ---- status phase: Arborec Mitosis, Creuss Wormhole Generator ---------------------------------------------
  const baseStatus = TI.statusAbilities;
  TI.statusAbilities = function (state) {
    if (baseStatus) baseStatus(state);
    for (const p of state.players) {
      if (ab(p).mitosis) {
        const planets = TI.planetsOwned(state, p).sort((x, y) => x.ground.length - y.ground.length || (y.res + y.inf) - (x.res + x.inf));
        if (planets[0]) { planets[0].ground.push(TI.makeUnit('infantry')); TI.log(state, `${p.name}'s Mitosis places an infantry on ${planets[0].name}.`); }
      }
      if (TI.hasTechEffect(p, 'wormholeGen')) TI.moveDelta(state, p);
    }
  };
  // Put the Delta wormhole token on a good system: a planet system of ours, otherwise an empty non-home system next to one.
  TI.moveDelta = function (state, p) {
    const here = state.map.order.filter((id) => S(state)[id].delta);
    const ok = (id) => id !== '0,0' && (S(state)[id].planets.some((x) => x.owner === p.id) || (S(state)[id].home === null && !state.players.some((q) => q.id !== p.id && (S(state)[id].ships[q.id] || []).length)));
    const mine = state.map.order.filter((id) => S(state)[id].planets.some((x) => x.owner === p.id) && !S(state)[id].home);
    const pick = mine.find((id) => !here.includes(id)) || state.map.order.find((id) => ok(id) && !here.includes(id) && !S(state)[id].wormhole);
    if (!pick) return;
    const home = homeSys(state, p);
    const old = here.filter((id) => id !== home);               // the home token stays; the generator's token moves
    for (const id of old) S(state)[id].delta = false;
    S(state)[pick].delta = true;
    TI.buildAdjacency(state.map);
    TI.log(state, `${p.name}'s Wormhole Generator places the Delta wormhole in ${pick}.`);
  };

  // Creuss flagship: its system counts as holding a Delta wormhole. Refreshed whenever it may have moved or died.
  TI.syncFlagDelta = function (state) {
    let changed = false;
    for (const id of state.map.order) {
      const sys = S(state)[id];
      const on = state.players.some((p) => p.stats.flagship && p.stats.flagship.wormhole && (sys.ships[p.id] || []).some((u) => u.type === 'flagship'));
      if (!!sys.flagDelta !== on) { sys.flagDelta = on; changed = true; }
    }
    if (changed) TI.buildAdjacency(state.map);
  };

  // Arborec Bioplasmosis: at the end of the status phase, shuffle infantry between your planets in the same or adjacent systems.
  // The default (bots) pulls spare infantry off safe planets onto the planet nearest an enemy.
  const bioPlan = (state, p) => {
    const mine = []; for (const id of state.map.order) S(state)[id].planets.forEach((pl) => { if (pl.owner === p.id) mine.push({ id, pl }); });
    const danger = (id) => S(state)[id].adj.concat([id]).reduce((n, k) => n + state.players.reduce((m, o) => m + (o.id === p.id ? 0 : (S(state)[k].ships[o.id] || []).length), 0), 0);
    const moves = [];
    const target = mine.slice().sort((x, y) => danger(y.id) - danger(x.id) || y.pl.ground.length - x.pl.ground.length)[0];
    if (!target || danger(target.id) === 0) return moves;
    for (const m of mine) {
      if (m.pl === target.pl || m.pl.ground.length < 2 || danger(m.id) >= danger(target.id)) continue;
      if (m.id !== target.id && !S(state)[m.id].adj.includes(target.id)) continue;
      moves.push({ from: m.pl, to: target.pl, n: m.pl.ground.filter((u) => u.type === 'infantry').length - 1 });
    }
    return moves.filter((x) => x.n > 0);
  };
  TI.endOfStatus = async function (state, agents) {
    for (const p of state.players) {
      if (!TI.hasTechEffect(p, 'bioplasmosis')) continue;
      const moves = bioPlan(state, p);
      if (!moves.length) continue;
      const yes = await ask(agents[p.id], 'wantBioplasmosis', () => true, state, p, moves);
      if (!yes) continue;
      let total = 0;
      for (const m of moves) for (let i = 0; i < m.n; i++) {
        const k = m.from.ground.findIndex((u) => u.type === 'infantry');
        if (k < 0) break;
        m.to.ground.push(m.from.ground.splice(k, 1)[0]); total++;
      }
      if (total) TI.log(state, `${p.name}'s Bioplasmosis moves ${total} infantry to ${moves[0].to.name}.`);
    }
  };
  TI.bioplasmosisPlan = bioPlan;

  // Nekro Galactic Threat: you never vote, but may predict the outcome and take a technology from a player who voted that way.
  TI.nekroPredict = async function (state, agents, ctx) {
    for (const p of state.players) {
      if (!ab(p).noVote || !ctx.outcomes.length) continue;
      const guess = TI.predictOutcome(state, ctx, p.id);
      const def = () => (guess && ctx.outcomes.find((o) => o.key === guess.key)) || null;
      const pick = await ask(agents[p.id], 'chooseThreat', def, state, p, ctx);
      const o = pick && ctx.outcomes.find((x) => x.key === pick.key);
      if (!o) continue;
      ctx.predictions.push({ pid: p.id, key: o.key, name: 'Galactic Threat', threat: true });
      TI.log(state, `${p.name} predicts: ${o.label}.`);
    }
  };
  TI.threatReward = function (state, p, ctx, key) {
    const donors = state.players.filter((o) => o.id !== p.id && ctx.votes[o.id] && ctx.votes[o.id].key === key);
    const pool = [];
    for (const o of donors) for (const t of o.techs) if (copyable(p, t)) pool.push(t);
    if (!pool.length) { TI.log(state, `${p.name} finds no technology to take.`); return; }
    const t = pool[state.rng.int(pool.length)];
    p.techs.push(t); TI.refreshStats(p);
    TI.log(state, `${p.name} takes ${TI.TECHS[t].name} (Galactic Threat).`);
  };

  // ---- Naalu: strategy-card initiative is handled in TI.initiative; Nekro: Propagation ---------------------------
  // (see cards.js research: a faction with 'propagation' gains 3 command tokens instead of a technology)

  // ---- start of turn: Saar Chaos Mapping ------------------------------------------------------------------------
  const baseNegotiate = TI.negotiate;
  TI.negotiate = async function (state, agents, p) {
    if (baseNegotiate) await baseNegotiate(state, agents, p);
    if (TI.hasTechEffect(p, 'chaos')) {
      const sysId = state.map.order.find((id) => S(state)[id].planets.some((pl) => pl.owner === p.id && pl.dock && !pl.holy)
        && !state.players.some((q) => q.id !== p.id && (S(state)[id].ships[q.id] || []).length));
      if (sysId) {
        const order = ((await agents[p.id].chooseProduction(state, p, sysId)) || []).slice(0, 1);
        const built = order.length ? TI.produce(state, p, sysId, order) : [];
        if (built.length) TI.log(state, `${p.name}'s Chaos Mapping produces ${built.map((u) => u.type).join(', ')} at ${sysId}.`);
      }
    }
  };

  // ---- Yssaril: Scheming / Crafty ---------------------------------------------------------------------------------
  const baseDraw = TI.drawActionCards;
  TI.drawActionCards = async function (state, agents, p, n, why) {
    const a = ab(p);
    if (!a.scheming && !a.crafty) return baseDraw.apply(this, arguments);
    const old = TI.HAND_LIMIT;
    if (a.crafty) TI.HAND_LIMIT = 999;
    try {
      const got = await baseDraw.call(this, state, agents, p, n > 0 && a.scheming ? n + 1 : n, why);
      if (a.scheming && n > 0 && p.hand.length) {
        const agent = agents && agents[p.id];
        let pick = agent && agent.chooseActionDiscard ? await agent.chooseActionDiscard(state, p) : null;
        if (!p.hand.includes(pick)) pick = p.hand.slice().sort((x, y) => (TI.ACTION_BY_ID[x].weight || 1) - (TI.ACTION_BY_ID[y].weight || 1))[0];
        TI.discardActionCard(state, p, pick);
        TI.log(state, `${p.name} discards an action card (Scheming).`);
      }
      return got;
    } finally { TI.HAND_LIMIT = old; }
  };

  // ---- component actions ------------------------------------------------------------------------------------------
  const baseActions = TI.factionActions;
  TI.factionActions = function (state, p) {
    const out = baseActions(state, p);
    const a = ab(p);
    if (a.starForge) {
      out.push({ id: 'star_forge', label: 'Star Forge', sub: 'Spend 1 strategy token: place 2 fighters or 1 destroyer in a system with one of your war suns.',
                 ok: p.tokens.strategy >= 1 && state.map.order.some((id) => (S(state)[id].ships[p.id] || []).some((u) => u.type === 'warsun')) });
    }
    if (p.stats.flagship.inferno) {
      out.push({ id: 'inferno', label: 'The Inferno', sub: 'Spend 1 strategy token: place 1 cruiser in the system with your flagship.',
                 ok: p.tokens.strategy >= 1 && TI.countShips(state, p, ['flagship']) > 0 });
    }
    if (a.stallTactics) {
      out.push({ id: 'stall_tactics', label: 'Stall Tactics', sub: 'Discard 1 action card from your hand.', ok: p.hand.length > 0, bot: false });
    }
    if (TI.hasTechEffect(p, 'mageon')) {
      out.push({ id: 'mageon_implants', label: 'Mageon Implants', sub: 'Exhaust: look at another player\'s action cards and take 1.',
                 ok: !p.exhausted.mageon_implants && state.players.some((o) => o.id !== p.id && o.hand.length) });
    }
    if (TI.hasTechEffect(p, 'lazax')) {
      const mec = S(state)['0,0'].planets[0];
      out.push({ id: 'lazax_gate_folding', label: 'Lazax Gate Folding', sub: 'Exhaust: place 1 infantry on Mecatol Rex (you must control it).',
                 ok: !p.exhausted.lazax_gate_folding && mec.owner === p.id });
    }
    return out;
  };

  const placeShips = (state, p, sysId, types) => {
    const sys = S(state)[sysId], mine = sys.ships[p.id] || (sys.ships[p.id] = []);
    const placed = [];
    for (const t of types) {
      if (TI.unitsLeft(state, p, t) < 1) break;
      if (t !== 'fighter' && mine.filter(isNonFighter).length + 1 > TI.fleetLimit(p)) break;
      const u = TI.makeUnit(t); mine.push(u); placed.push(u);
    }
    return placed;
  };
  const baseRun = TI.runFactionAction;
  TI.runFactionAction = async function (state, agents, p, id) {
    const ownIds = ['star_forge', 'inferno', 'stall_tactics', 'mageon_implants', 'lazax_gate_folding'];
    if (!ownIds.includes(id)) return baseRun.apply(this, arguments);
    if (id === 'star_forge') {
      const sysId = state.map.order.filter((x) => (S(state)[x].ships[p.id] || []).some((u) => u.type === 'warsun'))
        .sort((x, y) => state.players.filter((o) => o.id !== p.id && (S(state)[x].ships[o.id] || []).length).length - state.players.filter((o) => o.id !== p.id && (S(state)[y].ships[o.id] || []).length).length)[0];
      if (!sysId) return;
      const room = TI.fleetLimit(p) - (S(state)[sysId].ships[p.id] || []).filter(isNonFighter).length;
      const types = room > 0 && TI.unitsLeft(state, p, 'destroyer') > 0 ? ['destroyer'] : ['fighter', 'fighter'];
      p.tokens.strategy--;
      const got = placeShips(state, p, sysId, types);
      TI.log(state, `${p.name} uses Star Forge: ${got.length ? got.map((u) => u.type).join(' + ') : 'nothing'} appear${got.length === 1 ? 's' : ''} at ${sysId}.`);
    } else if (id === 'inferno') {
      const sysId = state.map.order.find((x) => (S(state)[x].ships[p.id] || []).some((u) => u.type === 'flagship'));
      if (!sysId) return;
      p.tokens.strategy--;
      const got = placeShips(state, p, sysId, ['cruiser']);
      TI.log(state, `${p.name}'s Inferno forges ${got.length ? 'a cruiser' : 'nothing (no room or no cruisers left)'} at ${sysId}.`);
    } else if (id === 'stall_tactics') {
      const agent = agents[p.id];
      let pick = agent && agent.chooseActionDiscard ? await agent.chooseActionDiscard(state, p) : null;
      if (!p.hand.includes(pick)) pick = p.hand.slice().sort((x, y) => (TI.ACTION_BY_ID[x].weight || 1) - (TI.ACTION_BY_ID[y].weight || 1))[0];
      TI.discardActionCard(state, p, pick);
      TI.log(state, `${p.name} uses Stall Tactics and discards an action card.`);
    } else if (id === 'mageon_implants') {
      const victims = state.players.filter((o) => o.id !== p.id && o.hand.length).sort((x, y) => y.hand.length - x.hand.length);
      const o = victims[0]; if (!o) return;
      const best = o.hand.slice().sort((x, y) => (TI.ACTION_BY_ID[y].weight || 1) - (TI.ACTION_BY_ID[x].weight || 1))[0];
      o.hand.splice(o.hand.indexOf(best), 1); p.hand.push(best);
      p.exhausted.mageon_implants = true;
      TI.log(state, `${p.name} uses Mageon Implants and takes an action card from ${o.name}.`);
    } else if (id === 'lazax_gate_folding') {
      const mec = S(state)['0,0'].planets[0];
      if (mec.owner !== p.id) return;
      p.exhausted.lazax_gate_folding = true;
      mec.ground.push(TI.makeUnit('infantry'));
      TI.log(state, `${p.name} uses Lazax Gate Folding: 1 infantry lands on Mecatol Rex.`);
    }
  };

  // ---- Mentak Pillage --------------------------------------------------------------------------------------------
  TI.pillage = function (state, victim) {
    if (victim.tg < 3) return;
    for (const m of state.players) {
      if (m.id === victim.id || !ab(m).pillage || victim.tg < 3) continue;
      if (!TI.neighbors(state, m).some((o) => o.id === victim.id)) continue;
      victim.tg--; m.tg++;
      TI.log(state, `${m.name} pillages 1 trade good from ${victim.name}.`);
    }
  };
  const baseTx = TI.onTransaction;
  TI.onTransaction = function (state, from, to, offer) {
    if (baseTx) baseTx(state, from, to, offer);
    for (const v of [from, to]) {
      if (v.tg < 3) continue;
      for (const m of state.players) {
        if (m.id === from.id || m.id === to.id || !ab(m).pillage || v.tg < 3) continue;
        if (!TI.neighbors(state, m).some((o) => o.id === v.id)) continue;
        v.tg--; m.tg++;
        TI.log(state, `${m.name} pillages 1 trade good from ${v.name}.`);
      }
    }
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
