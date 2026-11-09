// Faction rules: data matches the faction sheets and each ability does what the sheet says.
const assert = require('assert');
['rng', 'units', 'combat', 'tiles', 'map', 'data', 'factions2', 'state', 'moves', 'tactical', 'abilities', 'phases', 'cards', 'actioncards', 'agenda', 'trade', 'abilities2']
  .forEach((f) => require('../src/' + f + '.js'));
const TI = globalThis.TI;

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok -', name); }

const game = (ids, seed) => TI.createGame({ seed: seed || 5, players: ids.map((f, i) => ({ name: f + i, factionId: f, bot: null })) });
const home = (g, p) => g.map.systems[g.map.order.find((id) => g.map.systems[id].home === p)];
const mk = (...types) => types.map(TI.makeUnit);
const constRng = (v) => ({ d10: () => v, next: () => 0.5 });
const tech = (p, ...ids) => { ids.forEach((t) => p.techs.push(t)); TI.refreshStats(p); };
const count = (list, t) => list.filter((u) => u.type === t).length;
const stubAgents = (g) => g.players.map(() => ({ wantSecondary: () => true, distributeTokens: (s, p, n) => ({ tactic: n, fleet: 0, strategy: 0 }), chooseProduction: () => [] }));

(async () => {
  await test('every faction: starting units match the sheet and fit the fleet supply', () => {
    const want = {
      sol:     { ships: { carrier: 2, fighter: 3, destroyer: 1 }, inf: 5, pds: 0, comm: 4, res: 4, inf_: 2 },
      hacan:   { ships: { carrier: 2, fighter: 2, cruiser: 1 }, inf: 4, pds: 0, comm: 6, res: 3, inf_: 3 },
      letnev:  { ships: { carrier: 1, fighter: 1, destroyer: 1, dreadnought: 1 }, inf: 3, pds: 0, comm: 2, res: 6, inf_: 1 },
      jolnar:  { ships: { carrier: 2, fighter: 1, dreadnought: 1 }, inf: 2, pds: 2, comm: 4, res: 3, inf_: 5 },
      sardakk: { ships: { carrier: 2, cruiser: 1 }, inf: 5, pds: 1, comm: 3, res: 4, inf_: 1 },
      xxcha:   { ships: { carrier: 1, fighter: 3, cruiser: 2 }, inf: 4, pds: 1, comm: 4, res: 3, inf_: 4 },
    };
    for (const id of Object.keys(want)) {
      const g = game([id, 'sol'].slice(0, id === 'sol' ? 1 : 2).concat(id === 'sol' ? ['hacan'] : []));
      const h = home(g, 0), w = want[id], ships = h.ships[0];
      for (const [t, n] of Object.entries(w.ships)) assert.strictEqual(count(ships, t), n, `${id} ${t}`);
      assert.strictEqual(ships.length, Object.values(w.ships).reduce((a, b) => a + b, 0), id + ' ship total');
      assert.strictEqual(h.planets.reduce((n, p) => n + p.ground.length, 0), w.inf, id + ' infantry');
      assert.strictEqual(h.planets.reduce((n, p) => n + p.pds, 0), w.pds, id + ' PDS');
      assert.strictEqual(TI.faction(g.players[0]).commodities, w.comm, id + ' commodities');
      assert.strictEqual(h.planets.reduce((n, p) => n + p.res, 0), w.res, id + ' home resources');
      assert.strictEqual(h.planets.reduce((n, p) => n + p.inf, 0), w.inf_, id + ' home influence');
      assert(ships.filter((u) => u.type !== 'fighter').length <= g.players[0].tokens.fleet, id + ' exceeds fleet supply');
      assert(h.planets[0].dock, id + ' space dock');
    }
  });

  await test('faction techs exist, belong to their faction, and flagship stats match the sheets', () => {
    for (const f of TI.FACTIONS) {
      for (const t of f.factionTechs) assert.strictEqual(TI.TECHS[t].faction, f.id, t);
      for (const t of f.techs) assert(TI.TECHS[t], 'start tech ' + t);
      for (const t of f.techPlan) assert(TI.TECHS[t], 'plan tech ' + t);
    }
    const fl = Object.fromEntries(TI.FACTIONS.map((f) => [f.id, f.flagship]));
    assert.deepStrictEqual([fl.sol.cost, fl.sol.combat, fl.sol.dice, fl.sol.move, fl.sol.cap], [8, 5, 2, 1, 12]);
    assert.deepStrictEqual([fl.hacan.cost, fl.hacan.combat, fl.hacan.cap], [8, 7, 3]);
    assert.deepStrictEqual([fl.letnev.combat, fl.letnev.bombard.value, fl.letnev.bombard.dice], [5, 5, 3]);
    assert.deepStrictEqual([fl.jolnar.combat, fl.jolnar.cap], [6, 3]);
    assert.deepStrictEqual([fl.sardakk.cost, fl.sardakk.combat], [6, 6]);
    assert.deepStrictEqual([fl.xxcha.combat, fl.xxcha.cannon.value, fl.xxcha.cannon.dice], [7, 5, 3]);
  });

  await test('research: faction techs are exclusive and replace their generic versions', () => {
    const g = game(['sol', 'sardakk']), sol = g.players[0], sar = g.players[1];
    tech(sol, 'sarween'); // sol has antimass (blue) + neural (green); needs GG for Spec Ops II
    assert(!TI.canResearch(sol, 'infantry2'), 'Sol uses Spec Ops II instead of Infantry II');
    assert(!TI.canResearch(sar, 'spec_ops2'), 'Spec Ops II is Sol-only');
    tech(sol, 'dacxive');                                   // second green tech
    assert(TI.canResearch(sol, 'spec_ops2'));
    assert(!TI.canResearch(sar, 'dreadnought2') && !TI.canResearch(sar, 'exotrireme2'));
    tech(sar, 'antimass', 'gravity_drive', 'sarween');      // BB + Y
    assert(TI.canResearch(sar, 'exotrireme2'));
  });

  await test('Sol: Spec Ops/Advanced Carrier stats, revival, Genesis, Versatile', () => {
    const g = game(['sol', 'hacan']), p = g.players[0];
    assert.strictEqual(p.stats.infantry.combat, 7);
    assert.strictEqual(p.stats.carrier.cap, 6);
    tech(p, 'adv_carrier2', 'spec_ops2');
    assert.deepStrictEqual([p.stats.infantry.combat, p.stats.infantry.revive], [6, 5]);
    assert.deepStrictEqual([p.stats.carrier.move, p.stats.carrier.cap, p.stats.carrier.sustain], [2, 8, true]);
    // revival: a 5+ brings the unit back at the start of the next turn
    TI.reviveRolls(g, p, mk('infantry', 'infantry'));      // rng is real; force it
    p.revive = 0;
    const g2 = game(['sol', 'hacan']); const p2 = g2.players[0]; tech(p2, 'spec_ops2');
    g2.rng = constRng(5);
    TI.reviveRolls(g2, p2, mk('infantry', 'infantry', 'fighter'));
    assert.strictEqual(p2.revive, 2);
    const before = home(g2, 0).planets[0].ground.length;
    TI.placeRevived(g2, p2);
    assert.strictEqual(home(g2, 0).planets[0].ground.length, before + 2);
    g2.rng = constRng(4); TI.reviveRolls(g2, p2, mk('infantry'));
    assert.strictEqual(p2.revive, 0);
    // Genesis
    const gen = TI.makeUnit('flagship'), h = home(g, 0);
    h.ships[0].push(gen);
    TI.statusAbilities(g);
    assert.strictEqual(TI.cargoOf(h, 0).length, 1);
    // Versatile: 2 base + 1
    assert.strictEqual(2 + (TI.faction(p).ability.extraTokens || 0), 3);
  });

  await test('Sol: Orbital Drop spends a strategy token and lands 2 infantry', async () => {
    const g = game(['sol', 'hacan']), p = g.players[0], agents = stubAgents(g);
    const acts = TI.factionActions(g, p);
    assert.strictEqual(acts.length, 1); assert(acts[0].ok);
    const n = TI.groundCount(g, p), s = p.tokens.strategy;
    await TI.runFactionAction(g, agents, p, 'orbital_drop');
    assert.strictEqual(TI.groundCount(g, p), n + 2);
    assert.strictEqual(p.tokens.strategy, s - 1);
    p.tokens.strategy = 0;
    assert(!TI.factionActions(g, p)[0].ok);
  });

  await test('Hacan: free Trade secondary, Production Biomes, Quantum Datahub swap', async () => {
    const g = game(['sol', 'hacan']), sol = g.players[0], hac = g.players[1], agents = stubAgents(g);
    const s0 = hac.tokens.strategy;
    await TI.useStrategyCard(g, agents, sol, 5);
    assert.strictEqual(hac.tokens.strategy, s0, 'Hacan follows Trade without spending a token');
    assert.strictEqual(TI.commOf(hac), 6, 'commodities replenished to 6');
    // Production Biomes
    tech(hac, 'production_biomes');
    const tg = hac.tg, soltg = sol.tg;
    await TI.runFactionAction(g, agents, hac, 'production_biomes');
    assert.strictEqual(hac.tg, tg + 4); assert.strictEqual(sol.tg, soltg + 2);
    assert(!TI.factionActions(g, hac)[0].ok, 'exhausted');
    // Quantum Datahub: Hacan holds card 2, Sol holds Imperial
    tech(hac, 'quantum_datahub');
    hac.cards = [2]; sol.cards = [8]; g.cards.find((c) => c.id === 2).owner = 1; g.cards.find((c) => c.id === 8).owner = 0;
    hac.tg = 5;
    await TI.afterStrategyPhase(g, agents);
    assert.deepStrictEqual([hac.cards, sol.cards], [[8], [2]]);
    assert.strictEqual(hac.tg, 2);
  });

  await test('Hacan flagship: spends trade goods only to turn near-misses into hits', () => {
    const g = game(['hacan', 'sol']), p = g.players[0];
    const side = TI.combatSide(g, p, 'space');
    side.roundStart(mk('flagship', 'cruiser'));
    p.tg = 2;
    assert(side.boost(null, 6, 7), 'a 6 against need 7 is boosted');
    assert(!side.boost(null, 5, 7), 'more than 1 short is not');
    assert.strictEqual(p.tg, 1);
    p.tg = 0; assert(!side.boost(null, 6, 7));
  });

  await test('Letnev: Armada, flagship repair, Munitions Reserves, Non-Euclidean, L4', () => {
    const g = game(['letnev', 'sol']), p = g.players[0];
    assert.strictEqual(TI.fleetLimit(p), p.tokens.fleet + 2);
    assert.deepStrictEqual([p.stats.flagship.bombard.value, p.stats.flagship.bombard.dice], [5, 3]);
    const side = TI.combatSide(g, p, 'space');
    const fl = TI.makeUnit('flagship'); fl.damaged = true;
    p.tg = 0; side.roundStart([fl]);
    assert.strictEqual(fl.damaged, false, 'flagship repairs at the start of each round');
    assert.strictEqual(side.rerollMisses, false);
    p.tg = 3; side.roundStart(mk('flagship', 'dreadnought'));
    assert.strictEqual(side.rerollMisses, true); assert.strictEqual(p.tg, 1);
    // Non-Euclidean: one sustain cancels 2 hits
    tech(p, 'non_euclidean');
    const f = mk('dreadnought');
    assert.strictEqual(TI._assignHits(f, 2, p.stats), 0);
    assert.strictEqual(f[0].damaged, true); assert.strictEqual(f.length, 1);
    assert.strictEqual(TI._assignHits(f, 2, p.stats), 1);
    // L4 Disruptors: PDS cannot shoot Letnev's landing force
    tech(p, 'l4_disruptors');
    const target = g.map.systems[home(g, 0).adj.find((id) => g.map.systems[id].planets.length && !g.map.systems[id].anomaly && g.map.systems[id].home === null)];
    const pl = target.planets[0]; pl.owner = 1; pl.pds = 2; pl.ground = []; pl.dock = false;
    target.ships[0] = mk('carrier');
    TI.cargoOf(target, 0).push(...mk('infantry', 'infantry'));
    g.rng = constRng(10);                                    // PDS would hit every die if they fired
    assert(TI.invade(g, p, target.id, 0, TI.cargoOf(target, 0).slice()).captured);
    assert.strictEqual(pl.ground.length, 2, 'both infantry survived the (disabled) PDS');
  });

  await test('Jol-Nar: Fragile, flagship double hits, Analytical, Brilliant, E-Res, starting techs', async () => {
    const g = game(['jolnar', 'sardakk', 'sol']), jn = g.players[0], sar = g.players[1];
    assert.deepStrictEqual(jn.techs.slice().sort(), ['antimass', 'neural', 'plasma_scoring', 'sarween']);
    // Fragile vs Unrelenting: with every die showing 8, Jol-Nar infantry (need 9) miss, Sardakk's (need 7) hit
    const jnLose = TI.groundCombat(mk('infantry', 'infantry', 'infantry'), mk('infantry'), constRng(8),
      { attackerStats: jn.stats, defenderStats: sar.stats, attackerSide: TI.combatSide(g, jn, 'ground'), defenderSide: TI.combatSide(g, sar, 'ground') });
    assert.strictEqual(jnLose.winner, 'defender');
    const sarWin = TI.groundCombat(mk('infantry', 'infantry', 'infantry'), mk('infantry'), constRng(8),
      { attackerStats: sar.stats, defenderStats: jn.stats, attackerSide: TI.combatSide(g, sar, 'ground'), defenderSide: TI.combatSide(g, jn, 'ground') });
    assert.strictEqual(sarWin.winner, 'attacker');
    // Flagship: 9 or 10 gives 2 extra hits per die
    const side = TI.combatSide(g, jn, 'space'), fl = TI.makeUnit('flagship');
    assert.strictEqual(side.extraHits(fl, 9), 2); assert.strictEqual(side.extraHits(fl, 10), 2); assert.strictEqual(side.extraHits(fl, 8), 0);
    assert.strictEqual(side.extraHits(TI.makeUnit('cruiser'), 10), 0);
    // Analytical: one missing prerequisite is forgiven for non-unit-upgrade techs only
    assert(TI.canResearch(jn, 'fleet_logistics'), 'needs BB, has 1 blue (antimass): one short is forgiven');
    assert(!TI.canResearch(jn, 'light_wave'), 'needs BBB, two short: not forgiven');
    assert(!TI.canResearch(jn, 'infantry2'), 'unit upgrades keep their prerequisites (needs GG, has 1)');
    assert(!TI.canResearch(sar, 'fleet_logistics'), 'other factions are not forgiven');
    // Brilliant: following Technology resolves the primary (a free tech plus a paid one)
    const agents = stubAgents(g); agents[0].chooseTech = (s, p, opts) => opts[0];
    jn.tg = 20; const n = jn.techs.length;
    await TI.useStrategyCard(g, agents, g.players[2], 7);
    assert(jn.techs.length >= n + 1);
    // E-Res Siphons
    tech(jn, 'eres_siphons');
    const tgBefore = jn.tg;
    g.map.systems[home(g, 1).id].ships[0] = mk('cruiser');   // Jol-Nar ship in Sardakk's home
    assert.strictEqual(await TI.onActivated(g, agents, sar, home(g, 1).id), false);
    assert.strictEqual(jn.tg, tgBefore + 4);
  });

  await test('Jol-Nar: Spacial Conduit lets distant ships reach an activated system', () => {
    const g = game(['jolnar', 'sol']), p = g.players[0], h = home(g, 0);
    const far = g.map.order.find((id) => TI.systemDistance(g.map, h.id, id) === 3 && !g.map.systems[id].anomaly);
    g.map.systems[far].ships[0] = mk('cruiser');
    assert(!TI.movableShips(g, p, h.id).some((m) => m.from === far), 'cruiser (move 2) cannot reach 3 jumps away');
    tech(p, 'spacial_conduit');
    TI.activate(g, p, h.id);
    TI.tryConduit(g, p, h.id);
    assert(p.exhausted.spacial_conduit);
    assert(TI.movableShips(g, p, h.id).some((m) => m.from === far));
    g.conduit = null;
    assert(!TI.movableShips(g, p, h.id).some((m) => m.from === far));
  });

  await test('Sardakk: flagship aura, Exotrireme, Valkyrie, sacrifice', () => {
    const g = game(['sardakk', 'sol']), p = g.players[0];
    assert.strictEqual(p.stats.flagship.cost, 6);
    assert.deepStrictEqual([p.stats.dreadnought.bombard.value, p.stats.dreadnought.bombard.dice], [4, 2]);
    const side = TI.combatSide(g, p, 'space');
    const force = mk('flagship', 'cruiser');
    assert.strictEqual(side.unitMod(force[1], force), 2, 'Unrelenting +1 and flagship +1');
    assert.strictEqual(side.unitMod(force[0], force), 1, 'the flagship does not buff itself');
    assert.strictEqual(side.unitMod(force[1], [force[1]]), 1, 'no flagship, no aura');
    // Exotrireme II sacrifice: kills the two most valuable enemy ships
    tech(p, 'exotrireme2');
    const s2 = TI.combatSide(g, p, 'space');
    const mine = mk('dreadnought', 'cruiser'), theirs = mk('carrier', 'dreadnought', 'fighter');
    s2.afterRound(mine, theirs);
    assert.deepStrictEqual(mine.map((u) => u.type), ['cruiser']);
    assert.deepStrictEqual(theirs.map((u) => u.type), ['fighter']);
    const cheap = mk('fighter', 'fighter');
    const m2 = mk('dreadnought'); s2.afterRound(m2, cheap);
    assert.strictEqual(m2.length, 1, 'not worth sacrificing against fighters');
    // Valkyrie: if the opponent scores a hit, Sardakk scores 1 extra. Dice: attacker 10, defenders 10 and 1.
    const seq = () => { const v = [10, 10, 1]; let i = 0; return { d10: () => v[i++ % 3], next: () => 0.5 }; };
    const defenders = () => mk('infantry', 'infantry'), foe = g.players[1].stats;
    const withoutV = defenders();
    TI.groundCombat(mk('infantry'), withoutV, seq(), { attackerStats: p.stats, defenderStats: foe,
      attackerSide: Object.assign(TI.combatSide(g, p, 'ground'), { valkyrie: false }), defenderSide: TI.combatSide(g, g.players[1], 'ground') });
    assert.strictEqual(withoutV.length, 1, 'one hit kills one defender');
    tech(p, 'valkyrie');
    const withV = defenders();
    TI.groundCombat(mk('infantry'), withV, seq(), { attackerStats: p.stats, defenderStats: foe,
      attackerSide: TI.combatSide(g, p, 'ground'), defenderSide: TI.combatSide(g, g.players[1], 'ground') });
    assert.strictEqual(withV.length, 0, 'Valkyrie adds the second hit');
  });

  await test('Plasma Scoring adds a die; Antimass subtracts 1; Graviton Laser targets non-fighters', () => {
    const calls = [];
    const rng = { d10: () => { calls.push(1); return 1; } };
    TI.bombard(mk('dreadnought', 'dreadnought'), mk('infantry'), rng, null, { extraDie: false });
    assert.strictEqual(calls.length, 2);
    calls.length = 0;
    TI.bombard(mk('dreadnought', 'dreadnought'), mk('infantry'), rng, null, { extraDie: true });
    assert.strictEqual(calls.length, 3);
    // PDS cannon is 6+: a 6 hits normally and misses against Antimass (-1)
    assert.strictEqual(TI.spaceCannon(mk('pds'), mk('cruiser'), constRng(6)), 1);
    assert.strictEqual(TI.spaceCannon(mk('pds'), mk('cruiser'), constRng(6), null, null, { mod: -1 }), 0);
    // Graviton: the hit lands on the carrier, not the fighters
    const ships = mk('fighter', 'fighter', 'carrier');
    TI.spaceCannon(mk('pds'), ships, constRng(10), null, null, { nonFighter: true });
    assert.deepStrictEqual(ships.map((u) => u.type).sort(), ['fighter', 'fighter']);
    const ships2 = mk('fighter', 'fighter', 'carrier');
    TI.spaceCannon(mk('pds'), ships2, constRng(10));
    assert.strictEqual(count(ships2, 'fighter'), 1, 'without Graviton the cheapest ship takes it');
  });

  await test('Xxcha: flagship cannon reaches adjacent systems; Antimass and Graviton apply', () => {
    const g = game(['xxcha', 'sol']), xx = g.players[0], sol = g.players[1];
    const h = home(g, 0), adj = g.map.systems[h.adj.find((id) => !g.map.systems[id].anomaly && g.map.systems[id].home === null)];
    h.ships[0].push(TI.makeUnit('flagship'));
    adj.ships[1] = mk('fighter', 'fighter', 'carrier');
    g.rng = constRng(10);
    tech(xx, 'plasma_scoring');
    const killed = TI.cannonOffense(g, sol, adj.id);
    assert(killed >= 1, 'flagship fires from the adjacent system');
    assert.strictEqual(count(adj.ships[1], 'carrier'), 0, 'Graviton Laser sends the hits to the carrier first');
    // Too far away: nothing fires
    const far = g.map.order.find((id) => TI.systemDistance(g.map, h.id, id) >= 2 && !g.map.systems[id].anomaly && g.map.systems[id].home === null && !g.map.systems[id].planets.some((p) => p.owner !== null));
    g.map.systems[far].ships[1] = mk('cruiser', 'cruiser');
    assert.strictEqual(TI.cannonOffense(g, sol, far), 0);
  });

  await test('Xxcha: Nullification Field ends the activator\'s turn; Peace Accords takes an empty planet', async () => {
    const g = game(['xxcha', 'sol']), xx = g.players[0], sol = g.players[1];
    tech(xx, 'nullification');
    const agents = stubAgents(g); agents[0].wantNullify = () => true;
    const sys = g.map.systems[home(g, 0).adj.find((id) => g.map.systems[id].home === null && !g.map.systems[id].anomaly)];
    sys.ships[0] = mk('cruiser');
    const s0 = xx.tokens.strategy;
    assert.strictEqual(await TI.onActivated(g, agents, sol, sys.id), true);
    assert.strictEqual(xx.tokens.strategy, s0 - 1);
    assert(xx.exhausted.nullification);
    assert.strictEqual(await TI.onActivated(g, agents, sol, sys.id), false, 'exhausted until the status phase');
    // the full tactical action returns without moving anything
    const g3 = game(['xxcha', 'sol']); tech(g3.players[0], 'nullification');
    const ag3 = stubAgents(g3); ag3[0].wantNullify = () => true;
    ag3[1].chooseTarget = () => { const h = home(g3, 1); return h.id; };
    g3.map.systems[home(g3, 1).id].ships[0] = mk('cruiser');
    ag3[1].planMove = () => { throw new Error('should not be asked to move'); };
    assert.strictEqual(await TI.tacticalAction(g3, ag3, g3.players[1]), true);

    // Peace Accords
    const g2 = game(['xxcha', 'sol']), p = g2.players[0];
    const opts = TI.peaceAccordsOptions(g2, p);
    assert(opts.length > 0 && opts.every((o) => o.systemId !== '0,0' && !o.ground.length));
    const a2 = stubAgents(g2);
    await TI.peaceAccords(g2, a2, p);
    assert.strictEqual(TI.planetsOwned(g2, p).length, 3, 'two home planets plus one taken');
    // planets with units are off limits
    const occupied = opts[0]; occupied.ground.push(TI.makeUnit('infantry')); occupied.owner = null;
    assert(!TI.peaceAccordsOptions(g2, p).includes(occupied));
  });

  await test('production: one flagship per player, Sarween discount, Sardakk flagship is cheaper', () => {
    const g = game(['sardakk', 'sol']), p = g.players[0], h = home(g, 0);
    p.tokens.fleet = 5; p.tg = 20;
    const built = TI.produce(g, p, h.id, [{ unit: 'flagship' }, { unit: 'flagship' }]);
    assert.strictEqual(built.length, 1, 'second flagship refused');
    assert.strictEqual(count(h.ships[0], 'flagship'), 1);
    // Sarween: 1 less in total
    const g2 = game(['hacan', 'sol']), q = g2.players[0], h2 = home(g2, 0);
    q.tokens.fleet = 5; q.tg = 0;
    const planetsRes = h2.planets.reduce((n, pl) => n + pl.res, 0);   // 3 resources
    assert.strictEqual(TI.produce(g2, q, h2.id, [{ unit: 'dreadnought' }]).length, 1, 'cost 4 - 1 = 3 resources is affordable');
    const g3 = game(['sol', 'sol']), r = g3.players[0], h3 = home(g3, 0);
    r.tokens.fleet = 5; h3.planets.forEach((pl) => { pl.exhausted = true; }); r.tg = 3;
    assert.strictEqual(TI.produce(g3, r, h3.id, [{ unit: 'dreadnought' }]).length, 0, 'no Sarween: 3 is not enough for a dreadnought');
  });

  await test('cargo in orbit stays with the ships that remain, and follows the ships that leave', () => {
    const g = game(['sol', 'hacan']), p = g.players[0], h = home(g, 0);
    h.ships[0].push(TI.makeUnit('flagship'));
    TI.statusAbilities(g);
    const target = g.map.systems[h.adj.find((id) => g.map.systems[id].planets.length && !g.map.systems[id].anomaly && g.map.systems[id].home === null)];
    TI.activate(g, p, target.id);
    const fl = h.ships[0].find((u) => u.type === 'flagship');
    assert(TI.executeMove(g, p, target.id, { ships: [{ from: h.id, unit: fl }], ground: [] }).ok);
    assert.strictEqual(TI.cargoOf(h, 0).length, 1, 'the carriers left at home can hold the Genesis infantry');

    // flagship is the only ship: its cargo has to go with it
    const g2 = game(['sol', 'hacan']), p2 = g2.players[0], h2 = home(g2, 0);
    h2.ships[0] = [TI.makeUnit('flagship')];
    TI.cargoOf(h2, 0).push(...mk('infantry', 'infantry'));
    const t2 = g2.map.systems[h2.adj.find((id) => !g2.map.systems[id].anomaly && g2.map.systems[id].home === null)];
    TI.activate(g2, p2, t2.id);
    assert(TI.executeMove(g2, p2, t2.id, { ships: [{ from: h2.id, unit: h2.ships[0][0] }], ground: [] }).ok);
    assert.strictEqual(TI.cargoOf(t2, 0).length, 2);
    assert.strictEqual(TI.cargoOf(h2, 0).length, 0);
  });

  await test('landing on your own planet adds to its garrison instead of replacing it', () => {
    const g = game(['sol', 'hacan']), p = g.players[0], h = home(g, 0);
    const n = h.planets[0].ground.length;
    TI.cargoOf(h, 0).push(...mk('infantry', 'infantry'));
    TI.invade(g, p, h.id, 0, TI.cargoOf(h, 0).slice());
    assert.strictEqual(h.planets[0].ground.length, n + 2);
  });

  console.log('\n' + passed + ' tests passed');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
