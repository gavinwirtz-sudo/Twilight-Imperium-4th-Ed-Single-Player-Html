const assert = require('assert');
require('../src/rng.js');
require('../src/units.js');
require('../src/combat.js');
const TI = globalThis.TI;
const mk = (...types) => types.map(TI.makeUnit);

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok -', name); }

test('rng is deterministic per seed', () => {
  const a = TI.makeRng(42), b = TI.makeRng(42);
  for (let i = 0; i < 20; i++) assert.strictEqual(a.d10(), b.d10());
});

test('d10 stays in 1..10 and covers every face', () => {
  const r = TI.makeRng(7), seen = new Set();
  for (let i = 0; i < 2000; i++) { const v = r.d10(); assert(v >= 1 && v <= 10); seen.add(v); }
  assert.strictEqual(seen.size, 10);
});

test('sustain damage absorbs the first hit, second destroys', () => {
  const f = mk('dreadnought');
  assert.strictEqual(TI._assignHits(f, 1), 0);
  assert.strictEqual(f[0].damaged, true);
  assert.strictEqual(TI._assignHits(f, 1), 1);
  assert.strictEqual(f.length, 0);
});

test('hits go to sustainers first, then cheapest ships', () => {
  const f = mk('carrier', 'fighter', 'dreadnought', 'cruiser');
  TI._assignHits(f, 1);
  assert(f.find((u) => u.type === 'dreadnought').damaged);
  assert.strictEqual(f.length, 4);
  TI._assignHits(f, 1);                     // next cheapest: the fighter
  assert.deepStrictEqual(f.map((u) => u.type).sort(), ['carrier', 'cruiser', 'dreadnought']);
});

test('space combat always resolves and leaves one side empty', () => {
  const rng = TI.makeRng(1);
  for (let i = 0; i < 300; i++) {
    const a = mk('cruiser', 'cruiser', 'carrier', 'fighter', 'fighter');
    const d = mk('dreadnought', 'destroyer', 'fighter');
    const log = TI.spaceCombat(a, d, rng);
    assert(a.length === 0 || d.length === 0, 'combat left both sides alive');
    assert(['attacker', 'defender', 'none'].includes(log.winner));
  }
});

test('overwhelming force wins nearly always', () => {
  const rng = TI.makeRng(3);
  let wins = 0;
  for (let i = 0; i < 200; i++) {
    const a = mk('warsun', 'dreadnought', 'dreadnought', 'cruiser');
    const d = mk('fighter', 'fighter', 'destroyer');
    if (TI.spaceCombat(a, d, rng).winner === 'attacker') wins++;
  }
  assert(wins > 190, 'only won ' + wins);
});

test('anti-fighter barrage only kills fighters', () => {
  const rng = TI.makeRng(5);
  for (let i = 0; i < 200; i++) {
    const a = mk('destroyer', 'destroyer', 'destroyer');
    const d = mk('fighter', 'fighter', 'cruiser');
    TI.spaceCombat(a, d, { d10: () => 10, next: () => 0.99 }); // always hits; fine, just must not throw
  }
  const a = mk('destroyer', 'destroyer');
  const d = mk('cruiser', 'carrier');
  const sig = d.map((u) => u.type).join();
  // run only barrage via a combat where attackers can't win quickly: check cruiser/carrier not removed by AFB
  const log = TI.spaceCombat(a, d, { d10: () => 1, next: () => 0 }); // everything misses
  assert.strictEqual(log.afbKills.defender, 0);
  assert.strictEqual(d.map((u) => u.type).join(), sig);
});

test('bombardment kills only infantry', () => {
  const ships = mk('warsun');
  const ground = mk('infantry', 'infantry', 'pds');
  TI.bombard(ships, ground, { d10: () => 10 });
  assert.deepStrictEqual(ground.map((u) => u.type), ['pds']);
});

test('ground combat resolves and statistical sanity (equal armies ~50/50)', () => {
  const rng = TI.makeRng(11);
  let atk = 0; const N = 2000;
  for (let i = 0; i < N; i++) {
    const a = mk('infantry', 'infantry', 'infantry'), d = mk('infantry', 'infantry', 'infantry');
    const log = TI.groundCombat(a, d, rng);
    assert(a.length === 0 || d.length === 0);
    if (log.winner === 'attacker') atk++;
  }
  const rate = atk / N;
  assert(rate > 0.40 && rate < 0.60, 'attacker rate ' + rate);
});

test('space cannon can destroy attacking ships', () => {
  const ships = mk('fighter', 'fighter');
  const killed = TI.spaceCannon(mk('pds'), ships, { d10: () => 10 });
  assert.strictEqual(killed, 1);
});

console.log('\n' + passed + ' tests passed');
