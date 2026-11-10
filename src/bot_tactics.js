// Bot tactical reasoning: score each system a bot could activate and build the move plan.
(function (root) {
  const TI = (root.TI = root.TI || {});

  TI.BOT_STYLES = {
    expander:  { label: 'Expander',  expand: 1.4, attack: 0.8, build: 1.0, tech: 1.0, fightThresh: 1.4 },
    warmonger: { label: 'Warmonger', expand: 1.1, attack: 1.4, build: 1.0, tech: 0.9, fightThresh: 1.2 },
    builder:   { label: 'Builder',   expand: 1.0, attack: 0.7, build: 1.4, tech: 1.5, fightThresh: 1.5 },
  };

  // Rough expected-damage strength of a fleet.
  TI.fleetStrength = function (list, stats) {
    return list.reduce((n, u) => {
      const s = stats[u.type];
      if (s.type !== 'ship') return n;
      return n + (s.dice * (11 - s.combat)) / 10 * (s.sustain ? 1.7 : 1);
    }, 0);
  };
  const shipCost = (list, stats) => list.reduce((n, u) => n + stats[u.type].cost / stats[u.type].batch, 0);
  const planetValue = (pl, style) => (pl.res * 1.0 + pl.inf * 0.8 + (pl.mecatol ? 4 : 0)) * style.expand;

  // Extra appeal of a planet for the objectives the player is still chasing: the revealed public ones it has not
  // scored plus its own secrets. Counting objectives pull on the planets that advance the count.
  TI.botObjectiveBonus = function (state, p, pl, sys) {
    let bonus = 0;
    const ids = state.publicObjectives.concat(p.secrets).filter((id) => !p.scored.includes(id));
    const Q = TI.objectiveQueries;
    for (const id of ids) {
      const o = TI.objectiveById(id), w = o.vp;
      if (id === 's1_outposts' || id === 's2_brain') { if (pl.tech) bonus += 1.5 * w; }
      else if (id === 's1_borders' || id === 's2_subdue') { if (sys.home === null) bonus += 0.8 * w; }
      else if (id === 'x_minerals') { if (pl.trait === 'hazardous') bonus += 1.2; }
      else if (id === 'x_production') { if (pl.trait === 'industrial') bonus += 1.2; }
      else if (id === 'x_alliance') { if (pl.trait === 'cultural') bonus += 1.2; }
      else if (id === 's1_corner' || id === 's2_unify') {
        if (pl.trait) { const have = Q.trait(state, p, pl.trait); bonus += have > 0 ? (0.6 + 0.4 * have) * w : 0.3 * w; }
      }
    }
    return bonus;
  };

  // Resources a bot keeps unspent so it can pay for a spend-resources objective it could score this round.
  TI.botSpendReserve = function (state, p) {
    let reserve = 0;
    for (const id of state.publicObjectives) {
      const o = TI.objectiveById(id);
      if (p.scored.includes(id) || !o.spend || o.spend.kind !== 'res' || !TI.homeIntact(state, p)) continue;
      if (TI.canSpend(state, p, 'res', o.spend.n)) reserve = Math.max(reserve, o.spend.n);
    }
    return reserve;
  };

  // Gravity rifts: a ship leaving or crossing one is lost on a 1-3. Bots treat the expected loss as a cost
  // (they are wary of rifts, not forbidden from using them).
  const RIFT_CAUTION = 0.8;
  TI.botRiftExposed = (state, p, m, targetId) =>
    TI.riftExposure(state.map, m.from, targetId, p.stats[m.unit.type].move + (m.bonus ? 1 : 0), p.id, TI.reachOpts(p));
  TI.botRiftRisk = function (state, p, chosen, targetId) {
    let loss = 0;
    for (const m of chosen) if (m.unit.type !== 'fighter' && TI.botRiftExposed(state, p, m, targetId)) loss += 0.3 * shipCost([m.unit], p.stats);
    return loss * RIFT_CAUTION;
  };

  // Builds { plan, score, why } for activating targetId.
  TI.botPlan = function (state, p, targetId, style) {
    const S = state.map.systems, target = S[targetId], pid = p.id;
    const existing = target.ships[pid] || [];
    const existingNonFighter = existing.filter((u) => u.type !== 'fighter').length;
    const slots = Math.max(0, TI.fleetLimit(p) - existingNonFighter);
    const enemy = TI.defenderIn(state, targetId, pid);
    const enemyStr = enemy ? TI.fleetStrength(target.ships[enemy.id], enemy.stats) : 0;

    const planetsToTake = target.planets.filter((pl) => pl.owner !== pid);
    const wantsGround = planetsToTake.length > 0;

    const cands = TI.movableShips(state, p, targetId).filter((m) => m.unit.type !== 'fighter');
    // Strongest first, but ships that would have to gamble on a gravity rift rank lower.
    const eff = (m) => TI.fleetStrength([m.unit], p.stats) * (TI.botRiftExposed(state, p, m, targetId) ? 0.7 : 1);
    cands.sort((a, b) => eff(b) - eff(a) || p.stats[b.unit.type].cap - p.stats[a.unit.type].cap);

    const chosen = [];
    let bonusUsed = 0;   // Gravity Drive stretches only one ship
    for (const m of cands) {
      if (chosen.length >= slots) break;
      if (m.bonus && bonusUsed >= 1) continue;
      if (m.bonus) bonusUsed++;
      chosen.push(m);
    }
    // Make sure there is a carrier if we want to land troops and none was picked.
    if (wantsGround && chosen.length && !chosen.some((m) => p.stats[m.unit.type].cap > 0)) {
      const carrier = cands.find((m) => p.stats[m.unit.type].cap > 0 && !chosen.includes(m) && (!m.bonus || bonusUsed === 0 || chosen[chosen.length - 1].bonus));
      if (carrier) chosen[chosen.length - 1] = carrier;
    }

    const afterShips = existing.concat(chosen.map((m) => m.unit));
    const usedNow = existing.filter((u) => u.type === 'fighter').length + TI.cargoOf(target, pid).length;
    let room = TI.cargoCapacity(p, afterShips) - usedNow;

    // Ground forces to bring along, leaving one defender per planet at the source.
    const sources = [...new Set(chosen.map((m) => m.from))];
    const ground = [];
    let wantG = 0;
    for (const pl of planetsToTake) {
      const def = pl.owner !== null ? pl.ground.length + (pl.pds || 0) * 0.7 : 0;
      wantG += pl.owner === null ? 2 : Math.ceil(def * 1.6) + 2;
    }
    if (wantsGround) {
      for (const src of sources) {
        for (const g of TI.groundAvailable(state, p, src)) {
          if (ground.length >= Math.min(wantG, room)) break;
          const planet = S[src].planets[g.planetIdx];
          const taken = ground.filter((x) => x.from === src && x.planetIdx === g.planetIdx).length;
          if (planet.ground.length - taken > 1) ground.push(g);
        }
      }
    }
    room -= ground.length;

    // Fighters ride in any leftover space.
    const fighters = [];
    for (const src of sources) {
      for (const u of (S[src].ships[pid] || [])) {
        if (u.type === 'fighter' && fighters.length < room) fighters.push({ from: src, unit: u });
      }
    }
    const plan = { ships: chosen.concat(fighters), ground };

    // ---- score -----------------------------------------------------------------------------
    let score = 0, why = [];
    const myStr = TI.fleetStrength(afterShips.concat(fighters.map((f) => f.unit)), p.stats);
    if (enemy && enemyStr > 0) {
      if (myStr >= enemyStr * style.fightThresh) {
        const ownHere = target.planets.some((pl) => pl.owner === pid);
        score += shipCost(target.ships[enemy.id], enemy.stats) * 0.6 * style.attack + (ownHere ? 8 : 0);
        why.push('fight');
      } else return { plan, score: -1, why: ['too strong'] };
    }
    const g = ground.length;
    for (const pl of planetsToTake) {
      const ob = TI.botObjectiveBonus(state, p, pl, target);
      if (pl.owner === null) { if (g >= 1) score += planetValue(pl, style) + 1.5 + ob; }
      else {
        const def = pl.ground.length + (pl.pds || 0) * 0.7;
        if (g >= def * 1.4 + 1) score += planetValue(pl, style) * 1.3 * style.attack + 3 + ob;
      }
    }
    if (!chosen.length) score = Math.min(score, 0);
    score -= chosen.length * 0.3;
    const riftRisk = TI.botRiftRisk(state, p, plan.ships, targetId);
    if (riftRisk > 0) { score -= riftRisk; why.push('rift risk'); }

    // Production mission: activating a system with our own dock to build.
    const dockPlanet = target.planets.find((pl) => pl.owner === pid && pl.dock);
    if (dockPlanet) {
      const budget = TI.available(state, p).res + p.tg;
      score += Math.min(budget, dockPlanet.res + 2 + 2) * 0.55 * style.build;
      why.push('produce');
    }
    return { plan, score, why };
  };

  // Best system to activate, or null if nothing is worth a command token.
  TI.botChooseTarget = function (state, p, style) {
    let best = null;
    for (const id of state.map.order) {
      if (!TI.canActivate(state, p, id)) continue;
      const sys = state.map.systems[id];
      if (sys.anomaly === 'supernova') continue;
      const r = TI.botPlan(state, p, id, style);
      if (r.score > 2.2 && (!best || r.score > best.score)) best = Object.assign({ id }, r);
    }
    return best;
  };

  // Which ground forces to land where after space combat.
  TI.botInvasion = function (state, p, sysId, style) {
    const sys = state.map.systems[sysId];
    const cargo = TI.cargoOf(sys, p.id).slice();
    const options = sys.planets.map((pl, idx) => ({ pl, idx })).filter((x) => x.pl.owner !== p.id && !x.pl.dmz)
      .sort((a, b) => planetValue(b.pl, style) - planetValue(a.pl, style));
    const out = [];
    for (const { pl, idx } of options) {
      if (!cargo.length) break;
      if (pl.mecatol && state.custodians === null && !TI.canSpend(state, p, 'inf', 6)) continue;   // cannot afford the custodians token
      let need;
      if (pl.owner === null) need = 1;
      else {
        const def = pl.ground.length + (pl.pds || 0) * 0.7;
        need = Math.ceil(def * 1.4 + 1);
        if (cargo.length < need) continue;
      }
      const units = cargo.splice(0, Math.min(cargo.length, pl.owner === null ? Math.max(1, Math.min(2, cargo.length)) : cargo.length));
      out.push({ planetIdx: idx, units });
    }
    return out;
  };

  // What to build with the money available. The engine enforces limits and payment.
  TI.botProduction = function (state, p, sysId, style) {
    const sys = state.map.systems[sysId];
    const ships = sys.ships[p.id] || [];
    const nonFighters = ships.filter((u) => u.type !== 'fighter').length;
    const slots = TI.fleetLimit(p) - nonFighters;
    const order = [];
    const mil = style === TI.BOT_STYLES.warmonger;
    // Total ground we own vs. planets: keep a reserve of infantry for expansion.
    const groundTotal = TI.groundCount(state, p);
    const wantInfantry = groundTotal < 6 + TI.planetsOwned(state, p).length;
    let ship = 0;
    // Build the flagship as soon as it is affordable (one per player).
    const budget = TI.available(state, p).res + p.tg;
    const wantFlagship = slots > 0 && !TI.countShips(state, p, ['flagship']) && budget >= p.stats.flagship.cost - (TI.hasTechEffect(p, 'productionDiscount') ? 1 : 0);
    if (wantFlagship) { order.push({ unit: 'flagship' }); ship++; }
    const picks = mil ? ['dreadnought', 'cruiser', 'cruiser', 'carrier'] : (style && style.build > 1.2 ? ['cruiser', 'carrier', 'dreadnought', 'cruiser'] : ['carrier', 'cruiser', 'cruiser', 'dreadnought']);
    if (!wantFlagship && !ships.some((u) => p.stats[u.type].cap >= 4 && u.type !== 'fighter') && slots > 0) { order.push({ unit: 'carrier' }); ship++; }
    while (ship < slots && ship < 3) { order.push({ unit: picks[ship % picks.length] }); ship++; }
    if (TI.canBuildWarsun(p) && slots > ship) order.unshift({ unit: 'warsun' });
    if (wantInfantry) order.push({ unit: 'infantry' }, { unit: 'infantry' });
    order.push({ unit: 'fighter' }, { unit: 'infantry' });
    // Hold back the resources a spend objective needs, if the bot could score it this round.
    const reserve = TI.botSpendReserve(state, p);
    if (reserve > 0) {
      let left = TI.available(state, p).res + p.tg;
      const kept = [];
      for (const o of order) {
        const c = p.stats[o.unit].cost / p.stats[o.unit].batch;
        if (left - c < reserve) continue;
        kept.push(o); left -= c;
      }
      return kept;
    }
    return order;
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
