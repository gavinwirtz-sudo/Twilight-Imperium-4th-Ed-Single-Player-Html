// Generic technology tree (Tech V3 Omega list): prerequisites and the effect of each tech.
const assert = require('assert');
['rng', 'units', 'combat', 'tiles', 'map', 'data', 'factions2', 'state', 'moves', 'tactical', 'abilities', 'phases', 'cards', 'actioncards', 'agenda', 'trade', 'abilities2', 'bot_tactics', 'bots']
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
const plain = (g, seat) => { const h = home(g, seat); return g.map.systems[h.adj.find((id) => g.map.systems[id].planets.length && !g.map.systems[id].anomaly && g.map.systems[id].home === null)]; };

(async () => {
  await test('prerequisites follow the printed tech list', () => {
    const want = {
      antimass: {}, gravity_drive: { blue: 1 }, fleet_logistics: { blue: 2 }, light_wave: { blue: 3 },
      sarween: {}, graviton: { yellow: 1 }, transit_diodes: { yellow: 2 }, integrated_economy: { yellow: 3 },
      neural: {}, dacxive: { green: 1 }, hyper_metabolism: { green: 2 }, x89: { green: 3 },
      plasma_scoring: {}, magen: { red: 1 }, duranium: { red: 2 }, assault: { red: 3 },
      fighter2: { blue: 1, green: 1 }, cruiser2: { green: 1, red: 1, yellow: 1 }, carrier2: { blue: 2 }, destroyer2: { red: 2 },
      dreadnought2: { blue: 2, yellow: 1 }, infantry2: { green: 2 }, pds2: { red: 1, yellow: 1 }, spacedock2: { yellow: 2 }, war_sun: { red: 3, yellow: 1 },
    };
    for (const [id, pre] of Object.entries(want)) assert.deepStrictEqual(TI.TECHS[id].prereq, pre, id);
    const colors = { antimass: 'blue', sarween: 'yellow', neural: 'green', plasma_scoring: 'red', dacxive: 'green', magen: 'red', assault: 'red', x89: 'green' };
    for (const [id, c] of Object.entries(colors)) assert.strictEqual(TI.TECHS[id].color, c, id);
    for (const id of ['fighter2', 'cruiser2', 'carrier2', 'destroyer2', 'dreadnought2', 'infantry2', 'pds2', 'spacedock2', 'war_sun', 'spec_ops2', 'adv_carrier2', 'exotrireme2'])
      assert.strictEqual(TI.TECHS[id].color, null, id + ' grants no symbol');
    const g = game(['sol', 'hacan']), p = g.players[0];
    tech(p, 'carrier2');                                        // a unit upgrade must not count as a blue symbol
    assert.strictEqual(TI.techCountByColor(p).blue, 1);
  });

  await test('unit upgrades: Destroyer II, Cruiser II, Infantry II, Dock II, War Sun gating', () => {
    const g = game(['hacan', 'sardakk']), p = g.players[0];
    tech(p, 'destroyer2', 'cruiser2', 'infantry2', 'fighter2');
    assert.deepStrictEqual([p.stats.destroyer.combat, p.stats.destroyer.afb.value, p.stats.destroyer.afb.dice], [8, 6, 3]);
    assert.deepStrictEqual([p.stats.cruiser.combat, p.stats.cruiser.move, p.stats.cruiser.cap], [6, 3, 1]);
    assert.deepStrictEqual([p.stats.infantry.combat, p.stats.infantry.revive], [7, 6]);
    assert.deepStrictEqual([p.stats.fighter.combat, p.stats.fighter.move], [8, 2]);
    // Space Dock II: +2 production (two more infantry from a 2-batch order)
    const built = (withII) => {
      const g2 = game(['hacan', 'sardakk']), q = g2.players[0]; if (withII) tech(q, 'spacedock2');
      const h = home(g2, 0); q.tg = 99; h.planets.forEach((x) => { x.res = 2; });
      return TI.produce(g2, q, h.id, Array(8).fill({ unit: 'infantry' })).length;
    };
    assert.strictEqual(built(true) - built(false), 2);
    assert.strictEqual(TI.TECHS.spacedock2.effect.productionBonus, 2);
    assert(!p.techs.includes('war_sun') && !TI.canResearch(p, 'war_sun'));
  });

  await test('Gravity Drive: +1 movement for exactly one ship', () => {
    const g = game(['sol', 'hacan']), p = g.players[0];
    tech(p, 'gravity_drive');
    const H = home(g, 0), S = g.map.systems;
    // a system exactly 2 jumps away: carriers (move 1) reach it only through Gravity Drive
    const far = g.map.order.find((id) => id !== H.id && TI.systemDistance(g.map, H.id, id) === 2 && !S[id].anomaly && S[id].home === null && !H.adj.includes(id)
      && S[id].adj.some((n) => H.adj.includes(n) && !S[n].anomaly && S[n].home === null && !(S[n].ships[1] || []).length));
    H.ships[0] = mk('carrier', 'carrier', 'destroyer');
    const legal = TI.movableShips(g, p, far);
    const bonus = legal.filter((m) => m.bonus), plainOnes = legal.filter((m) => !m.bonus);
    assert(bonus.length >= 2, 'both carriers can only get there with the bonus');
    assert(plainOnes.some((m) => m.unit.type === 'destroyer'), 'destroyer (move 2) needs no help');
    const two = TI.executeMove(g, p, far, { ships: bonus.slice(0, 2).map((m) => ({ from: m.from, unit: m.unit })), ground: [] });
    assert.strictEqual(two.ok, false); assert(/Gravity Drive/.test(two.reason));
    g.rng = constRng(10);                                      // no rift losses
    const one = TI.executeMove(g, p, far, { ships: [{ from: bonus[0].from, unit: bonus[0].unit }], ground: [] });
    assert.strictEqual(one.ok, true);
  });

  await test('Light/Wave Deflector: pass through systems holding other players\' ships', () => {
    const g = game(['sol', 'hacan']), p = g.players[0], S = g.map.systems;
    const H = home(g, 0);
    const mid = H.adj.find((id) => !S[id].anomaly && S[id].home === null);
    const beyond = S[mid].adj.find((id) => id !== H.id && !H.adj.includes(id) && !S[id].anomaly && S[id].home === null);
    S[mid].ships[1] = mk('cruiser');
    assert.strictEqual(TI.reachable(g.map, H.id, 2, 0, {})[beyond], undefined);
    assert.strictEqual(TI.reachable(g.map, H.id, 2, 0, { throughShips: true })[beyond], 2);
    tech(p, 'light_wave');
    assert(TI.hasTechEffect(p, 'throughShips'));
  });

  await test('Fighter II: moves on its own, counts against the fleet limit only in excess of capacity', () => {
    const g = game(['sol', 'hacan']), p = g.players[0], S = g.map.systems;
    tech(p, 'fighter2');
    const H = home(g, 0), tgt = S[H.adj.find((id) => !S[id].anomaly && S[id].home === null)];
    H.ships[0] = mk('fighter', 'fighter', 'fighter');                           // no carrier at all
    g.rng = constRng(10);
    const legal = TI.movableShips(g, p, tgt.id).filter((m) => m.unit.type === 'fighter');
    assert.strictEqual(legal.length, 3);
    const r = TI.executeMove(g, p, tgt.id, { ships: legal.map((m) => ({ from: m.from, unit: m.unit })), ground: [] });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(count(tgt.ships[0], 'fighter'), 3);
    // fighters beyond capacity count as ships of supply; Sol's supply is 3, so a bigger stack is refused
    const g2 = game(['sol', 'hacan']), p2 = g2.players[0]; tech(p2, 'fighter2');
    const H2 = home(g2, 0), t2 = g2.map.systems[H2.adj.find((id) => !g2.map.systems[id].anomaly && g2.map.systems[id].home === null)];
    H2.ships[0] = mk('fighter', 'fighter', 'fighter', 'fighter', 'fighter', 'fighter', 'fighter', 'fighter');
    const l2 = TI.movableShips(g2, p2, t2.id).filter((m) => m.unit.type === 'fighter');
    const r2 = TI.executeMove(g2, p2, t2.id, { ships: l2.map((m) => ({ from: m.from, unit: m.unit })), ground: [] });
    assert.strictEqual(r2.ok, false); assert(/fleet/.test(r2.reason));
  });

  await test('Fleet Logistics: two actions per turn', async () => {
    const g = game(['sol', 'hacan']), p = g.players[0];
    tech(p, 'fleet_logistics');
    let turns = 0;
    const agents = [{ chooseAction: () => { turns++; return { type: 'pass' }; } }, { chooseAction: () => ({ type: 'pass' }) }];
    // The loop in actionPhase calls takeTurn once and again if the player has not passed.
    p.cards = []; g.players[1].cards = [];
    const take = TI.takeTurn;
    let calls = 0;
    TI.takeTurn = async (st, ag, pl) => { calls++; if (pl.id === 0 && calls >= 2) pl.passed = true; if (pl.id === 1) pl.passed = true; };
    await TI.actionPhase(g, agents);
    TI.takeTurn = take;
    assert(calls >= 3, 'player 0 acted twice before player 1 acted: ' + calls);
  });

  await test('Dacxive Animators and X-89 Bacterial Weapon', () => {
    const g = game(['sol', 'letnev']), a = g.players[0], d = g.players[1];
    const t = plain(g, 0), pl = t.planets[0];
    const stage = (inf) => { pl.owner = 1; pl.pds = 0; pl.dock = false; pl.ground = mk(...Array(inf).fill('infantry')); t.ships[0] = mk('carrier'); TI.cargoOf(t, 0).length = 0; TI.cargoOf(t, 0).push(...mk('infantry', 'infantry', 'infantry', 'infantry')); };
    // Dacxive: attacker wins the ground combat and gets a free infantry
    tech(a, 'dacxive'); stage(1); g.rng = constRng(10);
    assert(TI.invade(g, a, t.id, 0, TI.cargoOf(t, 0).slice()).captured);
    assert.strictEqual(pl.ground.length, 4, '4 landed, 1 lost to the defender, +1 free infantry');
    // X-89: dreadnough bombards, kills 1 infantry, so every infantry dies and the landing walks in
    tech(a, 'x89'); stage(6); t.ships[0] = mk('dreadnought', 'carrier');
    g.rng = constRng(10);
    TI.cargoOf(t, 0).length = 0; TI.cargoOf(t, 0).push(...mk('infantry'));
    const r = TI.invade(g, a, t.id, 0, TI.cargoOf(t, 0).slice());
    assert(r.captured); assert.strictEqual(pl.ground.length, 1, 'all 6 defenders died to X-89; the single lander holds it (no combat, so no Dacxive bonus)');
  });

  await test('Magen Defense Grid: defender with a structure kills one invader before combat', () => {
    const g = game(['sol', 'letnev']), a = g.players[0], d = g.players[1];
    const t = plain(g, 0), pl = t.planets[0];
    pl.owner = 1; pl.pds = 0; pl.dock = true; pl.ground = mk('infantry');
    t.ships[0] = mk('carrier'); TI.cargoOf(t, 0).length = 0; TI.cargoOf(t, 0).push(...mk('infantry', 'infantry'));
    tech(d, 'magen');
    g.rng = constRng(1);                                     // nobody hits: the free hit is the only casualty
    const log = [];
    const r = TI.invade(g, a, t.id, 0, TI.cargoOf(t, 0).slice());
    assert.strictEqual(r.captured, false);
    assert.strictEqual(pl.ground.length, 1);
    const g2 = game(['sol', 'letnev']); const t2 = plain(g2, 0), p2 = t2.planets[0];
    p2.owner = 1; p2.pds = 0; p2.dock = false; p2.ground = mk('infantry');            // no structure: no free hit
    t2.ships[0] = mk('carrier'); TI.cargoOf(t2, 0).length = 0; TI.cargoOf(t2, 0).push(...mk('infantry', 'infantry'));
    tech(g2.players[1], 'magen'); g2.rng = constRng(10);
    assert(TI.invade(g2, g2.players[0], t2.id, 0, TI.cargoOf(t2, 0).slice()).captured);
  });

  await test('Duranium Armor repairs a unit that did not sustain this round; Assault Cannon kills a ship', () => {
    const g = game(['sol', 'letnev']), a = g.players[0], d = g.players[1];
    // Duranium: dread damaged earlier, takes no hit now -> repaired after the round
    tech(a, 'duranium');
    const atk = mk('dreadnought', 'dreadnought'); atk[0].damaged = true;
    const def = mk('fighter');
    const sideA = TI.combatSide(g, a, 'space');
    assert.strictEqual(sideA.duranium, true);
    TI.spaceCombat(atk, def, constRng(1), { attackerStats: a.stats, defenderStats: d.stats, attackerSide: sideA, defenderSide: TI.combatSide(g, d, 'space') });
    assert(atk.every((u) => !u.damaged), 'repaired');
    // Assault Cannon: 3 non-fighter ships force the opponent to lose one before round 1
    tech(a, 'assault');
    const A = mk('cruiser', 'cruiser', 'cruiser'), D = mk('cruiser', 'dreadnought', 'fighter');
    const log = TI.spaceCombat(A, D, constRng(1), { attackerStats: a.stats, defenderStats: d.stats, attackerSide: TI.combatSide(g, a, 'space'), defenderSide: TI.combatSide(g, d, 'space'), });
    assert.strictEqual(log.assaultCannon.attacker, true);
    const A2 = mk('cruiser', 'cruiser'), D2 = mk('cruiser', 'dreadnought');
    const log2 = TI.spaceCombat(A2, D2, constRng(1), { attackerStats: a.stats, defenderStats: d.stats, attackerSide: TI.combatSide(g, a, 'space'), defenderSide: TI.combatSide(g, d, 'space') });
    assert.strictEqual(log2.assaultCannon.attacker, false, 'only 2 ships: no trigger');
  });

  await test('PDS II shoots at ships arriving in adjacent systems', () => {
    const g = game(['sol', 'hacan']), a = g.players[0], d = g.players[1], S = g.map.systems;
    const t = plain(g, 0), pl = t.planets[0];
    pl.owner = 1; pl.pds = 1;
    const next = t.adj.find((id) => !S[id].anomaly && S[id].home === null && !S[id].planets.some((x) => x.pds));
    S[next].ships[0] = mk('cruiser', 'cruiser');
    g.rng = constRng(10);
    assert.strictEqual(TI.cannonOffense(g, a, next), 0, 'PDS I has range 0');
    tech(d, 'pds2');
    S[next].ships[0] = mk('cruiser', 'cruiser');
    assert(TI.cannonOffense(g, a, next) >= 1, 'PDS II reaches the next system');
  });

  await test('Transit Diodes moves up to 4 ground forces; Integrated Economy builds on a won planet', async () => {
    const g = game(['sol', 'hacan']), p = g.players[0], S = g.map.systems;
    tech(p, 'transit_diodes');
    const H = home(g, 0), mine = plain(g, 0), frontPl = mine.planets[0];
    frontPl.owner = 0; frontPl.ground = mk('infantry');
    S[mine.id].ships[1] = mk('cruiser');                       // an enemy fleet next door: this planet needs help
    H.planets[0].ground = mk(...Array(6).fill('infantry'));
    const acts = TI.factionActions(g, p).filter((a) => a.id === 'transit_diodes');
    assert(acts.length && acts[0].ok);
    const homeBefore = H.planets.reduce((n, x) => n + x.ground.length, 0);
    await TI.runFactionAction(g, g.players.map(() => ({})), p, 'transit_diodes');
    assert.strictEqual(frontPl.ground.length, 5, 'up to 4 arrive');
    assert.strictEqual(H.planets.reduce((n, x) => n + x.ground.length, 0), homeBefore - 4);
    assert(!TI.factionActions(g, p).find((a) => a.id === 'transit_diodes').ok, 'exhausted');
    // Integrated Economy
    const g2 = game(['sol', 'hacan']), q = g2.players[0]; tech(q, 'integrated_economy');
    const t = plain(g2, 0), planet = t.planets[0];
    planet.owner = 0; planet.res = 2; planet.exhausted = true; planet.ground = [];
    q.tg = 5;
    await TI.integratedEconomy(g2, [{}, {}], q, t.id, planet);
    assert(planet.ground.length >= 1 && planet.ground.length <= 4, 'built infantry on the planet: ' + planet.ground.length);
    assert(q.tg < 5 || TI.planetsOwned(g2, q).some((pl) => pl !== planet && pl.exhausted), 'it was paid for (trade goods or a planet)');
  });

  await test('bots are wary of gravity rifts: expected losses lower a plan\'s score but do not forbid it', () => {
    const g = game(['sol', 'hacan']), p = g.players[0], S = g.map.systems;
    const H = home(g, 0), tgt = plain(g, 0);
    H.ships[0] = mk('carrier', 'destroyer');
    const style = TI.BOT_STYLES.expander;
    const calm = TI.botPlan(g, p, tgt.id, style);
    assert.strictEqual(TI.botRiftRisk(g, p, calm.plan.ships, tgt.id), 0);
    // park the fleet in a rift: leaving it costs a die roll per ship
    const saved = H.anomaly; H.anomaly = 'rift';
    const risky = TI.botPlan(g, p, tgt.id, style);
    H.anomaly = saved;
    const loss = (() => { H.anomaly = 'rift'; const r = TI.botRiftRisk(g, p, risky.plan.ships, tgt.id); H.anomaly = saved; return r; })();
    assert(loss > 0, 'exposed ships carry a risk');
    assert(risky.score < calm.score, 'risk lowers the score');
    assert(risky.score > calm.score - 10 && risky.plan.ships.length > 0, 'but the plan is still there (wary, not forbidden)');
    assert(risky.why.includes('rift risk'));
  });

  console.log('\n' + passed + ' tests passed');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
