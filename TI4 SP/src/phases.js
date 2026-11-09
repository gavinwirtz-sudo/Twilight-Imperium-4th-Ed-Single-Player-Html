// Phase flow. Every decision goes through an "agent" (bot or human UI) via async calls, so a
// human can take as long as they like while bots answer instantly.
//
// Agent interface (all may be sync or async):
//   chooseCard(state, player, availableCardIds) -> cardId
//   chooseAction(state, player) -> { type: 'tactical' } | { type: 'strategic', card } | { type: 'ability', id } | { type: 'pass' }
//   chooseTarget(state, player) -> systemId | null
//   planMove(state, player, targetId) -> { ships: [], ground: [] }
//   chooseInvasion(state, player, systemId) -> [{ planetIdx, units: [] }]
//   chooseProduction(state, player, systemId) -> [{ unit }]
//   wantSecondary(state, player, cardId) -> boolean
//   distributeTokens(state, player, n) -> { tactic, fleet, strategy }
//   chooseScore(state, player, eligible) -> objectiveId | null      (called per kind)
//   plus card-specific hooks used in cards.js
(function (root) {
  const TI = (root.TI = root.TI || {});

  const cardsPerPlayer = (state) => (state.players.length <= 4 ? 2 : 1);
  const cardOf = (state, id) => state.cards.find((c) => c.id === id);
  const seatOrder = (state, startId) => state.players.map((_, i) => state.players[(startId + i) % state.players.length]);

  TI.addVP = function (state, player, n, why) {
    player.vp += n;
    TI.log(state, `${player.name} gains ${n} VP (${why}) → ${player.vp}.`);
    if (player.vp >= state.vpToWin && state.winner === null) state.winner = player.id;
  };

  // Initiative = lowest-numbered strategy card held.
  TI.initiative = (player) => (TI.faction(player).ability.telepathic ? 0 : player.cards.length ? Math.min(...player.cards) : 99);

  // ---- Strategy phase -------------------------------------------------------------------------
  TI.strategyPhase = async function (state, agents) {
    state.phase = 'strategy';
    for (const p of state.players) { if (!p.keepCards) p.cards = []; p.passed = false; }
    for (const c of state.cards) c.used = false;
    if (TI.runPending) TI.runPending(state);                // delayed agenda effects
    if (TI.cardWindow) await TI.cardWindow(state, agents, 'strategyStart', {}, seatOrder(state, state.speaker));   // Summit
    for (let pass = 0; pass < cardsPerPlayer(state); pass++) {
      for (const p of seatOrder(state, state.speaker)) {
        if (p.keepCards) continue;                       // Political Stability: keeps last round's cards
        const avail = state.cards.filter((c) => c.owner === null).map((c) => c.id);
        let pick = await agents[p.id].chooseCard(state, p, avail);
        if (!avail.includes(pick)) pick = avail[0];
        if (TI.cardWindow && avail.length > 1) {         // Public Disgrace: pick again, if able
          const pc = { picker: p, cardId: pick, avail, forbid: false };
          await TI.cardWindow(state, agents, 'strategyPick', pc, state.players.filter((o) => o.id !== p.id));
          if (pc.forbid) {
            const rest = avail.filter((id) => id !== pick);
            let again = await agents[p.id].chooseCard(state, p, rest);
            if (!rest.includes(again)) again = rest[0];
            TI.log(state, `${p.name} must choose a different strategy card.`);
            pick = again;
          }
        }
        const card = cardOf(state, pick);
        card.owner = p.id;
        p.cards.push(pick);
        const bonus = card.tgBonus + (TI.faction(p).ability.cardBonusTG || 0);
        if (bonus) p.tg += bonus;
        TI.log(state, `${p.name} takes ${TI.STRATEGY_CARDS[pick - 1].name}${bonus ? ` (+${bonus} trade goods)` : ''}.`);
        card.tgBonus = 0;
      }
    }
    for (const p of state.players) p.keepCards = false;
    for (const c of state.cards) if (c.owner === null) c.tgBonus++;
    if (TI.afterStrategyPicks) await TI.afterStrategyPicks(state, agents);        // Imperial Arbiter
    await TI.afterStrategyPhase(state, agents);
  };

  // ---- Action phase ---------------------------------------------------------------------------
  const MAX_TURNS = 400; // safety valve against a stuck agent

  // ---- Undo (human turns only) --------------------------------------------------------------------
  // At the start of each of the human's turns the whole game is snapshotted (outside the state, so it never gets saved).
  // Asking for an undo while a decision is open throws an UndoSignal out of whatever the turn was doing; the action phase
  // then restores the snapshot in place and the turn starts over. From the action menu itself, undo goes back one more turn.
  const U = (TI.undo = { stack: [], active: false, atMenu: false, max: 6 });
  TI.restoreState = function (state, text) {
    const fresh = TI.deserializeState(text);
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, fresh);
  };
  // Returns the snapshot to go back to (and trims the stack), or null when there is nothing to go back to.
  U.request = function () {
    if (!U.active) return null;
    if (U.atMenu) { if (U.stack.length < 2) return null; U.stack.pop(); return U.stack.pop(); }
    return U.stack.pop() || null;
  };
  U.canUndo = () => U.active && (U.atMenu ? U.stack.length >= 2 : U.stack.length >= 1);
  U.signal = (text) => ({ undo: true, snapshot: text });

  TI.actionPhase = async function (state, agents, opts) {
    if (!(opts && opts.resume)) { state.phase = 'action'; state.turnNo = 0; state.acted = []; }
    state.acted = state.acted || [];
    let turns = 0;
    U.stack = []; U.active = false; U.atMenu = false;
    outer: while (state.winner === null && state.players.some((p) => !p.passed)) {
      const order = state.players.filter((p) => !p.passed).sort((a, b) => TI.initiative(a) - TI.initiative(b));
      for (const p of order) {
        if (state.winner !== null || p.passed || state.acted.includes(p.id)) continue;
        if (++turns > MAX_TURNS) { state.players.forEach((q) => { q.passed = true; }); return; }
        TI.checkpoint(state, 'action');                       // autosave hook: a clean point to resume from
        if (!p.bot) { U.stack.push(TI.serializeState(state)); if (U.stack.length > U.max) U.stack.shift(); U.active = true; U.atMenu = false; }
        try {
        await TI.takeTurn(state, agents, p);
        U.active = false;
        // Fleet Logistics: a second action in the same turn (unless the first was a pass).
        if (!p.passed && state.winner === null && TI.hasTechEffect(p, 'twoActions')) await TI.takeTurn(state, agents, p);
        // Minister of War: discard it after an action to pull a command token off the board and act again.
        if (!p.passed && state.winner === null && TI.lawOwner(state, 'minister_of_war') === p.id && state.map.order.some((id) => TI.tokensOn(state.map.systems[id]).includes(p.id)) && await TI.useLawCard(state, agents, p, 'minister_of_war', {})) {
          const sysId = state.map.order.find((id) => TI.tokensOn(state.map.systems[id]).includes(p.id));
          const tk = TI.tokensOn(state.map.systems[sysId]); tk.splice(tk.indexOf(p.id), 1);
          TI.log(state, `${p.name} removes their command token from ${sysId} and acts again.`);
          await TI.takeTurn(state, agents, p);
        }
        } catch (e) {
          U.active = false; U.atMenu = false;
          if (e && e.undo) { TI.restoreState(state, e.snapshot); state.rng.setState(((Math.random() * 4294967296) ^ Date.now()) >>> 0); if (TI.onRestore) TI.onRestore(state); TI.log(state, 'Undo: back to an earlier point in the round.'); continue outer; }
          throw e;
        }
        state.acted.push(p.id);
      }
      state.acted = [];
    }
  };

  // Autosave hook (set by the UI). `stage` records where a saved game picks up again.
  TI.checkpoint = function (state, stage) { state.stage = stage; if (TI.onCheckpoint) TI.onCheckpoint(state); };

  // Save / load. The only non-JSON piece of state is the seeded RNG, stored as its current number.
  TI.serializeState = function (state) {
    return JSON.stringify(state, (k, v) => (k === 'rng' && v && v.getState ? { __rng: v.getState() } : v));
  };
  TI.deserializeState = function (text) {
    const state = JSON.parse(text, (k, v) => { if (v && typeof v === 'object' && '__rng' in v) { const r = TI.makeRng(1); r.setState(v.__rng); return r; } return v; });
    if (TI.syncRules) TI.syncRules(state);
    return state;
  };

  const unusedCards = (state, p) => p.cards.filter((id) => !cardOf(state, id).used);
  TI.canPass = (state, p) => unusedCards(state, p).length === 0;

  TI.takeTurn = async function (state, agents, p) {
    const agent = agents[p.id];
    state.turnNo = (state.turnNo || 0) + 1;
    TI.placeRevived(state, p);
    if (TI.negotiate) await TI.negotiate(state, agents, p);
    let act = await agent.chooseAction(state, p);
    const mustAct = !TI.canPass(state, p);
    if (act && act.type === 'card' && !(TI.playableActionCards && TI.playableActionCards(state, p).some((x) => x.card.id === act.id))) act = null;
    if (!act || !['tactical', 'strategic', 'ability', 'pass', 'card'].includes(act.type)) act = { type: mustAct ? 'strategic' : 'pass' };
    if (act.type === 'ability' && !TI.factionActions(state, p).some((a) => a.id === act.id && a.ok)) act = { type: mustAct ? 'strategic' : 'pass' };
    if (act.type === 'pass' && mustAct) act = { type: 'strategic', card: unusedCards(state, p)[0] };
    if (act.type === 'strategic' && !unusedCards(state, p).includes(act.card)) {
      const cards = unusedCards(state, p);
      act = cards.length ? { type: 'strategic', card: cards[0] } : { type: 'pass' };
    }
    if (act.type === 'tactical' && p.tokens.tactic <= 0) act = mustAct ? { type: 'strategic', card: unusedCards(state, p)[0] } : { type: 'pass' };

    if (act.type === 'pass') { p.passed = true; TI.log(state, `${p.name} passes.`); return; }
    if (act.type === 'card') { await TI.componentActionCard(state, agents, p, act.id, act.value); return; }
    if (act.type === 'ability') { await TI.runFactionAction(state, agents, p, act.id); return; }
    if (act.type === 'strategic') { await TI.useStrategyCard(state, agents, p, act.card); return; }
    const done = await TI.tacticalAction(state, agents, p);
    if (!done) { // agent had nothing legal to activate: do not loop forever on it
      if (TI.canPass(state, p)) { p.passed = true; TI.log(state, `${p.name} passes.`); }
      else await TI.useStrategyCard(state, agents, p, unusedCards(state, p)[0]);
    }
  };

  TI.tacticalAction = async function (state, agents, p) {
    const agent = agents[p.id];
    const target = await agent.chooseTarget(state, p);
    if (target === null || target === undefined || !state.map.systems[target] || !TI.canActivate(state, p, target)) return false;
    TI.activate(state, p, target);
    state.lastMove = { player: p.id, target, from: [], round: state.round, turn: state.turnNo };
    TI.log(state, `${p.name} activates ${target}${state.map.systems[target].planets.length ? ' (' + state.map.systems[target].planets.map((pl) => pl.name).join(', ') + ')' : ''}.`);
    {   // Minister of Peace: after you activate a system holding another player's units, its owner may end your turn.
      const sysA = state.map.systems[target], foes = state.players.filter((o) => o.id !== p.id && ((sysA.ships[o.id] || []).length || sysA.planets.some((x) => x.owner === o.id && (x.ground.length || x.pds || x.dock))));
      const mp = TI.lawOwner(state, 'minister_of_peace');
      if (foes.length && mp !== null && mp !== p.id && await TI.useLawCard(state, agents, state.players[mp], 'minister_of_peace', { mover: p, sysId: target })) {
        TI.log(state, `${p.name}'s turn ends immediately.`); return true;
      }
    }
    if (await TI.onActivated(state, agents, p, target)) return true; // Nullification Field ends the turn
    if (TI.flagshipProduction) await TI.flagshipProduction(state, agents, p, target);   // Arborec: Duha Menaimon
    // "After you activate a system" action cards (Flank Speed, In The Silence Of Space, Lost Star Chart, Upgrade).
    state.tactical = { player: p.id, flank: 0, silence: null, lostStar: false };
    if (TI.cardWindow) await TI.cardWindow(state, agents, 'afterActivate', { player: p, sysId: target }, [p]);

    try {
      TI.tryConduit(state, p, target);
      const plan = await agent.planMove(state, p, target);
      if (plan && (plan.ships.length || plan.ground.length)) {
        const r = TI.executeMove(state, p, target, plan);
        if (!r.ok) TI.log(state, `${p.name}'s move failed (${r.reason}).`);
        else {
          const from = [...new Set(plan.ships.concat(plan.ground).map((m) => m.from))];
          const count = (list) => { const c = {}; list.forEach((m) => { c[m.unit.type] = (c[m.unit.type] || 0) + 1; }); return Object.entries(c).map(([t, n]) => `${n} ${TI.ui && TI.ui.unitName ? TI.ui.unitName(p, t) : t}`).join(', '); };
          TI.log(state, `${p.name} moves ${[count(plan.ships), plan.ground.length ? count(plan.ground) + ' (ground)' : ''].filter(Boolean).join(' + ')} from ${from.join(', ')} into ${target}.`);
          state.lastMove = { player: p.id, target, from, round: state.round, turn: state.turnNo };
          if (TI.cardWindow) await TI.cardWindow(state, agents, 'afterMove', { mover: p, sysId: target }, state.players.filter((o) => o.id !== p.id));
          if (TI.afterMovement && plan.ships.length) await TI.afterMovement(state, agents, p, target);
        }
      }
    } finally { state.conduit = null; state.tactical = null; }
    const sys = state.map.systems[target];
    const space = await TI.resolveSpaceAsync(state, agents, p, target);
    if (space && space.fought && TI.afterSpaceAsync) await TI.afterSpaceAsync(state, agents, p, target, space);   // Mentak: Salvage Operations
    TI.trimAllCargo(state, sys);
    await TI.flushEvents(state, agents);            // action-phase secret objectives earned in the space battle
    const alive = (sys.ships[p.id] || []).length > 0;
    if (alive && TI.cargoOf(sys, p.id).length) {
      let invasions = (await agent.chooseInvasion(state, p, target)) || [];
      invasions = TI.custodiansGate(state, p, target, invasions);
      for (const inv of invasions) {
        const res = await TI.invadeAsync(state, agents, p, target, inv.planetIdx, inv.units);
        await TI.flushEvents(state, agents);          // ... and in each ground battle
        if (res.captured) await TI.integratedEconomy(state, agents, p, target, sys.planets[inv.planetIdx]);
      }
    }
    if (sys.planets.some((pl) => pl.owner === p.id && pl.dock)) {
      const order = (await agent.chooseProduction(state, p, target)) || [];
      const built = TI.produce(state, p, target, order);
      if (built.length) TI.log(state, `${p.name} produces ${built.map((u) => u.type).join(', ')} at ${target}.`);
    }
    return true;
  };

  // Mecatol Rex: nobody may land there until the custodians token is removed, which costs 6 influence and at least
  // one committed ground force (rules 26.1-26.3). Removing it scores 1 VP and, from then on, adds the agenda phase.
  TI.custodiansGate = function (state, p, sysId, invasions) {
    if (state.custodians !== undefined && state.custodians !== null) return invasions;
    const sys = state.map.systems[sysId];
    const idx = sys.planets.findIndex((pl) => pl.mecatol);
    if (idx < 0) return invasions;
    const landing = invasions.filter((inv) => inv.planetIdx === idx && inv.units.length);
    const rest = invasions.filter((inv) => inv.planetIdx !== idx);
    if (!landing.length) return rest;
    const free = !!TI.faction(p).ability.bloodTies;
    if (!free && (!TI.canSpend(state, p, 'inf', 6) || !TI.paySpend(state, p, 'inf', 6))) {
      TI.log(state, `${p.name} cannot spend 6 influence, so the custodians token stays and no ground forces land on Mecatol Rex.`);
      return rest;
    }
    state.custodians = p.id;
    TI.log(state, free ? `${p.name} removes the custodians token from Mecatol Rex without paying (Blood Ties).` : `${p.name} spends 6 influence to remove the custodians token from Mecatol Rex.`);
    TI.addVP(state, p, 1, 'removes the custodians token');
    return rest.concat(landing);
  };

  // ---- Objectives ------------------------------------------------------------------------------
  const SPEND_LABEL = { res: 'resources', inf: 'influence', tg: 'trade goods', tokens: 'command tokens', cards: 'action cards' };
  TI.spendText = (o) => (o.spend ? `${o.spend.n} ${SPEND_LABEL[o.spend.kind]}` : '');

  // Rule 52.16: no public objectives unless the player controls every planet in their own home system.
  TI.homeIntact = function (state, p) {
    if (TI.faction(p).ability.nomadic) return true;   // Clan of Saar: Nomadic
    const home = state.map.systems[state.map.order.find((id) => state.map.systems[id].home === p.id)];
    return home.planets.every((pl) => pl.owner === p.id);
  };

  // Objectives the player could score right now (requirement met and cost payable). Action-timing secrets are
  // scored when their event happens, so they never show up here.
  TI.eligibleObjectives = function (state, p) {
    const ok = (id) => { const o = TI.objectiveById(id); return !p.scored.includes(id) && o.timing === 'status' && o.check(state, p); };
    const pub = TI.homeIntact(state, p) ? state.publicObjectives.filter(ok) : [];
    const secret = p.secrets.filter(ok);
    return { pub, secret };
  };

  // Pay the cost (if any) and award the points. Returns false if the player could not pay.
  TI.scoreObjective = async function (state, agents, p, id, how) {
    const o = TI.objectiveById(id);
    if (o.spend) {
      let split = null;
      if (o.spend.kind === 'tokens' && agents && agents[p.id].chooseTokenSpend) split = await agents[p.id].chooseTokenSpend(state, p, o.spend.n);
      if (!TI.paySpend(state, p, o.spend.kind, o.spend.n, split)) return false;
      TI.log(state, `${p.name} spends ${TI.spendText(o)}.`);
    }
    p.scored.push(id);
    TI.addVP(state, p, o.vp, `scores "${o.name}"${how ? ` (${how})` : ''}`);
    return true;
  };

  // Action-phase secret objectives. Combat code records what happened with TI.noteEvent(state, playerId, key);
  // after each combat the engine calls TI.flushEvents, which lets each player score at most one objective (52.7).
  TI.flushEvents = async function (state, agents) {
    const events = state.events || [];
    state.events = [];
    for (const p of state.players) {
      const keys = events.filter((e) => e.player === p.id).map((e) => e.key);
      if (!keys.length || state.winner !== null) continue;
      const id = p.secrets.find((sid) => { const o = TI.objectiveById(sid); return !p.scored.includes(sid) && o.timing === 'action' && keys.includes(o.event); });
      if (id) await TI.scoreObjective(state, agents, p, id, 'secret');
    }
  };

  // Each player was dealt two secret objectives at setup and keeps one; the other goes back into the deck.
  TI.chooseStartingSecrets = async function (state, agents) {
    if (state.secretsChosen) return;
    state.secretsChosen = true;
    const returned = [];
    for (const p of state.players) {
      const offer = p.secretOffer || p.secrets.slice();
      let pick = agents[p.id].chooseSecret ? await agents[p.id].chooseSecret(state, p, offer) : offer[0];
      if (!offer.includes(pick)) pick = offer[0];
      p.secrets = [pick];
      returned.push(...offer.filter((id) => id !== pick));
      delete p.secretOffer;
    }
    state.deck.secret = state.rng.shuffle(state.deck.secret.concat(returned));
  };

  // Draw a secret objective. A player may hold at most three (scored and unscored); a fourth means returning an
  // unscored one to the deck and shuffling it (rule 52.21).
  TI.drawSecret = async function (state, agents, p) {
    if (!state.deck.secret.length) return;
    p.secrets.push(state.deck.secret.pop());
    TI.log(state, `${p.name} draws a secret objective.`);
    if (p.secrets.length > 3) {
      const unscored = p.secrets.filter((id) => !p.scored.includes(id));
      let drop = agents && agents[p.id].chooseSecretDiscard ? await agents[p.id].chooseSecretDiscard(state, p, unscored) : null;
      if (!unscored.includes(drop)) drop = TI.worstSecret(state, p, unscored);
      p.secrets.splice(p.secrets.indexOf(drop), 1);
      state.deck.secret = state.rng.shuffle(state.deck.secret.concat([drop]));
      TI.log(state, `${p.name} returns a secret objective to the deck.`);
    }
  };
  // How close a player is to an objective, 0..1 (1 = requirement met, action-timing cards are judged as 0.2).
  TI.objectiveProgress = function (state, p, id) {
    const o = TI.objectiveById(id);
    if (o.timing === 'action') return 0.2;
    if (!o.progress) return o.check(state, p) ? 1 : 0;
    const [have, need] = o.progress(state, p);
    return Math.min(1, have / need);
  };
  TI.worstSecret = (state, p, ids) => ids.slice().sort((a, b) => TI.objectiveProgress(state, p, a) - TI.objectiveProgress(state, p, b))[0];

  // ---- Status phase ---------------------------------------------------------------------------
  TI.statusPhase = async function (state, agents) {
    state.phase = 'status';
    TI.log(state, `— Status phase, round ${state.round} —`);
    const order = state.players.slice().sort((a, b) => TI.initiative(a) - TI.initiative(b));
    for (const p of order) {
      for (const kind of ['pub', 'secret']) {
        if (state.winner !== null) return;
        const el = TI.eligibleObjectives(state, p)[kind];
        if (!el.length) continue;
        let pick = await agents[p.id].chooseScore(state, p, el, kind);
        if (!el.includes(pick)) pick = pick === null ? null : el[0];
        if (pick) await TI.scoreObjective(state, agents, p, pick);
      }
    }
    if (state.winner !== null) return;
    // Step 2: reveal. If every public objective is already face up the game ends on the spot (rule 70.2).
    if (!TI.revealObjective(state)) { TI.endForObjectives(state); return; }
    // Command tokens on the map are removed every status phase (they only mark "activated this round").
    for (const id of state.map.order) state.map.systems[id].tokens = [];
    for (const p of state.players) {
      for (const pl of TI.planetsOwned(state, p)) pl.exhausted = false;
      p.exhausted = {};
      const gain = 2 + p.techs.filter((t) => TI.TECHS[t].effect.extraTokens).length + (TI.faction(p).ability.extraTokens || 0);
      await TI.giveTokens(state, agents, p, gain);
      await TI.redistributeTokens(state, agents, p);
    }
    TI.repairAll(state);
    // Step 4: draw action cards (2 with Neural Motivator); Political Stability keeps strategy cards instead of returning them.
    if (TI.drawActionCards) for (const p of order) await TI.drawActionCards(state, agents, p, TI.hasTechEffect(p, 'neural') ? 2 : 1, 'status phase');
    if (TI.cardWindow) await TI.cardWindow(state, agents, 'statusReturn', {}, order);
    for (const c of state.cards) if (!(c.owner !== null && state.players[c.owner].keepCards)) { c.owner = null; c.used = false; }
    TI.statusAbilities(state);
    if (TI.drawActionCards) for (const p of order) if (TI.lawOwner(state, 'minister_of_policy') === p.id) await TI.drawActionCards(state, agents, p, 1, 'Minister of Policy');
    if (TI.endOfStatus) await TI.endOfStatus(state, agents);   // Arborec: Bioplasmosis
    if (!state.deferRound) state.round++;
  };

  // Stage II cards stay hidden until all stage I cards are revealed. Returns false when nothing is left to reveal.
  TI.revealObjective = function (state) {
    const next = state.deck.stage1.length ? state.deck.stage1.pop() : state.deck.stage2.pop();
    if (!next) return false;
    state.publicObjectives.push(next);
    TI.log(state, `New public objective: "${TI.objectiveById(next).name}" — ${TI.objectiveById(next).text}`);
    return true;
  };
  TI.endForObjectives = function (state) {
    const best = state.players.slice().sort((a, b) => b.vp - a.vp || TI.initiative(a) - TI.initiative(b))[0];
    state.winner = best.id;
    state.endedByObjectives = true;
    TI.log(state, `All public objectives have been revealed, so the game ends. ${best.name} wins with ${best.vp} VP.`);
  };

  // Status phase step 7: every damaged unit is repaired.
  TI.repairAll = function (state) {
    for (const id of state.map.order) {
      const sys = state.map.systems[id];
      for (const list of Object.values(sys.ships)) list.forEach((u) => { u.damaged = false; });
      for (const pl of sys.planets) pl.ground.forEach((u) => { u.damaged = false; });
    }
  };

  // Players may move any of their command tokens between the three pools (status phase step 5, Warfare primary).
  // The agent's redistributeTokens(state, player) returns { tactic, fleet, strategy } with the same total, or null to keep as is.
  TI.redistributeTokens = async function (state, agents, p) {
    const agent = agents[p.id];
    if (!agent.redistributeTokens) return;
    const total = p.tokens.tactic + p.tokens.fleet + p.tokens.strategy;
    const d = await agent.redistributeTokens(state, p);
    if (!d) return;
    const sum = (d.tactic || 0) + (d.fleet || 0) + (d.strategy || 0);
    if (sum !== total || ['tactic', 'fleet', 'strategy'].some((k) => !(d[k] >= 0))) return;
    p.tokens.tactic = d.tactic; p.tokens.fleet = d.fleet; p.tokens.strategy = d.strategy;
    clampFleet(p);
  };

  TI.giveTokens = async function (state, agents, p, n) {
    if (n <= 0) return;
    let d = await agents[p.id].distributeTokens(state, p, n);
    const total = d ? (d.tactic || 0) + (d.fleet || 0) + (d.strategy || 0) : 0;
    if (!d || total !== n || ['tactic', 'fleet', 'strategy'].some((k) => (d[k] || 0) < 0)) d = { tactic: n, fleet: 0, strategy: 0 };
    p.tokens.tactic += d.tactic || 0; p.tokens.fleet += d.fleet || 0; p.tokens.strategy += d.strategy || 0;
    clampFleet(p);
  };
  function clampFleet(p) { const cap = TI.rules && TI.rules.fleetCap; if (cap && p.tokens.fleet > cap) { p.tokens.tactic += p.tokens.fleet - cap; p.tokens.fleet = cap; } }

  // ---- whole game -----------------------------------------------------------------------------
  TI.runGame = async function (state, agents, opts) {
    opts = opts || {};
    const maxRounds = opts.maxRounds || 14;
    let resume = opts.resume ? state.stage : null;
    if (!resume) await TI.chooseStartingSecrets(state, agents);
    while (state.winner === null && state.round <= maxRounds) {
      if (resume !== 'action') {
        TI.checkpoint(state, 'strategy');
        TI.log(state, `=== Round ${state.round} ===`);
        await TI.strategyPhase(state, agents);
      }
      await TI.actionPhase(state, agents, { resume: resume === 'action' });
      resume = null;
      if (state.winner !== null) break;
      state.deferRound = true;
      await TI.statusPhase(state, agents);
      if (state.winner === null && TI.agendaPhase) await TI.agendaPhase(state, agents);       // the agenda phase follows the status phase
      state.deferRound = false;
      if (state.winner === null) state.round++;
      if (opts.onRound) await opts.onRound(state);
    }
    if (state.winner === null) {
      const best = state.players.slice().sort((a, b) => b.vp - a.vp || TI.planetsOwned(state, b).length - TI.planetsOwned(state, a).length)[0];
      state.winner = best.id;
      state.endedByRoundLimit = true;
      TI.log(state, `Round limit reached; ${best.name} leads with ${best.vp} VP.`);
    } else if (!state.endedByObjectives) {
      TI.log(state, `${state.players[state.winner].name} wins with ${state.players[state.winner].vp} VP!`);
    }
    return state.winner;
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
