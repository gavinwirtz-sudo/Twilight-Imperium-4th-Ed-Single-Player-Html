// Rule-based bot agents. TI.makeBot(styleName) returns an object implementing the agent interface
// (see phases.js). Everything is local and deterministic given the game's RNG.
(function (root) {
  const TI = (root.TI = root.TI || {});

  // How much each style likes each strategy card (1 Leadership … 8 Imperial).
  const CARD_PREF = {
    expander:  { 1: 8, 2: 4, 3: 4, 4: 6, 5: 6, 6: 5, 7: 5, 8: 7 },
    warmonger: { 1: 6, 2: 3, 3: 3, 4: 5, 5: 5, 6: 8, 7: 7, 8: 7 },
    builder:   { 1: 6, 2: 3, 3: 4, 4: 8, 5: 8, 6: 5, 7: 9, 8: 6 },
  };

  TI.makeBot = function (styleName) {
    const style = TI.BOT_STYLES[styleName] || TI.BOT_STYLES.expander;
    const prefs = CARD_PREF[styleName] || CARD_PREF.expander;
    const cache = {}; // per-turn plan cache: playerId -> {target, plan}
    // Hand out n tokens one at a time to the pool furthest below its target.
    const allocate = (have0, n, minFleet) => {
      const have = Object.assign({}, have0);
      const target = { tactic: style.fightThresh <= 1.2 ? 6 : 5, fleet: 4, strategy: 3 };
      const d = { tactic: 0, fleet: Math.min(minFleet || 0, n), strategy: 0 };
      for (let i = d.fleet; i < n; i++) {
        let bestK = 'tactic', bestNeed = -99;
        for (const k of ['tactic', 'fleet', 'strategy']) {
          const need = target[k] - have[k] - d[k] + (k === 'tactic' ? 0.5 : 0);
          if (need > bestNeed) { bestNeed = need; bestK = k; }
        }
        d[bestK]++;
      }
      return d;
    };

    return {
      name: style.label,
      style: styleName,
      botStyle: style,

      chooseCard(state, p, avail) {
        let best = avail[0], bestScore = -1;
        for (const id of avail) {
          const card = state.cards.find((c) => c.id === id);
          let s = prefs[id] + card.tgBonus * 1.2 + state.rng.next() * 0.5;
          if (id === 8 && TI.mecatolHeld(state, p) > 0) s += 3;                // Imperial pays off while holding Mecatol
          if (id === 8 && TI.eligibleObjectives(state, p).pub.length) s += 2;
          if (id === 1 && p.tokens.tactic + p.tokens.fleet + p.tokens.strategy < 6) s += 2;
          if (id === 7 && p.techs.length >= 4) s -= 3;
          if (s > bestScore) { bestScore = s; best = id; }
        }
        return best;
      },

      chooseAction(state, p) {
        const unused = p.cards.filter((id) => !state.cards.find((c) => c.id === id).used);
        const target = p.tokens.tactic > 0 ? TI.botChooseTarget(state, p, style) : null;
        cache[p.id] = target;
        // A strong "As an Action" card is worth a turn; a bot with nothing else to do will play any useful one.
        const ac = TI.botActionCard && TI.botActionCard(state, p, !target && !unused.length);
        if (ac && (!target || ac.score >= 1.0)) return { type: 'card', id: ac.id, value: ac.value };
        // Imperial is worth taking early when something can be scored.
        if (unused.includes(8) && TI.eligibleObjectives(state, p).pub.length) return { type: 'strategic', card: 8 };
        // Faction actions that cost only a strategy token (keep 1 token back to follow other players' cards).
        for (const a of TI.factionActions(state, p)) if (a.ok && a.bot !== false && (a.id === 'transit_diodes' || p.tokens.strategy >= 2)) return { type: 'ability', id: a.id };
        if (target) {
          // Use a card first on some turns so the strategy tokens/benefits are not wasted.
          if (unused.length && state.rng.next() < 0.3) return { type: 'strategic', card: unused[0] };
          return { type: 'tactical' };
        }
        if (unused.length) return { type: 'strategic', card: unused[0] };
        return { type: 'pass' };
      },

      chooseTarget(state, p) {
        const t = cache[p.id] || TI.botChooseTarget(state, p, style);
        return t ? t.id : null;
      },
      planMove(state, p, targetId) {
        const t = cache[p.id];
        // A Spacial Conduit activation changes who can reach the target, so re-plan then.
        const r = t && t.id === targetId && !state.conduit ? t : TI.botPlan(state, p, targetId, style);
        return r.plan;
      },
      chooseInvasion(state, p, sysId) { return TI.botInvasion(state, p, sysId, style); },
      chooseProduction(state, p, sysId, opts) {
        let o = TI.botProduction(state, p, sysId, style);
        if (opts && opts.types) o = o.filter((x) => opts.types.includes(x.unit));
        if (opts && opts.limit) o = o.slice(0, opts.limit);
        return o;
      },

      wantSecondary(state, p, cardId) {
        const avail = TI.available(state, p);
        switch (cardId) {
          case 1: return avail.inf + p.tg >= 3;
          case 2: return TI.planetsOwned(state, p).some((pl) => pl.exhausted);
          case 3: return true;
          case 5: return TI.commOf(p) < TI.commMax(p);
          case 4: return TI.planetsOwned(state, p).some((pl) => !pl.dock || (pl.pds || 0) < 2);
          case 6: return avail.res + p.tg >= 4 && TI.available(state, p).res > 0;
          case 7: return !!TI.faction(p).ability.propagation || avail.res + p.tg >= 4 && Object.keys(TI.TECHS).some((t) => TI.canResearch(p, t, state));
          case 8: return p.secrets.length < 3;
          default: return false;
        }
      },

      distributeTokens(state, p, n) { return allocate(p.tokens, n); },
      // Bots re-balance all their tokens toward their preferred split at the end of each round.
      redistributeTokens(state, p) {
        const total = p.tokens.tactic + p.tokens.fleet + p.tokens.strategy;
        // Never shrink the fleet pool below what the largest fleet on the board needs.
        const bonus = TI.fleetLimit(p) - p.tokens.fleet;
        let need = 0;
        for (const id of state.map.order) need = Math.max(need, (state.map.systems[id].ships[p.id] || []).filter((u) => u.type !== 'fighter').length - bonus);
        return allocate({ tactic: 0, fleet: 0, strategy: 0 }, total, need);
      },

      // Pick the objective worth the most after its cost. Spending trade goods or command tokens hurts, so those
      // are skipped unless they are worth it (or win the game).
      chooseScore(state, p, eligible) {
        let best = null, bv = 0;
        for (const id of eligible) {
          const o = TI.objectiveById(id);
          let v = o.vp;
          if (o.spend && o.spend.kind === 'tg') v -= p.tg - o.spend.n >= 3 ? 0.1 : 0.5 * (3 - (p.tg - o.spend.n)) / 3 + 0.1;
          if (o.spend && o.spend.kind === 'tokens') {
            const left = p.tokens.tactic + p.tokens.strategy - o.spend.n;
            v -= left >= 3 ? 0.1 : 0.4 + (3 - Math.max(0, left)) * 0.2;
          }
          if (p.vp + o.vp >= state.vpToWin) v += 2;      // the winning points are always worth it
          if (v > bv) { bv = v; best = id; }
        }
        return best;
      },
      // Keep the secret objective that is already closest to done (action cards the bot can chase count a little).
      chooseSecret(state, p, offer) {
        return offer.slice().sort((a, b) => TI.objectiveProgress(state, p, b) - TI.objectiveProgress(state, p, a))[0];
      },
      // Retreat when the fleet is clearly losing: less than half the enemy's expected firepower.
      chooseRetreat(state, p, sysId, options, ctx) {
        const mine = TI.fleetStrength(ctx.mine, p.stats), theirs = TI.fleetStrength(ctx.theirs, ctx.opponent.stats);
        if (mine >= theirs * 0.5 || !ctx.mine.length) return null;
        const S = state.map.systems;
        const score = (id) => (S[id].planets.some((pl) => pl.owner === p.id) ? 3 : 0) + (S[id].ships[p.id] || []).length;
        return options.slice().sort((a, b) => score(b) - score(a))[0];
      },
      chooseSecretDiscard(state, p, unscored) { return TI.worstSecret(state, p, unscored); },
      // Pay command tokens from the bigger pool, but keep at least one strategy token for following cards.
      chooseTokenSpend(state, p, n) {
        let tac = p.tokens.tactic, str = p.tokens.strategy, t = 0, st = 0;
        for (let i = 0; i < n; i++) { if (tac > 0 && (tac >= str || str <= 1)) { tac--; t++; } else { str--; st++; } }
        return { tactic: t, strategy: st };
      },

      // ---- card hooks ----
      chooseTech(state, p, options) {
        // The style's first two general picks (economy and mobility), then the faction's own techs, then the rest.
        const general = styleNameToTechOrder(styleName);
        const plan = general.slice(0, 3).concat(TI.faction(p).techPlan || [], general.slice(3));
        // If the best tech is out of reach only for lack of prerequisites, research a feeder of that color first.
        for (const t of plan.slice(0, 8)) {
          if (!TI.techAllowed(p, t)) continue;
          if (options.includes(t)) return t;
          const missing = TI.missingPrereqs(p, t);
          const feeder = plan.find((o) => options.includes(o) && missing[TI.TECHS[o].color]);
          if (feeder) return feeder;
        }
        for (const t of plan) if (options.includes(t)) return t;
        return options[0];
      },
      // Action cards: which card (if any) to play in response to something; the card itself says when a bot wants to.
      chooseActionCard(state, p, window, cands, ctx) {
        if (window === 'sabotage') {
          if (cands.includes('sabotage') && TI.ACTION_BY_ID.sabotage.bot(state, p, ctx, style)) return 'sabotage';
          if (cands.includes('instinct_training') && p.tokens.strategy >= 2 && (ctx.card.weight || 1) >= 2) return 'instinct_training';
          return null;
        }
        for (const id of cands) if (TI.ACTION_BY_ID[id].bot(state, p, ctx, style)) return id;
        return null;
      },
      chooseCardTarget(state, p, card, opts, ctx) {
        if (card.botOption) return card.botOption(state, p, ctx, style);
        return opts.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0] ? opts.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0].value : null;
      },
      chooseBuyTokens(state, p, max) { return Math.max(0, Math.min(max, 2)); },
      chooseSpeaker(state, p) { return p.id; },
      // Everything else (Orbital Drop target, Production Biomes partner, Nullification Field, Peace Accords,
      // Quantum Datahub) falls back to the defaults in abilities.js.
    };
  };

  function styleNameToTechOrder(styleName) {
    if (styleName === 'warmonger') return ['plasma_scoring', 'gravity_drive', 'dreadnought2', 'cruiser2', 'magen', 'duranium', 'infantry2', 'assault', 'destroyer2', 'war_sun', 'sarween', 'fighter2', 'pds2', 'antimass', 'dacxive', 'fleet_logistics', 'neural', 'hyper_metabolism', 'carrier2', 'graviton', 'spacedock2', 'x89', 'light_wave', 'transit_diodes', 'integrated_economy'];
    if (styleName === 'builder')   return ['gravity_drive', 'neural', 'sarween', 'dacxive', 'hyper_metabolism', 'spacedock2', 'infantry2', 'fleet_logistics', 'cruiser2', 'integrated_economy', 'war_sun', 'dreadnought2', 'fighter2', 'pds2', 'antimass', 'carrier2', 'magen', 'duranium', 'transit_diodes', 'plasma_scoring', 'graviton', 'x89', 'assault', 'light_wave', 'destroyer2'];
    return ['gravity_drive', 'neural', 'sarween', 'dacxive', 'fleet_logistics', 'infantry2', 'carrier2', 'cruiser2', 'fighter2', 'hyper_metabolism', 'antimass', 'spacedock2', 'dreadnought2', 'magen', 'transit_diodes', 'duranium', 'pds2', 'plasma_scoring', 'graviton', 'war_sun', 'destroyer2', 'light_wave', 'assault', 'integrated_economy', 'x89'];
  }

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
