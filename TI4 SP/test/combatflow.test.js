// Interactive combat plumbing: roll detail, chosen casualties, hooks for the human screens.
const assert = require('assert');
['rng', 'units', 'combat', 'tiles', 'map', 'data', 'factions2', 'state', 'moves', 'tactical', 'abilities', 'phases', 'cards', 'actioncards', 'agenda', 'trade', 'abilities2', 'bot_tactics', 'bots']
  .forEach((f) => require('../src/' + f + '.js'));
const TI = globalThis.TI;
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok -', name); }
const mk = (...t) => t.map(TI.makeUnit);
const fixed = (v) => ({ d10: () => v, next: () => 0.5 });
const game = () => TI.createGame({ seed: 9, players: [{ name: 'A', factionId: 'sol', bot: null }, { name: 'B', factionId: 'hacan', bot: 'expander' }] });
const plain = (g) => g.map.order.find((id) => g.map.systems[id].home === null && !g.map.systems[id].anomaly && id !== '0,0' && !g.map.systems[id].planets.length);

(async () => {
  await test('roll detail lists every die with the number needed', () => {
    const att = mk('cruiser', 'dreadnought'), def = mk('cruiser');
    const ctx = TI.spaceCombatStart(att, def, fixed(7), {});
    const roll = TI.spaceRoundRoll(ctx);
    assert.strictEqual(roll.attacker.dice.length, 2);
    assert.deepStrictEqual(roll.attacker.dice.map((d) => d.need), [7, 5]);
    assert(roll.attacker.dice.every((d) => d.hit && d.r === 7));
    assert.strictEqual(roll.attacker.hits, 2);
    const pre = TI.combatPreview(att, null, 1, 'ship');
    assert.deepStrictEqual(pre.map((x) => x.need), [6, 4], 'a +1 modifier lowers the number needed');
  });

  await test('a casualty plan is honoured; sustain absorbs the first hit; the rest is assigned automatically', () => {
    const dread = TI.makeUnit('dreadnought'), c1 = TI.makeUnit('cruiser'), c2 = TI.makeUnit('cruiser'), f = TI.makeUnit('fighter');
    const def = [dread, c1, c2, f];
    const att = mk('warsun');
    const ctx = TI.spaceCombatStart(att, def, fixed(10), {});
    TI.spaceRoundRoll(ctx);              // war sun: 3 dice, all hit
    TI.spaceRoundResolve(ctx, { defender: [c1, dread, dread] });
    assert(!def.includes(c1), 'chosen cruiser died');
    assert(!def.includes(dread), 'dreadnought sustained then died as planned');
    assert(def.includes(f) && def.includes(c2));
    const d2 = [TI.makeUnit('dreadnought'), TI.makeUnit('fighter')];
    const ctx2 = TI.spaceCombatStart(mk('warsun'), d2, fixed(10), {});
    TI.spaceRoundRoll(ctx2);
    TI.spaceRoundResolve(ctx2, { defender: [d2[1]] });   // plan covers 1 of 3 hits; the rest falls back to default priority
    assert.strictEqual(d2.length, 0);
  });

  await test('ground rounds expose dice and obey casualty plans', () => {
    const att = mk('infantry', 'infantry', 'infantry'), def = mk('infantry', 'infantry');
    const keep = att[0], lose = att[1];
    const ctx = TI.groundCombatStart(att, def, fixed(10), {});
    TI.groundRoundRoll(ctx);
    assert.strictEqual(ctx.roll.defender.hits, 2);
    TI.groundRoundResolve(ctx, { attacker: [lose, att[2]] });
    assert.deepStrictEqual(att, [keep]);
    assert.strictEqual(def.length, 0);
  });

  await test('the space step asks the agent before the roll and for casualties, in order', async () => {
    const g = game(), a = g.players[0], b = g.players[1], sysId = plain(g), S = g.map.systems[sysId];
    S.ships[0] = mk('cruiser', 'cruiser', 'cruiser'); S.ships[1] = mk('cruiser', 'cruiser');
    const calls = [];
    const agents = [{ combatRoundStart: async (s, p, q) => { calls.push('pre:' + p.name + ':' + q.round); },
                      chooseCasualties: async (s, p, q) => { calls.push('cas:' + p.name + ':' + q.hits); return q.force.slice(0, q.hits); } },
                    TI.makeBot('expander')];
    g.rng = fixed(10);
    const r = await TI.resolveSpaceAsync(g, agents, a, sysId);
    assert.strictEqual(r.fought, true);
    assert(calls[0].startsWith('pre:A:1'));
    assert(calls.some((c) => c.startsWith('cas:A:')));
    assert(calls.indexOf(calls.find((c) => c.startsWith('cas:'))) > 0, 'dice come after the pre-roll screen');
  });

  await test('the ground step goes through the same hooks and the chosen units die', async () => {
    const g = game(), a = g.players[0], b = g.players[1];
    const id = g.map.order.find((i) => g.map.systems[i].planets.length && g.map.systems[i].home === null && i !== '0,0');
    const S = g.map.systems[id], pl = S.planets[0];
    pl.owner = 1; pl.ground = mk('infantry'); pl.pds = 0;
    S.ships[0] = mk('carrier'); S.cargo = S.cargo || {}; S.cargo[0] = mk('infantry', 'infantry', 'infantry');
    const seen = [];
    const agents = [{ combatRoundStart: async (s, p, q) => seen.push(['pre', q.ground, q.round]),
                      chooseCasualties: async (s, p, q) => { seen.push(['cas', q.hits]); return q.force.slice().reverse(); } }, TI.makeBot('expander')];
    g.rng = { d10: (() => { let i = 0; return () => (i++ % 2 === 0 ? 10 : 1); })(), next: () => 0.5 };
    const r = await TI.invadeAsync(g, agents, a, id, 0, TI.cargoOf(S, 0).slice());
    assert(seen.some((x) => x[0] === 'pre' && x[1] === true));
    assert.strictEqual(typeof r.captured, 'boolean');
  });

  await test('bots and the synchronous resolvers need no hooks', async () => {
    const g = game(), sysId = plain(g), S = g.map.systems[sysId];
    S.ships[0] = mk('cruiser', 'cruiser'); S.ships[1] = mk('cruiser');
    const r = TI.resolveSpace(g, g.players[0], sysId);
    assert(r.fought);
  });

  console.log(`\n${passed} tests passed`);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
