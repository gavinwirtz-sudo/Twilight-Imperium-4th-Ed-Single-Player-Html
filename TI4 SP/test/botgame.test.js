// Soak test: bots play complete games headlessly. Catches stalls, crashes, and rule violations.
const assert = require('assert');
['rng', 'units', 'combat', 'tiles', 'map', 'data', 'factions2', 'state', 'moves', 'tactical', 'abilities', 'phases', 'cards', 'actioncards', 'agenda', 'trade', 'abilities2', 'bot_tactics', 'bots']
  .forEach((f) => require('../src/' + f + '.js'));
const TI = globalThis.TI;

const STYLES = ['expander', 'warmonger', 'builder'];

function setup(seed, n) {
  const fs = TI.FACTIONS.map((f) => f.id);
  const players = Array.from({ length: n }, (_, i) => ({ name: 'Bot' + (i + 1), factionId: fs[(i + seed) % fs.length], bot: STYLES[(i + seed) % 3] }));
  const state = TI.createGame({ seed, players });
  const agents = players.map((p) => TI.makeBot(p.bot));
  return { state, agents };
}

// Invariants that must hold at any time.
function checkInvariants(state) {
  for (const id of state.map.order) {
    const sys = state.map.systems[id];
    for (const p of state.players) {
      const ships = sys.ships[p.id] || [];
      const nonFighter = ships.filter((u) => u.type !== 'fighter').length;
      assert(nonFighter <= TI.fleetLimit(p) + 2, `fleet limit exceeded at ${id} by ${p.name}: ${nonFighter}`);
    }
    for (const pl of sys.planets) {
      assert(pl.owner === null || pl.owner < state.players.length);
      if (pl.owner === null) assert(pl.ground.length === 0, 'ground forces on unowned planet ' + pl.name);
      assert((pl.pds || 0) <= TI.pdsCap(), 'too many PDS on ' + pl.name);
    }
  }
  for (const p of state.players) {
    assert(p.tg >= 0, p.name + ' has negative trade goods');
    for (const k of ['tactic', 'fleet', 'strategy']) assert(p.tokens[k] >= 0, p.name + ' negative ' + k);
  }
}

(async () => {
  const results = [];
  const seeds = Number(process.argv[2] || 12);
  for (let seed = 1; seed <= seeds; seed++) {
    const n = 3 + (seed % 4); // 3..6 players
    const { state, agents } = setup(seed, n);
    await TI.runGame(state, agents, { maxRounds: 14, onRound: (s) => checkInvariants(s) });
    checkInvariants(state);
    const w = state.players[state.winner];
    if (state.endedByObjectives) {
      // Objective deck ran out: the leader wins (ties go to the first in initiative order).
      assert(state.players.every((q) => q.vp <= w.vp), `seed ${seed}: winner ${w.name} (${w.vp}) is not the VP leader`);
    } else if (!state.endedByRoundLimit) {
      assert(w.vp >= state.vpToWin, `winner ${w.name} has only ${w.vp} VP`);
      const others = state.players.filter((q) => q.id !== w.id && q.vp >= state.vpToWin);
      assert(others.length === 0, `seed ${seed}: ${others.map((q) => q.name + ' ' + q.vp).join(', ')} also at/above ${state.vpToWin} VP`);
    }
    results.push({ seed, n, rounds: state.round - 1, winner: w.name, style: w.bot, vp: w.vp, byLimit: !!state.endedByRoundLimit, byDeck: !!state.endedByObjectives,
                   vps: state.players.map((p) => p.vp).join('/') });
    console.log(`seed ${seed} (${n}p): ${w.name}/${w.bot} wins ${w.vp}VP after ${state.round - 1} rounds${state.endedByRoundLimit ? ' [round limit]' : ''}${state.endedByObjectives ? ' [objectives ran out]' : ''}  all: ${results[results.length - 1].vps}`);
  }
  const deck = results.filter((r) => r.byDeck).length, limit = results.filter((r) => r.byLimit).length;
  console.log(`\n${results.length} games: ${results.length - deck - limit} reached ${TI.VP_TO_WIN} VP, ${deck} ended when the objectives ran out, ${limit} hit the round limit`);
  const byStyle = {};
  results.forEach((r) => { byStyle[r.style] = (byStyle[r.style] || 0) + 1; });
  console.log('wins by style:', JSON.stringify(byStyle));
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
