const assert = require('assert');
require('../src/rng.js');
require('../src/units.js');
require('../src/tiles.js');
require('../src/map.js');
const TI = globalThis.TI;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok -', name); }

const homes = (n) => Array.from({ length: n }, (_, i) => [{ name: 'H' + i, res: 3, inf: 1 }]);

test('rings have 1, 6, 12, 18 hexes', () => {
  assert.deepStrictEqual([0, 1, 2, 3].map((n) => TI.hexRing(n).length), [1, 6, 12, 18]);
});

test('every player count 2-6 gives the right number of systems and homes (3-player galaxy is the 28-tile triangle)', () => {
  for (let p = 2; p <= 6; p++) {
    const m = TI.generateMap(p, TI.makeRng(p), homes(p));
    assert.strictEqual(m.order.length, p === 3 ? 28 : 37, 'p=' + p);
    const h = m.order.filter((id) => m.systems[id].home !== null);
    assert.strictEqual(h.length, p);
    assert.strictEqual(new Set(h.map((id) => m.systems[id].home)).size, p);
  }
});

test('adjacency is symmetric and interior hexes have 6 neighbours', () => {
  const m = TI.generateMap(6, TI.makeRng(9), homes(6));
  for (const id of m.order) for (const n of m.systems[id].adj) assert(m.systems[n].adj.includes(id), id + ' <-> ' + n);
  assert.strictEqual(m.systems['0,0'].adj.length >= 6, true);
  const hexOnly = (s) => s.adj.filter((n) => Math.abs(m.systems[n].q - s.q) <= 1 && Math.abs(m.systems[n].r - s.r) <= 1).length;
  assert.strictEqual(hexOnly(m.systems['0,0']), 6);
});

test('home systems are all 3 jumps from Mecatol (6 players: symmetric)', () => {
  const m = TI.generateMap(6, TI.makeRng(2), homes(6));
  for (const id of m.order) if (m.systems[id].home !== null) assert.strictEqual(TI.systemDistance(m, '0,0', id) <= 3, true);
});

test('system names are unique and wormholes are paired', () => {
  const m = TI.generateMap(2, TI.makeRng(4), homes(2));
  const names = m.order.flatMap((id) => m.systems[id].planets.map((p) => p.name));
  assert.strictEqual(new Set(names).size, names.length);
  for (const w of ['alpha', 'beta']) {
    const ids = m.order.filter((id) => m.systems[id].wormhole === w);
    // 2 tiles per type unless the 36-tile cut dropped one; if two exist they must be linked
    if (ids.length === 2) assert(m.systems[ids[0]].adj.includes(ids[1]));
  }
});

test('reachability: asteroids/supernovas blocked, nebula stop-only, enemies block passage', () => {
  const m = { playerCount: 2, order: ['a', 'b', 'c', 'd'], systems: {} };
  const mk = (id, extra) => (m.systems[id] = Object.assign({ id, planets: [], ships: {}, anomaly: null, wormhole: null, adj: [] }, extra));
  mk('a'); mk('b'); mk('c'); mk('d');
  const link = (x, y) => { m.systems[x].adj.push(y); m.systems[y].adj.push(x); };
  link('a', 'b'); link('b', 'c'); link('c', 'd');
  assert.deepStrictEqual(TI.reachable(m, 'a', 3, 0), { a: 0, b: 1, c: 2, d: 3 });
  m.systems.b.anomaly = 'asteroid';
  assert.deepStrictEqual(TI.reachable(m, 'a', 3, 0), { a: 0 });
  m.systems.b.anomaly = 'nebula';
  assert.deepStrictEqual(TI.reachable(m, 'a', 3, 0), { a: 0, b: 1 });   // can stop, cannot pass
  m.systems.b.anomaly = null;
  m.systems.c.ships[1] = [TI.makeUnit('cruiser')];
  assert.deepStrictEqual(TI.reachable(m, 'a', 3, 0), { a: 0, b: 1, c: 2 }); // can fight in c, not pass
  assert.deepStrictEqual(TI.reachable(m, 'a', 3, 1), { a: 0, b: 1, c: 2, d: 3 }); // own ships don't block
});

test('same seed gives the same map', () => {
  const a = TI.generateMap(5, TI.makeRng(77), homes(5)), b = TI.generateMap(5, TI.makeRng(77), homes(5));
  assert.deepStrictEqual(a.order.map((i) => a.systems[i].planets.map((p) => p.name)),
                         b.order.map((i) => b.systems[i].planets.map((p) => p.name)));
});

// ---- real galaxy ----
const tileAt = (m, q, r) => m.systems[q + ',' + r].tile;
const modes = ['preset', 'random', 'balanced'];

test('preset galaxies are the booklet maps: spot checks, unique tiles, setup rules respected', () => {
  const m6 = TI.generateMap(6, TI.makeRng(1), homes(6), { mode: 'preset' });
  assert.deepStrictEqual([[0, 0], [0, -1], [0, 1], [-1, 0], [-1, 1], [1, -1], [1, 0]].map(([q, r]) => tileAt(m6, q, r)), [18, 22, 42, 45, 24, 44, 19]);
  const m4 = TI.generateMap(4, TI.makeRng(1), homes(4), { mode: 'preset' });
  assert.strictEqual(tileAt(m4, 1, -3), 41);       // gravity rift
  assert.strictEqual(m4.systems['1,-3'].anomaly, 'rift');
  assert.strictEqual(tileAt(m4, -1, 3), 43);       // supernova
  const m3 = TI.generateMap(3, TI.makeRng(1), homes(3), { mode: 'preset' });
  assert.strictEqual(m3.order.length, 28);
  for (const n of [3, 4, 5, 6]) {
    const m = TI.generateMap(n, TI.makeRng(n), homes(n), { mode: 'preset' });
    const tiles = m.order.map((id) => m.systems[id].tile).filter(Boolean);
    assert.strictEqual(new Set(tiles).size, tiles.length, n + 'p unique tiles');
    assert.strictEqual(TI.mapViolations(m), 0, n + 'p printed map breaks no setup rule');
    assert.strictEqual(m.order.filter((id) => m.systems[id].home !== null).length, n);
  }
});

test('random and balanced galaxies: unique tiles, no setup-rule violations, wormholes paired, right size', () => {
  for (const mode of ['random', 'balanced']) for (const n of [3, 4, 5, 6]) for (let seed = 1; seed <= 4; seed++) {
    const m = TI.generateMap(n, TI.makeRng(seed * 31 + n), homes(n), { mode });
    const pre = TI.generateMap(n, TI.makeRng(1), homes(n), { mode: 'preset' });
    assert.strictEqual(m.order.length, pre.order.length);
    const tiles = m.order.map((id) => m.systems[id].tile).filter(Boolean);
    assert.strictEqual(new Set(tiles).size, tiles.length);
    assert.strictEqual(TI.mapViolations(m), 0, `${mode} ${n}p seed ${seed}`);
    for (const w of ['alpha', 'beta']) assert.strictEqual(m.order.filter((id) => m.systems[id].wormhole === w).length, 2, w);
    const blue = tiles.filter((t) => t >= 19 && t <= 38).length, red = tiles.filter((t) => t >= 39).length;
    const preBlue = pre.order.map((id) => pre.systems[id].tile).filter((t) => t >= 19 && t <= 38).length;
    assert.strictEqual(blue, preBlue);
  }
});

test('balanced setup narrows the gap between home systems compared with plain random', () => {
  let rnd = 0, bal = 0, runs = 0;
  for (const n of [4, 5, 6]) for (let seed = 1; seed <= 6; seed++) {
    rnd += TI.generateMap(n, TI.makeRng(seed), homes(n), { mode: 'random' }).spread;
    bal += TI.generateMap(n, TI.makeRng(seed), homes(n), { mode: 'balanced' }).spread;
    runs++;
  }
  console.log(`   mean home-value spread: random ${(rnd / runs).toFixed(3)}  balanced ${(bal / runs).toFixed(3)}`);
  assert(bal < rnd * 0.6, 'balanced should be clearly tighter');
  assert(bal / runs < 0.12, 'balanced spread under 12% of the mean');
});

test('every mode is deterministic for a seed; seats rotate with the seed', () => {
  for (const mode of modes) {
    const a = TI.generateMap(5, TI.makeRng(5), homes(5), { mode }), b = TI.generateMap(5, TI.makeRng(5), homes(5), { mode });
    assert.deepStrictEqual(a.order.map((i) => [a.systems[i].tile, a.systems[i].home]), b.order.map((i) => [b.systems[i].tile, b.systems[i].home]));
  }
  const seats = new Set();
  for (let s = 1; s <= 12; s++) { const m = TI.generateMap(6, TI.makeRng(s), homes(6), { mode: 'preset' }); seats.add(m.systems['0,-3'].home); }
  assert(seats.size > 1, 'seat 0 should not always sit in the same place');
});

test('five-player galaxy: +4, +2, +2 trade goods go to the three listed home positions', () => {
  const m = TI.generateMap(5, TI.makeRng(8), homes(5), { mode: 'preset' });
  assert.deepStrictEqual(Object.values(m.homeBonus).sort(), [2, 2, 4]);
  assert.strictEqual(m.homeBonus[m.systems['3,0'].home], 4);
  assert.strictEqual(m.homeBonus[m.systems['0,3'].home], 2);
  assert.strictEqual(m.homeBonus[m.systems['3,-3'].home], 2);
  assert.strictEqual(TI.generateMap(4, TI.makeRng(8), homes(4)).homeBonus && Object.keys(TI.generateMap(4, TI.makeRng(8), homes(4)).homeBonus).length, 0);
});

test('gravity rift: leaving it is free (+1 move) and exposure is detected', () => {
  const m = { playerCount: 2, order: ['a', 'b', 'c', 'd'], systems: {} };
  const mk = (id, extra) => (m.systems[id] = Object.assign({ id, q: 0, r: 0, planets: [], ships: {}, anomaly: null, wormhole: null, home: null, adj: [] }, extra));
  mk('a'); mk('b', { anomaly: 'rift' }); mk('c'); mk('d');
  const link = (x, y) => { m.systems[x].adj.push(y); m.systems[y].adj.push(x); };
  link('a', 'b'); link('b', 'c'); link('c', 'd');
  assert.deepStrictEqual(TI.reachable(m, 'a', 2, 0), { a: 0, b: 1, c: 1, d: 2 });  // through the rift costs one less
  assert.strictEqual(TI.riftExposure(m, 'a', 'c', 2, 0, {}), true);
  assert.strictEqual(TI.riftExposure(m, 'c', 'd', 1, 0, {}), false);
  assert.strictEqual(TI.riftExposure(m, 'b', 'a', 1, 0, {}), true);                // starting inside the rift
});

console.log('\n' + passed + ' tests passed');
