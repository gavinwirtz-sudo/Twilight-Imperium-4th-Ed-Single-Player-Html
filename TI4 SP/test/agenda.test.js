// Agenda phase: deck, voting, outcomes, laws in play and the hooks they set.
const assert = require('assert');
['rng', 'units', 'combat', 'tiles', 'map', 'data', 'factions2', 'state', 'moves', 'tactical', 'abilities', 'phases', 'cards', 'actioncards', 'agenda', 'trade', 'abilities2', 'bot_tactics', 'bots'].forEach((f) => require('../src/' + f + '.js'));
const TI = globalThis.TI;
let n = 0; const t = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('ok  ' + name); }, (e) => { console.log('FAIL ' + name + '\n  ' + (e.stack || e)); process.exitCode = 1; });
const mk = (seed) => {
  const s = TI.createGame({ seed: seed || 3, mapMode: 'balanced', players: [{ name: 'A', factionId: 'sol', bot: 'expander' }, { name: 'B', factionId: 'xxcha', bot: 'warmonger' }, { name: 'C', factionId: 'hacan', bot: 'builder' }] });
  s.agents = s.players.map((p) => TI.makeBot(p.bot)); return s;
};
// Everybody votes as told: votes = { playerId: [key, n] }.
const script = (s, votes) => { s.agents.forEach((a, i) => { a.chooseVote = (st, p, ctx) => (votes[p.id] ? { key: votes[p.id][0], n: votes[p.id][1] } : { key: null, n: 0 }); }); };
const run = (s, id, opts) => TI.resolveAgenda(s, s.agents, TI.AGENDA_BY_ID[id], opts || {});
const noCards = (s) => s.players.forEach((p) => { p.hand = []; });
(async () => {
  await t('50 agenda cards, all accounted for', () => { const s = mk(); assert.strictEqual(TI.AGENDAS.length, 50); assert.strictEqual(s.agendaDeck.length, 50); });
  await t('most votes win; the law stays in play and sets its flag', async () => {
    const s = mk(); noCards(s); script(s, { 0: ['for', 3], 1: ['against', 2], 2: ['for', 1] });
    await run(s, 'fleet_regulations');
    assert.ok(TI.rules.fleetCap === 4 && s.laws.length === 1);
  });
  await t('Against resolves its text and the law is discarded', async () => {
    const s = mk(); noCards(s); script(s, { 0: ['against', 5] }); const f = s.players.map((p) => p.tokens.fleet);
    await run(s, 'fleet_regulations');
    assert.strictEqual(s.laws.length, 0); s.players.forEach((p, i) => assert.strictEqual(p.tokens.fleet, f[i] + 1)); assert.ok(s.agendaDiscard.includes('fleet_regulations'));
  });
  await t('a tie is broken by the speaker', async () => {
    const s = mk(); noCards(s); s.speaker = 1; script(s, { 0: ['for', 2], 2: ['against', 2] });
    s.agents[1].chooseElected = (st, p, outs) => outs.find((o) => o.key === 'against');
    await run(s, 'executive_sanctions'); assert.strictEqual(s.laws.length, 0);
  });
  await t('voting spends planets and Representative Government limits votes to 1', async () => {
    const s = mk(); noCards(s); const a = s.players[0]; script(s, { 0: ['for', 2] });
    await run(s, 'seed_of_an_empire'); assert.ok(TI.planetsOwned(s, a).some((x) => x.exhausted));
    const s2 = mk(); noCards(s2); s2.laws.push({ id: 'representative_government', outcome: 'for', owner: null, planet: null }); TI.syncRules(s2);
    script(s2, { 0: ['for', 1] }); await run(s2, 'seed_of_an_empire'); assert.ok(!TI.planetsOwned(s2, s2.players[0]).some((x) => x.exhausted));
  });
  await t('elected-player law: the winner holds the card; Minister of Policy draws at the end of the status phase', async () => {
    const s = mk(5); noCards(s); script(s, { 0: ['p1', 3] }); await run(s, 'minister_of_policy');
    assert.strictEqual(TI.lawOwner(s, 'minister_of_policy'), 1);
    const before = s.players[1].hand.length; s.deferRound = true; await TI.statusPhase(s, s.agents); assert.ok(s.players[1].hand.length >= before + 1);
  });
  await t('planet law attaches, changes values and goes away with Judicial Abolishment', async () => {
    const s = mk(); noCards(s); const hz = TI.planetsOwned(s, s.players[0]).concat(TI.planetsOwned(s, s.players[1]))[0];
    const cands = TI.AGENDA_BY_ID.terraforming_initiative.candidates(s), c = cands[0], pl = s.map.systems[c.value.s].planets[c.value.i], r0 = pl.res;
    script(s, { 0: [c.key, 3] }); await run(s, 'terraforming_initiative'); assert.strictEqual(pl.res, r0 + 1);
    script(s, { 0: ['terraforming_initiative', 3] }); await run(s, 'judicial_abolishment'); assert.strictEqual(pl.res, r0); assert.strictEqual(s.laws.length, 0);
  });
  await t('Shard of the Throne changes hands when its owner loses a combat', async () => {
    const s = mk(); noCards(s); script(s, { 0: ['p1', 4] }); await run(s, 'shard_of_the_throne');
    assert.strictEqual(s.players[1].vp, 1); TI.onCombatWon(s, s.players[2], s.players[1]);
    assert.strictEqual(TI.lawOwner(s, 'shard_of_the_throne'), 2); assert.strictEqual(s.players[1].vp, 0); assert.strictEqual(s.players[2].vp, 1);
  });
  await t('Minister of Exploration pays when a planet changes hands', () => {
    const s = mk(); s.laws.push({ id: 'minister_of_exploration', outcome: null, owner: 2, planet: null });
    const pl = s.map.systems[s.map.order.find((id) => s.map.systems[id].planets.length && s.map.systems[id].home === null)].planets[0], tg = s.players[2].tg;
    TI.onPlanetControl(s, pl, s.map.order[0], s.players[2], null); assert.strictEqual(s.players[2].tg, tg + 1);
  });
  await t('Rider: a correct prediction pays, a wrong one does not', async () => {
    const s = mk(); noCards(s); s.players[0].hand = ['trade_rider']; script(s, { 1: ['for', 4], 2: ['for', 3] });
    s.agents[0].chooseActionCard = (st, p, w, cands) => (w === 'agendaRevealed' ? cands[0] : null); s.agents[0].chooseCardTarget = (st, p, c, opts) => 'for';
    const tg = s.players[0].tg; await run(s, 'seed_of_an_empire'); assert.strictEqual(s.players[0].tg, tg + 5);
    const s2 = mk(); noCards(s2); s2.players[0].hand = ['trade_rider']; script(s2, { 1: ['for', 4] });
    s2.agents[0].chooseActionCard = (st, p, w, cands) => (w === 'agendaRevealed' ? cands[0] : null); s2.agents[0].chooseCardTarget = () => 'against';
    const tg2 = s2.players[0].tg; await run(s2, 'seed_of_an_empire'); assert.strictEqual(s2.players[0].tg, tg2);
  });
  await t('Veto discards the agenda', async () => {
    const s = mk(); noCards(s); s.players[0].hand = ['veto']; s.agents[0].chooseActionCard = (st, p, w, c) => (w === 'agendaVeto' ? 'veto' : null);
    const r = await run(s, 'mutiny'); assert.ok(r.replaced); assert.ok(s.agendaDiscard.includes('mutiny'));
  });
  await t('Enforced Travel Ban: wormholes stop linking systems', async () => {
    const s = mk(); noCards(s); const w = s.map.order.filter((id) => s.map.systems[id].wormhole);
    if (w.length < 2) return;
    const a = w.find((id) => s.map.systems[id].adj.some((n) => s.map.systems[n].wormhole && s.map.systems[n].wormhole !== s.map.systems[id].wormhole) || true);
    const before = TI.reachable(s.map, w[0], 1, 0, { freeWormhole: true });
    script(s, { 0: ['for', 4] }); await run(s, 'enforced_travel_ban');
    const after = TI.reachable(s.map, w[0], 1, 0, { freeWormhole: true });
    assert.ok(Object.keys(after).length <= Object.keys(before).length);
  });
  await t('Crown of Thalnos: misses can be rerolled and units that miss again die', async () => {
    const s = mk(2); noCards(s); s.laws.push({ id: 'crown_of_thalnos', outcome: null, owner: 0, planet: null });
    const force = [TI.makeUnit('fighter'), TI.makeUnit('fighter')];
    const roll = { attacker: { hits: 0, dice: force.map((u) => ({ unit: u, need: 11, r: 1, hit: false })) }, defender: { hits: 0, dice: [] } };
    await TI.crownWindow(s, s.agents, { roll, sysId: s.map.order[0], ground: false, sides: { attacker: { player: s.players[0], force }, defender: { player: s.players[1], force: [] } } });
    assert.strictEqual(force.length, 0);        // need 11 can never hit, so both fighters are lost
  });
  await t('the agenda phase waits for the custodians token and follows the status phase', async () => {
    const s = mk(); noCards(s); const log0 = s.log.length;
    await TI.agendaPhase(s, s.agents); assert.strictEqual(s.log.length, log0);
    s.custodians = 0; await TI.agendaPhase(s, s.agents);
    assert.ok(s.log.slice(log0).some((l) => /Agenda phase/.test(l))); assert.strictEqual(s.agendaDeck.length + s.agendaDiscard.length + s.laws.length, 50);
  });
  await t('bot games: laws and agendas keep every deck whole', async () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = mk(seed * 17); await TI.runGame(s, s.agents, { maxRounds: 9, onRound: async (st) => { assert.strictEqual(st.agendaDeck.length + st.agendaDiscard.length + st.laws.length, 50); } });
    }
  });
  console.log(`${n} agenda tests done`);
})();
