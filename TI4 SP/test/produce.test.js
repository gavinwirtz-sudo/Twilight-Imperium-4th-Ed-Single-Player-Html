// Production: ships cannot be built beside enemy ships, and a blocked order explains itself in the log (humans only).
const assert = require('assert');
['rng','units','combat','tiles','map','data','factions2','state','moves','tactical','abilities','phases','cards','actioncards','agenda','trade','abilities2','bot_tactics','bots'].forEach((f) => require('../src/' + f + '.js'));
const TI = globalThis.TI;
const s = TI.createGame({ seed: 4, players: [{ name: 'Me', factionId: 'sol', bot: null }, { name: 'Bot', factionId: 'letnev', bot: 'expander' }] });
const me = s.players[0];
const home = s.map.order.find((id) => s.map.systems[id].home === 0), sys = s.map.systems[home];
me.tg = 20;
sys.ships[0] = [];   // start with an empty fleet so there is fleet supply to spare
let built = TI.produce(s, me, home, [{ unit: 'carrier' }]);
assert.strictEqual(built.length, 1, 'carrier is built normally');
sys.ships[1] = [TI.makeUnit('cruiser')];
const before = s.log.length;
built = TI.produce(s, me, home, [{ unit: 'destroyer' }, { unit: 'infantry' }]);
assert.deepStrictEqual(built.map((u) => u.type), ['infantry', 'infantry'], 'only ground forces while enemy ships are present');
assert(s.log.slice(before).some((l) => /could not build destroyer.*enemy ships/.test(l)), 'the refusal is logged');
sys.ships[1] = [];
sys.ships[0] = Array.from({ length: TI.fleetLimit(me) }, () => TI.makeUnit('cruiser'));
const b2 = s.log.length;
assert.strictEqual(TI.produce(s, me, home, [{ unit: 'carrier' }]).length, 0);
assert(s.log.slice(b2).some((l) => /fleet supply is full/.test(l)), 'fleet supply refusal is logged');

// Paying for the whole order at once: a 1-cost infantry must not burn a whole 4-resource planet before the 8-cost flagship.
{
  const g = TI.createGame({ seed: 3, players: [{ name: 'a', factionId: 'sol', bot: null }, { name: 'b', factionId: 'hacan', bot: null }] });
  const p = g.players[0], hid = g.map.order.find((id) => g.map.systems[id].home === 0);
  g.map.systems[hid].ships[0] = []; p.tg = 0;
  g.map.systems[hid].planets.forEach((pl) => { pl.exhausted = false; });
  p.tg = 9 - TI.planetsOwned(g, p).reduce((n, pl) => n + pl.res, 0);   // exactly enough for flagship (8) + infantry (1)
  assert(p.tg >= 0);
  const built = TI.produce(g, p, hid, [{ unit: 'infantry' }, { unit: 'flagship' }]);
  assert(built.some((u) => u.type === 'flagship') && built.some((u) => u.type === 'infantry'), 'built ' + built.map((u) => u.type));
}
console.log('produce tests passed');
