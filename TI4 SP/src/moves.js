// Tactical-action movement: activation, who can reach a system, and validated execution.
(function (root) {
  const TI = (root.TI = root.TI || {});

  const tokensOn = (sys) => (sys.tokens = sys.tokens || []);
  const cargoOf = (sys, pid) => { sys.cargo = sys.cargo || {}; return (sys.cargo[pid] = sys.cargo[pid] || []); };
  // Non-fighter ships allowed per system: fleet tokens (+1 Assault Cannon, +2 Letnev's Armada).
  const fleetLimit = (player) => player.tokens.fleet + (TI.hasTechEffect(player, 'fleetBonus') ? 1 : 0) + (TI.faction(player).ability.armada || 0);
  TI.tokensOn = tokensOn;
  // (set after reachOpts is defined below)
  TI.cargoOf = cargoOf;
  TI.fleetLimit = fleetLimit;

  TI.canActivate = (state, player, sysId) =>
    player.tokens.tactic > 0 && !tokensOn(state.map.systems[sysId]).includes(player.id);

  TI.activate = function (state, player, sysId) {
    if (!TI.canActivate(state, player, sysId)) return false;
    player.tokens.tactic--;
    tokensOn(state.map.systems[sysId]).push(player.id);
    return true;
  };

  const reachOpts = (player) => ({
    throughAsteroids: TI.hasTechEffect(player, 'throughAsteroids'),
    throughShips: TI.hasTechEffect(player, 'throughShips'),         // Light/Wave Deflector
    freeWormhole: !!TI.faction(player).ability.freeWormhole,
    wormholeLink: !!TI.faction(player).ability.entangle,                                  // Creuss: Quantum Entanglement
    throughSupernova: !!TI.faction(player).ability.gashlai || TI.hasTechEffect(player, 'magmus'),   // Muaat
  });

  TI.reachOpts = reachOpts;

  // Ships (move > 0) that could reach `targetId`. Ships in a system holding the player's own
  // command token cannot leave. Returns [{ from, unit, dist, bonus }]; bonus marks a ship that gets there only with
  // Gravity Drive's +1 (one ship per tactical action).
  TI.movableShips = function (state, player, targetId) {
    const out = [];
    const lazaxOn = TI.hasTechEffect(player, 'lazax') && state.map.systems['0,0'].planets[0].owner !== player.id;
    const target = state.map.systems[targetId], opts0 = lazaxOn ? Object.assign(reachOpts(player), { lazax: true }) : reachOpts(player);
    // Action cards played after activation: Flank Speed (+1 move), In The Silence Of Space, Lost Star Chart.
    const tac = state.tactical && state.tactical.player === player.id ? state.tactical : null;
    const flank = tac ? tac.flank || 0 : 0;
    const opts = tac && tac.lostStar ? Object.assign({}, opts0, { wormholeLink: true }) : opts0;
    // Spacial Conduit Cylinder (state.conduit): every system with the player's units counts as adjacent.
    const conduit = state.conduit && state.conduit.pid === player.id && state.conduit.sysId === targetId &&
      target.anomaly !== 'supernova' && !(target.anomaly === 'asteroid' && !opts.throughAsteroids);
    for (const id of state.map.order) {
      if (id === targetId) continue;
      const sys = state.map.systems[id];
      const ships = sys.ships[player.id] || [];
      if (!ships.length || tokensOn(sys).includes(player.id)) continue;
      const gd = TI.hasTechEffect(player, 'gravityDrive') ? 1 : 0;
      const inNebula = sys.anomaly === 'nebula';                                   // a ship starting in a nebula has move 1 (50.2)
      const slip = TI.faction(player).ability.slipstream && (sys.home === player.id || sys.wormhole) ? 1 : 0;   // Creuss: Slipstream
      const base = (u) => { const mv = inNebula ? Math.min(1, player.stats[u.type].move) : player.stats[u.type].move; return mv > 0 ? mv + flank + slip : 0; };
      const maxMove = Math.max(0, ...ships.map(base));
      if (maxMove === 0) continue;
      const fromOpts = tac && tac.silence === id ? Object.assign({}, opts, { throughShips: true }) : opts;
      const reach = TI.reachable(state.map, id, maxMove + gd, player.id, fromOpts);
      // Yssaril's flagship can slip through systems that hold other players' ships.
      const passer = player.stats.flagship && player.stats.flagship.passShips ? ships.find((u) => u.type === 'flagship') : null;
      const reachP = passer && !fromOpts.throughShips ? TI.reachable(state.map, id, maxMove + gd, player.id, Object.assign({}, fromOpts, { throughShips: true })) : null;
      const dist0 = conduit ? 1 : reach[targetId];
      const distP = reachP ? reachP[targetId] : undefined;
      if (dist0 === undefined && distP === undefined) continue;
      for (const unit of ships) {
        const mv = base(unit);
        const dist = unit === passer && distP !== undefined && (dist0 === undefined || distP < dist0) ? distP : dist0;
        if (dist === undefined) continue;
        if (mv >= dist) out.push({ from: id, unit, dist, bonus: false });
        else if (gd && mv > 0 && mv + gd >= dist) out.push({ from: id, unit, dist, bonus: true });
      }
    }
    return out;
  };

  // Ground forces sitting on planets in a system (candidates for pickup).
  TI.groundAvailable = (state, player, sysId) => {
    const out = [];
    state.map.systems[sysId].planets.forEach((pl, idx) => {
      if (pl.owner === player.id) pl.ground.forEach((unit) => out.push({ from: sysId, planetIdx: idx, unit }));
    });
    return out;
  };

  const capacity = (player, ships) => ships.reduce((n, u) => n + player.stats[u.type].cap, 0);
  TI.cargoCapacity = capacity;

  // plan = { ships: [{from, unit}], ground: [{from, planetIdx, unit}] }  (all moving to targetId)
  // Returns { ok, reason }. Applies the move only when valid.
  TI.executeMove = function (state, player, targetId, plan) {
    const S = state.map.systems, target = S[targetId], pid = player.id;
    const legal = TI.movableShips(state, player, targetId);
    // Fighter II fighters move on their own (no transport needed) when they can reach the target.
    const isIndep = (m) => m.unit.type === 'fighter' && legal.some((l) => l.unit === m.unit);
    const movingShips = plan.ships.filter((m) => m.unit.type !== 'fighter');
    const movingFighters = plan.ships.filter((m) => m.unit.type === 'fighter' && !isIndep(m));
    const indepFighters = plan.ships.filter(isIndep);

    for (const m of movingShips) {
      if (!legal.some((l) => l.unit === m.unit)) return { ok: false, reason: 'ship cannot reach target' };
    }
    const bonusShips = movingShips.concat(indepFighters).filter((m) => legal.find((l) => l.unit === m.unit).bonus);
    if (bonusShips.length > 1) return { ok: false, reason: 'Gravity Drive helps only 1 ship' };
    // Fighters have no movement: they must ride; they may come from any system that is a legal source.
    const sourceSystems = new Set(movingShips.map((m) => m.from));
    for (const m of movingFighters) if (!sourceSystems.has(m.from)) return { ok: false, reason: 'fighter has no carrier from there' };
    for (const g of plan.ground) if (!sourceSystems.has(g.from)) return { ok: false, reason: 'ground force has no ship from there' };
    // plan.cargo (optional): ground forces already aboard in a source system's space area that travel with the ships.
    // Without it (bots) whatever the remaining ships cannot hold goes along automatically.
    const aboard = plan.cargo || [];
    for (const c of aboard) if (!sourceSystems.has(c.from) || !cargoOf(S[c.from], pid).includes(c.unit)) return { ok: false, reason: 'those ground forces are not aboard there' };
    if (plan.cargo) for (const src of sourceSystems) {
      const gone = new Set(plan.ships.filter((m) => m.from === src).map((m) => m.unit));
      const rest = (S[src].ships[pid] || []).filter((u) => !gone.has(u));
      const left = cargoOf(S[src], pid).length - aboard.filter((c) => c.from === src).length;
      const stay = Math.max(0, capacity(player, rest) - rest.filter((u) => u.type === 'fighter').length);
      if (left > stay) return { ok: false, reason: 'ground forces left aboard have no ship to stay on: carry them or keep a ship with room' };
    }

    const existing = target.ships[pid] || [];
    const afterShips = existing.concat(movingShips.map((m) => m.unit), movingFighters.map((m) => m.unit), indepFighters.map((m) => m.unit));
    const nonFighter = afterShips.filter((u) => u.type !== 'fighter').length;
    const fightersAfter = afterShips.length - nonFighter, cap = capacity(player, afterShips);
    const groundUsed = cargoOf(target, pid).length + plan.ground.length + aboard.length;
    let excess = 0;   // Fighter II: fighters beyond the carrying capacity count against the fleet limit
    if (player.stats.fighter.move > 0) {
      if (groundUsed > cap) return { ok: false, reason: 'not enough capacity' };
      excess = Math.max(0, fightersAfter - (cap - groundUsed));
    } else if (fightersAfter + groundUsed > cap) return { ok: false, reason: 'not enough capacity' };
    if (nonFighter + excess > fleetLimit(player)) return { ok: false, reason: 'exceeds fleet supply' };

    // Gravity rifts: each ship that leaves or crosses one rolls a die; 1-3 and it is lost.
    const lost = [];
    for (const m of movingShips) {
      const mv = player.stats[m.unit.type].move + (state.tactical && state.tactical.player === pid ? state.tactical.flank || 0 : 0) + (legal.find((l) => l.unit === m.unit).bonus ? 1 : 0);
      if (TI.riftExposure(state.map, m.from, targetId, mv, player.id, reachOpts(player)) && state.rng.d10() <= 3) lost.push(m);
    }
    if (lost.length) {
      for (const m of lost) {
        const list = S[m.from].ships[pid], i = list.indexOf(m.unit);
        if (i >= 0) list.splice(i, 1);
        plan.ships.splice(plan.ships.indexOf(m), 1);
        const k = afterShips.indexOf(m.unit);
        if (k >= 0) afterShips.splice(k, 1);
      }
      TI.log(state, `${player.name} loses ${lost.length} ship${lost.length > 1 ? 's' : ''} in the gravity rift.`);
      if (!afterShips.some((u) => u.type !== 'fighter')) {
        // Nothing carries the cargo any more: the fighters and ground forces aboard are lost too.
        for (const m of plan.ships.slice()) {
          const list = S[m.from].ships[pid], i = list.indexOf(m.unit);
          if (i >= 0) list.splice(i, 1);
        }
        for (const g of plan.ground) {
          const planet = S[g.from].planets[g.planetIdx], i = planet.ground.indexOf(g.unit);
          if (i >= 0) planet.ground.splice(i, 1);
        }
        plan.ships = []; plan.ground = [];
        return { ok: true, lostAll: true };
      }
    }

    // apply
    for (const m of plan.ships) {
      const list = S[m.from].ships[pid];
      const i = list.indexOf(m.unit);
      if (i >= 0) list.splice(i, 1);
    }
    target.ships[pid] = afterShips;
    for (const g of plan.ground) {
      const planet = S[g.from].planets[g.planetIdx];
      const i = planet.ground.indexOf(g.unit);
      if (i >= 0) { planet.ground.splice(i, 1); cargoOf(target, pid).push(g.unit); }
    }
    for (const c of aboard) {
      const list = cargoOf(S[c.from], pid), i = list.indexOf(c.unit);
      if (i >= 0) { list.splice(i, 1); cargoOf(target, pid).push(c.unit); }
    }
    // Ground forces waiting in the space area stay with the ships that remain; whatever those ships
    // cannot hold must have been aboard the ships that left, so it travels with them (as far as room allows).
    if (!plan.cargo) for (const src of sourceSystems) {
      const rest = S[src].ships[pid] || [], cargo = cargoOf(S[src], pid);
      const stay = Math.max(0, capacity(player, rest) - rest.filter((u) => u.type === 'fighter').length);
      if (cargo.length <= stay) continue;
      const leaving = cargo.splice(stay);
      const room = capacity(player, target.ships[pid]) - target.ships[pid].filter((u) => u.type === 'fighter').length - cargoOf(target, pid).length;
      cargoOf(target, pid).push(...leaving.slice(0, Math.max(0, room)));
    }
    return { ok: true };
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
