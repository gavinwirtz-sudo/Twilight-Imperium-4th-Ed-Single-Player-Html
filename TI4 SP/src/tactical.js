// Resolving a tactical action after movement: space cannon, space combat, invasion, production.
(function (root) {
  const TI = (root.TI = root.TI || {});

  // A space battle in a nebula gives the defender +1 on every combat roll (rule 50.3).
  // Mentak's Fourth Moon: other players' ships in its system cannot use Sustain Damage (stats copy for that fight).
  const noSustainCopy = (stats) => { const c = {}; for (const k of Object.keys(stats)) c[k] = Object.assign({}, stats[k], stats[k].type === 'ship' ? { sustain: false } : {}); return c; };
  const spaceMods = (state, atk, def, sysId) => {
    const hasFM = (pl) => pl && pl.stats.flagship.noEnemySustain && (state.map.systems[sysId].ships[pl.id] || []).some((u) => u.type === 'flagship');
    return {
      attacker: 0, defender: sysId && state.map.systems[sysId].anomaly === 'nebula' ? 1 : 0,
      attackerStats: hasFM(def) ? noSustainCopy(atk.stats) : atk.stats, defenderStats: def ? (hasFM(atk) ? noSustainCopy(def.stats) : def.stats) : null,
      attackerSide: TI.combatSide(state, atk, 'space', sysId),
      defenderSide: def ? TI.combatSide(state, def, 'space', sysId) : null,
    };
  };

  // Ground forces aboard ships that no longer have room (or ships) are lost.
  const trimCargo = (state, attacker, sys) => {
    const cargo = TI.cargoOf(sys, attacker.id), mine = sys.ships[attacker.id] || [];
    if (!mine.length) { cargo.length = 0; return; }
    // Fighter II fighters travel on their own, so they do not take up room needed by ground forces.
    const room = TI.cargoCapacity(attacker, mine) - (attacker.stats.fighter.move > 0 ? 0 : mine.filter((u) => u.type === 'fighter').length);
    if (cargo.length > room) cargo.length = Math.max(0, room);
  };

  TI.trimCargo = trimCargo;
  // Ground forces in a space area need ships of their own: whoever lost their ships there loses the cargo too.
  TI.trimAllCargo = (state, sys) => { for (const p of state.players) trimCargo(state, p, sys); };

  // The other player (if any) with ships in the system.
  TI.defenderIn = function (state, sysId, attackerId) {
    const sys = state.map.systems[sysId];
    for (const p of state.players) if (p.id !== attackerId && (sys.ships[p.id] || []).length) return p;
    return null;
  };

  // ---- retreats (rules 67.5-67.7) ----------------------------------------------------------
  // Systems a player's ships may retreat to from sysId: adjacent, holding one of their units or a planet they control,
  // and free of other players' ships.
  TI.retreatOptions = function (state, player, sysId) {
    const S = state.map.systems;
    return S[sysId].adj.filter((id) => {
      const t = S[id];
      if (TI.hasOtherShips(t, player.id)) return false;
      return (t.ships[player.id] || []).length > 0 || TI.cargoOf(t, player.id).length > 0 || t.planets.some((pl) => pl.owner === player.id);
    });
  };

  // Move a retreating player's ships (and the cargo they can carry) to `destId`, placing a command token there.
  function doRetreat(state, player, sysId, destId) {
    const S = state.map.systems, from = S[sysId], dest = S[destId];
    const ships = from.ships[player.id] || [], cargo = TI.cargoOf(from, player.id);
    const room = TI.cargoCapacity(player, ships) - (player.stats.fighter.move > 0 ? 0 : ships.filter((u) => u.type === 'fighter').length);
    from.ships[player.id] = [];
    if (cargo.length) from.cargo[player.id] = [];
    (dest.ships[player.id] = dest.ships[player.id] || []).push(...ships);
    const keep = cargo.slice(0, Math.max(0, room));
    if (keep.length) { dest.cargo = dest.cargo || {}; (dest.cargo[player.id] = dest.cargo[player.id] || []).push(...keep); }
    const tokens = TI.tokensOn(dest);
    if (!tokens.includes(player.id)) tokens.push(player.id);
    // Fleet pool: excess ships at the destination are removed (cheapest first).
    const limit = TI.fleetLimit(player);
    const mine = dest.ships[player.id];
    while (mine.filter((u) => u.type !== 'fighter').length > limit) {
      const i = mine.reduce((best, u, k) => (u.type !== 'fighter' && (best < 0 || player.stats[u.type].cost < player.stats[mine[best].type].cost) ? k : best), -1);
      mine.splice(i, 1);
    }
    trimCargo(state, player, dest);
    TI.log(state, `${player.name} retreats from ${sysId} to ${destId}.`);
  }

  TI.doRetreat = (state, player, sysId, destId) => doRetreat(state, player, sysId, destId);

  // The whole space step as a generator so it can be driven synchronously (tests, no retreat offers) or
  // asynchronously (the game, where agents decide on retreats). It yields { player, sysId, options, mine, theirs }
  // before each round and expects a destination system id (retreat) or null (keep fighting).
  function* spaceFlow(state, attacker, sysId) {
    const sys = state.map.systems[sysId];
    const mine = sys.ships[attacker.id] || (sys.ships[attacker.id] = []);
    const isBig = (u) => u.type === 'warsun' || u.type === 'flagship';
    const mostVP = (pl) => state.players.every((o) => o.vp <= pl.vp);   // tied for the lead counts
    // Space cannon offense: defending PDS and cannon flagships fire at the arriving fleet.
    const arrived = mine.slice();
    if (yield* TI.cannonFlow(state, attacker, sysId)) {
      trimCargo(state, attacker, sys);
      // Secret objectives: "Turn Their Fleets to Dust" (last ships destroyed by Space Cannon) and "Destroy Their Greatest Ship".
      const killers = state.players.filter((o) => o.id !== attacker.id && state.lastCannonBy && state.lastCannonBy.includes(o.id));
      if (!mine.length) for (const o of killers) TI.noteEvent(state, o.id, 'cannonWipe');
      if (arrived.some((u) => isBig(u) && !mine.includes(u))) for (const o of killers) TI.noteEvent(state, o.id, 'bigKill');
    }
    const def = TI.defenderIn(state, sysId, attacker.id);
    if (!def || !mine.length) return { fought: false };
    const theirs = sys.ships[def.id];
    const before = [mine.length, theirs.length];
    const mineBefore = mine.slice(), theirsBefore = theirs.slice();
    const ctx = TI.spaceCombatStart(mine, theirs, state.rng, spaceMods(state, attacker, def, sysId));
    ctx.buffs = [];
    let retreated = null, endedByCard = false;
    while (mine.length && theirs.length && ctx.log.rounds < 50) {
      const rd = ctx.log.rounds + 1;
      // "At the start of a combat round" action cards (Morale Boost, Skilled Retreat, Emergency Repairs, Fighter Prototype).
      const rc = { sysId, round: rd, attacker, defender: def, cx: ctx, ended: false, ground: false };
      yield { kind: 'cards', window: 'spaceRoundStart', ctx: rc, players: [attacker, def] };
      if (rc.ended) { endedByCard = true; break; }
      // Announce retreats: the defender first; if the defender announces, the attacker cannot.
      let dest = null, who = null;
      for (const [pl, side] of [[def, 'defender'], [attacker, 'attacker']]) {
        const options = TI.retreatOptions(state, pl, sysId);
        if (!options.length) continue;
        const foe = pl === def ? attacker : def;
        const choice = yield { kind: 'retreat', player: pl, sysId, options, mine: sys.ships[pl.id], theirs: sys.ships[foe.id], opponent: foe };
        if (choice && options.includes(choice)) {
          // Intercept: the opponent may stop this retreat for the round.
          const rr = { retreater: pl, other: foe, dest: choice, cancelled: false, sysId };
          yield { kind: 'cards', window: 'retreatDeclared', ctx: rr, players: [foe] };
          if (rr.cancelled) { TI.log(state, `${foe.name} stops ${pl.name}'s retreat.`); continue; }
          dest = choice; who = pl; break;
        }
      }
      // Round: both sides look at their units (roundStart), the dice fall, then each side may pick its own casualties.
      const em = TI.effectiveMods(ctx);
      yield { kind: 'roundStart', sysId, round: rd, attacker, defender: def, afb: ctx.log.afbKills, assaultCannon: ctx.log.assaultCannon,
              preview: { attacker: TI.combatPreview(mine, em.attackerStats, em.attacker, 'ship', em.attackerSide), defender: TI.combatPreview(theirs, em.defenderStats, em.defender, 'ship', em.defenderSide) },
              retreating: who ? who.id : null, buffs: (ctx.buffs || []).length };
      const roll = TI.spaceRoundRoll(ctx);
      yield { kind: 'cards', window: 'afterRoll', ctx: { roll, sysId, ground: false, sides: { attacker: { player: attacker, force: mine }, defender: { player: def, force: theirs } } }, players: [] };
      // Shields Holding: cancel hits before they are assigned.
      for (const [pl, side, foeSide] of [[def, 'defender', 'attacker'], [attacker, 'attacker', 'defender']]) {
        if (roll[foeSide].hits > 0) yield { kind: 'cards', window: 'beforeAssign', ctx: { player: pl, side, foeSide, hits: roll[foeSide].hits, roll, sysId }, players: [pl] };
      }
      const plans = {};
      for (const [pl, side] of [[def, 'defender'], [attacker, 'attacker']]) {
        const foeSide = side === 'defender' ? 'attacker' : 'defender';
        const plan = yield { kind: 'casualties', sysId, round: rd, player: pl, side, hits: roll[foeSide].hits, roll, attacker, defender: def,
                             force: sys.ships[pl.id], stats: side === 'attacker' ? attacker.stats : def.stats };
        if (Array.isArray(plan)) plans[side] = plan;
      }
      const hitsA = roll.attacker.hits, hitsD = roll.defender.hits;
      const snap = { mine: mine.slice(), theirs: theirs.slice(), dmgM: mine.filter((u) => u.damaged), dmgT: theirs.filter((u) => u.damaged) };
      TI.spaceRoundResolve(ctx, plans);
      TI.log(state, `  Round ${rd} at ${sysId}: ${attacker.name} scores ${hitsA} hit(s), ${def.name} scores ${hitsD}; ${attacker.name} has ${mine.length} ship(s) left, ${def.name} ${theirs.length}.`);
      // Reactions: Direct Hit on ships that sustained damage, Courageous to the End for ships that were destroyed.
      for (const [owner, foe, arr, before, dmgBefore] of [[attacker, def, mine, snap.mine, snap.dmgM], [def, attacker, theirs, snap.theirs, snap.dmgT]]) {
        const sustained = arr.filter((u) => u.damaged && !dmgBefore.includes(u));
        for (const u of sustained) {
          if (!arr.includes(u)) continue;
          yield { kind: 'cards', window: 'afterSustain', ctx: { unit: u, owner, by: foe, sysId, state }, players: [foe] };
        }
        const lost = before.filter((u) => !arr.includes(u));
        if (lost.length) yield { kind: 'cards', window: 'afterDestroyed', ctx: { owner, foe, units: lost, sysId, state }, players: [owner] };
      }
      // The retreat happens after hits
      // unless the opponent has no ships left (then the combat just ends).
      if (who && mine.length && theirs.length) { doRetreat(state, who, sysId, dest); retreated = who; break; }
    }
    const log = TI.spaceCombatFinish(ctx);
    if (endedByCard) log.winner = 'none';
    if (retreated) log.winner = retreated === attacker ? 'defender' : 'attacker';
    TI.trimAllCargo(state, sys);      // the defender's ground forces die with their ships too
    TI.log(state, `Space battle at ${sysId}: ${attacker.name} (${before[0]} ships) vs ${def.name} (${before[1]}) → ${retreated ? `${retreated.name} retreats; ${(retreated === attacker ? def : attacker).name} wins` : log.winner === 'attacker' ? attacker.name + ' wins' : log.winner === 'defender' ? def.name + ' wins' : 'draw'}.`);
    // Secret objectives that depend on this battle.
    if (theirsBefore.some((u) => isBig(u) && !theirs.includes(u) && !(retreated === def))) TI.noteEvent(state, attacker.id, 'bigKill');
    if (mineBefore.some((u) => isBig(u) && !mine.includes(u) && !(retreated === attacker))) TI.noteEvent(state, def.id, 'bigKill');
    const winner = log.winner === 'attacker' ? attacker : log.winner === 'defender' ? def : null;
    const loser = winner === attacker ? def : winner === def ? attacker : null;
    if (winner && loser) TI.onCombatWon(state, winner, loser);
    if (TI.afterSpaceCombat) TI.afterSpaceCombat(state, attacker, def, sysId, winner);
    if (winner) {
      if (mostVP(loser)) TI.noteEvent(state, winner.id, 'beatLeader');
      if ((sys.ships[winner.id] || []).some((u) => u.type === 'flagship')) TI.noteEvent(state, winner.id, 'flagshipWin');
    }
    const typesLost = (before, now) => before.filter((u) => !now.includes(u) && u.type !== 'fighter').map((u) => u.type);
    return { fought: true, attackerWon: log.winner === 'attacker', winner: log.winner, retreated: retreated ? retreated.id : null, defenderId: def.id,
             lost: typesLost(mineBefore, mine).concat(typesLost(theirsBefore, theirs)) };
  }

  // After ships arrive: PDS fire, then space combat. Synchronous version: nobody retreats. Returns { fought, attackerWon, winner }.
  TI.resolveSpace = function (state, attacker, sysId) {
    const g = spaceFlow(state, attacker, sysId);
    let r = g.next();
    while (!r.done) r = g.next(null);
    return r.value;
  };
  // Drive a combat generator, handing each question to the right agent: retreat offers, the "before the roll" screen
  // (combatRoundStart) and casualty choices (chooseCasualties). Agents without a hook get the automatic answer.
  async function drive(state, agents, g) {
    let r = g.next();
    while (!r.done) {
      const q = r.value;
      let ans = null;
      if (q.kind === 'cards') {
        if (q.window === 'afterRoll') { if (TI.crownWindow) await TI.crownWindow(state, agents, q.ctx); }
        else if (TI.cardWindow) await TI.cardWindow(state, agents, q.window, q.ctx, q.players);
      } else if (q.kind === 'roundStart') {
        for (const pl of [q.defender, q.attacker]) { const a = agents[pl.id]; if (a && a.combatRoundStart) await a.combatRoundStart(state, pl, q); }
      } else if (q.kind === 'casualties') {
        const a = agents[q.player.id];
        if (a && a.chooseCasualties) ans = await a.chooseCasualties(state, q.player, q);
      } else {
        const a = agents[q.player.id];
        if (a && a.chooseRetreat) ans = await a.chooseRetreat(state, q.player, q.sysId, q.options, { mine: q.mine, theirs: q.theirs, opponent: q.opponent });
      }
      r = g.next(ans || null);
    }
    return r.value;
  }
  // Game version: decisions go to the players' agents, which may be async.
  TI.resolveSpaceAsync = (state, agents, attacker, sysId) => drive(state, agents, spaceFlow(state, attacker, sysId));
  TI.invadeAsync = (state, agents, attacker, sysId, planetIdx, committed) => drive(state, agents, invadeFlow(state, attacker, sysId, planetIdx, committed));

  // Land `committed` ground forces (from the system's cargo) on `planetIdx`. Returns { captured }.
  function* invadeFlow(state, attacker, sysId, planetIdx, committed) {
    const sys = state.map.systems[sysId], planet = sys.planets[planetIdx], pid = attacker.id;
    const cargo = TI.cargoOf(sys, pid);
    const landing = [];
    for (const u of committed) { const i = cargo.indexOf(u); if (i >= 0) { cargo.splice(i, 1); landing.push(u); } }
    if (!landing.length) return { captured: false };

    if (planet.dmz) { cargo.push(...landing); TI.log(state, `${planet.name} is a Demilitarized Zone: nobody can land there.`); return { captured: false }; }
    const defenderPlayer = planet.owner !== null && planet.owner !== pid ? state.players[planet.owner] : null;

    TI.log(state, `${attacker.name} lands ${landing.length} ground force(s) on ${planet.name}${defenderPlayer ? ' (held by ' + defenderPlayer.name + ')' : ''}.`);
    // Parley (return the landing force to orbit), Bunker and Disable (invasion modifiers).
    if (defenderPlayer) {
      const lc = { attacker, planet, landing, defenderPlayer, cancelled: false, sysId };
      yield { kind: 'cards', window: 'landing', ctx: lc, players: [defenderPlayer] };
      if (lc.cancelled) { cargo.push(...landing); TI.log(state, `${attacker.name}'s ground forces are sent back to orbit above ${planet.name}.`); return { captured: false }; }
    }
    const ic = { attacker, defenderPlayer, planet, sysId, bombardMod: 0, noPDS: false };
    if (defenderPlayer) yield { kind: 'cards', window: 'invasionStart', ctx: ic, players: [defenderPlayer, attacker] };
    const deadAtk = [], deadDef = [];
    if (defenderPlayer) {
      // Bombardment (no effect if the planet has no infantry), then PDS fire at the landing force.
      const ships = sys.ships[pid] || [];
      const hadGround = planet.ground.length > 0;
      const bombed = TI.rules && TI.rules.noBombardCultural && planet.trait === 'cultural' ? 0 : TI.bombard(ships, planet.ground, state.rng, attacker.stats, { extraDie: TI.hasTechEffect(attacker, 'plasma'), dead: deadDef, mod: ic.bombardMod });
      if (bombed > 0 && TI.hasTechEffect(attacker, 'x89')) {   // X-89 Bacterial Weapon: wipe out all infantry
        for (let i = planet.ground.length - 1; i >= 0; i--) if (planet.ground[i].type === 'infantry') deadDef.push(planet.ground.splice(i, 1)[0]);
        TI.log(state, `${attacker.name}'s X-89 Bacterial Weapon kills every infantry on ${planet.name}.`);
      }
      if (bombed > 0) TI.log(state, `${attacker.name}'s bombardment kills ${bombed} ground force(s) on ${planet.name}.`);
      if (hadGround && bombed > 0 && planet.ground.length === 0) TI.noteEvent(state, attacker.id, 'bombWipe');   // "Make an Example of Their World"
      if (planet.pds > 0 && !ic.noPDS && !TI.hasTechEffect(attacker, 'noCannonDefense')) {
        let hits = 0;
        const c = defenderPlayer.stats.pds.cannon;
        const extra = TI.hasTechEffect(defenderPlayer, 'plasma') ? 1 : 0;
        const resist = TI.hasTechEffect(attacker, 'cannonResist') ? -1 : 0;
        for (let i = 0; i < planet.pds; i++) {
          for (let d = 0; d < c.dice + (i === 0 ? extra : 0); d++) if (state.rng.d10() >= c.value - resist) hits++;
        }
        if (hits > 0) { const vol = { hits }; yield { kind: 'cards', window: 'beforeCannon', ctx: { player: attacker, owner: defenderPlayer, volley: vol, ground: true, state }, players: [attacker] }; hits = Math.max(0, vol.hits); }
        for (let i = 0; i < landing.length && hits > 0; ) { if (landing[i].type === 'infantry') { deadAtk.push(landing.splice(i, 1)[0]); hits--; } else i++; }
      }
    }

    let captured = false;
    if (planet.ground.length === 0 || !defenderPlayer) {
      captured = true;
    } else {
      // Yin Indoctrination: spend 2 influence to turn one of the opponent's infantry.
      for (const [yin, mineF, theirF] of [[attacker, landing, planet.ground], [defenderPlayer, planet.ground, landing]]) if (TI.faction(yin).ability.indoctrination && TI.indoctrinate) TI.indoctrinate(state, yin, mineF, theirF);
      // Magen Defense Grid: a defender with a structure here gets a free hit before the fighting starts.
      if (TI.hasTechEffect(defenderPlayer, 'magen') && (planet.pds > 0 || planet.dock) && landing.length) {
        deadAtk.push(landing.splice(0, 1)[0]);
        TI.log(state, `${defenderPlayer.name}'s Magen Defense Grid destroys an invading ground force.`);
      }
      const m = { attacker: 0, defender: 0, attackerStats: attacker.stats, defenderStats: defenderPlayer.stats,
                  attackerSide: TI.combatSide(state, attacker, 'ground'), defenderSide: TI.combatSide(state, defenderPlayer, 'ground'),
                  attackerDead: deadAtk, defenderDead: deadDef };
      const gctx = TI.groundCombatStart(landing, planet.ground, state.rng, m);
      while (landing.length && planet.ground.length && gctx.log.rounds < 50) {
        const rd = gctx.log.rounds + 1;
        gctx.buffs = gctx.buffs || [];
        yield { kind: 'cards', window: 'groundRoundStart', ctx: { sysId, round: rd, attacker, defender: defenderPlayer, cx: gctx, ground: true }, players: [attacker, defenderPlayer] };
        const em = TI.effectiveMods(gctx);
        yield { kind: 'roundStart', ground: true, sysId, planet, round: rd, attacker, defender: defenderPlayer,
                preview: { attacker: TI.combatPreview(landing, m.attackerStats, em.attacker, null, em.attackerSide), defender: TI.combatPreview(planet.ground, m.defenderStats, em.defender, null, em.defenderSide) } };
        const roll = TI.groundRoundRoll(gctx);
        yield { kind: 'cards', window: 'afterRoll', ctx: { roll, sysId, ground: true, sides: { attacker: { player: attacker, force: landing }, defender: { player: defenderPlayer, force: planet.ground } } }, players: [] };
        // Fire Team: reroll missed dice.
        for (const [pl, side] of [[attacker, 'attacker'], [defenderPlayer, 'defender']]) yield { kind: 'cards', window: 'groundRolled', ctx: { player: pl, side, roll, state, stats: side === 'attacker' ? m.attackerStats : m.defenderStats }, players: [pl] };
        const plans = {};
        for (const [pl, side, force] of [[defenderPlayer, 'defender', planet.ground], [attacker, 'attacker', landing]]) {
          const foeSide = side === 'defender' ? 'attacker' : 'defender';
          const plan = yield { kind: 'casualties', ground: true, sysId, planet, round: rd, player: pl, side, hits: roll[foeSide].hits, roll, attacker, defender: defenderPlayer,
                               force, stats: side === 'attacker' ? m.attackerStats : m.defenderStats };
          if (Array.isArray(plan)) plans[side] = plan;
        }
        const ha = roll.attacker.hits, hd = roll.defender.hits;
        TI.groundRoundResolve(gctx, plans);
        // L1Z1X Harrow: after each round your ships in the system bombard the defenders.
        if (TI.faction(attacker).ability.harrow && landing.length && planet.ground.length) {
          const hk = TI.bombard(sys.ships[pid] || [], planet.ground, state.rng, attacker.stats, { extraDie: TI.hasTechEffect(attacker, 'plasma'), dead: deadDef });
          if (hk > 0) TI.log(state, `${attacker.name}'s Harrow bombardment kills ${hk} ground force(s) on ${planet.name}.`);
        }
        TI.log(state, `  Ground round ${rd} on ${planet.name}: ${attacker.name} scores ${ha} hit(s), ${defenderPlayer.name} ${hd}; ${landing.length} vs ${planet.ground.length} left.`);
      }
      const r = TI.groundCombatFinish(gctx);
      TI.log(state, `Ground battle on ${planet.name}: ${attacker.name} vs ${defenderPlayer.name} → ${r.winner === 'attacker' ? attacker.name : defenderPlayer.name} wins.`);
      captured = r.winner === 'attacker';
      if (r.winner === 'attacker') TI.onCombatWon(state, attacker, defenderPlayer); else if (r.winner === 'defender') TI.onCombatWon(state, defenderPlayer, attacker);
      const champ = r.winner === 'attacker' ? attacker : r.winner === 'defender' ? defenderPlayer : null;
      const beaten = champ === attacker ? defenderPlayer : attacker;
      if (champ && state.players.every((o) => o.vp <= beaten.vp)) TI.noteEvent(state, champ.id, 'beatLeader');
      // Dacxive Animators: the winner of a ground combat gets a free infantry on the planet.
      const victor = r.winner === 'attacker' ? attacker : r.winner === 'defender' ? defenderPlayer : null;
      if (victor && TI.hasTechEffect(victor, 'dacxive')) {
        (r.winner === 'attacker' ? landing : planet.ground).push(TI.makeUnit('infantry'));
        TI.log(state, `${victor.name}'s Dacxive Animators place an infantry on ${planet.name}.`);
      }
    }
    TI.reviveRolls(state, attacker, deadAtk);
    if (defenderPlayer) TI.reviveRolls(state, defenderPlayer, deadDef);
    if (captured && landing.length) {
      const changed = planet.owner !== pid;
      const prevOwner = planet.owner;
      planet.owner = pid;
      planet.ground.push(...landing);   // defenders (if any) are already dead
      if (changed) {
        const had = { pds: planet.pds || 0, dock: !!planet.dock };
        const gc = { newOwner: attacker, oldOwner: defenderPlayer || (prevOwner !== null && prevOwner !== pid ? state.players[prevOwner] : null), planet, had, infiltrate: false, state };
        planet.pds = 0; planet.dock = false; planet.exhausted = true;
        TI.log(state, `${attacker.name} takes ${planet.name}.`);
        // Infiltrate keeps the structures (as the new owner's); Reparations punishes the conqueror.
        if (TI.faction(attacker).ability.assimilate) gc.infiltrate = true;   // L1Z1X Assimilate: its structures become yours
        yield { kind: 'cards', window: 'planetGained', ctx: gc, players: [attacker].concat(gc.oldOwner ? [gc.oldOwner] : []) };
        TI.onPlanetControl(state, planet, sysId, attacker, gc.oldOwner);
        if (gc.infiltrate) {
          const havePds = TI.structureCount(state, attacker, 'pds'), haveDock = TI.structureCount(state, attacker, 'dock');
          planet.pds = Math.max(0, Math.min(had.pds, TI.UNIT_LIMITS.pds - havePds));
          if (had.dock && haveDock < TI.UNIT_LIMITS.dock) planet.dock = true;
          TI.log(state, `${attacker.name} infiltrates ${planet.name}: its structures now belong to them.`);
        }
      }
    }
    return { captured: captured && landing.length > 0 };
  }
  // Synchronous version (tests, anyone who just wants the answer): all casualties are chosen automatically.
  TI.invade = function (state, attacker, sysId, planetIdx, committed) {
    const g = invadeFlow(state, attacker, sysId, planetIdx, committed);
    let r = g.next();
    while (!r.done) r = g.next(null);
    return r.value;
  };

  // Spend `amount` resources (exhaust planets then trade goods). Returns true if paid.
  TI.pay = function (state, player, amount, kind) {
    kind = kind || 'res';
    const planets = TI.planetsOwned(state, player).filter((p) => !p.exhausted && p[kind === 'res' ? 'res' : 'inf'] > 0);
    const value = (p) => p[kind === 'res' ? 'res' : 'inf'];
    const tv = TI.tgValue(player);
    const total = planets.reduce((n, p) => n + value(p), 0) + player.tg * tv;
    if (total < amount) return false;
    planets.sort((a, b) => value(b) - value(a));
    let owed = amount;
    for (const p of planets) { if (owed <= 0) break; p.exhausted = true; owed -= value(p); }
    if (owed > 0) player.tg -= Math.ceil(owed / tv); // overpayment on planets is simply lost, as in the board game
    return true;
  };

  // Production in a system with the player's space dock.
  // order: [{ unit: 'cruiser', planetIdx? }]. Returns the units actually built.
  // opts.planet / opts.maxCost: production that needs no dock (Integrated Economy) is capped by a total cost.
  TI.produce = function (state, player, sysId, order, opts) {
    opts = opts || {};
    const sys = state.map.systems[sysId];
    // opts.noDock: production that needs no space dock (Arborec flagship, Salvage Operations); opts.limit caps the units, opts.types the kinds.
    const dockPlanet = opts.planet || (opts.noDock ? sys.planets.find((p) => p.owner === player.id) : sys.planets.find((p) => p.owner === player.id && p.dock && !p.holy && !p.dmz));
    if (!opts.noDock && (!dockPlanet || dockPlanet.holy || dockPlanet.dmz)) return [];
    let limit = opts.noDock ? (opts.limit || Infinity) : opts.planet ? Infinity : dockPlanet.res + 2 + player.techs.reduce((n, t) => n + (TI.TECHS[t].effect.productionBonus || 0), 0);
    let spent = 0;
    // The whole order is paid in one go afterwards (paying unit by unit threw away the change on each planet).
    const payable = TI.planetsOwned(state, player).filter((p) => !p.exhausted).reduce((n, p) => n + p.res, 0) + player.tg * TI.tgValue(player);
    let discount = TI.hasTechEffect(player, 'productionDiscount') ? 1 : 0; // Sarween Tools: -1 total cost
    let flagships = TI.countShips(state, player, ['flagship']);
    const built = [];
    const skip = (unit, why) => { if (!player.bot) TI.log(state, `${player.name} could not build ${unit} at ${sysId}: ${why}.`); };
    for (const o of order) {
      const st = player.stats[o.unit];
      if (!st || st.type === 'struct') continue;
      if (opts.types && !opts.types.includes(o.unit)) continue;
      if (st.type !== 'ship' && !dockPlanet) { skip(o.unit, 'there is no planet of yours here to put it on'); continue; }
      if (o.unit === 'warsun' && !TI.canBuildWarsun(player)) { skip('a war sun', 'War Sun technology not researched'); continue; }
      if (o.unit === 'flagship' && flagships >= 1) { skip('a flagship', 'you already have one'); continue; }
      const mine = sys.ships[player.id] || (sys.ships[player.id] = []);
      const wouldBe = mine.filter((u) => u.type !== 'fighter').length + (st.type === 'ship' && o.unit !== 'fighter' ? 1 : 0);
      if (st.type === 'ship' && o.unit !== 'fighter' && wouldBe > TI.fleetLimit(player)) { skip(o.unit, `fleet supply is full (${TI.fleetLimit(player)} non-fighter ships per system; add fleet tokens)`); continue; }
      if (TI.unitsLeft(state, player, o.unit) < 1) { skip(o.unit, 'none left in your reinforcements'); continue; }                // reinforcements ran out
      if (o.unit === 'infantry' && !opts.planet && TI.faction(player).ability.noDockInfantry) { skip('infantry', 'your space docks cannot produce infantry (Mitosis)'); continue; }
      if (st.type === 'ship' && TI.hasOtherShips(sys, player.id)) { skip(o.unit, 'enemy ships are in the system, and ships cannot be produced there'); continue; }   // (58.2)
      const count = TI.rules && TI.rules.conscription && (o.unit === 'fighter' || o.unit === 'infantry') ? 1 : st.batch;
      if (limit < count) { skip(o.unit, 'over the space dock production limit'); continue; }
      const cost = Math.max(0, st.cost - discount);
      if (opts.maxCost !== undefined && spent + cost > opts.maxCost) continue;
      if (spent + cost > payable) { skip(o.unit, `not enough resources (${cost} needed, ${Math.max(0, payable - spent)} left)`); continue; }
      spent += cost;
      discount = 0;
      limit -= count;
      if (o.unit === 'flagship') flagships++;
      for (let i = 0; i < count; i++) {
        const unit = TI.makeUnit(o.unit);
        if (st.type === 'ship') mine.push(unit);
        else dockPlanet.ground.push(unit);
        built.push(unit);
      }
    }
    if (spent > 0) TI.pay(state, player, spent, 'res');
    if (built.length && TI.afterProduce) TI.afterProduce(state, player, sysId, built, dockPlanet, opts);
    // Prophecy of Ixth: the owner discards it unless this production made 2 or more fighters.
    if (built.length && TI.lawOwner && TI.lawOwner(state, 'prophecy_of_ixth') === player.id && built.filter((u) => u.type === 'fighter').length < 2) { TI.discardOwnedLaw(state, 'prophecy_of_ixth'); TI.log(state, `${player.name} discards Prophecy of Ixth.`); }
    return built;
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
