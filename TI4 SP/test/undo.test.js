// Undo: a human decision can be abandoned mid-action and the game is rewound in place.
const assert = require('assert');
['rng','units','combat','tiles','map','data','factions2','state','moves','tactical','abilities','phases','cards','actioncards','agenda','trade','abilities2','bot_tactics','bots'].forEach((f) => require('../src/' + f + '.js'));
const TI = globalThis.TI;
(async () => {
  const mk = () => {
    const s = TI.createGame({ seed: 8, players: [{ name: 'Me', factionId: 'sol', bot: null }, { name: 'B', factionId: 'hacan', bot: 'expander' }] });
    s.players.forEach((p) => { p.cards = []; });
    s.phase = 'action';
    return s;
  };
  // 1) undo mid-action restores the state in place and the turn starts again
  {
    const s = mk(), ref = s, tg0 = s.players[0].tg, logs0 = s.log.length;
    let calls = 0, seenAtStart = [];
    const me = { chooseAction: async (st, p) => {
      calls++; seenAtStart.push(p.tg);
      if (calls === 1) { p.tg += 7; st.map.systems['0,0'].tokens = [0]; assert(TI.undo.canUndo()); throw TI.undo.signal(TI.undo.request()); }
      return { type: 'pass' };
    } };
    await TI.actionPhase(s, [me, TI.makeBot('expander')]);
    assert.strictEqual(s, ref, 'state object is restored in place');
    assert.deepStrictEqual(seenAtStart, [tg0, tg0], 'second try starts from the original state');
    assert.strictEqual(calls, 2);
    assert(s.log.some((m) => /Undo/.test(m)));
    assert(!TI.undo.active);
  }
  // 2) the stack: mid-action goes back to this turn's start, the action menu goes back one turn further
  {
    const U = TI.undo;
    U.stack = ['t1', 't2', 't3']; U.active = true; U.atMenu = false;
    assert(U.canUndo()); assert.strictEqual(U.request(), 't3'); assert.deepStrictEqual(U.stack, ['t1', 't2']);
    U.stack = ['t1', 't2', 't3']; U.atMenu = true;
    assert.strictEqual(U.request(), 't2'); assert.deepStrictEqual(U.stack, ['t1']);
    U.stack = ['t1']; assert(!U.canUndo() && U.request() === null, 'the first turn of the round has nothing before it');
    U.active = false; U.atMenu = false; U.stack = [];
  }
  // 3) nothing to undo outside a human turn
  assert.strictEqual(TI.undo.request(), null);
  console.log('undo tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
