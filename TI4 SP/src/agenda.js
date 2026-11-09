// Agenda phase: the agenda deck (base game, 50 cards), voting, laws in play and the hooks that make laws matter.
//
// A card is a directive (resolved once, then discarded) or a law (stays in play). Cards either ask For/Against or elect
// something (player, planet, scored secret objective, law in play). Voting follows the rules: starting left of the speaker
// (speaker last), each player picks one outcome and casts 1 vote per influence of the planets they exhaust.
//
// Persistent laws set flags in TI.rules (recomputed from state.laws) that the rest of the engine reads; cards owned by a
// player (the ministers, the Crowns...) are looked up with TI.lawOwner.
(function (root) {
  const TI = (root.TI = root.TI || {});
  TI.rules = {};

  // ---- small helpers ----------------------------------------------------------------------------
  const S = (state) => state.map.systems;
  const allPlanets = (state) => { const out = []; for (const id of state.map.order) S(state)[id].planets.forEach((pl, i) => out.push({ pl, s: id, i })); return out; };
  const planetAt = (state, r) => S(state)[r.s].planets[r.i];
  const isHex = (a, b) => Math.abs(a.q - b.q) <= 1 && Math.abs(a.r - b.r) <= 1 && Math.abs((a.q - b.q) + (a.r - b.r)) <= 1;
  const seat = (state, startId) => state.players.map((_, i) => state.players[(startId + i) % state.players.length]);
  const COST = { fighter: 0.5, destroyer: 1, cruiser: 2, carrier: 3, dreadnought: 4, warsun: 12, flagship: 8, infantry: 0.5, mech: 2 };
  const entry = (state, id) => (state.laws || []).find((l) => l.id === id);
  const leaders = (state) => { const m = Math.max(...state.players.map((p) => p.vp)); return state.players.filter((p) => p.vp === m); };
  const losers = (state) => { const m = Math.min(...state.players.map((p) => p.vp)); return state.players.filter((p) => p.vp === m); };
  const planetsOf = (state, p) => TI.planetsOwned(state, p);
  const homeOf = (state, p) => state.map.order.find((id) => S(state)[id].home === p.id);
  const infCount = (pl) => pl.ground.filter((u) => u.type === 'infantry').length;
  const hexAdjacent = (state, a) => S(state)[a].adj.filter((n) => isHex(S(state)[a], S(state)[n]));
  const wormholeSys = (state) => state.map.order.filter((id) => S(state)[id].wormhole);
  const mecatolId = (state) => state.map.order.find((id) => S(state)[id].mecatol) || '0,0';
  const cheapest = (list, st) => list.slice().sort((a, b) => (COST[a.type] || 1) - (COST[b.type] || 1));
  const ask = async (agent, name, def, ...args) => (agent && agent[name] ? agent[name](...args) : def(...args));

  // ---- laws in play -------------------------------------------------------------------------------
  TI.lawOwner = (state, id) => { const e = entry(state, id); return e && e.owner !== null && e.owner !== undefined ? e.owner : null; };
  TI.lawIs = (state, id) => { const e = entry(state, id); return !!e; };
  TI.pdsCap = () => (TI.rules.pdsUnlimited ? 99 : 2);

  // Recompute the flags the engine reads from the laws that are in play.
  TI.syncRules = function (state) {
    const on = (id) => { const e = entry(state, id); return !!e && e.outcome === 'for'; };
    const r = {
      handLimit: on('executive_sanctions') ? 3 : 7,
      fleetCap: on('fleet_regulations') ? 4 : null,
      pdsUnlimited: on('homeland_defense'),
      noBombardCultural: on('conventions_of_war'),
      noWormholes: on('enforced_travel_ban'),
      wormholeLink: on('wormhole_reconstruction'),
      nebulaThrough: on('shared_research'),
      conscription: on('regulated_conscription'),
      warsunFree: on('publicize_weapon'),
      repGov: on('representative_government'),
      antiResearch: on('anti_intellectual'),
    };
    TI.rules = r;
    TI.HAND_LIMIT = r.handLimit;
    if (state.players) for (const p of state.players) if (p.stats) TI.refreshStats(p);
  };
  TI.resetAgenda = function (state) {
    state.laws = []; state.pending = []; state.noVote = [];
    state.agendaDeck = TI.buildAgendaDeck(state.rng); state.agendaDiscard = [];
    TI.syncRules(state);
  };

  // Planets with a printed law attached change their values for good; these undo it again.
  function attach(state, law, ref) {
    const pl = planetAt(state, ref); pl.attach = (pl.attach || []).concat(law);
    return pl;
  }
  function detach(state, law, ref) { const pl = planetAt(state, ref); pl.attach = (pl.attach || []).filter((x) => x !== law); return pl; }

  // ---- the cards ------------------------------------------------------------------------------------
  const DECK = [];
  // spec: { type, text, elect, outcomes?, candidates?, bias?, escore?, resolve?, keepsFor?, attach?, undo? }
  const add = (id, name, type, text, spec) => DECK.push(Object.assign({ id, name, type, text }, spec));

  const researchFree = async (state, agents, p, label) => { await TI.research(state, agents, p, 0, label); };
  const discardHand = (state, p) => { while (p.hand.length) TI.discardActionCard(state, p, p.hand[0]); };
  const loseVP = (state, p, n, why) => { const d = Math.min(n, p.vp); if (d > 0) { p.vp -= d; TI.log(state, `${p.name} loses ${d} VP (${why}) → ${p.vp}.`); } };
  const plannedTech = (p) => p.techs.length;
  const myShipsNear = (state, p, ids) => ids.reduce((n, id) => n + (S(state)[id].ships[p.id] || []).length, 0);
  const queue = (state, kind, extra) => { state.pending.push(Object.assign({ kind }, extra || {})); };
  const stratLabel = 'at the start of the next strategy phase';

  const cand = {
    players: (state) => state.players.map((p) => ({ key: 'p' + p.id, label: p.name, value: p.id })),
    planets: (state, f) => allPlanets(state).filter((e) => f(e)).map((e) => ({ key: e.s + '|' + e.i, label: `${e.pl.name}${e.pl.owner !== null ? ' (' + state.players[e.pl.owner].name + ')' : ' (unclaimed)'}`, value: { s: e.s, i: e.i } })),
  };
  const isHome = (state, e) => S(state)[e.s].home !== null;

  // -- directives
  add('archived_secret', 'Archived Secret', 'directive', 'The elected player draws 1 secret objective.', {
    elect: 'player', candidates: cand.players,
    escore: (state, p, c) => (c.value === p.id ? 1.2 : -0.3) - (state.players[c.value].secrets.length >= 3 ? 1 : 0),
    resolve: async (state, agents, out) => { await TI.drawSecret(state, agents, state.players[out.value]); } });
  add('arms_reduction', 'Arms Reduction', 'directive', 'For: each player destroys all but 2 dreadnoughts and all but 4 cruisers. Against: ' + stratLabel + ', each player exhausts each planet with a technology specialty.', {
    bias: (state, p) => -(Math.max(0, TI.countShips(state, p, ['dreadnought']) - 2) * 1.5 + Math.max(0, TI.countShips(state, p, ['cruiser']) - 4) * 0.8) + planetsOf(state, p).filter((x) => x.tech).length * 0.8,
    resolve: async (state, agents, out) => {
      if (out.key === 'against') { queue(state, 'exhaustSpecialty'); return; }
      for (const p of state.players) for (const [t, keep] of [['dreadnought', 2], ['cruiser', 4]]) {
        let have = []; for (const id of state.map.order) (S(state)[id].ships[p.id] || []).forEach((u) => { if (u.type === t) have.push({ id, u }); });
        const kill = have.slice().sort((a, b) => (b.u.damaged ? 0 : 1) - (a.u.damaged ? 0 : 1)).slice(0, Math.max(0, have.length - keep));
        for (const k of kill) { const l = S(state)[k.id].ships[p.id]; l.splice(l.indexOf(k.u), 1); TI.trimCargo(state, p, S(state)[k.id]); }
        if (kill.length) TI.log(state, `${p.name} destroys ${kill.length} ${t}${kill.length === 1 ? '' : 's'}.`);
      }
    } });
  add('colonial_redistribution', 'Colonial Redistribution', 'directive', 'Destroy each unit on the elected non-home planet other than Mecatol Rex. Its controller chooses a player with the fewest VP, who may place 1 infantry there.', {
    elect: 'planet', candidates: (state) => cand.planets(state, (e) => e.pl.owner !== null && !isHome(state, e) && !e.pl.mecatol),
    escore: (state, p, c) => { const pl = planetAt(state, c.value); return pl.owner === p.id ? -(pl.ground.length * 0.5 + 0.8) : (pl.ground.length * 0.4 + (pl.pds || 0) * 0.5 + (pl.dock ? 1 : 0)) * 0.7; },
    resolve: async (state, agents, out) => {
      const pl = planetAt(state, out.value), owner = state.players[pl.owner];
      pl.ground = []; pl.pds = 0; pl.dock = false;
      TI.log(state, `${owner.name}'s units on ${pl.name} are destroyed.`);
      const poor = losers(state);
      const pick = poor.length === 1 ? poor[0] : state.players[await ask(agents[owner.id], 'chooseCardPlayer', (s, me, list) => list[0].id, state, owner, poor)] || poor[0];
      if (!pl.dmz && TI.unitsLeft(state, pick, 'infantry') > 0) {
        pl.ground.push(TI.makeUnit('infantry'));
        if (pick.id !== pl.owner) { const old = pl.owner; pl.owner = pick.id; TI.onPlanetControl(state, pl, out.value.s, pick, state.players[old]); }
        TI.log(state, `${pick.name} places an infantry on ${pl.name}.`);
      }
    } });
  add('compensated_disarmament', 'Compensated Disarmament', 'directive', 'Destroy each ground force on the elected planet; its controller gains 1 trade good for each.', {
    elect: 'planet', candidates: (state) => cand.planets(state, (e) => e.pl.owner !== null && e.pl.ground.length > 0),
    escore: (state, p, c) => { const pl = planetAt(state, c.value); return pl.owner === p.id ? 0.2 * pl.ground.length - 0.3 : -pl.ground.length * 0.2 + 0.1; },
    resolve: async (state, agents, out) => { const pl = planetAt(state, out.value), o = state.players[pl.owner], n = pl.ground.length; pl.ground = []; o.tg += n; TI.log(state, `${o.name} loses ${n} ground forces on ${pl.name} and gains ${n} trade goods.`); } });
  add('economic_equality', 'Economic Equality', 'directive', 'For: each player returns all trade goods, then gains 5. Against: each player returns all trade goods.', {
    bias: () => 1, resolve: async (state, agents, out) => { for (const p of state.players) p.tg = out.key === 'for' ? 5 : 0; TI.log(state, out.key === 'for' ? 'Everyone now has exactly 5 trade goods.' : 'Everyone loses all trade goods.'); } });
  add('incentive_program', 'Incentive Program', 'directive', 'For: reveal 1 stage I public objective. Against: reveal 1 stage II public objective.', {
    bias: () => 0.4, resolve: async (state, agents, out) => {
      const deck = out.key === 'for' ? state.deck.stage1 : state.deck.stage2, id = deck.pop();
      if (!id) { TI.log(state, 'That objective deck is empty.'); return; }
      state.publicObjectives.push(id); TI.log(state, `Incentive Program reveals "${TI.objectiveById(id).name}".`);
    } });
  add('ixthian_artifact', 'Ixthian Artifact', 'directive', 'For: the speaker rolls a die. 6-10: each player may research 2 technologies. 1-5: destroy everything in Mecatol Rex\'s system, and each player destroys 3 of their units in each adjacent system. Against: no effect.', {
    bias: (state, p) => 0.7 - myShipsNear(state, p, [mecatolId(state)].concat(hexAdjacent(state, mecatolId(state)))) * 0.35,
    resolve: async (state, agents, out) => {
      if (out.key !== 'for') return;
      const r = state.rng.d10(); TI.log(state, `The speaker rolls ${r} for the Ixthian Artifact.`);
      if (r >= 6) { for (const p of seat(state, state.speaker)) { await researchFree(state, agents, p, 'Ixthian Artifact'); await researchFree(state, agents, p, 'Ixthian Artifact'); } return; }
      const mid = mecatolId(state), sys = S(state)[mid];
      for (const k of Object.keys(sys.ships)) sys.ships[k] = [];
      sys.cargo = {}; for (const pl of sys.planets) { pl.ground = []; pl.pds = 0; pl.dock = false; }
      TI.log(state, 'Everything in the Mecatol Rex system is destroyed.');
      for (const nid of hexAdjacent(state, mid)) for (const p of state.players) {
        const s2 = S(state)[nid], mine = [].concat((s2.ships[p.id] || []).map((u) => ({ u, list: s2.ships[p.id] })), ...s2.planets.filter((x) => x.owner === p.id).map((x) => x.ground.map((u) => ({ u, list: x.ground }))));
        const kill = cheapest(mine.map((m) => m.u)).slice(0, 3);
        for (const u of kill) { const m = mine.find((x) => x.u === u); m.list.splice(m.list.indexOf(u), 1); }
        if (kill.length) { TI.trimCargo(state, p, s2); TI.log(state, `${p.name} destroys ${kill.length} unit(s) in ${nid}.`); }
      }
    } });
  add('judicial_abolishment', 'Judicial Abolishment', 'directive', 'Discard the elected law from play.', {
    elect: 'law', candidates: (state) => state.laws.map((l) => ({ key: l.id, label: DEF[l.id].name, value: l.id })),
    escore: (state, p, c) => TI.lawHarm(state, p, entry(state, c.value)),
    resolve: async (state, agents, out) => { const e = entry(state, out.value); if (e) { TI.discardLaw(state, e); TI.log(state, `${DEF[out.value].name} is discarded from play.`); } } });
  add('miscount_disclosed', 'Miscount Disclosed', 'directive', 'Vote on the elected law as if it were just revealed from the top of the deck.', {
    elect: 'law', candidates: (state) => state.laws.map((l) => ({ key: l.id, label: DEF[l.id].name, value: l.id })),
    escore: (state, p, c) => TI.lawHarm(state, p, entry(state, c.value)) * 0.8,
    resolve: async (state, agents, out) => { const e = entry(state, out.value); if (!e) return; TI.discardLaw(state, e, true, true); await TI.resolveAgenda(state, agents, DEF[out.value], { noReplace: true, revote: true }); } });
  add('mutiny', 'Mutiny', 'directive', 'For: each player that voted "For" gains 1 VP. Against: each player that voted "For" loses 1 VP.', {
    bias: () => 0.5, resolve: async (state, agents, out, ctx) => {
      for (const p of state.players) if (ctx.votes[p.id] && ctx.votes[p.id].key === 'for') { if (out.key === 'for') TI.addVP(state, p, 1, 'Mutiny'); else loseVP(state, p, 1, 'Mutiny'); }
    } });
  add('new_constitution', 'New Constitution', 'directive', 'For: discard all laws from play; ' + stratLabel + ', each player exhausts each planet in their home system. Against: no effect.', {
    bias: (state, p) => state.laws.reduce((n, l) => n + (l.owner === p.id ? -0.9 : TI.lawHarm(state, p, l) * 0.5), 0) - 0.4,
    resolve: async (state, agents, out) => { if (out.key !== 'for') return; for (const l of state.laws.slice()) TI.discardLaw(state, l); queue(state, 'exhaustHome'); TI.log(state, 'All laws are discarded.'); } });
  add('public_execution', 'Public Execution', 'directive', 'The elected player discards all action cards, passes the speaker token left if they hold it, and cannot vote on agendas this phase.', {
    elect: 'player', candidates: cand.players,
    escore: (state, p, c) => (c.value === p.id ? -2 : (leaders(state).some((l) => l.id === c.value) ? 0.8 : 0.3) + state.players[c.value].hand.length * 0.15),
    resolve: async (state, agents, out) => {
      const v = state.players[out.value]; discardHand(state, v);
      if (state.speaker === v.id) { state.speaker = (v.id + 1) % state.players.length; TI.log(state, `${state.players[state.speaker].name} becomes speaker.`); }
      state.noVote.push(v.id); TI.log(state, `${v.name} discards their action cards and cannot vote this phase.`);
    } });
  add('seed_of_an_empire', 'Seed of an Empire', 'directive', 'For: the player with the most VP gains 1 VP. Against: the player with the fewest VP gains 1 VP.', {
    bias: (state, p) => (leaders(state).includes(p) ? 1.5 : losers(state).includes(p) ? -1.5 : 0.1),
    resolve: async (state, agents, out) => { for (const p of out.key === 'for' ? leaders(state) : losers(state)) TI.addVP(state, p, 1, 'Seed of an Empire'); } });
  add('swords_to_plowshares', 'Swords to Plowshares', 'directive', 'For: each player destroys half their infantry on each planet (rounded up), then gains trade goods equal to those destroyed. Against: each player places 1 infantry on each planet they control.', {
    bias: (state, p) => -planetsOf(state, p).length * 0.5 + 0.1,
    resolve: async (state, agents, out) => {
      for (const p of state.players) {
        let gain = 0;
        for (const pl of planetsOf(state, p)) {
          if (out.key === 'for') { const inf = pl.ground.filter((u) => u.type === 'infantry'), n = Math.ceil(inf.length / 2); inf.slice(0, n).forEach((u) => pl.ground.splice(pl.ground.indexOf(u), 1)); gain += n; }
          else if (!pl.dmz && TI.unitsLeft(state, p, 'infantry') > 0) pl.ground.push(TI.makeUnit('infantry'));
        }
        p.tg += gain;
      }
      TI.log(state, out.key === 'for' ? 'Every player halves their infantry and is paid in trade goods.' : 'Every player places an infantry on each of their planets.');
    } });
  add('unconventional_measures', 'Unconventional Measures', 'directive', 'For: each player that voted "For" draws 2 action cards. Against: each player that voted "For" discards all of their action cards.', {
    bias: (state, p) => 0.6 - p.hand.length * 0.2,
    resolve: async (state, agents, out, ctx) => {
      for (const p of state.players) if (ctx.votes[p.id] && ctx.votes[p.id].key === 'for') { if (out.key === 'for') await TI.drawActionCards(state, agents, p, 2, 'Unconventional Measures'); else discardHand(state, p); }
    } });
  add('wormhole_research', 'Wormhole Research', 'directive', 'For: each player with a ship in a wormhole system may research 1 technology; then destroy all ships in alpha and beta wormhole systems. Against: each player that voted "Against" removes 1 command token from their sheet.', {
    bias: (state, p) => { const n = myShipsNear(state, p, wormholeSys(state)); return n ? 0.6 - n * 0.8 : 0.2; },
    resolve: async (state, agents, out, ctx) => {
      if (out.key === 'against') { for (const p of state.players) if (ctx.votes[p.id] && ctx.votes[p.id].key === 'against') { const k = p.tokens.tactic > 0 ? 'tactic' : p.tokens.strategy > 0 ? 'strategy' : 'fleet'; if (p.tokens[k] > 0) { p.tokens[k]--; TI.log(state, `${p.name} loses a command token.`); } } return; }
      const ws = wormholeSys(state);
      for (const p of state.players) if (myShipsNear(state, p, ws)) await researchFree(state, agents, p, 'Wormhole Research');
      for (const id of ws) { for (const k of Object.keys(S(state)[id].ships)) S(state)[id].ships[k] = []; S(state)[id].cargo = {}; }
      TI.log(state, 'All ships in wormhole systems are destroyed.');
    } });

  // -- laws that stay in play when "For" wins (or always, when elected)
  const lawFor = (id, name, text, spec) => add(id, name, 'law', text, Object.assign({ keepsFor: true }, spec));
  lawFor('anti_intellectual', 'Anti-Intellectual Revolution', 'For: after a player researches a technology, they must destroy 1 of their non-fighter ships. Against: ' + stratLabel + ', each player exhausts 1 planet for each technology they own.', {
    bias: (state, p) => p.techs.length * 0.25 - 0.8,
    resolve: async (state, agents, out) => { if (out.key === 'against') queue(state, 'exhaustPerTech'); } });
  lawFor('conventions_of_war', 'Conventions of War', 'For: players cannot use Bombardment against units on cultural planets. Against: each player that voted "Against" discards all of their action cards.', {
    bias: (state, p) => planetsOf(state, p).filter((x) => x.trait === 'cultural').length * 0.5 + p.hand.length * 0.5,
    resolve: async (state, agents, out, ctx) => { if (out.key === 'against') for (const p of state.players) if (ctx.votes[p.id] && ctx.votes[p.id].key === 'against') discardHand(state, p); } });
  lawFor('enforced_travel_ban', 'Enforced Travel Ban', 'For: alpha and beta wormholes have no effect during movement. Against: destroy each PDS in or adjacent to a system that contains a wormhole.', {
    bias: (state, p) => { const near = new Set(wormholeSys(state).flatMap((id) => [id].concat(hexAdjacent(state, id)))); return planetsOf(state, p).reduce((n, x) => n + (near.has(x.systemId) ? (x.pds || 0) : 0), 0) * 0.8 - 0.3; },
    resolve: async (state, agents, out) => {
      if (out.key !== 'against') return;
      const near = new Set(wormholeSys(state).flatMap((id) => [id].concat(hexAdjacent(state, id))));
      for (const id of near) for (const pl of S(state)[id].planets) if (pl.pds) { TI.log(state, `The PDS on ${pl.name} are destroyed.`); pl.pds = 0; }
    } });
  lawFor('executive_sanctions', 'Executive Sanctions', 'For: each player can have a maximum of 3 action cards in hand. Against: each player discards 1 random action card.', {
    bias: (state, p) => -Math.max(0, p.hand.length - 3) * 0.5 + (p.hand.length ? 0.4 : 0),
    resolve: async (state, agents, out) => {
      if (out.key === 'against') { for (const p of state.players) if (p.hand.length) { const [c] = p.hand.splice(state.rng.int(p.hand.length), 1); state.actionDiscard.push(c); } return; }
      TI.syncRules(state); for (const p of state.players) while (p.hand.length > 3) TI.discardActionCard(state, p, p.hand.slice().sort((a, b) => TI.ACTION_BY_ID[a].weight - TI.ACTION_BY_ID[b].weight)[0]);
    } });
  lawFor('fleet_regulations', 'Fleet Regulations', 'For: each player cannot have more than 4 tokens in their fleet pool. Against: each player places 1 command token in their fleet pool.', {
    bias: (state, p) => -1 - Math.max(0, p.tokens.fleet - 4),
    resolve: async (state, agents, out) => { if (out.key === 'against') for (const p of state.players) p.tokens.fleet++; else TI.syncRules(state); } });
  lawFor('homeland_defense', 'Homeland Defense Act', 'For: each player can have any number of PDS on planets they control. Against: each player destroys 1 of their PDS.', {
    bias: (state, p) => (TI.structureCount(state, p, 'pds') ? 1.2 : 0.2),
    resolve: async (state, agents, out) => {
      if (out.key !== 'against') return;
      for (const p of state.players) { const pl = planetsOf(state, p).filter((x) => x.pds > 0).sort((a, b) => b.pds - a.pds)[0]; if (pl) { pl.pds--; TI.log(state, `${p.name} destroys a PDS on ${pl.name}.`); } }
    } });
  lawFor('publicize_weapon', 'Publicize Weapon Schematics', 'For: if any player owns a war sun technology, all players may ignore the prerequisites of war sun technologies and all war suns lose Sustain Damage. Against: each player that owns a war sun technology discards all action cards.', {
    bias: (state, p) => (p.techs.includes('war_sun') ? p.hand.length * 0.5 - 1 : 0.8),
    resolve: async (state, agents, out) => {
      const any = state.players.some((p) => p.techs.includes('war_sun'));
      if (out.key === 'against') { for (const p of state.players) if (p.techs.includes('war_sun')) discardHand(state, p); return; }
      if (!any) { out.fizzled = true; TI.log(state, 'Nobody owns the war sun technology, so the law has no effect.'); }
    } });
  lawFor('regulated_conscription', 'Regulated Conscription', 'For: when a player produces units, they produce only 1 fighter or infantry for its cost instead of 2. Against: no effect.', { bias: () => -0.8 });
  lawFor('representative_government', 'Representative Government', 'For: players cannot exhaust planets to cast votes; each player may cast 1 vote on each agenda. Against: ' + stratLabel + ', each player that voted "Against" exhausts all of their cultural planets.', {
    bias: (state, p) => 1.5 - TI.available(state, p).inf * 0.25 + planetsOf(state, p).filter((x) => x.trait === 'cultural').length * 0.5,
    resolve: async (state, agents, out, ctx) => { if (out.key === 'against') queue(state, 'exhaustCultural', { players: state.players.filter((p) => ctx.votes[p.id] && ctx.votes[p.id].key === 'against').map((p) => p.id) }); } });
  lawFor('shared_research', 'Shared Research', 'For: each player\'s units can move through nebulae. Against: each player places a command token from their reinforcements in their home system, if able.', {
    bias: () => 0.6,
    resolve: async (state, agents, out) => { if (out.key === 'against') for (const p of state.players) { const t = TI.tokensOn(S(state)[homeOf(state, p)]); if (!t.includes(p.id)) t.push(p.id); } } });
  lawFor('wormhole_reconstruction', 'Wormhole Reconstruction', 'For: systems with an alpha or beta wormhole are adjacent to each other. Against: each player places a command token in each wormhole system that contains 1 or more of their ships.', {
    bias: () => 0.3,
    resolve: async (state, agents, out) => { if (out.key === 'against') for (const p of state.players) for (const id of wormholeSys(state)) if ((S(state)[id].ships[p.id] || []).length) { const t = TI.tokensOn(S(state)[id]); if (!t.includes(p.id)) t.push(p.id); } } });

  // -- one-shot law
  add('classified_document_leaks', 'Classified Document Leaks', 'law', 'The elected scored secret objective becomes a public objective.', {
    oneShot: true, elect: 'secret',
    candidates: (state) => { const out = []; for (const p of state.players) for (const id of p.scored) if (TI.objectiveById(id).stage === 'secret' && !state.publicObjectives.includes(id)) out.push({ key: id, label: `${TI.objectiveById(id).name} (${p.name})`, value: id }); return out; },
    escore: (state, p, c) => (p.scored.includes(c.value) ? -0.3 : 0.5),
    resolve: async (state, agents, out) => { state.publicObjectives.push(out.value); TI.log(state, `"${TI.objectiveById(out.value).name}" is now a public objective.`); } });

  // -- elected-player laws (the elected player gains the card)
  const boon = (state, p, c) => (c.value === p.id ? 1.5 : -0.25 - (leaders(state).some((l) => l.id === c.value) ? 0.4 : 0));
  const player = (id, name, text, extra) => add(id, name, 'law', text, Object.assign({ elect: 'player', candidates: cand.players, escore: boon, owned: true }, extra || {}));
  player('committee_formation', 'Committee Formation', 'The elected player gains this card. Before players vote on an agenda that elects a player, its owner may discard it to choose the elected player; players do not vote.', {});
  player('imperial_arbiter', 'Imperial Arbiter', 'The elected player gains this card. At the end of the strategy phase, its owner may discard it to swap 1 of their strategy cards with 1 of another player\'s.', {});
  player('minister_of_commerce', 'Minister of Commerce', 'The elected player gains this card. After the owner replenishes commodities (Trade), they gain 1 trade good for each neighbor.', {});
  player('minister_of_exploration', 'Minister of Exploration', 'The elected player gains this card. When the owner gains control of a planet, they gain 1 trade good.', {});
  player('minister_of_industry', 'Minister of Industry', 'The elected player gains this card. When the owner places a space dock in a system, their units there may use Production.', {});
  player('minister_of_peace', 'Minister of Peace', 'The elected player gains this card. After a player activates a system containing a different player\'s units, the owner may discard it to end that player\'s turn immediately.', {});
  player('minister_of_policy', 'Minister of Policy', 'The elected player gains this card. At the end of the status phase, the owner draws 1 action card.', {});
  player('minister_of_sciences', 'Minister of Sciences', 'The elected player gains this card. The owner does not need to spend resources to research with the Technology strategy card.', {});
  player('minister_of_war', 'Minister of War', 'The elected player gains this card. After performing an action, the owner may discard it to remove 1 of their command tokens from the board and perform 1 additional action.', {});
  player('prophecy_of_ixth', 'Prophecy of Ixth', 'The elected player gains this card. The owner applies +1 to their fighters\' combat rolls. When they use Production they discard it unless they produce 2 or more fighters.', {});
  player('shard_of_the_throne', 'Shard of the Throne', 'The elected player gains this card and 1 VP. A player who wins a combat against the owner gains this card and 1 VP; the previous owner loses 1 VP.', {
    onGain: (state, p) => TI.addVP(state, p, 1, 'Shard of the Throne') });
  player('crown_of_emphidia', 'The Crown of Emphidia', 'The elected player gains this card and 1 VP. A player who gains control of a planet in the owner\'s home system gains this card and 1 VP; the previous owner loses 1 VP.', {
    onGain: (state, p) => TI.addVP(state, p, 1, 'Crown of Emphidia') });
  player('crown_of_thalnos', 'The Crown of Thalnos', 'The elected player gains this card. During each combat round, the owner may reroll any number of dice; each of their units that does not hit with its reroll is destroyed.', {});

  // -- planet laws (attached to the elected planet)
  const planetLaw = (id, name, text, f, spec) => add(id, name, 'law', text, Object.assign({ elect: 'planet', candidates: (state) => cand.planets(state, (e) => f(e, state)), planetLaw: true }, spec));
  const hazardous = (e) => e.pl.trait === 'hazardous', cultural = (e) => e.pl.trait === 'cultural', industrial = (e) => e.pl.trait === 'industrial';
  const mine = (state, p, c) => planetAt(state, c.value).owner === p.id;
  planetLaw('core_mining', 'Core Mining', 'Attach to the elected hazardous planet; destroy 1 infantry on it. Its resource value is increased by 2.', hazardous, {
    escore: (state, p, c) => (mine(state, p, c) ? 1.2 : -0.2),
    apply: (state, pl) => { pl.res += 2; const i = pl.ground.findIndex((u) => u.type === 'infantry'); if (i >= 0) pl.ground.splice(i, 1); }, undo: (state, pl) => { pl.res -= 2; } });
  planetLaw('demilitarized_zone', 'Demilitarized Zone', 'Attach to the elected cultural planet; destroy all units on it. Units cannot land, be produced or be placed on it.', cultural, {
    escore: (state, p, c) => { const pl = planetAt(state, c.value); return pl.owner === p.id ? -(pl.ground.length * 0.4 + (pl.dock ? 1.5 : 0) + 0.5) : pl.owner === null ? 0 : (pl.ground.length * 0.3 + (pl.dock ? 1 : 0)) * 0.5; },
    apply: (state, pl) => { pl.ground = []; pl.pds = 0; pl.dock = false; pl.dmz = true; }, undo: (state, pl) => { pl.dmz = false; } });
  planetLaw('holy_planet_of_ixth', 'Holy Planet of Ixth', 'Attach to the elected cultural planet; its owner gains 1 VP. Units there cannot use Production. Whoever gains control of it gains 1 VP; whoever loses control loses 1 VP.', cultural, {
    escore: (state, p, c) => (mine(state, p, c) ? 2 : planetAt(state, c.value).owner === null ? 0.4 : -0.5),
    apply: (state, pl) => { pl.holy = true; if (pl.owner !== null) TI.addVP(state, state.players[pl.owner], 1, 'Holy Planet of Ixth'); }, undo: (state, pl) => { pl.holy = false; } });
  planetLaw('senate_sanctuary', 'Senate Sanctuary', 'Attach to the elected cultural planet. Its influence value is increased by 2.', cultural, {
    escore: (state, p, c) => (mine(state, p, c) ? 1.2 : 0), apply: (state, pl) => { pl.inf += 2; }, undo: (state, pl) => { pl.inf -= 2; } });
  planetLaw('terraforming_initiative', 'Terraforming Initiative', 'Attach to the elected hazardous planet. Its resource and influence values are increased by 1.', hazardous, {
    escore: (state, p, c) => (mine(state, p, c) ? 1.4 : 0), apply: (state, pl) => { pl.res++; pl.inf++; }, undo: (state, pl) => { pl.res--; pl.inf--; } });
  const team = (id, name, color, f) => planetLaw(id, 'Research Team: ' + name, 'Attach to the elected ' + (f === industrial ? 'industrial' : 'hazardous') + ' planet. When its owner researches, they may exhaust this card to ignore 1 ' + color + ' prerequisite.', f, {
    escore: (state, p, c) => (mine(state, p, c) ? 1 : 0), apply: (state, pl) => { pl.team = { color, ready: true }; }, undo: (state, pl) => { pl.team = null; } });
  team('research_team_biotic', 'Biotic', 'green', industrial);
  team('research_team_cybernetic', 'Cybernetic', 'yellow', industrial);
  team('research_team_propulsion', 'Propulsion', 'blue', industrial);
  team('research_team_warfare', 'Warfare', 'red', hazardous);

  const DEF = {};
  DECK.forEach((d) => { DEF[d.id] = d; });
  TI.AGENDAS = DECK; TI.AGENDA_BY_ID = DEF;
  TI.buildAgendaDeck = (rng) => rng.shuffle(DECK.map((d) => d.id));
  TI.AGENDA_COUNT = DECK.length;

  // ---- law bookkeeping --------------------------------------------------------------------------------
  // How much a law in play hurts player p (positive = bad for p). Used by Repeal Law, Judicial Abolishment and bot voting.
  TI.lawHarm = function (state, p, e) {
    if (!e) return 0;
    const d = DEF[e.id];
    if (d.owned) return e.owner === p.id ? -1.5 : (e.owner === null ? 0 : 0.5 + (leaders(state).some((l) => l.id === e.owner) ? 0.4 : 0));
    if (d.planetLaw) { const pl = planetAt(state, e.planet); return pl.owner === p.id ? -1 : 0.3; }
    return d.bias ? -d.bias(state, p) * 0.6 : 0;      // a rule law the player voted for is one it wants
  };
  TI.discardLaw = function (state, e, quiet, notToPile) {
    const d = DEF[e.id];
    if (e.planet) { const pl = detach(state, e.id, e.planet); if (d.undo) d.undo(state, pl); }
    state.laws.splice(state.laws.indexOf(e), 1); if (!notToPile) state.agendaDiscard.push(e.id);
    TI.syncRules(state); if (!quiet) TI.log(state, `${d.name} leaves play.`);
  };
  function giveCard(state, id, to) {
    const e = entry(state, id), d = DEF[id];
    if (!e) return;
    e.owner = to.id; if (d.onGain) d.onGain(state, to);
    TI.log(state, `${to.name} gains ${d.name}.`);
  }
  TI.discardOwnedLaw = function (state, id) { const e = entry(state, id); if (e) { state.laws.splice(state.laws.indexOf(e), 1); state.agendaDiscard.push(id); TI.syncRules(state); } };

  // ---- hooks used by the rest of the engine --------------------------------------------------------------
  // A planet changed hands (capture, Peace Accords, Colonial Redistribution).
  TI.onPlanetControl = function (state, planet, sysId, newOwner, oldOwner) {
    if (!state.laws || !state.laws.length) return;
    if (planet.holy) { TI.addVP(state, newOwner, 1, 'Holy Planet of Ixth'); if (oldOwner) loseVP(state, oldOwner, 1, 'Holy Planet of Ixth'); }
    if (TI.lawOwner(state, 'minister_of_exploration') === newOwner.id) { newOwner.tg++; TI.log(state, `${newOwner.name}'s Minister of Exploration pays 1 trade good.`); }
    const home = S(state)[sysId].home;
    const crown = entry(state, 'crown_of_emphidia');
    if (crown && home !== null && crown.owner === home && newOwner.id !== crown.owner) {
      const prev = state.players[crown.owner]; loseVP(state, prev, 1, 'Crown of Emphidia'); giveCard(state, 'crown_of_emphidia', newOwner);
    }
  };
  TI.onCombatWon = function (state, winner, loser) {
    if (!winner || !loser || !state.laws || !state.laws.length) return;
    const e = entry(state, 'shard_of_the_throne');
    if (e && e.owner === loser.id) { loseVP(state, loser, 1, 'Shard of the Throne'); giveCard(state, 'shard_of_the_throne', winner); }
  };
  // Neighbors (Minister of Commerce): players with a planet or ship in or next to a system where p has a planet or ship.
  TI.neighbors = function (state, p) {
    const mineSys = state.map.order.filter((id) => S(state)[id].planets.some((x) => x.owner === p.id) || (S(state)[id].ships[p.id] || []).length);
    const zone = new Set(); mineSys.forEach((id) => { zone.add(id); S(state)[id].adj.forEach((n) => zone.add(n)); });
    return state.players.filter((o) => o.id !== p.id && [...zone].some((id) => S(state)[id].planets.some((x) => x.owner === o.id) || (S(state)[id].ships[o.id] || []).length));
  };
  // Optional use of a card a player owns (Minister of Peace/War, Imperial Arbiter, Committee Formation). Returns true if used.
  TI.useLawCard = async function (state, agents, p, id, ctx) {
    if (TI.lawOwner(state, id) !== p.id) return false;
    const agent = agents[p.id];
    const yes = agent && agent.chooseUseLaw ? await agent.chooseUseLaw(state, p, id, ctx) : TI.botUseLaw(state, p, id, ctx);
    if (!yes) return false;
    TI.discardOwnedLaw(state, id); TI.log(state, `${p.name} discards ${DEF[id].name}.`);
    return true;
  };
  TI.botUseLaw = function (state, p, id, ctx) {
    if (id === 'minister_of_peace') return ctx.mover.id !== p.id && (ctx.mover.vp >= p.vp || (S(state)[ctx.sysId].planets.some((x) => x.owner === p.id)));
    if (id === 'minister_of_war') return p.tokens.tactic >= 1 && state.map.order.some((sid) => TI.tokensOn(S(state)[sid]).includes(p.id)) && TI.botChooseTarget && !!TI.botChooseTarget(state, p, TI.BOT_STYLES.expander);
    if (id === 'imperial_arbiter') return !!ctx.swap;
    if (id === 'committee_formation') { const d = ctx.ctx.def; return Math.max(...ctx.ctx.outcomes.map((o) => d.escore(state, p, o))) >= 1.2; }
    return false;
  };

  // Delayed effects ("at the start of the next strategy phase").
  TI.runPending = function (state) {
    const list = state.pending || []; state.pending = [];
    for (const q of list) {
      if (q.kind === 'exhaustSpecialty') for (const p of state.players) planetsOf(state, p).filter((x) => x.tech).forEach((x) => { x.exhausted = true; });
      if (q.kind === 'exhaustHome') for (const p of state.players) planetsOf(state, p).filter((x) => S(state)[x.systemId].home === p.id).forEach((x) => { x.exhausted = true; });
      if (q.kind === 'exhaustCultural') for (const id of q.players) planetsOf(state, state.players[id]).filter((x) => x.trait === 'cultural').forEach((x) => { x.exhausted = true; });
      if (q.kind === 'exhaustPerTech') for (const p of state.players) planetsOf(state, p).filter((x) => !x.exhausted).sort((a, b) => (b.res + b.inf) - (a.res + a.inf)).slice(0, p.techs.length).forEach((x) => { x.exhausted = true; });
      TI.log(state, `A law takes effect: ${q.kind === 'exhaustSpecialty' ? 'planets with technology specialties' : q.kind === 'exhaustHome' ? 'home system planets' : q.kind === 'exhaustCultural' ? 'cultural planets' : 'planets (one per technology)'} are exhausted.`);
    }
  };

  // Crown of Thalnos: the owner may reroll any dice after a combat roll; units that miss again are destroyed.
  TI.crownWindow = async function (state, agents, ctx) {
    const owner = TI.lawOwner(state, 'crown_of_thalnos');
    if (owner === null) return;
    for (const side of ['attacker', 'defender']) {
      const info = ctx.sides[side];
      if (!info || info.player.id !== owner) continue;
      const roll = ctx.roll[side], p = info.player, misses = roll.dice.filter((d) => !d.hit);
      if (!misses.length) continue;
      const agent = agents[p.id];
      let chosen = agent && agent.chooseCrownDice ? await agent.chooseCrownDice(state, p, { roll: roll, misses, force: info.force, side }) : misses.filter((d) => (COST[d.unit.type] || 1) <= 1);
      if (!chosen || !chosen.length) continue;
      const lost = new Set(); let gained = 0;
      for (const d of chosen) { const n = state.rng.d10(); d.reroll = n; if (n >= d.need) { d.hit = true; gained++; } else lost.add(d.unit); }
      for (const u of [...lost]) { const i = info.force.indexOf(u); if (i >= 0) info.force.splice(i, 1); }
      roll.hits += gained;
      TI.log(state, `${p.name} rerolls ${chosen.length} die/dice with the Crown of Thalnos: ${gained} new hit(s), ${lost.size} unit(s) destroyed.`);
      if (TI.trimCargo && ctx.sysId && !ctx.ground) TI.trimCargo(state, p, S(state)[ctx.sysId]);
    }
  };

  // ---- voting ---------------------------------------------------------------------------------------------
  const outcomesOf = (state, d) => {
    if (!d.elect) return [{ key: 'for', label: 'For', value: 'for' }, { key: 'against', label: 'Against', value: 'against' }];
    return d.candidates(state);
  };
  const influenceAvail = (state, p) => (TI.rules.repGov ? 1 : TI.available(state, p).inf);
  // How a bot would vote right now: { key, n } (key null = abstain). Also used to predict outcomes for Riders.
  TI.botVotePlan = function (state, p, ctx) {
    if (ctx.banned.has(p.id) || state.noVote.includes(p.id)) return { key: null, n: 0 };
    const d = ctx.def, avail = influenceAvail(state, p);
    if (avail <= 0) return { key: null, n: 0 };
    let best = null, bs = -99;
    for (const o of ctx.outcomes) {
      const s = d.elect ? (d.escore ? d.escore(state, p, o) : 0) : (d.bias ? (o.key === 'for' ? d.bias(state, p) : -d.bias(state, p)) : 0);
      if (s > bs) { bs = s; best = o; }
    }
    if (!best || bs < 0.15) return { key: null, n: 0 };
    if (TI.rules.repGov) return { key: best.key, n: 1 };
    const frac = Math.min(1, 0.4 + bs * 0.3);
    return { key: best.key, n: Math.max(1, Math.round(avail * frac)) };
  };
  const tallyOf = (ctx) => { const t = {}; for (const v of Object.values(ctx.votes)) if (v.key) t[v.key] = (t[v.key] || 0) + v.n; return t; };
  // Who is likely to win this vote if everybody (except `skip`) follows their bot plan. { key, margin } or null.
  TI.predictOutcome = function (state, ctx, skipId) {
    const t = {};
    for (const q of state.players) { if (q.id === skipId) continue; const v = ctx.votes[q.id] || TI.botVotePlan(state, q, ctx); if (v.key) t[v.key] = (t[v.key] || 0) + v.n; }
    const ranked = Object.entries(t).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return null;
    return { key: ranked[0][0], margin: ranked[0][1] - (ranked[1] ? ranked[1][1] : 0), t };
  };
  TI.agendaOutcomeScore = (state, p, ctx, key) => { const o = ctx.outcomes.find((x) => x.key === key); if (!o) return 0; const d = ctx.def; return d.elect ? (d.escore ? d.escore(state, p, o) : 0) : (d.bias ? (key === 'for' ? d.bias(state, p) : -d.bias(state, p)) : 0); };

  function spendInfluence(state, p, n) {
    if (TI.rules.repGov) return n;
    const ps = planetsOf(state, p).filter((x) => !x.exhausted && x.inf > 0).sort((a, b) => a.inf - b.inf);
    let sum = 0; const used = [];
    // fewest wasted points: smallest planets until the total covers n, then drop any that is not needed
    for (const x of ps) { if (sum >= n) break; used.push(x); sum += x.inf; }
    for (const x of used.slice()) if (sum - x.inf >= n) { used.splice(used.indexOf(x), 1); sum -= x.inf; }
    used.forEach((x) => { x.exhausted = true; });
    return Math.min(n, sum);
  }

  // Run one revealed agenda to the end. Returns { replaced } if it was vetoed or could not be resolved.
  TI.resolveAgenda = async function (state, agents, d, opts) {
    opts = opts || {};
    const order = seat(state, (state.speaker + 1) % state.players.length);       // left of the speaker first, speaker last
    const ctx = { def: d, outcomes: [], banned: new Set(), predictions: [], votes: {}, agenda: d, speaker: state.players[state.speaker], resolved: false };
    TI.log(state, `Agenda: ${d.name} (${d.type}) — ${d.text}`);
    ctx.outcomes = outcomesOf(state, d);
    if (!ctx.outcomes.length) { TI.log(state, 'There is nothing to elect, so the agenda is discarded.'); state.agendaDiscard.push(d.id); return { replaced: true }; }
    if (!opts.noReplace) {
      const vc = { vetoed: false, agenda: d };
      await TI.cardWindow(state, agents, 'agendaVeto', vc, order);
      if (!vc.vetoed) await TI.quashWindow(state, agents, vc);
      if (vc.vetoed) { TI.log(state, `${d.name} is discarded.`); state.agendaDiscard.push(d.id); return { replaced: true }; }
    }
    await TI.cardWindow(state, agents, 'agendaRevealed', ctx, order);
    if (TI.nekroPredict) await TI.nekroPredict(state, agents, ctx);   // Nekro: Galactic Threat
    for (const id of state.noVote) ctx.banned.add(id);

    let result = null;
    // Committee Formation: skip the vote and choose the elected player.
    if (d.elect === 'player' && !opts.revote) {
      const owner = TI.lawOwner(state, 'committee_formation');
      if (owner !== null && owner !== undefined) {
        const cc = { swap: true, ctx };
        if (await TI.useLawCard(state, agents, state.players[owner], 'committee_formation', cc)) {
          const o = state.players[owner], ag = agents[o.id];
          let pick = await ask(ag, 'chooseElected', (s, me, c) => c.slice().sort((a, b) => d.escore(s, me, b) - d.escore(s, me, a))[0], state, o, ctx.outcomes, ctx);
          if (!ctx.outcomes.includes(pick)) pick = ctx.outcomes.find((x) => x.key === (pick && pick.key)) || ctx.outcomes[0];
          result = pick; TI.log(state, `${o.name} chooses ${pick.label} to be elected; there is no vote.`);
        }
      }
    }
    if (!result) {
      TI.log(state, `Voting on ${d.name}: ${ctx.outcomes.map((o) => o.label).join(' / ')}.`);
      for (const p of order) {
        if (ctx.banned.has(p.id) || TI.faction(p).ability.noVote) { TI.log(state, `${p.name} cannot vote on this agenda.`); continue; }
        const avail = influenceAvail(state, p);
        let v = { key: null, n: 0 };
        if (avail > 0) {
          const ag = agents[p.id];
          const pick = await ask(ag, 'chooseVote', (s, me, c) => TI.botVotePlan(s, me, c), state, p, Object.assign(ctx, { avail, tally: tallyOf(ctx) }));
          if (pick && pick.key && ctx.outcomes.some((o) => o.key === pick.key)) v = { key: pick.key, n: Math.max(0, Math.min(avail, pick.n | 0)) };
        }
        if (v.key && v.n > 0) {
          v.n = spendInfluence(state, p, v.n);
          ctx.votes[p.id] = v;
          TI.log(state, `${p.name} casts ${v.n} vote${v.n === 1 ? '' : 's'} for ${ctx.outcomes.find((o) => o.key === v.key).label}.`);
          await TI.cardWindow(state, agents, 'afterVote', { voter: p, key: v.key, vote: v, ctx }, [p]);
        } else { ctx.votes[p.id] = { key: null, n: 0 }; TI.log(state, `${p.name} abstains.`); }
      }
      // Bribery and friends: after the speaker has voted, everybody who voted may add votes.
      await TI.cardWindow(state, agents, 'afterSpeakerVote', { ctx }, order.filter((p) => ctx.votes[p.id] && ctx.votes[p.id].key));
      const t = tallyOf(ctx);
      const ranked = ctx.outcomes.map((o) => ({ o, n: t[o.key] || 0 })).sort((a, b) => b.n - a.n);
      TI.log(state, 'Result of the vote: ' + (ranked.filter((r) => r.n > 0).map((r) => `${r.o.label} ${r.n}`).join(', ') || 'no votes'));
      const topN = ranked[0].n, tied = ranked.filter((r) => r.n === topN).map((r) => r.o);
      if (tied.length === 1) result = tied[0];
      else {
        const sp = state.players[state.speaker];
        TI.log(state, topN === 0 ? `Nobody voted, so ${sp.name} (speaker) picks the outcome.` : `Tie: ${sp.name} (speaker) breaks it.`);
        const pick = await ask(agents[sp.id], 'chooseElected', (s2, me, c) => c.slice().sort((a, b) => TI.agendaOutcomeScore(s2, me, ctx, b.key) - TI.agendaOutcomeScore(s2, me, ctx, a.key))[0], state, sp, tied, ctx);
        result = tied.find((o) => o.key === (pick && pick.key)) || tied[0];
      }
    }
    TI.log(state, `Outcome: ${result.label}.`);
    // Confusing Legal Text: an elected player may pass the election to someone else.
    if (d.elect === 'player') {
      const ec = { elected: state.players[result.value], result, newTarget: null, outcomes: ctx.outcomes, def: d };
      await TI.cardWindow(state, agents, 'elected', ec, [ec.elected]);
      if (ec.newTarget !== null && ec.newTarget !== undefined && state.players[ec.newTarget]) { result = ctx.outcomes.find((o) => o.value === ec.newTarget) || result; TI.log(state, `${state.players[ec.newTarget].name} is elected instead.`); }
    }
    await applyOutcome(state, agents, d, result, ctx);
    // Riders: predictions that came true pay out.
    for (const pr of ctx.predictions) {
      const p = state.players[pr.pid];
      if (pr.key === result.key) { TI.log(state, `${p.name}'s ${pr.name} prediction is correct.`); if (pr.threat) TI.threatReward(state, p, ctx, pr.key); else await TI.riderReward(state, agents, p, pr.rider); }
      else TI.log(state, `${p.name}'s ${pr.name} prediction was wrong.`);
    }
    return { replaced: false, result };
  };

  async function applyOutcome(state, agents, d, result, ctx) {
    const out = { key: result.key, value: result.value, label: result.label };
    if (d.resolve) await d.resolve(state, agents, out, ctx);
    if (d.type === 'directive' || d.oneShot) { state.agendaDiscard.push(d.id); return; }
    if (d.elect === 'player') { state.laws.push({ id: d.id, outcome: null, owner: null, planet: null }); giveCard(state, d.id, state.players[result.value]); TI.syncRules(state); return; }
    if (d.planetLaw) {
      const e = { id: d.id, outcome: null, owner: null, planet: result.value }; state.laws.push(e);
      const pl = attach(state, d.id, result.value); if (d.apply) d.apply(state, pl);
      TI.log(state, `${d.name} is attached to ${pl.name}.`); TI.syncRules(state); return;
    }
    if (d.keepsFor && result.key === 'for' && !out.fizzled) { state.laws.push({ id: d.id, outcome: 'for', owner: null, planet: null }); TI.syncRules(state); TI.log(state, `${d.name} stays in play.`); if (d.id === 'fleet_regulations') for (const p of state.players) if (p.tokens.fleet > 4) { p.tokens.tactic += p.tokens.fleet - 4; p.tokens.fleet = 4; } return; }
    state.agendaDiscard.push(d.id);
  }

  // ---- the phase ----------------------------------------------------------------------------------------------
  const nextAgenda = (state) => {
    if (!state.agendaDeck.length) { state.agendaDeck = state.rng.shuffle(state.agendaDiscard.splice(0)); }
    return state.agendaDeck.pop();
  };
  TI.agendaPhase = async function (state, agents) {
    if (state.custodians === undefined || state.custodians === null) return;
    state.phase = 'agenda'; state.noVote = [];
    TI.log(state, `— Agenda phase, round ${state.round} —`);
    await TI.cardWindow(state, agents, 'agendaPhaseStart', {}, seat(state, state.speaker));
    for (let n = 0; n < 2 && state.winner === null; n++) {
      for (let tries = 0; tries < 6; tries++) {
        const id = nextAgenda(state); if (!id) break;
        const r = await TI.resolveAgenda(state, agents, DEF[id], {});
        if (!r.replaced) break;
      }
      for (const p of state.players) for (const pl of planetsOf(state, p)) pl.exhausted = false;       // ready planets after each agenda
      TI.log(state, 'Planets are readied.');
    }
  };

  // Xxcha's Quash and other faction hooks that discard the revealed agenda.
  TI.quashWindow = async function (state, agents, vc) {
    for (const p of state.players) {
      if (!TI.faction(p).ability.quash || p.tokens.strategy < 1 || (p.exhausted && p.exhausted.quash)) continue;
      const agent = agents[p.id];
      const yes = agent && agent.chooseQuash ? await agent.chooseQuash(state, p, vc.agenda) : false;
      if (yes) { p.tokens.strategy--; p.exhausted = p.exhausted || {}; p.exhausted.quash = true; vc.vetoed = true; TI.log(state, `${p.name} spends a strategy token to Quash the agenda.`); return; }
    }
  };

  // Rider rewards.
  TI.riderReward = async function (state, agents, p, rider) {
    if (rider === 'trade') { p.tg += 5; TI.log(state, `${p.name} gains 5 trade goods.`); }
    else if (rider === 'imperial') TI.addVP(state, p, 1, 'Imperial Rider');
    else if (rider === 'leadership') await TI.giveTokens(state, agents, p, 3);
    else if (rider === 'politics') { await TI.drawActionCards(state, agents, p, 3, 'Politics Rider'); state.speaker = p.id; TI.log(state, `${p.name} becomes speaker.`); }
    else if (rider === 'technology') await TI.research(state, agents, p, 0, 'Technology Rider');
    else if (rider === 'construction') {
      const pl = planetsOf(state, p).filter((x) => !x.dock && !x.dmz && !x.holy).sort((a, b) => (b.res + b.inf) - (a.res + a.inf))[0];
      if (pl && TI.unitsLeft(state, p, 'dock') > 0) { pl.dock = true; TI.log(state, `${p.name} places a space dock on ${pl.name}.`); }
    } else if (rider === 'warfare') {
      const id = TI.shipSystems(state, p).sort((a, b) => (S(state)[b].ships[p.id] || []).length - (S(state)[a].ships[p.id] || []).length)[0];
      if (id && TI.unitsLeft(state, p, 'dreadnought') > 0 && (S(state)[id].ships[p.id] || []).filter((u) => u.type !== 'fighter').length < TI.fleetLimit(p)) { S(state)[id].ships[p.id].push(TI.makeUnit('dreadnought')); TI.log(state, `${p.name} places a dreadnought in ${id}.`); }
    } else if (rider === 'diplomacy') {
      const sysId = state.map.order.filter((id) => S(state)[id].planets.some((x) => x.owner === p.id) && id !== mecatolId(state))[0];
      if (sysId) { for (const o of state.players) if (o.id !== p.id && !TI.tokensOn(S(state)[sysId]).includes(o.id)) TI.tokensOn(S(state)[sysId]).push(o.id); TI.log(state, `${p.name}'s Diplomacy Rider: rivals place command tokens in ${sysId}.`); }
    }
  };

  // Imperial Arbiter: end of the strategy phase. The owner may discard it to swap a strategy card with another player's.
  TI.afterStrategyPicks = async function (state, agents) {
    const owner = TI.lawOwner(state, 'imperial_arbiter');
    if (owner === null) return;
    const p = state.players[owner];
    if (!p.cards.length) return;
    const pref = { 1: 6, 2: 3, 3: 3, 4: 5, 5: 5, 6: 5, 7: 6, 8: 7 };
    let best = null, gain = 0;
    for (const o of state.players) if (o.id !== p.id) for (const mine of p.cards) for (const theirs of o.cards) {
      const g = pref[theirs] - pref[mine];
      if (g > gain) { gain = g; best = { mine, theirs, other: o }; }
    }
    if (!(await TI.useLawCard(state, agents, p, 'imperial_arbiter', { swap: gain >= 2 ? best : null }))) return;
    const agent = agents[p.id];
    if (agent && agent.chooseArbiterSwap) { best = await agent.chooseArbiterSwap(state, p); if (!best || !best.other) { TI.log(state, `${p.name} makes no swap.`); return; } }
    if (!best) return;
    p.cards[p.cards.indexOf(best.mine)] = best.theirs; best.other.cards[best.other.cards.indexOf(best.theirs)] = best.mine;
    state.cards.find((c) => c.id === best.theirs).owner = p.id; state.cards.find((c) => c.id === best.mine).owner = best.other.id;
    TI.log(state, `${p.name} swaps ${TI.STRATEGY_CARDS[best.mine - 1].name} for ${best.other.name}'s ${TI.STRATEGY_CARDS[best.theirs - 1].name}.`);
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
