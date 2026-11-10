// The human player's agent: answers every decision the engine asks through dialogs / map clicks.
(function (root) {
  const TI = (root.TI = root.TI || {});
  const ui = (TI.ui = TI.ui || {});

  const cardName = (id) => TI.STRATEGY_CARDS[id - 1].name;

  // Explains why activating `target` would waste a command token and an action, or returns '' when something can happen there.
  function tacticalWarning(state, p, target) {
    const sys = state.map.systems[target];
    if (TI.movableShips(state, p, target).length) return '';
    if ((sys.ships[p.id] || []).length || TI.cargoOf(sys, p.id).length) return '';          // ships already there can still invade
    if (sys.planets.some((pl) => pl.owner === p.id && pl.dock) && TI.available(state, p).res + p.tg > 0) return '';   // production
    const stuck = TI.shipSystems(state, p).filter((id) => (state.map.systems[id].tokens || []).includes(p.id));
    const other = TI.shipSystems(state, p).filter((id) => !stuck.includes(id));
    let why = `<p><b>None of your ships can reach ${ui.esc(target)}</b>, and you could not produce there, so the action and command token would be spent for nothing.</p>`;
    if (stuck.length) why += `<p>${stuck.length} of your fleet${stuck.length === 1 ? ' is' : 's are'} in system${stuck.length === 1 ? '' : 's'} <b>${stuck.map(ui.esc).join(', ')}</b> that already hold${stuck.length === 1 ? 's' : ''} your command token. Ships that were activated or moved into a system this round cannot move again until the status phase.</p>`;
    if (other.length) why += `<p class="note">Your other fleets (${other.map(ui.esc).join(', ')}) are too far away or blocked by anomalies, enemy ships or the fleet limit.</p>`;
    return why;
  }

  TI.makeHuman = function () {
    let pendingTarget = null;

    return {
      human: true,

      async chooseCard(state, p, avail) {
        ui.setStatus(`${p.name}: choose a strategy card`);
        const opts = avail.map((id) => {
          const c = TI.STRATEGY_CARDS[id - 1], card = state.cards.find((x) => x.id === id);
          return { label: `${id} · ${c.name}` + (card.tgBonus ? `   (+${card.tgBonus} trade goods)` : ''),
                   sub: `<b>Primary:</b> ${ui.esc(c.primary)}<br><b>Secondary:</b> ${ui.esc(c.secondary)}`, value: id };
        });
        const pick = await ui.choose('Choose a strategy card', opts, { note: `Initiative order follows the card number. You pick ${state.players.length <= 4 ? 'two cards' : 'one card'} this round.` });
        return pick;
      },

      async chooseAction(state, p) {
        for (;;) {
          ui.setStatus(`Your turn, ${p.name}`);
          const unused = p.cards.filter((id) => !state.cards.find((c) => c.id === id).used);
          const options = [];
          options.push({ label: `Tactical action  (${p.tokens.tactic} tactic token${p.tokens.tactic === 1 ? '' : 's'})`,
                         sub: 'Activate a system, move ships, fight, invade and produce.', value: 'tactical', disabled: p.tokens.tactic <= 0 });
          unused.forEach((id) => options.push({ label: `Strategic action: ${cardName(id)}`, sub: ui.esc(TI.STRATEGY_CARDS[id - 1].primary), value: 'card' + id }));
          for (const { card, options: copts } of TI.playableActionCards(state, p)) {
            options.push({ label: `Action card: ${card.name}`, sub: ui.esc(card.text.replace(/^As an Action: /, '')), value: 'ac:' + card.id, _opts: copts });
          }
          for (const a of TI.factionActions(state, p)) {
            options.push({ label: `Faction action: ${a.label}`, sub: ui.esc(a.sub), value: 'ability:' + a.id, disabled: !a.ok });
          }
          if (TI.dealPartners(state, p).length) options.push({ label: 'Trade with a player…', sub: `Swap trade goods or commodities with a neighbor (you have ${p.tg} TG, ${TI.commOf(p)}/${TI.commMax(p)} commodities). Does not use up your action.`, value: 'trade' });
          if (TI.undo.stack.length >= 2) options.push({ label: '↩ Undo: back to the start of your previous turn', sub: 'Everything since then is rewound, including the other players\' moves.', value: 'undo' });
          options.push({ label: 'Pass', sub: unused.length ? 'You must use your strategy cards first.' : 'End your actions for this round.', value: 'pass', disabled: unused.length > 0 });
          TI.undo.atMenu = true;
          let pick;
          try { pick = await ui.choose('Choose your action', options); } finally { TI.undo.atMenu = false; }
          if (pick === 'undo') { TI.undo.atMenu = true; const text = TI.undo.request(); TI.undo.atMenu = false; if (text) throw TI.undo.signal(text); continue; }
          if (pick === 'trade') { state.turnPlayer = p.id; await ui.openTrade(true); continue; }
          if (pick === 'pass') return { type: 'pass' };
          if (pick && pick.startsWith('card')) return { type: 'strategic', card: +pick.slice(4) };
          if (pick && pick.startsWith('ability:')) return { type: 'ability', id: pick.slice(8) };
          if (pick && pick.startsWith('ac:')) {
            const id = pick.slice(3), o = options.find((x) => x.value === pick), c = TI.ACTION_BY_ID[id];
            const opts = o._opts.map((x) => ({ label: x.label, value: x.value }));
            const v = opts.length === 1 && opts[0].value === true ? true : await ui.chooseValue(c.name, c.text, opts);
            if (v !== undefined) return { type: 'card', id, value: v };
            continue;
          }
          // tactical: pick the system now so a misclick can be cancelled back to this menu
          const ids = state.map.order.filter((id) => TI.canActivate(state, p, id) && state.map.systems[id].anomaly !== 'supernova');
          const target = await ui.pickSystem(state, ids, 'Click a system to activate.', 'Cancel');
          if (target) {
            const warn = tacticalWarning(state, p, target);
            if (warn) {
              const go = await ui.modal({ title: 'This action may accomplish nothing', body: warn, actions: [{ label: 'Choose another action', value: false, cls: 'secondary' }, { label: 'Activate anyway', value: true }] }).promise;
              if (!go) continue;
            }
            pendingTarget = target; return { type: 'tactical' };
          }
        }
      },

      // ---- agenda phase ----
      async chooseVote(state, p, ctx) {
        const d = ctx.def, T = ctx.tally || {};
        const seen = state.players.filter((q) => ctx.votes[q.id]).map((q) => `${ui.esc(q.name)}: ${ctx.votes[q.id].key ? ctx.votes[q.id].n + ' for ' + ui.esc(ctx.outcomes.find((o) => o.key === ctx.votes[q.id].key).label) : 'abstained'}`).join('<br>');
        const note = `<b>${ui.esc(d.name)}</b> <span class="chip">${d.type}</span><br>${ui.esc(d.text)}<br><br>You have <b>${ctx.avail}</b> influence available (1 vote per influence, exhausting planets).${TI.rules.repGov ? ' Representative Government: 1 vote only.' : ''}${seen ? '<br><br><b>Votes so far</b><br>' + seen : ''}`;
        const opts = ctx.outcomes.slice(0, 40).map((o) => ({ label: o.label + (T[o.key] ? `   (${T[o.key]} votes so far)` : ''), value: o.key }));
        opts.push({ label: 'Abstain', sub: 'Cast no votes.', value: null });
        ui.setStatus(`Vote on ${d.name}`);
        const key = await ui.choose('Vote: ' + d.name, opts, { note });
        if (!key) return { key: null, n: 0 };
        if (TI.rules.repGov) return { key, n: 1 };
        const label = ctx.outcomes.find((o) => o.key === key).label;
        let n = ctx.avail;
        const wrap = document.createElement('div');
        wrap.innerHTML = `<p class="note">Votes for <b>${ui.esc(label)}</b>. Exhausting planets gives their influence; any extra influence on the last planet is wasted.</p>`;
        const st = ui.stepper(1, ctx.avail, n, (v) => { n = v; });
        const row = document.createElement('div'); row.className = 'row'; row.innerHTML = '<label>Votes</label>'; row.appendChild(st.node); wrap.appendChild(row);
        const go = await ui.modal({ title: `How many votes for ${label}?`, body: wrap, actions: [{ label: 'Back', value: false, cls: 'secondary' }, { label: 'Cast votes', value: true }] }).promise;
        if (!go) return this.chooseVote(state, p, ctx);
        return { key, n };
      },
      async chooseElected(state, p, outcomes, ctx) {
        const d = ctx.def;
        return ui.choose(`${d.name}: you decide`, outcomes.slice(0, 40).map((o) => ({ label: o.label, value: o })), { note: ui.esc(d.text) });
      },
      async chooseUseLaw(state, p, id, ctx) {
        const d = TI.AGENDA_BY_ID[id];
        const why = { minister_of_peace: `${ctx.mover ? ctx.mover.name : 'A player'} activated ${ui.sysLabel(state, ctx.sysId)}, which holds another player's units. Discard Minister of Peace to end their turn right now?`,
          minister_of_war: 'Discard Minister of War to remove one of your command tokens from the board and take another action?',
          committee_formation: 'Discard Committee Formation to choose the elected player yourself, with no vote?',
          imperial_arbiter: 'Discard Imperial Arbiter to swap one of your strategy cards with another player\'s?' }[id] || `Use ${d.name}?`;
        return ui.confirm(d.name, why, 'Use it', 'Keep it');
      },
      async chooseArbiterSwap(state, p) {
        const opts = [];
        for (const o of state.players) if (o.id !== p.id) for (const mine of p.cards) for (const theirs of o.cards)
          opts.push({ label: `Give ${cardName(mine)} · take ${cardName(theirs)} (${o.name})`, value: { mine, theirs, other: o } });
        opts.push({ label: 'Make no swap', value: null });
        return ui.choose('Imperial Arbiter: swap strategy cards', opts, {});
      },
      async chooseQuash(state, p, d) { return ui.confirm('Quash', `${ui.esc(d.name)} was revealed. Spend a strategy token to discard it and reveal another agenda?`, 'Quash', 'Let it stand'); },
      async chooseCrownDice(state, p, info) {
        const yes = await ui.confirm('The Crown of Thalnos', `You missed with ${info.misses.length} die/dice. Reroll them all? Any unit that misses again is destroyed.`, 'Reroll', 'Keep the dice');
        return yes ? info.misses : [];
      },

      // ---- action cards ----
      // Offered a moment where one of your cards could be played (a combat step, a strategy pick, a cancel window...).
      async chooseActionCard(state, p, window, cands, ctx) {
        const opts = cands.map((id) => { const c = TI.ACTION_BY_ID[id]; return id === 'instinct_training'
          ? { label: 'Instinct Training (Xxcha)', sub: 'Exhaust and spend a strategy token: cancel that action card.', value: id }
          : { label: `Play ${c.name}`, sub: ui.esc(c.text), value: id }; });
        opts.push({ label: "Don't play a card", value: null });
        const first = TI.ACTION_BY_ID[cands[0]];
        const note = first && first.prompt && cands[0] !== 'instinct_training' ? first.prompt(state, p, ctx) : (ctx && ctx.card ? `${ctx.player.name} plays ${ctx.card.name}: ${ctx.card.text}` : '');
        ui.setStatus('You can play an action card');
        return ui.choose(window === 'sabotage' ? 'Cancel this action card?' : 'Play an action card?', opts, { note: ui.esc(note) });
      },
      // A card that needs a choice (target planet, system, player...).
      chooseCardTarget(state, p, card, opts) {
        return ui.chooseValue(card.name, card.text, opts.map((o) => ({ label: o.label, value: o.value })));
      },
      async chooseActionDiscard(state, p) {
        const opts = p.hand.map((id, i) => ({ label: TI.ACTION_BY_ID[id].name, sub: ui.esc(TI.ACTION_BY_ID[id].text), value: id }));
        return ui.choose(`Hand limit: discard down to ${TI.HAND_LIMIT}`, opts, { note: 'You hold more action cards than the limit. Choose one to discard.' });
      },
      async chooseShipToDestroy(state, p, list) {
        const seen = new Set(), opts = [];
        list.forEach((u, i) => { const k = u.type + (u.damaged ? '*' : ''); if (!seen.has(k)) { seen.add(k); opts.push({ label: u.type + (u.damaged ? ' (damaged)' : ''), value: u }); } });
        return ui.choose('Choose one of your ships to destroy', opts, {});
      },

      chooseTarget() { const t = pendingTarget; pendingTarget = null; return t; },
      async planMove(state, p, targetId) {
        ui.setStatus(`Moving to ${ui.sysLabel(state, targetId)}`);
        try { return await ui.moveDialog(state, p, targetId); }
        catch (e) {   // never leave the game waiting on a dialog that failed to build: fall back to the suggested plan
          console.error('moveDialog failed', e);
          return TI.botPlan(state, p, targetId, TI.BOT_STYLES.expander).plan;
        }
      },
      chooseInvasion(state, p, sysId) { return ui.invasionDialog(state, p, sysId); },
      chooseProduction(state, p, sysId, opts) { return ui.productionDialog(state, p, sysId, opts); },

      async wantSecondary(state, p, cardId) {
        const c = TI.STRATEGY_CARDS[cardId - 1];
        return ui.modal({ title: `Follow ${c.name}?`, body: `<p><b>Secondary:</b> ${ui.esc(c.secondary)}</p><p class="note">${cardId === 1 ? 'Costs no command token.' : `Costs 1 strategy token (you have ${p.tokens.strategy}).`}</p>`,
          actions: [{ label: 'No thanks', value: false, cls: 'secondary' }, { label: 'Follow', value: true }] }).promise;
      },

      async distributeTokens(state, p, n) {
        const wrap = document.createElement('div');
        wrap.innerHTML = `<p class="note">Gain ${n} command token${n > 1 ? 's' : ''}. <b>Tactic</b> tokens activate systems, <b>fleet</b> tokens raise your ships-per-system limit, <b>strategy</b> tokens let you follow other players' cards.</p>`;
        const have = p.tokens, d = { tactic: 0, fleet: 0, strategy: 0 };
        const status = document.createElement('div'); status.className = 'note';
        const m = {};
        const upd = () => {
          const left = n - d.tactic - d.fleet - d.strategy;
          status.textContent = left === 0 ? 'Ready.' : `${left} left to assign.`;
          if (m.btn) m.btn.disabled = left !== 0;
          ['tactic', 'fleet', 'strategy'].forEach((k) => m.st[k].setMax(d[k] + Math.max(0, left)));
        };
        m.st = {};
        for (const k of ['tactic', 'fleet', 'strategy']) {
          const row = document.createElement('div'); row.className = 'row';
          row.innerHTML = `<label>${k[0].toUpperCase() + k.slice(1)} (now ${have[k]})</label>`;
          m.st[k] = ui.stepper(0, n, 0, (v) => { d[k] = v; upd(); });
          row.appendChild(m.st[k].node); wrap.appendChild(row);
        }
        wrap.appendChild(status);
        const h = ui.modal({ title: 'Command tokens', body: wrap, actions: [{ label: 'Confirm', value: () => ({ tactic: d.tactic, fleet: d.fleet, strategy: d.strategy }) }] });
        m.btn = h.buttons[0]; upd();
        return h.promise;
      },

      async chooseScore(state, p, eligible, kind) {
        const opts = eligible.map((id) => {
          const o = TI.objectiveById(id);
          return { label: `${o.name}  (+${o.vp} VP${o.spend ? ` · costs ${TI.spendText(o)}` : ''})`, sub: ui.esc(o.text), value: id };
        });
        opts.push({ label: 'Do not score now', sub: 'You can score an unscored objective in a later status phase.', value: null });
        return ui.choose(kind === 'pub' ? 'Score a public objective' : 'Score a secret objective', opts, { note: 'You qualify for these. Costs are paid when you score.' });
      },

      // Start of the game: you were dealt two secret objectives and keep one.
      async chooseSecret(state, p, offer) {
        const opts = offer.map((id) => { const o = TI.objectiveById(id); return { label: `${o.name}  (+${o.vp} VP)`, sub: ui.esc(o.text), value: id }; });
        return ui.choose('Keep one secret objective', opts, { note: 'You were dealt two. The other goes back into the deck.' });
      },
      async chooseSecretDiscard(state, p, unscored) {
        const opts = unscored.map((id) => { const o = TI.objectiveById(id); return { label: `${o.name}  (+${o.vp} VP)`, sub: ui.esc(o.text), value: id }; });
        return ui.choose('Return a secret objective', opts, { note: 'You may hold only three secret objectives (scored or not). Choose an unscored one to return to the deck.' });
      },
      // Which pools pay for a "spend tokens" objective.
      async chooseTokenSpend(state, p, n) {
        const lo = Math.max(0, n - p.tokens.strategy), hi = Math.min(n, p.tokens.tactic), opts = [];
        for (let t = lo; t <= hi; t++) opts.push({ label: `${t} tactic + ${n - t} strategy`, sub: `You keep ${p.tokens.tactic - t} tactic and ${p.tokens.strategy - (n - t)} strategy tokens.`, value: { tactic: t, strategy: n - t } });
        if (opts.length <= 1) return opts.length ? opts[0].value : null;
        return ui.choose(`Pay ${n} command tokens`, opts, { note: 'Spent tokens come from your tactic and/or strategy pools.' });
      },

      async chooseTech(state, p, options, price) {
        const opts = options.map((t) => { const T = TI.TECHS[t]; return { label: `${T.name}  [${T.color || 'unit upgrade'}]${T.faction ? '  ★ faction tech' : ''}`, sub: techText(T), value: t }; });
        opts.push({ label: 'Skip', value: null });
        return ui.choose('Research a technology', opts, { note: price ? `Cost: ${price} resources.` : 'This one is free.' });
      },

      async chooseBuyTokens(state, p, max) {
        const st = ui.stepper(0, max, 0);
        const wrap = document.createElement('div');
        wrap.innerHTML = `<p>Buy command tokens for 3 influence each (up to ${max}).</p>`;
        wrap.appendChild(st.node);
        return ui.modal({ title: 'Buy command tokens', body: wrap, actions: [{ label: 'Confirm', value: () => st.get() }] }).promise;
      },

      async chooseSpeaker(state, p) {
        return ui.choose('Choose the new speaker', state.players.map((q) => ({ label: q.name + (q.id === state.speaker ? ' (current)' : ''), value: q.id })));
      },

      async chooseStructures(state, p, count, opts) {
        opts = opts || {};
        const out = [];
        for (let i = 0; i < count; i++) {
          const opts2 = [];
          const onlyPds = i >= 1 && opts.restSecond === 'pds';
          TI.planetsOwned(state, p).forEach((pl) => {
            if (opts.system && pl.systemId !== opts.system) return;
            const sys = state.map.systems[pl.systemId], idx = sys.planets.indexOf(pl);
            if (!onlyPds && !pl.dock && TI.unitsLeft(state, p, 'dock') - out.filter((o) => o.kind === 'dock').length > 0) opts2.push({ label: `Space dock on ${pl.name}`, value: { systemId: pl.systemId, planetIdx: idx, kind: 'dock' } });
            const already = out.filter((o) => o.systemId === pl.systemId && o.planetIdx === idx && o.kind === 'pds').length;
            if ((pl.pds || 0) + already < 2 && TI.unitsLeft(state, p, 'pds') - out.filter((o) => o.kind === 'pds').length > 0) opts2.push({ label: `PDS on ${pl.name}`, sub: `currently ${pl.pds || 0}`, value: { systemId: pl.systemId, planetIdx: idx, kind: 'pds' } });
          });
          if (!opts2.length) break;
          opts2.push({ label: 'Done', value: null });
          const note = opts.restSecond === 'pds' ? (i === 0 ? 'First: a PDS or a space dock. The second structure must be a PDS.' : 'The additional structure must be a PDS.') : null;
          const pick = await ui.choose(`Place structure ${i + 1} of ${count}`, opts2, note ? { note } : undefined);
          if (!pick) break;
          out.push(pick);
        }
        return out;
      },
      async chooseConstructionSystem(state, p) {
        const ids = [...new Set(TI.planetsOwned(state, p).map((pl) => pl.systemId))];
        if (!ids.length) return null;
        return ui.pickSystem(state, ids, 'Construction: choose the system for your command token and one PDS or space dock.', 'Skip');
      },
      // Combat screens (see combat.js): units and hit numbers + Roll button, then the dice and your casualty choices.
      combatRoundStart(state, p, q) { return ui.combatPre(state, p, q); },
      chooseCasualties(state, p, q) { return ui.combatResult(state, p, q); },
      // Retreat offer, shown before each round of a space battle you could retreat from.
      async chooseRetreat(state, p, sysId, options, ctx) {
        const opts = options.map((id) => ({ label: `Retreat to ${ui.sysLabel(state, id)}`, sub: 'Your ships still take this round of hits, then move there and a command token is placed.', value: id }));
        opts.push({ label: 'Keep fighting', value: null });
        return ui.choose(`Space battle at ${ui.sysLabel(state, sysId)}: retreat?`, opts, { note: `Your ${ctx.mine.length} ship(s) vs ${ctx.opponent.name}'s ${ctx.theirs.length}.` });
      },
      // Move command tokens between your three pools (status phase step 5, Warfare).
      async redistributeTokens(state, p) {
        const total = p.tokens.tactic + p.tokens.fleet + p.tokens.strategy, d = Object.assign({}, p.tokens);
        delete d.extra;
        const wrap = document.createElement('div');
        wrap.innerHTML = `<p class="note">You may move your ${total} command tokens between pools: lower one pool with &minus;, then raise another with +, until nothing is left to assign. Choose <b>Keep as is</b> to change nothing. <b>Tactic</b> activates systems, <b>fleet</b> sets your ships-per-system limit, <b>strategy</b> lets you follow other players' cards.</p>`;
        const status = document.createElement('div'); status.className = 'note';
        const m = { st: {} };
        const upd = () => {
          const left = total - d.tactic - d.fleet - d.strategy;
          status.textContent = left === 0 ? 'Ready.' : left > 0 ? `${left} left to assign.` : `${-left} too many.`;
          if (m.btn) m.btn.disabled = left !== 0;
        };
        for (const k of ['tactic', 'fleet', 'strategy']) {
          const row = document.createElement('div'); row.className = 'row';
          row.innerHTML = `<label>${k[0].toUpperCase() + k.slice(1)}</label>`;
          m.st[k] = ui.stepper(0, total, d[k], (v) => { d[k] = v; upd(); });
          row.appendChild(m.st[k].node); wrap.appendChild(row);
        }
        wrap.appendChild(status);
        const h = ui.modal({ title: 'Redistribute command tokens', body: wrap, actions: [
          { label: 'Keep as is', value: null, cls: 'secondary' },
          { label: 'Confirm', value: () => ({ tactic: d.tactic, fleet: d.fleet, strategy: d.strategy }) } ] });
        m.btn = h.buttons[1]; upd();
        return h.promise;
      },

      async chooseOrbitalDrop(state, p, planets) {
        const opts = planets.map((pl) => ({ label: `${pl.name} (${pl.res}/${pl.inf})`, sub: `${pl.ground.length} ground forces now`, value: pl }));
        return ui.choose('Orbital Drop: choose a planet', opts, { note: 'Spend 1 strategy token to place 2 infantry on it.' });
      },

      async chooseDiodesTarget(state, p, planets) {
        const opts = planets.map((pl) => ({ label: `${pl.name} (${pl.res}/${pl.inf})`, sub: `${pl.ground.length} ground forces now`, value: pl }));
        return ui.choose('Transit Diodes: which planet receives the ground forces?', opts, { note: 'Up to 4 ground forces (one stays behind on every other planet) move here.', cancel: 'Cancel' });
      },

      async chooseIntegrated(state, p, sysId, planet) {
        const n = Math.max(0, planet.res);
        const opts = [{ label: 'Build nothing', value: [] }];
        if (n > 0) opts.push({ label: `${n * 2} infantry`, sub: `costs ${n} resources`, value: Array(n).fill({ unit: 'infantry' }) });
        return ui.choose(`Integrated Economy on ${planet.name}`, opts, { note: `Produce units on the planet you just won (combined cost up to ${planet.res}).` });
      },

      async chooseReplenish(state, p, others) {
        if (!others.length) return [];
        const chosen = new Set();
        const wrap = document.createElement('div');
        wrap.innerHTML = '<div class="note">Trade primary: you gained 3 trade goods and replenished your commodities. You may also replenish any other players\' commodities (it gives them something to trade with you).</div>';
        others.forEach((o) => {
          const lab = document.createElement('label'); lab.className = 'opt'; lab.style.display = 'block';
          lab.innerHTML = `<input type="checkbox"> ${ui.esc(o.name)} <span class="sub">${o.vp} VP · ${TI.commOf(o)}/${TI.commMax(o)} commodities · ${o.tg} TG</span>`;
          lab.querySelector('input').addEventListener('change', (e) => { e.target.checked ? chosen.add(o) : chosen.delete(o); });
          wrap.appendChild(lab);
        });
        await ui.modal({ title: 'Replenish other players?', body: wrap, actions: [{ label: 'Done', value: true }] }).promise;
        return [...chosen];
      },

      async wantTransaction(state, me, from, offer) {
        const side = (s) => TI.describeSide(s);
        return ui.confirm(`Trade offer from ${from.name}`, `${ui.esc(from.name)} offers you <b>${side(offer.give)}</b> in exchange for <b>${side(offer.get)}</b>.<br><span class="note">You have ${me.tg} trade goods and ${TI.commOf(me)} commodities. Commodities you receive become trade goods.</span>`, 'Accept', 'Decline');
      },

      async chooseTradePartner(state, p, others, gift) {
        const opts = others.map((o) => ({ label: o.name, sub: `${o.vp} VP · ${o.tg} trade goods`, value: o }));
        return ui.choose('Production Biomes: who gains ' + gift + ' trade goods?', opts, { note: 'You gain 4 trade goods.' });
      },

      async wantNullify(state, p, activator, sysId) {
        return ui.confirm('Nullification Field', `${ui.esc(activator.name)} activated system <b>${ui.esc(ui.sysLabel(state, sysId))}</b>, which holds your ships. Exhaust Nullification Field and spend 1 strategy token (you have ${p.tokens.strategy}) to end their turn now?`, 'Nullify', 'Let it happen');
      },

      async choosePeaceAccords(state, p, planets) {
        const opts = planets.map((pl) => ({ label: `${pl.name} (${pl.res}/${pl.inf})`, sub: `system ${pl.systemId} · ${pl.owner === null ? 'unclaimed' : state.players[pl.owner].name}`, value: pl }));
        opts.push({ label: 'Skip', value: null });
        return ui.choose('Peace Accords: take a planet?', opts, { note: 'Any planet with no units on it, next to a planet you control (not Mecatol Rex).' });
      },

      async chooseForesight(state, p, activator, sysId, options) {
        const opts = options.map((id) => ({ label: `Slip away to ${ui.sysLabel(state, id)}`, sub: state.map.systems[id].planets.map((pl) => ui.esc(pl.name)).join(', ') || 'empty space', value: id }));
        opts.push({ label: 'Stay and fight', value: null });
        return ui.choose('Foresight', opts, { note: `${ui.esc(activator.name)} moved ships into <b>${ui.esc(ui.sysLabel(state, sysId))}</b>, where your fleet is. Spend 1 strategy token (you have ${p.tokens.strategy}) to move your fleet to an adjacent system with no other player's ships?` });
      },

      async wantBioplasmosis(state, p, moves) {
        const n = moves.reduce((a, m) => a + m.n, 0);
        return ui.confirm('Bioplasmosis', `End of the status phase: move ${n} spare infantry onto <b>${ui.esc(moves[0].to.name)}</b>, the planet nearest your enemies?`, 'Move them', 'Leave them');
      },
      async chooseThreat(state, p, ctx) {
        const opts = ctx.outcomes.map((o) => ({ label: o.label, value: o }));
        opts.push({ label: 'Make no prediction', value: null });
        return ui.choose('Galactic Threat', opts, { note: `You cannot vote on <b>${ui.esc(ctx.def.name)}</b>. Predict its outcome: if you are right you take a technology from a player who voted that way.` });
      },

      async chooseDatahub(state, p) {
        const theirs = [];
        state.players.forEach((o) => { if (o.id !== p.id) o.cards.forEach((c) => theirs.push({ o, c })); });
        const opts = theirs.map(({ o, c }) => ({ label: `${c} · ${TI.STRATEGY_CARDS[c - 1].name}`, sub: `held by ${ui.esc(o.name)}`, value: c }));
        opts.push({ label: 'Do not swap', value: null });
        const take = await ui.choose('Quantum Datahub Node: take which card?', opts, { note: `Costs 1 strategy token and 3 trade goods (given to the other player). You have ${p.tg} trade goods.` });
        if (!take) return null;
        const give = await ui.choose('Quantum Datahub Node: give which card?', p.cards.map((c) => ({ label: `${c} · ${TI.STRATEGY_CARDS[c - 1].name}`, value: c })));
        return { take, give };
      },

      async chooseDiplomacySystem(state, p) {
        const ids = state.map.order.filter((id) => id !== '0,0' && state.map.systems[id].planets.some((x) => x.owner === p.id));
        if (!ids.length) return null;
        return ui.pickSystem(state, ids, 'Diplomacy: choose a system you control (not Mecatol Rex); rivals place command tokens there and cannot activate it this round.', 'Skip');
      },

      async chooseTokenReturn(state, p) {
        const ids = state.map.order.filter((id) => (state.map.systems[id].tokens || []).includes(p.id));
        if (!ids.length) return null;
        return ui.pickSystem(state, ids, 'Warfare: choose one of your command tokens on the board to take back; you then redistribute your tokens.', 'Skip');
      },
    };
  };

  function techText(T) {
    if (T.text) {
      const pre = Object.entries(T.prereq).map(([c, n]) => `${n} ${c}`).join(', ');
      return ui.esc(T.text) + (pre ? ` · requires ${pre}` : '');
    }
    const bits = [];
    const e = T.effect;
    if (e.shipMove) bits.push(`+${e.shipMove} move for ships`);
    if (e.productionBonus) bits.push(`+${e.productionBonus} dock production`);
    if (e.extraTokens) bits.push(`+${e.extraTokens} command token each status phase`);
    if (e.throughAsteroids) bits.push('ships can cross asteroid fields');
    if (e.fleetBonus) bits.push(`+${e.fleetBonus} fleet supply`);
    if (e.freeReady) bits.push('bonus readying');
    if (e.unlock) bits.push('unlocks the ' + e.unlock);
    if (e.upgrade) bits.push('upgrades ' + Object.keys(e.upgrade).join(', '));
    const pre = Object.entries(T.prereq).map(([c, n]) => `${n} ${c}`).join(', ');
    return bits.join('; ') + (pre ? ` · requires ${pre}` : '');
  }

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
