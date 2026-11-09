const assert = require('assert');
['rng','units','combat','tiles','map','data','factions2','state','moves','tactical','abilities','phases','cards','actioncards','agenda','trade','abilities2','bot_tactics','bots'].forEach((f) => require('../src/' + f + '.js'));
const TI = globalThis.TI;
const mk = () => TI.createGame({ seed: 5, players: [{ name: 'A', factionId: 'hacan', bot: null }, { name: 'B', factionId: 'sol', bot: 'builder' }, { name: 'C', factionId: 'xxcha', bot: 'expander' }] });
(async () => {
  const s = mk(), [a, b, c] = s.players;
  assert.strictEqual(TI.commOf(a), 0);
  // trade card
  const agents = s.players.map((p) => (p.bot ? TI.makeBot(p.bot) : { chooseReplenish: async () => [c] }));
  s.cards.find((x) => x.id === 5).owner = a.id; a.cards.push(5);
  await TI.useStrategyCard(s, agents, a, 5);
  assert.strictEqual(a.tg, 3); assert.strictEqual(TI.commOf(a), 6); assert.strictEqual(TI.commOf(c), TI.commMax(c));
  // transaction commodities -> tg
  b.tg = 4; b.comm = 0; TI.neighbors = () => [b];
  const offer = TI.makeOffer({ comm: 3 }, { tg: 2 });
  assert.strictEqual(TI.offerProblem(s, a, b, offer), null);
  s.traded = {};
  assert.ok(await TI.propose(s, agents, a, b, offer));
  assert.strictEqual(a.tg, 5); assert.strictEqual(TI.commOf(a), 3); assert.strictEqual(b.tg, 5);
  assert.ok(TI.offerProblem(s, a, b, TI.makeOffer({ tg: 99 }, { tg: 1 })));
  assert.ok(TI.offerProblem(s, a, b, TI.makeOffer({ tg: 1 }, {})));
  // cards only with Hacan
  assert.ok(TI.cardsAllowed(a, b)); assert.ok(!TI.cardsAllowed(b, c));
  // bots refuse to feed a leader
  b.vp = 0; a.vp = s.vpToWin - 1;
  assert.ok(!TI.botAcceptsOffer(s, b, a, TI.makeOffer({ comm: 2 }, { tg: 1 })));
  console.log('trade tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
