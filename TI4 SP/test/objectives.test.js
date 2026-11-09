// The 40 base-game objectives: card data, scoring rules (rules reference section 52 and 70) and the action-phase secrets.
const assert = require('assert');
['rng', 'units', 'combat', 'tiles', 'map', 'data', 'factions2', 'state', 'moves', 'tactical', 'abilities', 'phases', 'cards', 'actioncards', 'agenda', 'trade', 'abilities2', 'bot_tactics', 'bots']
  .forEach((f) => require('../src/' + f + '.js'));
const TI = globalThis.TI;

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok -', name); }

const game = (ids, seed) => TI.createGame({ seed: seed || 5, players: ids.map((f, i) => ({ name: f + i, factionId: f, bot: null })) });
const bots = (g) => g.players.map(() => TI.makeBot('expander'));
const home = (g, p) => g.map.systems[g.map.order.find((id) => g.map.systems[id].home === p)];
const mk = (...types) => types.map(TI.makeUnit);
const tech = (p, ...ids) => { ids.forEach((t) => p.techs.push(t)); TI.refreshStats(p); };
const O = (id) => TI.objectiveById(id);
// Free planets outside every home system.
const freePlanets = (g) => g.map.order.filter((id) => g.map.systems[id].home === null && id !== '0,0').flatMap((id) => g.map.systems[id].planets.map((pl) => ({ pl, id })));
const own = (g, p, n, tweak) => { const got = freePlanets(g).filter((x) => x.pl.owner === null).slice(0, n); got.forEach((x, i) => { x.pl.owner = p.id; if (tweak) tweak(x.pl, i); }); return got; };
const ship = (g, p, sysId, ...types) => { const s = g.map.systems[sysId]; (s.ships[p.id] = s.ships[p.id] || []).push(...mk(...types)); };

(async () => {
  await test('card list: 10 stage I, 10 stage II, 20 secrets; wording matches the printed list', () => {
    assert.strictEqual(TI.OBJECTIVES.length, 40);
    assert.strictEqual(TI.OBJECTIVES.filter((o) => o.stage === 1).length, 10);
    assert.strictEqual(TI.OBJECTIVES.filter((o) => o.stage === 2).length, 10);
    assert.strictEqual(TI.OBJECTIVES.filter((o) => o.stage === 'secret').length, 20);
    assert(TI.OBJECTIVES.filter((o) => o.stage === 1).every((o) => o.vp === 1) && TI.OBJECTIVES.filter((o) => o.stage === 2).every((o) => o.vp === 2));
    assert.strictEqual(O('s1_monument').text, 'Spend 8 resources.');
    assert.strictEqual(O('x_seat').name, 'Occupy the Seat of the Empire');
    assert.strictEqual(O('s2_sciences').text, 'Own 2 technologies in each of 4 colors.');
    assert.deepStrictEqual(TI.OBJECTIVES.filter((o) => o.timing === 'action').map((o) => o.name).sort(),
      ['Destroy Their Greatest Ship', 'Make an Example of Their World', 'Spark a Rebellion', 'Turn Their Fleets to Dust', 'Unveil Flagship']);
  });

  await test('setup: 5 stage I and 5 stage II objectives per game, two stage I revealed, two secrets dealt per player', () => {
    const g = game(['sol', 'hacan', 'letnev']);
    assert.strictEqual(g.publicObjectives.length, 2);
    assert(g.publicObjectives.every((id) => O(id).stage === 1));
    assert.strictEqual(g.publicObjectives.length + g.deck.stage1.length, 5);
    assert.strictEqual(g.deck.stage2.length, 5);
    assert(g.players.every((p) => p.secretOffer.length === 2 && p.secretOffer[0] !== p.secretOffer[1]));
    assert([].concat(...g.players.map((p) => p.secretOffer), g.deck.secret).includes('x_spy'), 'Form a Spy Network is in the deck now that action cards exist');
  });

  await test('keep one of two secrets; the other goes back into the deck', async () => {
    const g = game(['sol', 'hacan', 'letnev']), ag = bots(g);
    const deckBefore = g.deck.secret.length, offers = g.players.map((p) => p.secretOffer.slice());
    ag[1].chooseSecret = (s, p, offer) => offer[1];
    await TI.chooseStartingSecrets(g, ag);
    assert.deepStrictEqual(g.players[1].secrets, [offers[1][1]]);
    assert(g.players.every((p) => p.secrets.length === 1));
    assert.strictEqual(g.deck.secret.length, deckBefore + 3);
    assert(g.deck.secret.includes(offers[1][0]));
  });

  await test('spend objectives: resources, influence, trade goods and tokens are paid when scored', async () => {
    const g = game(['sol', 'hacan']), p = g.players[0], ag = bots(g);
    p.tg = 0;
    // Sol home: Jord 4/2 only -> add planets to reach 8 resources.
    own(g, p, 3, (pl) => { pl.res = 2; pl.inf = 3; });
    const res = TI.available(g, p).res, inf = TI.available(g, p).inf;
    assert(res >= 8 && inf >= 8);
    assert(O('s1_monument').check(g, p) && O('s1_sway').check(g, p) && !O('s1_routes').check(g, p));
    p.tg = 5;
    assert(O('s1_routes').check(g, p));
    assert(await TI.scoreObjective(g, ag, p, 's1_routes'));
    assert.strictEqual(p.tg, 0); assert.strictEqual(p.vp, 1); assert(p.scored.includes('s1_routes'));
    assert(await TI.scoreObjective(g, ag, p, 's1_monument'));
    assert(TI.planetsOwned(g, p).filter((x) => x.exhausted).length >= 2, 'planets were exhausted to pay');
    assert(!(await TI.scoreObjective(g, ag, g.players[1], 's2_age')), 'cannot pay 16 resources');
    assert.strictEqual(g.players[1].vp, 0);
    // tokens: 3 from tactic/strategy pools
    const q = g.players[1];
    q.tokens = { tactic: 2, fleet: 5, strategy: 2 };
    assert(O('s1_front').check(g, q));
    await TI.scoreObjective(g, ag, q, 's1_front');
    assert.strictEqual(q.tokens.tactic + q.tokens.strategy, 1);
    assert.strictEqual(q.tokens.fleet, 5, 'fleet pool is untouched');
    q.tokens = { tactic: 1, fleet: 9, strategy: 1 };
    assert(!O('s2_galvanize').check(g, q), 'fleet tokens do not count');
  });

  await test('counting objectives: traits, specialties, non-home planets', () => {
    const g = game(['sol', 'hacan']), p = g.players[0];
    own(g, p, 6, (pl, i) => { pl.trait = i < 4 ? 'cultural' : 'hazardous'; pl.tech = i < 3 ? 'blue' : null; });
    assert(O('s1_corner').check(g, p) && !O('s2_unify').check(g, p));
    assert(O('x_alliance').check(g, p) && !O('x_minerals').check(g, p));
    assert(O('s1_outposts').check(g, p) && !O('s2_brain').check(g, p));
    assert(O('s1_borders').check(g, p), '6 planets outside home systems');
    assert(!O('s2_subdue').check(g, p));
    const [have, need] = O('s1_corner').progress(g, p);
    assert.deepStrictEqual([have, need], [4, 4]);
    // Planets in a home system never count as "non-home".
    const q = g.players[1];
    assert.strictEqual(TI.objectiveQueries.abroad(g, q).length, 0);
  });

  await test('technology objectives: unit upgrades and colors', () => {
    const g = game(['jolnar', 'hacan']), p = g.players[0];
    p.techs = []; TI.refreshStats(p);
    tech(p, 'antimass', 'gravity_drive', 'sarween', 'graviton');
    assert(O('s1_diversify').check(g, p), '2 blue + 2 yellow');
    assert(!O('s2_sciences').check(g, p));
    assert(!O('s1_weaponry').check(g, p));
    tech(p, 'carrier2', 'war_sun');
    assert(O('s1_weaponry').check(g, p) && !O('s2_warfare').check(g, p));
    tech(p, 'destroyer2');
    assert(O('s2_warfare').check(g, p), 'War Sun and every unit upgrade count');
    tech(p, 'fleet_logistics', 'light_wave');
    assert(O('x_physics').check(g, p), '4 blue technologies');
    assert.strictEqual(TI.objectiveQueries.colors(p, 2), 2);
  });

  await test('Adapt New Strategies counts faction technologies only', () => {
    const g = game(['sol', 'hacan']), p = g.players[0];
    assert(!O('x_adapt').check(g, p));
    tech(p, 'spec_ops2'); assert(!O('x_adapt').check(g, p));
    tech(p, 'adv_carrier2'); assert(O('x_adapt').check(g, p));
  });

  await test('fleet-position objectives: Mecatol ring, region, gatekeeper, supply lines, threaten, cosmos', () => {
    const g = game(['sol', 'hacan']), p = g.players[0], q = g.players[1];
    const ring = g.map.systems['0,0'].adj;
    ship(g, p, ring[0], 'cruiser'); assert(!O('s1_council').check(g, p));
    ship(g, p, ring[1], 'cruiser'); assert(O('s1_council').check(g, p));
    // Occupy the Seat: Mecatol + 3 ships there
    assert(!O('x_seat').check(g, p));
    g.map.systems['0,0'].planets[0].owner = p.id;
    ship(g, p, '0,0', 'cruiser', 'cruiser'); assert(!O('x_seat').check(g, p));
    ship(g, p, '0,0', 'cruiser'); assert(O('x_seat').check(g, p));
    // Cut Supply Lines: ships where another player's dock is
    const qh = home(g, 1);
    assert(!O('x_supply').check(g, p));
    ship(g, p, qh.id, 'cruiser'); assert(O('x_supply').check(g, p));
    assert(!O('x_supply').check(g, q), 'your own dock does not count');
  });

  await test('Threaten Enemies needs a system adjacent to another player\'s home; Learn the Secrets needs anomaly neighbours', () => {
    const g = game(['sol', 'hacan']), p = g.players[0];
    const qh = home(g, 1), neighbour = qh.adj.find((id) => g.map.systems[id].home === null && !g.map.systems[id].anomaly);
    assert(!O('x_threaten').check(g, p));
    ship(g, p, neighbour, 'cruiser'); assert(O('x_threaten').check(g, p));
    const nearAnomaly = g.map.order.filter((id) => g.map.systems[id].adj.some((n) => g.map.systems[n].anomaly) && !g.map.systems[id].anomaly);
    assert(nearAnomaly.length >= 3);
    const g2 = game(['sol', 'hacan']); const p2 = g2.players[0];
    nearAnomaly.slice(0, 2).forEach((id) => ship(g2, p2, id, 'cruiser'));
    assert(!O('x_cosmos').check(g2, p2));
    ship(g2, p2, nearAnomaly[2], 'cruiser'); assert(O('x_cosmos').check(g2, p2));
    // Gatekeeper: one ship in an alpha and one in a beta wormhole system
    const a = g2.map.order.find((id) => g2.map.systems[id].wormhole === 'alpha'), b = g2.map.order.find((id) => g2.map.systems[id].wormhole === 'beta');
    ship(g2, p2, a, 'cruiser'); assert(!O('x_gatekeeper').check(g2, p2));
    ship(g2, p2, b, 'cruiser'); assert(O('x_gatekeeper').check(g2, p2));
    // Control the Region: 6 systems
    const g3 = game(['sol', 'hacan']); const p3 = g3.players[0];
    g3.map.order.forEach((id) => { g3.map.systems[id].ships[p3.id] = []; });
    g3.map.order.filter((id) => g3.map.systems[id].anomaly !== 'supernova').slice(0, 5).forEach((id) => ship(g3, p3, id, 'fighter'));
    assert.strictEqual(TI.shipSystems(g3, p3).length, 5); assert(!O('x_region').check(g3, p3));
    ship(g3, p3, g3.map.order.filter((id) => g3.map.systems[id].anomaly !== 'supernova')[5], 'fighter');
    assert(O('x_region').check(g3, p3));
  });

  await test('structure objectives: PDS, docks, dreadnoughts', () => {
    const g = game(['sol', 'hacan']), p = g.players[0];
    const got = own(g, p, 4); got.forEach((x) => { x.pl.pds = 1; });
    assert(O('x_perimeter').check(g, p));
    got.slice(0, 2).forEach((x) => { x.pl.dock = true; });
    assert.strictEqual(TI.structureCount(g, p, 'dock'), 3);
    assert(O('x_machine').check(g, p));
    ship(g, p, home(g, 0).id, 'dreadnought', 'dreadnought', 'dreadnought', 'dreadnought');
    assert(!O('x_fleet').check(g, p)); ship(g, p, got[0].id, 'dreadnought'); assert(O('x_fleet').check(g, p));
  });

  await test('rule 52.16: no public objectives without every planet in your home system', () => {
    const g = game(['sol', 'hacan']), p = g.players[0];
    p.techs = []; TI.refreshStats(p); tech(p, 'carrier2', 'war_sun');
    g.publicObjectives = ['s1_weaponry'];
    assert.deepStrictEqual(TI.eligibleObjectives(g, p).pub, ['s1_weaponry']);
    const h = home(g, 0); h.planets[0].owner = 1;
    assert.deepStrictEqual(TI.eligibleObjectives(g, p).pub, []);
    h.planets[0].owner = 0;
    assert.deepStrictEqual(TI.eligibleObjectives(g, p).pub, ['s1_weaponry']);
  });

  await test('status phase: one public and one secret per player, each objective once', async () => {
    const g = game(['sol', 'hacan']), p = g.players[0], ag = bots(g);
    await TI.chooseStartingSecrets(g, ag);
    p.techs = []; TI.refreshStats(p); tech(p, 'carrier2', 'war_sun', 'destroyer2');
    p.tg = 5;
    g.publicObjectives = ['s1_weaponry', 's1_routes'];
    p.secrets = ['x_adapt']; tech(p, 'spec_ops2', 'adv_carrier2');
    g.players.forEach((q) => { q.cards = [q.id + 1]; });
    await TI.statusPhase(g, ag);
    assert.strictEqual(p.scored.filter((id) => O(id).stage !== 'secret').length, 1, 'only one public objective per status phase');
    assert(p.scored.includes('x_adapt'));
    const before = p.vp;
    g.round = 2; await TI.statusPhase(g, ag);
    assert.strictEqual(p.scored.filter((id) => O(id).stage !== 'secret').length, 2, 'the second one is scored next round');
    assert.strictEqual(new Set(p.scored).size, p.scored.length);
    assert(p.vp > before);
  });

  await test('Imperial scoring pays the objective cost too', async () => {
    const g = game(['sol', 'hacan']), p = g.players[0], ag = bots(g);
    p.tg = 6; g.publicObjectives = ['s1_routes'];
    await TI.useStrategyCard(g, ag, p, 8);
    assert.strictEqual(p.tg, 1);
    assert(p.scored.includes('s1_routes'));
  });

  await test('at most three secrets (scored + unscored); the fourth means returning an unscored one', async () => {
    const g = game(['sol', 'hacan']), p = g.players[0], ag = bots(g);
    await TI.chooseStartingSecrets(g, ag);
    p.secrets = ['x_adapt', 'x_region', 'x_machine']; p.scored = ['x_adapt'];
    g.deck.secret = ['x_fleet'];
    await TI.drawSecret(g, ag, p);
    assert.strictEqual(p.secrets.length, 3);
    assert(p.secrets.includes('x_adapt'), 'scored secrets are never returned');
    assert(g.deck.secret.length === 1);
    // a hand of three scored cards: the new one is the only one that can go back
    p.secrets = ['x_adapt', 'x_region', 'x_machine']; p.scored = p.secrets.slice(); g.deck.secret = ['x_fleet'];
    await TI.drawSecret(g, ag, p);
    assert.deepStrictEqual(p.secrets, ['x_adapt', 'x_region', 'x_machine']);
    assert.deepStrictEqual(g.deck.secret, ['x_fleet']);
  });

  await test('action secrets: Unveil Flagship and Spark a Rebellion score after a won space battle', async () => {
    const g = game(['sol', 'hacan']), p = g.players[0], q = g.players[1], ag = bots(g);
    const sysId = g.map.order.find((id) => g.map.systems[id].home === null && !g.map.systems[id].anomaly && id !== '0,0');
    ship(g, p, sysId, 'flagship', 'dreadnought', 'dreadnought', 'dreadnought'); ship(g, q, sysId, 'fighter');
    p.secrets = ['x_flagship']; q.vp = 3;
    const r = TI.resolveSpace(g, p, sysId);
    assert(r.fought && r.winner === 'attacker');
    await TI.flushEvents(g, ag);
    assert(p.scored.includes('x_flagship') && p.vp === 1);
    // Spark a Rebellion: opponent is the VP leader (p has 1, q has 3) -> win against q
    const h = game(['sol', 'hacan']), a = h.players[0], b = h.players[1];
    const sid = h.map.order.find((id) => h.map.systems[id].home === null && !h.map.systems[id].anomaly && id !== '0,0');
    ship(h, a, sid, 'dreadnought', 'dreadnought', 'dreadnought'); ship(h, b, sid, 'fighter');
    a.secrets = ['x_rebellion']; b.vp = 2; a.vp = 1;
    TI.resolveSpace(h, a, sid); await TI.flushEvents(h, bots(h));
    assert(a.scored.includes('x_rebellion'));
    // ... but not against a player who is behind
    const k = game(['sol', 'hacan']), c = k.players[0], d = k.players[1];
    const sk = k.map.order.find((id) => k.map.systems[id].home === null && !k.map.systems[id].anomaly && id !== '0,0');
    ship(k, c, sk, 'dreadnought', 'dreadnought', 'dreadnought'); ship(k, d, sk, 'fighter');
    c.secrets = ['x_rebellion']; c.vp = 3; d.vp = 1;
    TI.resolveSpace(k, c, sk); await TI.flushEvents(k, bots(k));
    assert(!c.scored.includes('x_rebellion'));
  });

  await test('action secrets: Destroy Their Greatest Ship and Turn Their Fleets to Dust', async () => {
    const g = game(['sol', 'hacan']), p = g.players[0], q = g.players[1];
    const sysId = g.map.order.find((id) => g.map.systems[id].home === null && !g.map.systems[id].anomaly && id !== '0,0');
    tech(p, 'war_sun');
    ship(g, p, sysId, 'dreadnought', 'dreadnought', 'dreadnought', 'dreadnought'); ship(g, q, sysId, 'flagship');
    p.secrets = ['x_greatest'];
    TI.resolveSpace(g, p, sysId); await TI.flushEvents(g, bots(g));
    assert(p.scored.includes('x_greatest'), 'destroyed the flagship');
    // Space Cannon wipe: two PDS shoot a lone arriving fighter-less cruiser until nothing remains
    const h = game(['sol', 'hacan']), a = h.players[0], b = h.players[1];
    const pl = freePlanets(h).find((x) => x.pl.owner === null);
    pl.pl.owner = b.id; pl.pl.pds = 2;
    ship(h, a, pl.id, 'destroyer');
    b.secrets = ['x_dust'];
    const rng = h.rng; h.rng = { next: () => 0.5, d10: () => 10, int: rng.int, pick: rng.pick, shuffle: rng.shuffle };   // every PDS shot hits
    TI.resolveSpace(h, a, pl.id); await TI.flushEvents(h, bots(h));
    assert(b.scored.includes('x_dust'));
  });

  await test('action secret: Make an Example of Their World needs bombardment to kill every defender', async () => {
    const g = game(['sol', 'hacan']), p = g.players[0], q = g.players[1];
    const pl = freePlanets(g).find((x) => x.pl.owner === null);
    pl.pl.owner = q.id; pl.pl.ground = mk('infantry');
    ship(g, p, pl.id, 'dreadnought', 'carrier');
    g.map.systems[pl.id].cargo = { [p.id]: mk('infantry', 'infantry') };
    p.secrets = ['x_example'];
    const rng = g.rng; g.rng = { next: () => 0.5, d10: () => 10, int: rng.int, pick: rng.pick, shuffle: rng.shuffle };
    TI.invade(g, p, pl.id, 0, g.map.systems[pl.id].cargo[p.id].slice());
    await TI.flushEvents(g, bots(g));
    assert(p.scored.includes('x_example'));
  });

  await test('one objective per combat: two earned events score only one secret', async () => {
    const g = game(['sol', 'hacan']), p = g.players[0], q = g.players[1];
    const sysId = g.map.order.find((id) => g.map.systems[id].home === null && !g.map.systems[id].anomaly && id !== '0,0');
    ship(g, p, sysId, 'flagship', 'dreadnought', 'dreadnought', 'dreadnought'); ship(g, q, sysId, 'flagship');
    p.secrets = ['x_flagship', 'x_greatest']; q.vp = 5;
    TI.resolveSpace(g, p, sysId); await TI.flushEvents(g, bots(g));
    assert.strictEqual(p.scored.length, 1);
  });

  await test('game ends when there is no objective left to reveal; the VP leader wins, ties go by initiative', async () => {
    const g = game(['sol', 'hacan', 'letnev']), ag = bots(g);
    g.deck.stage1 = []; g.deck.stage2 = [];
    g.players[0].vp = 4; g.players[1].vp = 6; g.players[2].vp = 6;
    g.players[0].cards = [1]; g.players[1].cards = [5]; g.players[2].cards = [3];
    g.players.forEach((p) => { p.secrets = []; });
    g.publicObjectives = [];
    await TI.statusPhase(g, ag);
    assert.strictEqual(g.winner, 2, 'tied at 6 VP: the player with the lower initiative number (3 beats 5) wins');
    assert(g.endedByObjectives);
  });

  await test('stage II cards stay hidden until every stage I card is revealed', () => {
    const g = game(['sol', 'hacan']);
    const seen = [];
    while (g.deck.stage1.length || g.deck.stage2.length) { TI.revealObjective(g); seen.push(O(g.publicObjectives[g.publicObjectives.length - 1]).stage); }
    assert.deepStrictEqual(seen, [1, 1, 1, 2, 2, 2, 2, 2]);
    assert.strictEqual(g.publicObjectives.length, 10);
    assert.strictEqual(TI.revealObjective(g), false);
  });

  await test('bots: keep the better secret, skip a costly trade-good objective they cannot afford to lose', () => {
    const g = game(['sol', 'hacan']), p = g.players[0], bot = TI.makeBot('expander');
    own(g, p, 4, (pl) => { pl.trait = 'cultural'; });
    assert.strictEqual(bot.chooseSecret(g, p, ['x_fleet', 'x_alliance']), 'x_alliance');
    p.tg = 5;
    assert.strictEqual(bot.chooseScore(g, p, ['s1_routes']), 's1_routes', 'a lone 1 VP objective is still taken');
    p.tokens = { tactic: 3, fleet: 3, strategy: 0 };
    assert.strictEqual(bot.chooseScore(g, p, ['s1_front']), null, 'spending the last tokens for 1 VP is not worth it');
    p.vp = g.vpToWin - 1;
    assert.strictEqual(bot.chooseScore(g, p, ['s1_front']), 's1_front', 'unless it wins the game');
  });

  await test('bots: planets that advance an objective look better; bots keep resources for a spend objective', () => {
    const g = game(['sol', 'hacan']), p = g.players[0];
    g.publicObjectives = ['s1_outposts']; p.secrets = [];
    const sys = g.map.systems[g.map.order.find((id) => g.map.systems[id].home === null)];
    assert(TI.botObjectiveBonus(g, p, { tech: 'red' }, sys) > 0);
    assert.strictEqual(TI.botObjectiveBonus(g, p, { tech: null }, sys), 0);
    own(g, p, 3, (pl) => { pl.res = 3; });
    g.publicObjectives = ['s1_monument'];
    assert(TI.botSpendReserve(g, p) === 8);
    const order = TI.botProduction(g, p, home(g, 0).id, TI.BOT_STYLES.expander);
    const cost = order.reduce((n, o) => n + p.stats[o.unit].cost / p.stats[o.unit].batch, 0);
    assert(TI.available(g, p).res + p.tg - cost >= 8, 'production leaves 8 resources unspent');
  });

  console.log(`\n${passed} tests passed`);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
