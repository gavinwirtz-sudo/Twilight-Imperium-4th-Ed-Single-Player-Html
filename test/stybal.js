// Unconfounded balance harness: styles and factions are assigned independently at random per seat.
// Usage: MAPMODE=preset|random|balanced node test/stybal.js [games]
['rng','units','combat','tiles','map','data','factions2','state','moves','tactical','abilities','phases','cards', 'actioncards', 'agenda', 'trade', 'abilities2', 'bot_tactics','bots'].forEach(f=>require('../src/'+f+'.js'));
const TI = globalThis.TI;
(async () => {
  const N = Number(process.argv[2] || 150), STY = ['expander','warmonger','builder'], fs = TI.FACTIONS.map(f => f.id);
  const ws = {}, ps = {}, wf = {}, pf = {};
  const bump = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  const r = TI.makeRng(4242);
  for (let g = 0; g < N; g++) {
    const n = 3 + (g % 4), seed = 1000 + g;
    const players = Array.from({ length: n }, (_, i) => ({ name: 'B' + i, factionId: r.pick(fs), bot: r.pick(STY) }));
    const state = TI.createGame({ seed, players, mapMode: process.env.MAPMODE });
    await TI.runGame(state, players.map(p => TI.makeBot(p.bot)), { maxRounds: 14 });
    players.forEach(p => { bump(ps, p.bot, 1); bump(pf, p.factionId, 1); });
    bump(ws, players[state.winner].bot, 1); bump(wf, players[state.winner].factionId, 1);
  }
  const line = (w, p) => Object.keys(p).sort().map(k => `${k} ${(100 * (w[k] || 0) / p[k]).toFixed(0)}%`).join('  ');
  console.log('styles  :', line(ws, ps));
  console.log('factions:', line(wf, pf));
})();
