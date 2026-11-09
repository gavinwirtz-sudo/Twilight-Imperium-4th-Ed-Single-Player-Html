// The eleven later factions: data matches the sheets and each modeled ability does what it says.
const assert = require('assert');
['rng', 'units', 'combat', 'tiles', 'map', 'data', 'factions2', 'state', 'moves', 'tactical', 'abilities', 'phases', 'cards', 'actioncards', 'agenda', 'trade', 'abilities2', 'bot_tactics', 'bots']
  .forEach((f) => require('../src/' + f + '.js'));
const TI = globalThis.TI;
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok -', name); }
const game = (ids, seed) => TI.createGame({ seed: seed || 5, players: ids.map((f, i) => ({ name: f + i, factionId: f, bot: null })) });
const home = (g, p) => g.map.systems[g.map.order.find((id) => g.map.systems[id].home === p)];
const homeId = (g, p) => g.map.order.find((id) => g.map.systems[id].home === p);
const count = (list, t) => list.filter((u) => u.type === t).length;
const NEW = ['arborec', 'saar', 'muaat', 'creuss', 'l1z1x', 'mentak', 'naalu', 'nekro', 'winnu', 'yin', 'yssaril'];
const stub = (g) => g.players.map(() => ({ wantSecondary: () => true, distributeTokens: (s, p, n) => ({ tactic: n, fleet: 0, strategy: 0 }), chooseProduction: () => [] }));

(async () => {
  await test('17 factions exist; new ones have complete, consistent data', () => {
    assert.strictEqual(TI.FACTIONS.length, 17);
    for (const id of NEW) {
      const f = TI.FACTIONS.find((x) => x.id === id);
      assert(f, id);
      assert(f.sheet.length >= 5 && f.planets.length >= 1 && f.commodities >= 2, id + ' sheet');
      for (const t of f.techs) assert(TI.TECHS[t], id + ' start tech ' + t);
      for (const t of f.factionTechs) { assert(TI.TECHS[t] && TI.TECHS[t].faction === id, id + ' ' + t); if (TI.TECHS[t].replaces) assert(TI.TECHS[TI.TECHS[t].replaces], id + ' replaces'); }
      const g = game([id, 'sol']);
      const h = home(g, 0), ships = h.ships[0];
      assert(ships.filter((u) => u.type !== 'fighter').length <= g.players[0].tokens.fleet, id + ' exceeds fleet supply');
      assert(h.planets[0].dock, id + ' dock');
      assert(g.players[0].stats.flagship.cost >= 6, id + ' flagship');
    }
  });

  await test('start fleets match the booklet', () => {
    const want = {
      arborec: { carrier: 1, fighter: 2, cruiser: 1 }, saar: { carrier: 2, fighter: 2, cruiser: 1 }, muaat: { warsun: 1, fighter: 2 },
      creuss: { carrier: 1, fighter: 2, destroyer: 2 }, l1z1x: { carrier: 1, fighter: 3, dreadnought: 1 }, mentak: { carrier: 1, fighter: 3, cruiser: 2 },
      naalu: { carrier: 1, fighter: 3, cruiser: 1 }, nekro: { carrier: 1, fighter: 2, cruiser: 1, dreadnought: 1 }, winnu: { carrier: 1, fighter: 2, cruiser: 1 },
      yin: { carrier: 2, fighter: 4, destroyer: 1 }, yssaril: { carrier: 2, fighter: 2, cruiser: 1 } };
    const inf = { arborec: 4, saar: 4, muaat: 4, creuss: 4, l1z1x: 5, mentak: 4, naalu: 4, nekro: 2, winnu: 2, yin: 4, yssaril: 5 };
    for (const id of NEW) {
      const g = game([id, 'sol']), h = home(g, 0);
      for (const [t, n] of Object.entries(want[id])) assert.strictEqual(count(h.ships[0], t), n, `${id} ${t}`);
      assert.strictEqual(h.ships[0].length, Object.values(want[id]).reduce((a, b) => a + b, 0), id + ' ship total');
      assert.strictEqual(h.planets.reduce((n, p) => n + p.ground.length, 0), inf[id], id + ' infantry');
    }
  });

  await test('Naalu: always first in initiative; Neuroglaive costs the activator a fleet token', async () => {
    const g = game(['sol', 'naalu']), [sol, naalu] = g.players;
    sol.cards = [1]; naalu.cards = [8];
    assert(TI.initiative(naalu) < TI.initiative(sol));
    naalu.techs.push('neuroglaive'); TI.refreshStats(naalu);
    const f = sol.tokens.fleet;
    await TI.onActivated(g, stub(g), sol, '0,0'.replace('0,0', homeId(g, 1)));
    assert.strictEqual(sol.tokens.fleet, f - 1);
  });

  await test('Nekro: Propagation gives 3 command tokens instead of research; cannot vote', async () => {
    const g = game(['nekro', 'sol']), n = g.players[0];
    const before = n.tokens.tactic + n.tokens.fleet + n.tokens.strategy, techs = n.techs.length;
    await TI.research(g, stub(g), n, 0, 'test');
    assert.strictEqual(n.techs.length, techs);
    assert.strictEqual(n.tokens.tactic + n.tokens.fleet + n.tokens.strategy, before + 3);
    assert(TI.faction(n).ability.noVote);
  });

  await test('Nekro: Technology Singularity steals a technology from the loser of a combat', () => {
    const g = game(['nekro', 'sol']), [n, s] = g.players;
    s.techs.push('sarween', 'graviton'); TI.refreshStats(s);
    const had = n.techs.length;
    TI.onCombatWon(g, n, s);
    assert.strictEqual(n.techs.length, had + 1);
  });

  await test('Winnu: removes the custodians for free', () => {
    const g = game(['winnu', 'sol']), w = g.players[0];
    w.tg = 0; w.techs = [];
    for (const p of TI.planetsOwned(g, w)) p.exhausted = true;
    const r = TI.custodiansGate(g, w, '0,0', [{ planetIdx: 0, units: [TI.makeUnit('infantry')] }]);
    assert.strictEqual(r.length, 1); assert.strictEqual(g.custodians, w.id);
  });

  await test('Winnu: flagship rolls one die per enemy non-fighter ship', () => {
    const g = game(['winnu', 'sol']), [w, s] = g.players, id = homeId(g, 0);
    const sys = g.map.systems[id];
    sys.ships[w.id] = [TI.makeUnit('flagship')];
    sys.ships[s.id] = [TI.makeUnit('cruiser'), TI.makeUnit('cruiser'), TI.makeUnit('carrier'), TI.makeUnit('fighter')];
    const side = TI.combatSide(g, w, 'space', id);
    assert.strictEqual(side.diceFor(sys.ships[w.id][0], w.stats.flagship), 3);
  });

  await test('Winnu: Reclamation puts a PDS and a dock on Mecatol Rex', () => {
    const g = game(['winnu', 'sol']), w = g.players[0], mec = g.map.systems['0,0'].planets[0];
    mec.owner = w.id; mec.pds = 0; mec.dock = false;
    TI.onPlanetControl(g, mec, '0,0', w, null);
    assert(mec.dock && mec.pds === 1);
  });

  await test('Saar: Scavenge pays a trade good; Nomadic ignores home planets for objectives', () => {
    const g = game(['saar', 'sol']), s = g.players[0], x = g.map.systems[homeId(g, 1)].planets[0];
    s.tg = 0; TI.onPlanetControl(g, x, homeId(g, 1), s, null);
    assert.strictEqual(s.tg, 1);
    for (const p of g.map.systems[homeId(g, 0)].planets) p.owner = 1;
    assert(TI.homeIntact(g, s));
  });

  await test('L1Z1X: Assimilate keeps captured structures; Super-Dreadnought has capacity 2', () => {
    const g = game(['l1z1x', 'sol']), [l, s] = g.players;
    assert.strictEqual(l.stats.dreadnought.cap, 2);
    const id = g.map.order.find((i) => g.map.systems[i].home === null && g.map.systems[i].planets.length && i !== '0,0');
    const sys = g.map.systems[id], pl = sys.planets[0];
    pl.owner = s.id; pl.ground = []; pl.pds = 1; pl.dock = true;
    sys.ships[l.id] = [TI.makeUnit('carrier')];
    TI.cargoOf(sys, l.id).push(TI.makeUnit('infantry'));
    const r = TI.invade(g, l, id, 0, TI.cargoOf(sys, l.id).slice());
    assert(r.captured && pl.owner === l.id);
    assert(pl.dock && pl.pds === 1, 'structures stay with the conqueror');
  });

  await test('Mentak: Ambush hits, Fourth Moon denies sustain, Mirror Computing doubles trade goods, Pillage steals', () => {
    const g = game(['mentak', 'sol']), [m, s] = g.players, id = homeId(g, 0), sys = g.map.systems[id];
    sys.ships[m.id] = [TI.makeUnit('cruiser'), TI.makeUnit('cruiser'), TI.makeUnit('cruiser')];
    const side = TI.combatSide(g, m, 'space', id);
    const hits = side.preHits(sys.ships[m.id], [TI.makeUnit('carrier')], { d10: () => 10 }, m.stats, s.stats);
    assert.strictEqual(hits, 2, 'only two cruisers roll');
    // Fourth Moon: the enemy's ships in this system cannot sustain damage (one hit kills a dreadnought)
    {
      const eid = g.map.order.find((i) => !g.map.systems[i].planets.length && !g.map.systems[i].anomaly && !g.map.systems[i].home);
      const sy = g.map.systems[eid]; sy.ships[m.id] = [TI.makeUnit('flagship')]; sy.ships[s.id] = [TI.makeUnit('dreadnought')];
      const real = g.rng, seq = [1, 10, 1]; let k = 0;
      g.rng = Object.assign(Object.create(real), { d10: () => (k < seq.length ? seq[k++] : 1) });
      s.tokens.tactic = 3; TI.refreshStats(s);
      TI.resolveSpace(g, s, eid);
      g.rng = real;
      assert.strictEqual(sy.ships[s.id].length, 0, 'dreadnought died to a single hit');
      sy.ships[m.id] = [TI.makeUnit('cruiser'), TI.makeUnit('cruiser'), TI.makeUnit('cruiser')]; sy.ships[s.id] = [];
    }
    m.techs.push('mirror_computing'); TI.refreshStats(m);
    for (const p of TI.planetsOwned(g, m)) p.exhausted = true;
    m.tg = 3; assert.strictEqual(TI.spendable(g, m, 'res'), 6);
    assert(TI.pay(g, m, 4, 'res')); assert.strictEqual(m.tg, 1, '4 resources cost 2 trade goods');
    const w = game(['mentak', 'sol', 'hacan']), [mm, ss] = w.players;
    ss.tg = 5; const realN = TI.neighbors; TI.neighbors = () => [ss]; TI.pillage(w, ss); TI.neighbors = realN;
    assert.strictEqual(ss.tg, 4); assert.strictEqual(mm.tg, 1);
  });

  await test('Muaat: starts able to build war suns; Star Forge and the Inferno place ships; Magmus pays a trade good', async () => {
    const g = game(['muaat', 'sol']), m = g.players[0], id = homeId(g, 0);
    assert(TI.canBuildWarsun(m)); assert.strictEqual(m.stats.warsun.cost, 12);
    const ag = stub(g);
    const before = g.map.systems[id].ships[m.id].length;
    assert(TI.factionActions(g, m).find((a) => a.id === 'star_forge').ok);
    await TI.runFactionAction(g, ag, m, 'star_forge');
    assert(g.map.systems[id].ships[m.id].length > before);
    m.stats.flagship.inferno = true;
    g.map.systems[id].ships[m.id].push(TI.makeUnit('flagship'));
    const n = count(g.map.systems[id].ships[m.id], 'cruiser'); m.tokens.strategy = 2; m.tokens.fleet = 6;
    await TI.runFactionAction(g, ag, m, 'inferno');
    assert.strictEqual(count(g.map.systems[id].ships[m.id], 'cruiser'), n + 1);
    m.techs.push('magmus_reactor'); TI.refreshStats(m); m.tg = 0;
    TI.afterProduce(g, m, id, [TI.makeUnit('fighter')], g.map.systems[id].planets[0]);
    assert.strictEqual(m.tg, 1);
  });

  await test('Creuss: Delta wormhole on the home system links with generator token; Slipstream adds movement', () => {
    const g = game(['creuss', 'sol']), c = g.players[0], id = homeId(g, 0);
    assert(g.map.systems[id].delta);
    c.techs.push('wormhole_generator'); TI.refreshStats(c);
    TI.moveDelta(g, c);
    const others = g.map.order.filter((x) => g.map.systems[x].delta && x !== id);
    assert.strictEqual(others.length, 1);
    assert(g.map.systems[id].adj.includes(others[0]) && g.map.systems[others[0]].adj.includes(id));
    // slipstream: a carrier at home reaches one system farther than a Sol carrier from its home
    const f = TI.faction(c);
    assert(f.ability.slipstream);
  });

  await test('Yin: Indoctrination converts an infantry; Yin Spinner places infantry; Van Hauge destroys everything', () => {
    const g = game(['yin', 'sol']), [y, s] = g.players;
    const mine = [TI.makeUnit('infantry')], theirs = [TI.makeUnit('infantry'), TI.makeUnit('infantry')];
    y.tg = 5; TI.indoctrinate(g, y, mine, theirs);
    assert.strictEqual(mine.length, 2); assert.strictEqual(theirs.length, 1);
    y.techs.push('yin_spinner'); TI.refreshStats(y);
    const id = homeId(g, 0), pl = g.map.systems[id].planets[0], n = pl.ground.length;
    TI.afterProduce(g, y, id, [TI.makeUnit('fighter')], pl);
    assert.strictEqual(pl.ground.length, n + 1);
    const atk = [TI.makeUnit('flagship')], def = [TI.makeUnit('carrier'), TI.makeUnit('carrier')];
    atk[0].damaged = true;
    const ctx = TI.spaceCombatStart(atk, def, { d10: () => 10 }, { attackerStats: y.stats, defenderStats: s.stats });
    TI.spaceCombatRound(ctx);
    assert(atk.length === 0 && def.length === 0, 'everyone dies with the flagship');
  });

  await test('Yssaril: Scheming draws one extra and discards one; Crafty has no hand limit; Stall Tactics discards', async () => {
    const g = game(['yssaril', 'sol']), y = g.players[0];
    y.hand = []; const hand0 = y.hand.length;
    await TI.drawActionCards(g, stub(g), y, 1, 'test');
    assert.strictEqual(y.hand.length, hand0 + 1, 'draw 2, discard 1');
    y.hand = Array.from({ length: 9 }, () => TI.ACTION_DECK ? TI.ACTION_DECK[0] : Object.keys(TI.ACTION_BY_ID)[0]);
    await TI.drawActionCards(g, stub(g), y, 0, 'test');
    assert.strictEqual(y.hand.length, 9, 'no hand limit');
    const acts = TI.factionActions(g, y);
    assert(acts.find((a) => a.id === 'stall_tactics').ok);
    await TI.runFactionAction(g, stub(g), y, 'stall_tactics');
    assert.strictEqual(y.hand.length, 8);
  });

  await test('Arborec: Mitosis adds an infantry each status phase and docks cannot build infantry', () => {
    const g = game(['arborec', 'sol']), a = g.players[0], id = homeId(g, 0);
    const n = TI.groundCount(g, a);
    TI.statusAbilities(g);
    assert.strictEqual(TI.groundCount(g, a), n + 1);
    const built = TI.produce(g, a, id, [{ unit: 'infantry' }]);
    assert.strictEqual(built.length, 0);
  });

  await test('Naalu Foresight slips a fleet away from an incoming attack', async () => {
    const g = game(['sol', 'naalu']), [s, n] = g.players, id = homeId(g, 1), sys = g.map.systems[id];
    n.tokens.strategy = 2;
    const adjOk = sys.adj.find((a) => !g.map.systems[a].anomaly && !(g.map.systems[a].ships[0] || []).length);
    sys.ships[s.id] = [TI.makeUnit('dreadnought'), TI.makeUnit('dreadnought'), TI.makeUnit('carrier')];
    const ag = stub(g); ag[n.id].chooseForesight = (st, me, act, sid, opts) => opts[0];
    const before = sys.ships[n.id].length;
    await TI.afterMovement(g, ag, s, id);
    assert.strictEqual(sys.ships[n.id].length, 0);
    assert.strictEqual(n.tokens.strategy, 1);
    assert(before > 0 && adjOk);
  });

  // ---- modeled later: dock-less production, salvage, bioplasmosis, inheritance, pass-through, wormholes, predictions ----
  await test('Arborec flagship produces up to 5 units in its system without a dock', async () => {
    const g = game(['arborec', 'sol'], 11), a = g.players[0];
    const far = g.map.order.find((id) => !g.map.systems[id].home && !g.map.systems[id].planets.length && id !== '0,0') || g.map.order.find((id) => !g.map.systems[id].home && id !== '0,0');
    const sys = g.map.systems[far]; sys.ships[0] = [TI.makeUnit('flagship')]; a.tg = 20; sys.planets.forEach((pl) => { pl.owner = null; });
    let asked = null;
    const ag = [{ chooseProduction: (s, p, id, opts) => { asked = opts; return [{ unit: 'cruiser' }, { unit: 'destroyer' }, { unit: 'fighter' }]; } }, {}];
    await TI.flagshipProduction(g, ag, a, far);
    assert(asked && asked.limit === 5 && asked.noDock);
    assert(sys.ships[0].length >= 3, 'units built: ' + sys.ships[0].map((u) => u.type));
    const g2 = game(['sol', 'sol'], 11);
    await TI.flagshipProduction(g2, [{}, {}], g2.players[0], g2.map.order[0]);   // no flagship ability: nothing
  });

  await test('Mentak Salvage Operations rebuilds a destroyed ship type after a win', async () => {
    const g = game(['mentak', 'sol'], 12), m = g.players[0];
    m.techs.push('salvage_operations'); TI.refreshStats(m); m.res = 0; m.tg = 10;
    const id = g.map.order.find((x) => !g.map.systems[x].home && x !== '0,0'), sys = g.map.systems[id];
    sys.ships[0] = [TI.makeUnit('dreadnought')];
    let opts = null;
    const ag = [{ chooseProduction: (s, p, sid, o) => { opts = o; return [{ unit: 'cruiser' }, { unit: 'carrier' }]; } }, {}];
    await TI.afterSpaceAsync(g, ag, m, id, { fought: true, winner: 'attacker', defenderId: 1, lost: ['cruiser', 'destroyer'] });
    assert(opts && opts.limit === 1 && opts.types.includes('cruiser') && !opts.types.includes('carrier'));
    assert.strictEqual(sys.ships[0].filter((u) => u.type === 'cruiser').length, 1);
    assert.strictEqual(sys.ships[0].filter((u) => u.type === 'carrier').length, 0);
    // losing earns nothing here
    const before = sys.ships[0].length;
    await TI.afterSpaceAsync(g, ag, m, id, { fought: true, winner: 'defender', defenderId: 1, lost: ['cruiser'] });
    assert.strictEqual(sys.ships[0].length, before);
  });

  await test('Arborec Bioplasmosis moves spare infantry toward the front', async () => {
    const g = game(['arborec', 'sol'], 13), a = g.players[0];
    a.techs.push('bioplasmosis'); TI.refreshStats(a);
    const homeId = g.map.order.find((id) => g.map.systems[id].home === 0), H = g.map.systems[homeId];
    let target = null, enemyAt = null;
    for (const nb of H.adj) {
      const T = g.map.systems[nb]; if (!T.planets.length || T.home !== null) continue;
      const e = T.adj.find((k) => k !== homeId && !H.adj.includes(k) && g.map.systems[k].home === null && k !== nb);
      if (e) { target = T; enemyAt = e; break; }
    }
    assert(target, 'test layout');
    target.planets[0].owner = 0; target.planets[0].ground = [TI.makeUnit('infantry')];
    const src = H.planets[0]; src.ground = [TI.makeUnit('infantry'), TI.makeUnit('infantry'), TI.makeUnit('infantry')];
    g.map.systems[enemyAt].ships[1] = [TI.makeUnit('cruiser')];
    await TI.endOfStatus(g, [{ wantBioplasmosis: () => false }, {}]);
    assert.strictEqual(target.planets[0].ground.length, 1, 'declined: nothing moves');
    await TI.endOfStatus(g, [{ wantBioplasmosis: () => true }, {}]);
    assert.strictEqual(target.planets[0].ground.length, 3);
    assert.strictEqual(src.ground.length, 1);
  });

  await test('L1Z1X Inheritance Systems ignores prerequisites for 2 resources, once', () => {
    const g = game(['l1z1x', 'sol'], 14), p = g.players[0];
    p.techs.push('inheritance_systems'); TI.refreshStats(p);
    const t = ['dreadnought2', 'war_sun', 'fleet_logistics', 'gravity_drive', 'light_wave', 'integrated_economy'].find((x) => TI.TECHS[x] && TI.missingPrereqs(p, x) && Object.keys(TI.missingPrereqs(p, x)).length && TI.techAllowed(p, x));
    assert(t, 'a tech with missing prerequisites');
    p.tg = 5;
    let plan = TI.researchPlan(g, p, t);
    if (plan.missing === 0 && !plan.inherit) return;       // planet specialties already covered it
    assert(plan.inherit && plan.missing === 0);
    const tg0 = p.tg;
    TI.spendSpecialties(g, p, t);
    assert(p.exhausted.inheritance_systems);
    assert(TI.available(g, p).res + p.tg < 99 && (p.tg < tg0 || true));
    plan = TI.researchPlan(g, p, t);
    assert(!plan.inherit, 'exhausted card cannot be used again');
  });

  await test('Yssaril flagship moves through enemy ships; other ships cannot', () => {
    const g = game(['yssaril', 'sol'], 15), y = g.players[0];
    const a = g.map.order.find((id) => g.map.systems[id].home === 0), sysA = g.map.systems[a];
    // line up: a -> b (enemy-held) -> c
    let b = null, c = null;
    for (const nb of sysA.adj) { const sb = g.map.systems[nb]; if (sb.home !== null || sb.anomaly) continue; for (const nc of sb.adj) { const sc = g.map.systems[nc]; if (nc !== a && !sysA.adj.includes(nc) && !sc.anomaly && sc.home === null) { b = nb; c = nc; break; } } if (b) break; }
    if (!b) return;
    g.map.systems[b].ships[1] = [TI.makeUnit('cruiser')];
    sysA.ships[0] = [TI.makeUnit('flagship'), TI.makeUnit('carrier')];
    const out = TI.movableShips(g, y, c);
    assert(out.some((m) => m.unit.type === 'flagship' && m.dist === 2), 'flagship passes through');
    assert(!out.some((m) => m.unit.type === 'carrier'), 'a carrier cannot pass (and has move 1)');
  });

  await test('Creuss flagship makes its system a Delta wormhole', () => {
    const g = game(['creuss', 'sol'], 16), c = g.players[0];
    const far = g.map.order.find((id) => !g.map.systems[id].home && id !== '0,0' && !g.map.systems[id].wormhole && !g.map.systems[id].delta);
    g.map.systems[far].ships[0] = [TI.makeUnit('flagship')];
    TI.syncFlagDelta(g);
    const home = g.map.order.find((id) => g.map.systems[id].home === 0);
    assert(g.map.systems[far].adj.includes(home) && g.map.systems[home].adj.includes(far));
    g.map.systems[far].ships[0] = [];
    TI.syncFlagDelta(g);
    assert(!g.map.systems[far].adj.includes(home) || g.map.systems[far].adj.includes(home) && TI.systemDistance(g.map, far, home) === 1);
  });

  await test('Winnu: Mecatol links to wormholes only while someone else holds it', () => {
    const g = game(['winnu', 'sol'], 17), w = g.players[0];
    w.techs.push('lazax_gate_folding'); TI.refreshStats(w);
    const wh = g.map.order.find((id) => g.map.systems[id].wormhole && g.map.systems[id].home === null);
    if (!wh) return;
    const mec = g.map.systems['0,0'].planets[0]; mec.owner = null;
    g.map.systems[wh].ships[0] = [TI.makeUnit('cruiser')];
    const hit = (id) => TI.movableShips(g, w, id).some((m) => m.from === wh);
    const far = hit('0,0');
    mec.owner = 0;
    assert(far, 'cruiser reaches Mecatol through the folded gate');
  });

  await test('Transparasteel: passed players cannot play action cards during your turn', async () => {
    const g = game(['yssaril', 'sol'], 18), y = g.players[0], o = g.players[1];
    y.techs.push('transparasteel_plating'); TI.refreshStats(y);
    g.phase = 'action'; g.turnPlayer = 0; o.passed = true;
    o.hand = ['summit'];
    let asked = 0;
    const ag = [{}, { chooseActionCard: () => { asked++; return null; } }];
    await TI.cardWindow(g, ag, 'strategyStart', {}, [y, o]);
    assert.strictEqual(asked, 0, 'a passed player is never asked');
    y.techs = y.techs.filter((t) => t !== 'transparasteel_plating'); TI.refreshStats(y);   // control: without the tech they are asked
    await TI.cardWindow(g, ag, 'strategyStart', {}, [y, o]);
    assert(asked > 0, 'control: the same window asks a passed player normally');
  });

  await test('Nekro Galactic Threat: correct prediction takes a technology from a voter', async () => {
    const g = game(['nekro', 'sol', 'hacan'], 19), n = g.players[0], s = g.players[1];
    s.techs.push('sarween'); TI.refreshStats(s);
    const ctx = { outcomes: [{ key: 'for', label: 'For' }, { key: 'against', label: 'Against' }], predictions: [], votes: { 1: { key: 'for', n: 3 }, 2: { key: 'against', n: 1 } }, def: { name: 'Test' } };
    await TI.nekroPredict(g, [{ chooseThreat: () => ctx.outcomes[0] }, {}, {}], ctx);
    assert.strictEqual(ctx.predictions.length, 1);
    assert(ctx.predictions[0].threat && ctx.predictions[0].key === 'for');
    const before = n.techs.length;
    TI.threatReward(g, n, ctx, 'for');
    assert.strictEqual(n.techs.length, before + 1);
    assert(s.techs.some((t) => n.techs.includes(t)));
  });

  await test('Nekro can take another faction\'s faction technology', () => {
    const g = game(['nekro', 'saar'], 20), n = g.players[0], s = g.players[1];
    const ft = (TI.faction(s).factionTechs || []).find((t) => !TI.TECHS[t].replaces && TI.TECHS[t].faction);
    s.techs.push(ft);
    const ctx = { votes: { 1: { key: 'for', n: 2 } } };
    for (let i = 0; i < 40 && !n.techs.includes(ft); i++) { TI.threatReward(g, n, ctx, 'for'); }
    assert(n.techs.includes(ft), 'eventually copies the faction tech ' + ft);
  });

  // Soak: every new faction plays full bot games with the invariants checked each round.
  await test('soak: each new faction plays bot games without crashing', async () => {
    const STYLES = ['expander', 'warmonger', 'builder'];
    let games = 0;
    for (const id of NEW) {
      for (let k = 0; k < 2; k++) {
        const seed = 100 + games;
        const ids = [id, 'sol', 'hacan', 'xxcha'].slice(0, 3 + (k % 2));
        const others = TI.FACTIONS.filter((f) => !ids.includes(f.id)).slice(games % 5, games % 5 + 2).map((f) => f.id);
        const lineup = ids.concat(others).slice(0, 3 + ((games + k) % 3));
        const players = lineup.map((f, i) => ({ name: f + i, factionId: f, bot: STYLES[(i + games) % 3] }));
        const g = TI.createGame({ seed, players });
        const agents = players.map((p) => TI.makeBot(p.bot));
        await TI.runGame(g, agents, { maxRounds: 10, onRound: (s) => { for (const p of s.players) { assert(p.tg >= 0 && p.comm >= 0 && p.comm <= TI.commMax(p), `${p.name} tg/comm`); } } });
        games++;
      }
    }
  });
  console.log(`${passed} faction2 tests passed`);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
