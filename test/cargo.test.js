// Ground forces in orbit die with their ships (the loser of a space battle must not keep infantry floating in orbit).
const assert = require('assert');
['rng','units','combat','tiles','map','data','factions2','state','moves','tactical','abilities','phases','cards','actioncards','agenda','trade','abilities2','bot_tactics','bots'].forEach((f) => require('../src/' + f + '.js'));
const TI = globalThis.TI;
(async () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = TI.createGame({ seed, mapMode: 'balanced', players: ['expander', 'warmonger'].map((b, i) => ({ name: 'P' + i, factionId: ['sol', 'letnev'][i], bot: b })) });
    const id = s.map.order.find((i) => !s.map.systems[i].anomaly && s.map.systems[i].home == null && i !== '0,0');
    const sys = s.map.systems[id]; sys.ships = {}; sys.cargo = {};
    sys.ships[0] = Array.from({ length: 6 }, () => TI.makeUnit('dreadnought'));
    sys.ships[1] = [TI.makeUnit('carrier')]; TI.cargoOf(sys, 1).push(TI.makeUnit('infantry'), TI.makeUnit('infantry'));
    const agents = s.players.map((p) => TI.makeBot(p.bot));
    await TI.resolveSpaceAsync(s, agents, s.players[0], id);
    assert.strictEqual((sys.ships[1] || []).length, 0, 'defender fleet should be destroyed');
    assert.strictEqual(TI.cargoOf(sys, 1).length, 0, 'defender infantry must not survive in orbit (seed ' + seed + ')');
  }
  // Infantry aboard in the space area: the player chooses whether they travel (Genesis case).
  {
    const g = TI.createGame({ seed: 5, players: [{ name: 'a', factionId: 'sol', bot: null }, { name: 'b', factionId: 'hacan', bot: null }] });
    const ids = g.map.order.filter((i) => !g.map.systems[i].anomaly && g.map.systems[i].home == null && i !== '0,0');
    const home = g.map.order.find((i) => g.map.systems[i].home === 0), H = g.map.systems[home];
    const dst = H.adj.find((i) => !g.map.systems[i].anomaly && g.map.systems[i].home == null && i !== '0,0');
    H.ships[0] = [TI.makeUnit('flagship'), TI.makeUnit('carrier')]; H.cargo = {}; TI.cargoOf(H, 0).push(TI.makeUnit('infantry'), TI.makeUnit('infantry'));
    const fl = H.ships[0][0], inf = TI.cargoOf(H, 0).slice();
    // leave both behind with the carrier: fine
    let r = TI.executeMove(g, g.players[0], dst, { ships: [{ from: home, unit: fl }], ground: [], cargo: [] });
    assert(r.ok, r.reason);
    assert.strictEqual(TI.cargoOf(H, 0).length, 2, 'left aboard the carrier');
    assert.strictEqual(TI.cargoOf(g.map.systems[dst], 0).length, 0);
    // bring one with the flagship
    H.ships[0].push(fl); g.map.systems[dst].ships[0] = [];
    r = TI.executeMove(g, g.players[0], dst, { ships: [{ from: home, unit: fl }], ground: [], cargo: [{ from: home, unit: inf[0] }] });
    assert(r.ok, r.reason);
    assert.strictEqual(TI.cargoOf(g.map.systems[dst], 0).length, 1);
    assert.strictEqual(TI.cargoOf(H, 0).length, 1);
    // stranding is refused: the last ship leaves, cargo stays behind
    H.ships[0] = [TI.makeUnit('flagship')];
    const f2 = H.ships[0][0];
    r = TI.executeMove(g, g.players[0], dst, { ships: [{ from: home, unit: f2 }], ground: [], cargo: [] });
    assert(!r.ok && /stay/.test(r.reason), r.reason);
  }
  console.log('cargo tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
