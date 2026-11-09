// Save/load: a game resumed from a mid-round checkpoint must play out exactly like the uninterrupted one.
const assert = require('assert');
['rng','units','combat','tiles','map','data','factions2','state','moves','tactical','abilities','phases','cards','actioncards','agenda','trade','abilities2','bot_tactics','bots'].forEach((f) => require('../src/' + f + '.js'));
const TI = globalThis.TI;
const mk = (seed) => TI.createGame({ seed, mapMode: 'balanced', players: ['expander', 'warmonger', 'builder'].map((b, i) => ({ name: 'P' + i, factionId: ['sol', 'letnev', 'hacan'][i], bot: b })) });
const fin = (s) => JSON.stringify([s.winner, s.round, s.players.map((p) => [p.vp, p.techs.length, TI.planetsOwned(s, p).length]), s.log.length]);
(async () => {
  let n = 0;
  for (const seed of [3, 11, 20]) {
    // reference run, capturing a checkpoint at every 7th checkpoint
    const ref = mk(seed), saves = [];
    TI.onCheckpoint = (st) => { if (++n % 7 === 0) saves.push(TI.serializeState(st)); };
    await TI.runGame(ref, ref.players.map((p) => TI.makeBot(p.bot)), { maxRounds: 6 });
    TI.onCheckpoint = null;
    assert(saves.length > 3, 'expected several checkpoints');
    for (const text of saves.slice(0, 6)) {
      const st = TI.deserializeState(text);
      await TI.runGame(st, st.players.map((p) => TI.makeBot(p.bot)), { maxRounds: 6, resume: true });
      assert.strictEqual(fin(st), fin(ref), 'resumed game diverged (seed ' + seed + ', stage ' + JSON.parse(text).stage + ')');
    }
  }
  console.log('save/load tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
