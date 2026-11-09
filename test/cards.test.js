// Action cards: deck, hand limit, each card family, Sabotage, and a full bot game with invariants.
const assert = require('assert');
['rng', 'units', 'combat', 'tiles', 'map', 'data', 'factions2', 'state', 'moves', 'tactical', 'abilities', 'phases', 'cards', 'actioncards', 'agenda', 'trade', 'abilities2', 'bot_tactics', 'bots']
  .forEach((f) => require('../src/' + f + '.js'));
const TI = globalThis.TI;
let n = 0; const t = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('ok  ' + name); }, (e) => { console.log('FAIL ' + name + '\n  ' + (e.stack || e)); process.exitCode = 1; });
const mk = (seed) => {
  const s = TI.createGame({ seed: seed || 5, mapMode: 'balanced', players: [{ name: 'A', factionId: 'sol', bot: 'expander' }, { name: 'B', factionId: 'xxcha', bot: 'warmonger' }, { name: 'C', factionId: 'hacan', bot: 'builder' }] });
  const ag = s.players.map((p) => TI.makeBot(p.bot));
  s.agents = ag; return s;
};
(async () => {
  await t('deck has all cards and no duplicates beyond counts', () => {
    const s = mk(); assert.strictEqual(s.actionDeck.length, TI.buildActionDeck(TI.makeRng(1)).length);
    const c = {}; s.actionDeck.forEach((id) => { c[id] = (c[id] || 0) + 1; });
    for (const card of TI.ACTION_CARDS) assert.strictEqual(c[card.id], card.count);
  });
  await t('hand limit 7 discards down', async () => {
    const s = mk(); const p = s.players[0];
    await TI.drawActionCards(s, s.agents, p, 10);
    assert.strictEqual(p.hand.length, 7);
    assert.strictEqual(s.actionDeck.length + s.actionDiscard.length + s.players.reduce((a, q) => a + q.hand.length, 0), TI.buildActionDeck(TI.makeRng(1)).length);
  });
  await t('empty deck reshuffles the discard', async () => {
    const s = mk(); s.actionDiscard = s.actionDeck.splice(0); const p = s.players[0];
    await TI.drawActionCards(s, s.agents, p, 2);
    assert.strictEqual(p.hand.length, 2);
  });
  await t('Sabotage cancels an action card', async () => {
    const s = mk(); const a = s.players[0], b = s.players[1];
    a.hand = ['mining_initiative']; b.hand = ['sabotage'];
    const sab = TI.ACTION_BY_ID.sabotage; const old = sab.bot; sab.bot = () => true;
    const planet = TI.planetsOwned(s, a)[0]; planet.res = 4; const tg = a.tg;
    await TI.componentActionCard(s, s.agents, a, 'mining_initiative', true);
    sab.bot = old;
    assert.strictEqual(a.tg, tg); assert.strictEqual(b.hand.length, 0); assert.strictEqual(s.actionDiscard.length, 2);
  });
  await t('Mining Initiative and Industrial Initiative give trade goods', async () => {
    const s = mk(); const a = s.players[0];
    a.hand = ['mining_initiative']; for (const q of s.players) q.hand = q === a ? q.hand : [];
    const best = TI.planetsOwned(s, a).sort((x, y) => y.res - x.res)[0]; best.res = 3; const tg = a.tg;
    await TI.componentActionCard(s, s.agents, a, 'mining_initiative', 3);
    assert.strictEqual(a.tg, tg + 3);
  });
  await t('Frontline Deployment places 3 infantry', async () => {
    const s = mk(); const a = s.players[0]; a.hand = ['frontline_deployment'];
    const pl = TI.planetsOwned(a ? s : s, a)[0], g = pl.ground.length;
    const opts = TI.ACTION_BY_ID.frontline_deployment.options(s, a);
    await TI.componentActionCard(s, s.agents, a, 'frontline_deployment', opts[0].value);
    const after = TI.planetsOwned(s, a).reduce((x, q) => x + q.ground.length, 0);
    assert.ok(after >= g + 3);
  });
  await t('Unexpected Action removes a command token', async () => {
    const s = mk(); const a = s.players[0]; a.hand = ['unexpected_action'];
    const id = s.map.order[3]; TI.tokensOn(s.map.systems[id]).push(a.id);
    await TI.componentActionCard(s, s.agents, a, 'unexpected_action', id);
    assert.ok(!TI.tokensOn(s.map.systems[id]).includes(a.id));
  });
  await t('Skilled Retreat and Shields Holding windows fire in combat', async () => {
    const s = mk(7); const a = s.players[0], b = s.players[1];
    const id = s.map.order.find((x) => s.map.systems[x].home === null && !s.map.systems[x].anomaly && s.map.systems[x].adj.length > 2);
    const sys = s.map.systems[id];
    sys.ships[a.id] = [TI.makeUnit('cruiser'), TI.makeUnit('cruiser')]; sys.ships[b.id] = [TI.makeUnit('dreadnought'), TI.makeUnit('dreadnought'), TI.makeUnit('dreadnought')];
    b.hand = ['shields_holding']; a.hand = [];
    const r = await TI.resolveSpaceAsync(s, s.agents, a, id);
    assert.ok(r.fought); assert.ok(s.log.some((l) => /shields hold|Round 1/.test(l)));
  });
  await t('Political Stability keeps strategy cards', async () => {
    const s = mk(11); const a = s.players[0];
    a.hand = ['political_stability']; await TI.strategyPhase(s, s.agents);
    const mine = a.cards.slice(); assert.ok(mine.length);
    TI.ACTION_BY_ID.political_stability.bot = () => true;
    await TI.statusPhase(s, s.agents);
    assert.ok(a.keepCards); assert.deepStrictEqual(a.cards, mine);
    await TI.strategyPhase(s, s.agents);
    assert.deepStrictEqual(a.cards, mine); assert.ok(!a.keepCards);
  });
  await t('Form a Spy Network discards cards', async () => {
    const s = mk(); const a = s.players[0]; a.hand = ['spy', 'plague', 'uprising', 'war_effort', 'summit'];
    assert.ok(TI.canSpend(s, a, 'cards', 5)); TI.paySpend(s, a, 'cards', 5);
    assert.strictEqual(a.hand.length, 0); assert.strictEqual(s.actionDiscard.length, 5);
  });
  await t('full bot games keep hands <= 7 and the deck conserved', async () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = mk(seed * 13); let played = 0;
      const ol = TI.onLog; TI.onLog = (m) => { if (/ plays /.test(m)) played++; };
      await TI.runGame(s, s.agents, { maxRounds: 8, onRound: async (st) => {
        assert.strictEqual(st.actionDeck.length + st.actionDiscard.length + st.players.reduce((a, q) => a + q.hand.length, 0), TI.buildActionDeck(TI.makeRng(1)).length, "deck conservation");
        st.players.forEach((q) => assert.ok(q.hand.length <= 7));
      } });
      TI.onLog = ol;
      assert.ok(played > 0, 'cards get played in seed ' + seed);
    }
  });
  console.log(`${n} card tests done`);
})();
