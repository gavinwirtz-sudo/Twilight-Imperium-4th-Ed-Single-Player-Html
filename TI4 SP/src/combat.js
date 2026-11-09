// Combat resolution. Pure functions over arrays of units ({type, damaged}); they mutate
// the arrays they are given (removing destroyed units) and return a summary.
// Every function accepts optional per-side stat tables (tech upgrades); default is TI.UNITS.
//
// Faction abilities plug in through an optional "side" object per combatant (built in abilities.js):
//   unitMod(u, force)          extra modifier for one unit's combat roll (Fragile, Unrelenting, flagship aura)
//   extraHits(u, rawRoll)      extra hits for a raw die result (Jol-Nar flagship)
//   boost(u, rawRoll, need)    true to turn a miss into a hit by paying something (Hacan flagship)
//   roundStart(force)          called before each space combat round (Letnev repair + Munitions Reserves)
//   rerollMisses               set by roundStart: every missed die is rolled once more
//   afterRound(force, other)   called after hits are assigned (Sardakk Exotrireme II)
//   valkyrie                   ground combat: +1 hit if the opponent scored a hit (Sardakk)
(function (root) {
  const TI = (root.TI = root.TI || {});
  const T = (stats) => stats || TI.UNITS;

  // mod: positive helps (like a +1 on the result), negative hurts. extraDie: first shooter rolls 1 more die.
  function rollHits(rng, value, dice, mod, rec) {
    let hits = 0;
    const need = Math.min(10, Math.max(1, value - (mod || 0)));
    for (let i = 0; i < dice; i++) { const r = rng.d10(); if (rec) rec.push(r); if (r >= need) hits++; }
    return hits;
  }

  // Take losses on sustainers first, then the cheapest units, keeping valuable ships last.
  function lossPriority(u, stats) {
    const s = T(stats)[u.type];
    if (s.sustain && !u.damaged) return -1;
    return s.cost / s.batch + (u.damaged ? -0.5 : 0);
  }

  // Assign `hits` to a force. Returns number of units destroyed.
  // opts: { nonFighter: hits must go to non-fighter ships if any (Graviton Laser), dead: array to receive casualties,
  //         plan: units the owner chose, one per hit (a sustainer listed twice is damaged, then destroyed); whatever
  //         the plan does not cover is assigned by the default priority below }
  function takeHit(force, u, stats, opts) {
    const s = T(stats)[u.type];
    if (s.sustain && !u.damaged) { u.damaged = true; if (opts.sustained) opts.sustained.push(u); return { used: s.sustainCancel || 1, destroyed: 0 }; }
    force.splice(force.indexOf(u), 1); if (opts.dead) opts.dead.push(u);
    return { used: 1, destroyed: 1 };
  }
  function assignHits(force, hits, stats, opts) {
    opts = opts || {};
    let destroyed = 0;
    if (opts.plan) {
      for (const pu of opts.plan) {
        if (hits <= 0) break;
        if (force.indexOf(pu) < 0) continue;
        const r = takeHit(force, pu, stats, opts);
        hits -= r.used; destroyed += r.destroyed;
      }
    }
    while (hits > 0 && force.length) {
      force.sort((a, b) => lossPriority(a, stats) - lossPriority(b, stats));
      let u = force[0];
      if (opts.nonFighter) {
        const nf = force.find((x) => T(stats)[x.type].type === 'ship' && x.type !== 'fighter');
        if (nf) u = nf;
      }
      const r = takeHit(force, u, stats, opts);
      hits -= r.used; destroyed += r.destroyed;
    }
    return destroyed;
  }

  // Anti-fighter barrage: only destroys fighters, once, before round one.
  function barrage(rng, shooters, shooterStats, targets) {
    let hits = 0;
    for (const u of shooters) {
      const a = T(shooterStats)[u.type].afb;
      if (a) hits += rollHits(rng, a.value, a.dice, 0);
    }
    let killed = 0;
    for (let i = 0; i < targets.length && hits > 0; ) {
      if (targets[i].type === 'fighter') { targets.splice(i, 1); hits--; killed++; }
      else i++;
    }
    return killed;
  }

  // One side's combat rolls. Returns { hits, dice: [{ unit, need, r, reroll, hit, boosted, extra }] } so a screen can show them.
  function sideRoll(rng, force, stats, mod, onlyType, side) {
    let hits = 0;
    const dice = [];
    for (const u of force) {
      const s = T(stats)[u.type];
      if (onlyType && s.type !== onlyType) continue;
      const m = (mod || 0) + (side && side.unitMod ? side.unitMod(u, force) : 0);
      const need = Math.min(10, Math.max(1, s.combat - m));
      const nd = side && side.diceFor ? side.diceFor(u, s) : s.dice;
      for (let d = 0; d < nd; d++) {
        const first = rng.d10();
        let r = first, hit = r >= need, reroll = null, boosted = false, extra = 0;
        if (!hit && side && side.rerollMisses) { r = rng.d10(); reroll = r; hit = r >= need; }
        if (!hit && side && side.boost && side.boost(u, r, need)) { hit = true; boosted = true; }
        if (hit) hits++;
        if (side && side.extraHits) { extra = side.extraHits(u, r) || 0; hits += extra; }
        dice.push({ unit: u, need, r: first, reroll, hit, boosted, extra });
      }
    }
    return { hits, dice };
  }
  const sideHits = (rng, force, stats, mod, onlyType, side) => sideRoll(rng, force, stats, mod, onlyType, side).hits;

  // One-round bonuses from action cards (Morale Boost, Fighter Prototype): ctx.buffs = [{ side, mod, type? }].
  // effectiveMods returns the mods with those applied; nothing is changed permanently.
  TI.effectiveMods = function (ctx) {
    const m = ctx.mods || {}, out = Object.assign({}, m);
    for (const b of ctx.buffs || []) {
      if (b.type) {
        const key = b.side === 'attacker' ? 'attackerSide' : 'defenderSide', base = out[key] || {};
        const prev = base.unitMod;
        out[key] = Object.assign(Object.create(base), { unitMod: (u, f) => (prev ? prev(u, f) : 0) + (u.type === b.type ? b.mod : 0) });
      } else out[b.side] = (out[b.side] || 0) + b.mod;
    }
    return out;
  };

  // What each unit needs to hit this round (for the "before you roll" screen). Same arithmetic as sideRoll, no dice.
  TI.combatPreview = function (force, stats, mod, onlyType, side) {
    const out = [];
    for (const u of force) {
      const s = T(stats)[u.type];
      if (onlyType && s.type !== onlyType) continue;
      const m = (mod || 0) + (side && side.unitMod ? side.unitMod(u, force) : 0);
      out.push({ unit: u, need: Math.min(10, Math.max(1, s.combat - m)), dice: side && side.diceFor ? side.diceFor(u, s) : s.dice });
    }
    return out;
  };

  // Space combat, split into steps so the tactical action can offer retreats between rounds.
  // mods: { attacker, defender (roll modifiers), attackerStats, defenderStats, attackerSide, defenderSide }
  //   spaceCombatStart   anti-fighter barrage and Assault Cannon (first round only)
  //   spaceCombatRound   one round of rolls, hits, repairs
  //   spaceCombatFinish  decides the winner
  //   spaceCombat        all of it, to the death (used when nobody can retreat)
  TI.spaceCombatStart = function (attackers, defenders, rng, mods) {
    mods = mods || {};
    const log = { rounds: 0, afbKills: { attacker: 0, defender: 0 } };
    const aShooters = attackers.slice(), dShooters = defenders.slice();
    log.afbKills.defender = barrage(rng, aShooters, mods.attackerStats, defenders);
    log.afbKills.attacker = barrage(rng, dShooters, mods.defenderStats, attackers);

    // Assault Cannon: with 3+ non-fighter ships at the start of combat, the opponent destroys one of theirs.
    const nonFighters = (f, st) => f.filter((u) => T(st)[u.type].type === 'ship' && u.type !== 'fighter');
    const aAC = mods.attackerSide && mods.attackerSide.assaultCannon && nonFighters(attackers, mods.attackerStats).length >= 3;
    const dAC = mods.defenderSide && mods.defenderSide.assaultCannon && nonFighters(defenders, mods.defenderStats).length >= 3;
    const cheapest = (f, st) => nonFighters(f, st).sort((a, b) => T(st)[a.type].cost - T(st)[b.type].cost)[0];
    const hitA = aAC ? cheapest(defenders, mods.defenderStats) : null, hitD = dAC ? cheapest(attackers, mods.attackerStats) : null;
    if (hitA) defenders.splice(defenders.indexOf(hitA), 1);
    if (hitD) attackers.splice(attackers.indexOf(hitD), 1);
    log.assaultCannon = { attacker: !!hitA, defender: !!hitD };
    // Pre-combat hits (Mentak Ambush, Yin Impulse Core, Creuss Dimensional Splicer): produced at the start of the combat.
    const pre = (side, own, ownStats, foe, foeStats) => {
      const n = side && side.preHits ? side.preHits(own, foe, rng, ownStats, foeStats) : 0;
      if (n > 0) assignHits(foe, n, foeStats, { nonFighter: !!side.preHitsNonFighter });
      return n;
    };
    log.preHits = { attacker: pre(mods.attackerSide, attackers, mods.attackerStats, defenders, mods.defenderStats),
                    defender: pre(mods.defenderSide, defenders, mods.defenderStats, attackers, mods.attackerStats) };
    return { attackers, defenders, rng, mods, log };
  };

  // A round is two steps so a player can roll and choose casualties by hand:
  //   spaceRoundRoll     round-start abilities and both sides' dice (stored on ctx.roll)
  //   spaceRoundResolve  assign the hits, using the casualties each player chose ({attacker: [units], defender: [units]})
  TI.spaceRoundRoll = function (ctx) {
    const { attackers, defenders, rng, mods, log } = ctx;
    log.rounds++;
    if (mods.attackerSide && mods.attackerSide.roundStart) mods.attackerSide.roundStart(attackers);
    if (mods.defenderSide && mods.defenderSide.roundStart) mods.defenderSide.roundStart(defenders);
    const em = TI.effectiveMods(ctx);
    ctx.roll = {
      attacker: sideRoll(rng, attackers, mods.attackerStats, em.attacker, 'ship', em.attackerSide),
      defender: sideRoll(rng, defenders, mods.defenderStats, em.defender, 'ship', em.defenderSide),
    };
    ctx.roll.attacker.cancelled = 0; ctx.roll.defender.cancelled = 0;
    return ctx.roll;
  };

  TI.spaceRoundResolve = function (ctx, plans) {
    const { attackers, defenders, mods } = ctx;
    plans = plans || {};
    // Duranium Armor: after hits are assigned, repair 1 damaged unit that did not sustain damage this round.
    const repair = (force, sustained, side) => {
      if (!side || !side.duranium) return;
      const u = force.find((x) => x.damaged && !sustained.includes(x));
      if (u) u.damaged = false;
    };
    const aHits = ctx.roll.attacker.hits, dHits = ctx.roll.defender.hits;
    const aSus = [], dSus = [];
    const aBefore = attackers.slice(), dBefore = defenders.slice();
    assignHits(defenders, aHits, mods.defenderStats, { sustained: dSus, plan: plans.defender, nonFighter: !!(mods.attackerSide && mods.attackerSide.nonFighterHits) });
    assignHits(attackers, dHits, mods.attackerStats, { sustained: aSus, plan: plans.attacker, nonFighter: !!(mods.defenderSide && mods.defenderSide.nonFighterHits) });
    // Yin's Van Hauge: when it is destroyed, every ship in the system is destroyed.
    const boom = (before, force, stats) => before.some((u) => u.type === 'flagship' && !force.includes(u) && T(stats).flagship && T(stats).flagship.suicide);
    if (boom(aBefore, attackers, mods.attackerStats) || boom(dBefore, defenders, mods.defenderStats)) { attackers.length = 0; defenders.length = 0; ctx.log.vanHauge = true; }
    repair(attackers, aSus, mods.attackerSide);
    repair(defenders, dSus, mods.defenderSide);
    if (attackers.length && defenders.length) {
      if (mods.attackerSide && mods.attackerSide.afterRound) mods.attackerSide.afterRound(attackers, defenders, mods.defenderStats, ctx.rng);
      if (mods.defenderSide && mods.defenderSide.afterRound) mods.defenderSide.afterRound(defenders, attackers, mods.attackerStats, ctx.rng);
    }
    ctx.roll = null; ctx.buffs = [];
  };

  TI.spaceCombatRound = function (ctx) { TI.spaceRoundRoll(ctx); TI.spaceRoundResolve(ctx, null); };

  TI.spaceCombatFinish = function (ctx) {
    const { attackers, defenders, log } = ctx;
    log.winner = attackers.length && !defenders.length ? 'attacker'
               : defenders.length && !attackers.length ? 'defender' : 'none';
    return log;
  };

  TI.spaceCombat = function (attackers, defenders, rng, mods) {
    const ctx = TI.spaceCombatStart(attackers, defenders, rng, mods);
    while (attackers.length && defenders.length && ctx.log.rounds < 50) TI.spaceCombatRound(ctx);
    return TI.spaceCombatFinish(ctx);
  };

  // Bombardment: dreadnoughts/war suns/flagships shoot ground forces (infantry only).
  // opts: { extraDie (Plasma Scoring), dead (receives destroyed infantry) }
  TI.bombard = function (ships, groundDefenders, rng, shipStats, opts) {
    opts = opts || {};
    let hits = 0, boosted = !opts.extraDie;
    for (const u of ships) {
      const b = T(shipStats)[u.type].bombard;
      if (!b) continue;
      hits += rollHits(rng, b.value, b.dice + (boosted ? 0 : 1), opts.mod || 0);
      boosted = true;
    }
    let killed = 0;
    for (let i = 0; i < groundDefenders.length && hits > 0; ) {
      if (groundDefenders[i].type === 'infantry') { const [d] = groundDefenders.splice(i, 1); if (opts.dead) opts.dead.push(d); hits--; killed++; }
      else i++;
    }
    return killed;
  };

  // Space cannon: shooters (PDS or ships with a cannon) shoot arriving ships.
  // opts: { mod (negative = Antimass -1), extraDie (Plasma Scoring), nonFighter (Graviton Laser) }
  // cannonRoll only rolls (so a card can cancel hits); spaceCannon rolls and assigns.
  TI.cannonRoll = function (structures, rng, structStats, opts) {
    opts = opts || {};
    let hits = 0, boosted = !opts.extraDie;
    for (const u of structures) {
      const c = T(structStats)[u.type].cannon;
      if (!c) continue;
      hits += rollHits(rng, c.value, c.dice + (boosted ? 0 : 1), opts.mod || 0, opts.rolls);
      if (opts.need) opts.need.push(Math.min(10, Math.max(1, c.value - (opts.mod || 0))));
      boosted = true;
    }
    return hits;
  };
  TI.spaceCannon = function (structures, attackerShips, rng, structStats, shipStats, opts) {
    opts = opts || {};
    return assignHits(attackerShips, TI.cannonRoll(structures, rng, structStats, opts), shipStats, { nonFighter: opts.nonFighter });
  };

  // Ground combat, also in steps. mods: { attacker, defender, attackerStats, defenderStats, attackerSide, defenderSide, attackerDead, defenderDead }
  TI.groundCombatStart = function (attackers, defenders, rng, mods) {
    return { attackers, defenders, rng, mods: mods || {}, log: { rounds: 0 } };
  };
  TI.groundRoundRoll = function (ctx) {
    const { attackers, defenders, rng, mods, log } = ctx;
    log.rounds++;
    const em = TI.effectiveMods(ctx);
    const a = sideRoll(rng, attackers, mods.attackerStats, em.attacker, null, em.attackerSide);
    const d = sideRoll(rng, defenders, mods.defenderStats, em.defender, null, em.defenderSide);
    a.cancelled = 0; d.cancelled = 0;
    const a0 = a.hits, d0 = d.hits;
    a.bonus = 0; d.bonus = 0;
    if (mods.attackerSide && mods.attackerSide.valkyrie && d0 > 0) { a.hits++; a.bonus = 1; }
    if (mods.defenderSide && mods.defenderSide.valkyrie && a0 > 0) { d.hits++; d.bonus = 1; }
    ctx.roll = { attacker: a, defender: d };
    return ctx.roll;
  };
  TI.groundRoundResolve = function (ctx, plans) {
    const { attackers, defenders, mods } = ctx;
    plans = plans || {};
    assignHits(defenders, ctx.roll.attacker.hits, mods.defenderStats, { dead: mods.defenderDead, plan: plans.defender });
    assignHits(attackers, ctx.roll.defender.hits, mods.attackerStats, { dead: mods.attackerDead, plan: plans.attacker });
    ctx.roll = null; ctx.buffs = [];
  };
  TI.groundCombatFinish = function (ctx) {
    const { attackers, defenders, log } = ctx;
    log.winner = attackers.length && !defenders.length ? 'attacker'
               : defenders.length && !attackers.length ? 'defender' : 'none';
    return log;
  };
  TI.groundCombat = function (attackers, defenders, rng, mods) {
    const ctx = TI.groundCombatStart(attackers, defenders, rng, mods);
    while (attackers.length && defenders.length && ctx.log.rounds < 50) { TI.groundRoundRoll(ctx); TI.groundRoundResolve(ctx, null); }
    return TI.groundCombatFinish(ctx);
  };

  TI._assignHits = assignHits; // exposed for tests

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
