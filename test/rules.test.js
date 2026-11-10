// Rules-reference audit: behaviours checked against the Living Rules Reference v1.3 (paragraph numbers in the names).
const assert = require('assert');
['rng', 'units', 'combat', 'tiles', 'map', 'data', 'factions2', 'state', 'moves', 'tactical', 'abilities', 'phases', 'cards', 'actioncards', 'agenda', 'trade', 'abilities2', 'bot_tactics', 'bots']
  .forEach((f) => require('../src/' + f + '.js'));
const TI = globalThis.TI;

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok -', name); }

const game = (ids, seed) => TI.createGame({ seed: seed || 5, players: ids.map((f, i) => ({ name: f + i, factionId: f, bot: 'expander' })) });
const bots = (g) => g.players.map(() => TI.makeBot('expander'));
const home = (g, p) => g.map.systems[g.map.order.find((id) => g.map.systems[id].home === p)];
const mk = (...types) => types.map(TI.makeUnit);
const constRng = (v, base) => Object.assign({}, base, { d10: () => v, next: () => 0.5 });
const plain = (g, skip) => g.map.order.find((id) => g.map.systems[id].home === null && !g.map.systems[id].anomaly && id !== '0,0' && g.map.systems[id].planets.length === 0 && id !== skip)
  || g.map.order.find((id) => g.map.systems[id].home === null && !g.map.systems[id].anomaly && id !== '0,0');
const ship = (g, p, sysId, ...types) => { const s = g.map.systems[sysId]; (s.ships[p.id] = s.ships[p.id] || []).push(...mk(...types)); };
const nebula = (g) => g.map.order.find((id) => g.map.systems[id].anomaly === 'nebula');

(async () => {
  await test('67.5-67.7 retreat: announced before the round, happens after hits, token placed, winner is the one who stays', async () => {
    const g = game(['sol', 'hacan']), a = g.players[0], b = g.players[1], ag = bots(g);
    const sysId = plain(g), S = g.map.systems[sysId];
    const refuge = S.adj.find((id) => g.map.systems[id].home === null && g.map.systems[id].planets.length);
    g.map.systems[refuge].planets[0].owner = a.id;
    ship(g, a, sysId, 'carrier', 'cruiser', 'cruiser', 'cruiser'); ship(g, b, sysId, 'dreadnought', 'dreadnought', 'dreadnought', 'dreadnought');
    const r = await TI.resolveSpaceAsync(g, ag, b, sysId);
    assert.strictEqual(r.retreated, a.id);
    assert.strictEqual(r.winner, 'attacker', 'the player who stays wins');
    assert((g.map.systems[refuge].ships[a.id] || []).length > 0 && (S.ships[a.id] || []).length === 0);
    assert(TI.tokensOn(g.map.systems[refuge]).includes(a.id), 'a command token is placed where the ships retreat to');
  });

  await test('67.7 retreat needs an eligible system: adjacent, own unit or planet, no enemy ships; the synchronous resolver never retreats', () => {
    const g = game(['sol', 'hacan']), a = g.players[0], b = g.players[1];
    const sysId = plain(g), S = g.map.systems[sysId];
    assert.deepStrictEqual(TI.retreatOptions(g, a, sysId), [], 'nowhere to go');
    const nb = S.adj[0];
    ship(g, a, nb, 'cruiser');
    assert(TI.retreatOptions(g, a, sysId).includes(nb));
    ship(g, b, nb, 'cruiser');
    assert(!TI.retreatOptions(g, a, sysId).includes(nb), 'enemy ships block the system');
    ship(g, a, sysId, 'cruiser', 'cruiser', 'cruiser'); ship(g, b, sysId, 'dreadnought', 'dreadnought', 'dreadnought', 'dreadnought');
    const r = TI.resolveSpace(g, b, sysId);
    assert.strictEqual(r.retreated, null);
  });

  await test('67.7 a retreat is cancelled when the opponent is wiped out in the round', async () => {
    const g = game(['sol', 'hacan']), a = g.players[0], b = g.players[1], ag = bots(g);
    const sysId = plain(g), nb = g.map.systems[sysId].adj[0];
    ship(g, a, nb, 'cruiser');
    ship(g, a, sysId, 'cruiser'); ship(g, b, sysId, 'cruiser');
    ag[0].chooseRetreat = () => nb; ag[1].chooseRetreat = () => null;
    g.rng = constRng(10, g.rng);                        // every die hits: both ships die
    const r = await TI.resolveSpaceAsync(g, ag, b, sysId);
    assert.strictEqual(r.retreated, null);
    assert.strictEqual(r.winner, 'none');
  });

  await test('50.2-50.3 nebula: ships starting there move 1; the defender applies +1 to combat rolls', () => {
    const g = game(['sol', 'hacan']), a = g.players[0], b = g.players[1];
    const nid = nebula(g); assert(nid, 'the real galaxy has a nebula');
    const N = g.map.systems[nid];
    const out = N.adj.find((id) => g.map.systems[id].anomaly !== 'asteroid' && g.map.systems[id].anomaly !== 'supernova');
    const far = g.map.systems[out].adj.find((id) => id !== nid && g.map.systems[id].anomaly === null && !g.map.systems[id].ships[a.id]);
    ship(g, a, nid, 'cruiser');                          // move 3 normally
    const reach = TI.movableShips(g, a, far).filter((m) => m.from === nid);
    assert.strictEqual(reach.length, 0, 'two jumps away is out of reach for a ship that starts in a nebula');
    assert(TI.movableShips(g, a, out).some((m) => m.from === nid), 'one jump is fine');
    // Combat: every die rolls 6. Cruisers need 7, so only the defender (+1 in a nebula) hits.
    N.ships[a.id] = mk('cruiser'); N.ships[b.id] = mk('cruiser');
    g.rng = constRng(6, g.rng);
    const r = TI.resolveSpace(g, a, nid);
    assert.strictEqual(r.winner, 'defender');
  });

  await test('status phase step 7: damaged units are repaired', async () => {
    const g = game(['sol', 'hacan']), a = g.players[0], ag = bots(g);
    await TI.chooseStartingSecrets(g, ag);
    const h = home(g, 0);
    ship(g, a, h.id, 'dreadnought'); h.ships[a.id].forEach((u) => { u.damaged = true; });
    g.players.forEach((q) => { q.cards = [q.id + 1]; });
    await TI.statusPhase(g, ag);
    assert(h.ships[a.id].every((u) => !u.damaged));
  });

  await test('26.1-26.4 custodians: landing on Mecatol needs 6 influence and removes the token for 1 VP (works for player 0 too)', () => {
    const g = game(['sol', 'hacan']), a = g.players[0];
    const m = g.map.systems['0,0'];
    const inv = [{ planetIdx: 0, units: mk('infantry', 'infantry') }];
    a.tg = 0; TI.planetsOwned(g, a).forEach((pl) => { pl.exhausted = true; });
    assert.deepStrictEqual(TI.custodiansGate(g, a, '0,0', inv), [], 'cannot pay: nobody lands');
    assert.strictEqual(g.custodians, null); assert.strictEqual(a.vp, 0);
    TI.planetsOwned(g, a).forEach((pl) => { pl.exhausted = false; pl.inf = 3; });
    a.tg = 6;
    const out = TI.custodiansGate(g, a, '0,0', inv);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(g.custodians, 0, 'player 0 is a valid owner');
    assert.strictEqual(a.vp, 1);
    // Afterwards the gate is open and free.
    assert.strictEqual(TI.custodiansGate(g, a, '0,0', inv).length, 1);
    assert.strictEqual(a.vp, 1);
  });

  await test('45.3 / 19.5 Leadership secondary costs no command token', async () => {
    const g = game(['sol', 'hacan']), a = g.players[0], b = g.players[1], ag = bots(g);
    b.tokens.strategy = 0; b.tg = 6;
    ag[1].wantSecondary = () => true;
    const before = b.tg;
    await TI.useStrategyCard(g, ag, a, 1);
    assert(b.tg < before || TI.planetsOwned(g, b).some((pl) => pl.exhausted), 'b paid influence for tokens, not a strategy token');
    assert(g.log.some((l) => l.includes('follows with Leadership')), 'b followed without a strategy token');
  });

  await test('30.1 Diplomacy: rivals place command tokens in the chosen system and cannot activate it', async () => {
    const g = game(['sol', 'hacan', 'letnev']), a = g.players[0], ag = bots(g);
    const sysId = home(g, 0).id;
    ag[0].chooseDiplomacySystem = () => sysId;
    await TI.useStrategyCard(g, ag, a, 2);
    for (const o of [g.players[1], g.players[2]]) assert(!TI.canActivate(g, o, sysId), o.name + ' is blocked');
    assert(TI.canActivate(g, a, sysId), 'the active player is not');
    // Mecatol Rex cannot be chosen
    const g2 = game(['sol', 'hacan']); g2.map.systems['0,0'].planets[0].owner = 0;
    const ag2 = bots(g2); ag2[0].chooseDiplomacySystem = () => '0,0';
    await TI.useStrategyCard(g2, ag2, g2.players[0], 2);
    assert(TI.canActivate(g2, g2.players[1], '0,0'));
  });

  await test('88 Warfare: the primary takes a token back and redistributes (no production); the secondary produces at home', async () => {
    const g = game(['sol', 'hacan']), a = g.players[0], b = g.players[1], ag = bots(g);
    const S = g.map.systems[plain(g)]; TI.tokensOn(S).push(a.id); a.tokens.tactic = 0;
    ag[0].redistributeTokens = () => ({ tactic: 1, fleet: 3, strategy: 2 });
    const homeShips = home(g, 0).ships[a.id].length;
    ag[1].wantSecondary = () => true;
    b.tg = 10;
    const hs = home(g, 1).ships[b.id].length;
    await TI.useStrategyCard(g, ag, a, 6);
    assert.strictEqual(a.tokens.tactic + a.tokens.fleet + a.tokens.strategy, 6, 'one token came back (5 in pools + 1)');
    assert.deepStrictEqual([a.tokens.tactic, a.tokens.fleet, a.tokens.strategy], [1, 3, 2]);
    assert.strictEqual(home(g, 0).ships[a.id].length, homeShips, 'the primary builds nothing');
    assert(home(g, 1).ships[b.id].length > hs || home(g, 1).planets[0].ground.length > 2, 'the follower produced at home');
  });

  await test('23 Construction: primary is one PDS or dock plus an additional PDS; the secondary places the spent token', async () => {
    const g = game(['sol', 'hacan']), a = g.players[0], ag = bots(g);
    const pls = [];
    for (const x of g.map.order.filter((id) => g.map.systems[id].home === null && g.map.systems[id].planets.length).slice(0, 3)) { g.map.systems[x].planets[0].owner = 0; pls.push(x); }
    const want = pls.map((id) => ({ systemId: id, planetIdx: 0, kind: 'dock' }));
    ag[0].chooseStructures = () => want;
    await TI.useStrategyCard(g, ag, a, 4);
    const docks = pls.filter((id) => g.map.systems[id].planets[0].dock).length;
    assert.strictEqual(docks, 1, 'only the first structure may be a dock');
    // Secondary
    const b = g.players[1]; b.tokens.strategy = 2;
    const bs = g.map.order.find((id) => g.map.systems[id].home === null && g.map.systems[id].planets.length && g.map.systems[id].planets[0].owner === null);
    g.map.systems[bs].planets[0].owner = 1;
    ag[1].wantSecondary = () => true;
    ag[1].chooseConstructionSystem = () => bs;
    ag[1].chooseStructures = (s, p, c, o) => [{ systemId: bs, planetIdx: 0, kind: 'pds' }];
    await TI.useStrategyCard(g, ag, a, 4);
    assert.strictEqual(g.map.systems[bs].planets[0].pds, 1);
    assert(TI.tokensOn(g.map.systems[bs]).includes(1), 'the spent command token sits in that system');
    assert.strictEqual(b.tokens.strategy, 1);
  });

  await test('85 component limits: 5 dreadnoughts, 3 space docks, 6 PDS', () => {
    const g = game(['hacan', 'sol']), a = g.players[0];
    a.tg = 99;
    const h = home(g, 0);
    ship(g, a, h.id, 'dreadnought', 'dreadnought', 'dreadnought', 'dreadnought', 'dreadnought');
    a.tokens.fleet = 9;
    assert.strictEqual(TI.unitsLeft(g, a, 'dreadnought'), 0);
    const built = TI.produce(g, a, h.id, [{ unit: 'dreadnought' }]);
    assert.strictEqual(built.length, 0, 'no sixth dreadnought');
    assert.strictEqual(TI.unitsLeft(g, a, 'dock'), 2);
    assert.strictEqual(TI.unitsLeft(g, a, 'pds'), 6 - TI.structureCount(g, a, 'pds'));
    assert.strictEqual(TI.unitsLeft(g, a, 'infantry'), Infinity);
  });

  await test('58.2 ships cannot be produced where other players have ships; ground forces still can', () => {
    const g = game(['sol', 'hacan']), a = g.players[0], b = g.players[1];
    a.tg = 20; const h = home(g, 0);
    ship(g, b, h.id, 'cruiser');
    const before = h.ships[a.id].length;
    const built = TI.produce(g, a, h.id, [{ unit: 'cruiser' }, { unit: 'infantry' }]);
    assert(built.every((u) => u.type === 'infantry') && built.length >= 1);
    assert.strictEqual(h.ships[a.id].length, before);
  });

  await test('79.14 technology specialties: exhaust a matching planet to ignore one prerequisite', () => {
    const g = game(['hacan', 'sol']), a = g.players[0];
    a.techs = []; TI.refreshStats(a);
    assert(!TI.canResearch(a, 'gravity_drive', g), 'needs a blue symbol');
    const pl = g.map.systems[g.map.order.find((id) => g.map.systems[id].home === null && g.map.systems[id].planets.length)].planets[0];
    pl.owner = 0; pl.tech = 'propulsion'; pl.exhausted = false;
    assert(TI.canResearch(a, 'gravity_drive', g), 'a propulsion specialty covers the blue prerequisite');
    assert(!TI.canResearch(a, 'dacxive', g), 'but not a green one');
    assert(!TI.canResearch(a, 'fleet_logistics', g), 'only one symbol is ignored per planet');
    const used = TI.spendSpecialties(g, a, 'gravity_drive');
    assert.strictEqual(used.length, 1); assert(pl.exhausted);
    assert(!TI.canResearch(a, 'gravity_drive', g), 'an exhausted planet cannot be used again');
  });

  await test('status phase step 5: tokens can be redistributed; invalid answers are ignored', async () => {
    const g = game(['sol', 'hacan']), a = g.players[0], ag = bots(g);
    a.tokens = { tactic: 3, fleet: 3, strategy: 2 };
    ag[0].redistributeTokens = () => ({ tactic: 1, fleet: 4, strategy: 3 });
    await TI.redistributeTokens(g, ag, a);
    assert.deepStrictEqual(a.tokens, { tactic: 1, fleet: 4, strategy: 3 });
    ag[0].redistributeTokens = () => ({ tactic: 9, fleet: 9, strategy: 9 });
    await TI.redistributeTokens(g, ag, a);
    assert.deepStrictEqual(a.tokens, { tactic: 1, fleet: 4, strategy: 3 }, 'a different total is rejected');
  });

  console.log(`\n${passed} tests passed`);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
