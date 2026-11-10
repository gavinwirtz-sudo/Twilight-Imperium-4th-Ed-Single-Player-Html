// Balance harness: many games, summary only. Usage: node test/balance.js [games]
['rng','units','combat','tiles','map','data','factions2','state','moves','tactical','abilities','phases','cards', 'actioncards', 'agenda', 'trade', 'abilities2', 'bot_tactics','bots'].forEach(f=>require('../src/'+f+'.js'));
const TI = globalThis.TI;
(async () => {
  const N = Number(process.argv[2] || 90), STY = ['expander','warmonger','builder'];
  const wins = { expander: 0, warmonger: 0, builder: 0 }, played = { expander: 0, warmonger: 0, builder: 0 };
  let limit = 0, rounds = 0;
  for (let seed = 100; seed < 100 + N; seed++) {
    const n = 3 + (seed % 4), fs = TI.FACTIONS.map(f => f.id);
    // rotate styles AND factions independently so neither biases the other
    const players = Array.from({ length: n }, (_, i) => ({ name: 'B' + i, factionId: fs[(i * 2 + seed) % fs.length], bot: STY[(i + seed) % 3] }));
    const state = TI.createGame({ seed, players, mapMode: process.env.MAPMODE });
    await TI.runGame(state, players.map(p => TI.makeBot(p.bot)), { maxRounds: 14 });
    players.forEach(p => played[p.bot]++);
    wins[players[state.winner].bot]++;
    if (state.endedByRoundLimit) limit++;
    rounds += state.round - 1;
  }
  console.log('games', N, '| avg rounds', (rounds / N).toFixed(1), '| round-limit', limit);
  for (const s of STY) console.log(s.padEnd(10), 'win rate per seat', (100 * wins[s] / played[s]).toFixed(1) + '%', `(${wins[s]} wins / ${played[s]} seats)`);
})();
