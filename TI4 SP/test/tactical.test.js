const assert = require('assert');
['rng', 'units', 'combat', 'tiles', 'map', 'data', 'factions2', 'state', 'moves', 'tactical', 'abilities', 'agenda'].forEach((f) => require('../src/' + f + '.js'));
const TI = globalThis.TI;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok -', name); }

function newGame(seed, factions) {
  const players = (factions || ['sol', 'sardakk']).map((f, i) => ({ name: 'P' + i, factionId: f, bot: null }));
  return TI.createGame({ seed: seed || 3, players });
}
const homeOf = (g, p) => g.map.systems[g.map.order.find((id) => g.map.systems[id].home === p)];
// An adjacent system that has at least one planet and no anomaly.
const neighborWithPlanet = (g, home) =>
  home.adj.map((id) => g.map.systems[id]).find((s) => s.planets.length && !s.anomaly && s.home === null);

test('activation spends a tactic token and blocks re-activation', () => {
  const g = newGame(), p = g.players[0], target = neighborWithPlanet(g, homeOf(g, 0));
  assert(TI.canActivate(g, p, target.id));
  assert(TI.activate(g, p, target.id));
  assert.strictEqual(p.tokens.tactic, 2);
  assert(!TI.canActivate(g, p, target.id));
});

test('ships move with cargo and a neutral planet is captured', () => {
  const g = newGame(), p = g.players[0], home = homeOf(g, 0), target = neighborWithPlanet(g, home);
  TI.activate(g, p, target.id);
  const carriers = home.ships[0].filter((u) => u.type === 'carrier');
  const ground = TI.groundAvailable(g, p, home.id).slice(0, 4);
  const r = TI.executeMove(g, p, target.id, { ships: [{ from: home.id, unit: carriers[0] }], ground });
  assert(r.ok, r.reason);
  assert.strictEqual(TI.cargoOf(target, 0).length, 4);
  assert.strictEqual(TI.resolveSpace(g, p, target.id).fought, false);
  const landing = TI.cargoOf(target, 0).slice(0, 2);
  assert(TI.invade(g, p, target.id, 0, landing).captured);
  assert.strictEqual(target.planets[0].owner, 0);
  assert.strictEqual(target.planets[0].ground.length, 2);
});

test('cargo capacity is enforced (Sol\'s Advanced Carrier holds 6)', () => {
  const g = newGame(), p = g.players[0], home = homeOf(g, 0), target = neighborWithPlanet(g, home);
  for (let i = 0; i < 4; i++) home.planets[0].ground.push(TI.makeUnit('infantry'));
  TI.activate(g, p, target.id);
  const carrier = home.ships[0].find((u) => u.type === 'carrier');
  const r = TI.executeMove(g, p, target.id, { ships: [{ from: home.id, unit: carrier }], ground: TI.groundAvailable(g, p, home.id).slice(0, 7) });
  assert(!r.ok && /capacity/.test(r.reason));
});

test('fleet supply limits non-fighter ships in a system', () => {
  const g = newGame(), p = g.players[0], home = homeOf(g, 0), target = neighborWithPlanet(g, home);
  for (let i = 0; i < 3; i++) home.ships[0].push(TI.makeUnit('cruiser'));
  TI.activate(g, p, target.id);
  const ships = home.ships[0].filter((u) => u.type !== 'fighter').map((unit) => ({ from: home.id, unit }));
  const r = TI.executeMove(g, p, target.id, { ships, ground: [] });
  assert(!r.ok && /fleet/.test(r.reason), JSON.stringify(r));
});

test('ships cannot leave a system holding the owner command token', () => {
  const g = newGame(), p = g.players[0], home = homeOf(g, 0), target = neighborWithPlanet(g, home);
  TI.tokensOn(home).push(p.id);
  assert.strictEqual(TI.movableShips(g, p, target.id).length, 0);
});

test('space combat resolves against a defender and cargo dies with a lost fleet', () => {
  const g = newGame(), a = g.players[0], d = g.players[1], home = homeOf(g, 0), target = neighborWithPlanet(g, home);
  target.ships[1] = Array.from({ length: 3 }, () => TI.makeUnit('dreadnought'));
  TI.activate(g, a, target.id);
  const carrier = home.ships[0].find((u) => u.type === 'carrier');
  TI.executeMove(g, a, target.id, { ships: [{ from: home.id, unit: carrier }], ground: TI.groundAvailable(g, a, home.id).slice(0, 2) });
  const r = TI.resolveSpace(g, a, target.id);
  assert(r.fought);
  assert(((g.map.systems[target.id].ships[0] || []).length === 0) !== ((g.map.systems[target.id].ships[1] || []).length === 0) || r.winner === 'none');
  if (!(target.ships[0] || []).length) assert.strictEqual(TI.cargoOf(target, 0).length, 0);
});

test('conquering an enemy planet destroys its structures and flips control', () => {
  const g = newGame(), a = g.players[0], d = g.players[1];
  const target = neighborWithPlanet(g, homeOf(g, 0));
  const planet = target.planets[0];
  planet.owner = 1; planet.pds = 2; planet.dock = true; planet.ground = [];
  target.ships[0] = [TI.makeUnit('carrier')];
  TI.cargoOf(target, 0).push(TI.makeUnit('infantry'), TI.makeUnit('infantry'));
  const r = TI.invade(g, a, target.id, 0, TI.cargoOf(target, 0).slice());
  // PDS can shoot down infantry, so allow either outcome but check invariants
  if (r.captured) { assert.strictEqual(planet.owner, 0); assert.strictEqual(planet.pds, 0); assert.strictEqual(planet.dock, false); }
  else assert.strictEqual(planet.owner, 1);
});

test('production pays resources, respects the dock limit, and places units', () => {
  const g = newGame(), p = g.players[0], home = homeOf(g, 0);
  p.tg = 10;
  p.tokens.fleet = 4; // starting fleets already fill the 3-token supply
  const before = home.ships[0].length;
  const built = TI.produce(g, p, home.id, [{ unit: 'cruiser' }, { unit: 'fighter' }, { unit: 'infantry' }]);
  assert(built.length >= 1);
  assert.strictEqual(built.filter((u) => u.type === 'cruiser').length, 1);
  assert(home.ships[0].length > before);
  // limit = dock planet res (Jord 4) + 2 = 6 units; this order uses 5: 1 cruiser + 2 fighters + 2 infantry fits exactly
  assert.strictEqual(built.length, 5);
});

test('production stops when the player cannot pay', () => {
  const g = newGame(), p = g.players[0], home = homeOf(g, 0);
  home.planets.forEach((pl) => { pl.exhausted = true; });
  p.tg = 0;
  assert.strictEqual(TI.produce(g, p, home.id, [{ unit: 'dreadnought' }]).length, 0);
});

test('war sun requires the technology', () => {
  const g = newGame(), p = g.players[0], home = homeOf(g, 0);
  p.tg = 20;
  assert.strictEqual(TI.produce(g, p, home.id, [{ unit: 'warsun' }]).length, 0);
});

console.log('\n' + passed + ' tests passed');
