// Strategy card resolution (primary for the active player, secondary for others).
// Each choice is asked of the agent via an optional hook; sensible defaults apply otherwise.
(function (root) {
  const TI = (root.TI = root.TI || {});

  const ask = async (agent, name, def, ...args) => (agent[name] ? agent[name](...args) : def(...args));
  const homeId = (state, p) => state.map.order.find((id) => state.map.systems[id].home === p.id);

  function readyPlanets(state, p, n) {
    const ex = TI.planetsOwned(state, p).filter((pl) => pl.exhausted).sort((a, b) => (b.res + b.inf) - (a.res + a.inf));
    ex.slice(0, n).forEach((pl) => { pl.exhausted = false; });
  }

  async function buyTokens(state, agents, p) {
    const max = Math.floor((TI.available(state, p).inf + p.tg) / 3);
    if (max <= 0) return;
    let n = await ask(agents[p.id], 'chooseBuyTokens', (s, pl, m) => Math.floor(m / 2), state, p, max);
    n = Math.max(0, Math.min(max, n | 0));
    if (n > 0 && TI.pay(state, p, 3 * n, 'inf')) { TI.log(state, `${p.name} buys ${n} command token(s).`); await TI.giveTokens(state, agents, p, n); }
  }

  // Construction. Primary: one PDS or space dock, then one more PDS. Secondary: spend a token, place it in a system,
  // and put a PDS or dock on a planet you control there. Each planet holds one dock and two PDS; the supply is
  // 3 docks and 6 PDS (rules 23, 74, 22).
  async function placeStructures(state, agents, p, count, opts) {
    opts = opts || {};
    const defaults = (s, pl, c) => {
      const out = [];
      const mine = TI.planetsOwned(s, pl).sort((a, b) => (b.res + b.inf) - (a.res + a.inf));
      const tally = (pla, kind) => out.filter((o) => s.map.systems[o.systemId].planets[o.planetIdx] === pla && o.kind === kind).length;
      for (const planet of mine) {
        if (out.length >= 1) break;
        if (!planet.dock && TI.unitsLeft(s, pl, 'dock') > 0) out.push({ systemId: planet.systemId, planetIdx: s.map.systems[planet.systemId].planets.indexOf(planet), kind: 'dock' });
      }
      for (const planet of mine) {
        if (out.length >= c) break;
        if ((planet.pds || 0) + tally(planet, 'pds') < TI.pdsCap()) out.push({ systemId: planet.systemId, planetIdx: s.map.systems[planet.systemId].planets.indexOf(planet), kind: 'pds' });
      }
      return out;
    };
    const wanted = (await ask(agents[p.id], 'chooseStructures', defaults, state, p, count, opts)) || [];
    let placed = 0;
    for (const w of wanted) {
      if (placed >= count) break;
      const sys = state.map.systems[w.systemId];
      const planet = sys && sys.planets[w.planetIdx];
      if (!planet || planet.owner !== p.id) continue;
      if (opts.system && w.systemId !== opts.system) continue;
      if (placed >= 1 && opts.restSecond === 'pds' && w.kind !== 'pds') continue;      // the "additional" structure is a PDS
      if (planet.dmz) continue;
      if (w.kind === 'dock' && !planet.dock && TI.unitsLeft(state, p, 'dock') > 0) { planet.dock = true; if (TI.lawOwner(state, 'minister_of_industry') === p.id && !planet.holy) { const order = (await ask(agents[p.id], 'chooseProduction', (s, pl) => [], state, p, w.systemId)) || []; const built = TI.produce(state, p, w.systemId, order); if (built.length) TI.log(state, `${p.name}'s Minister of Industry lets the new dock produce ${built.map((u) => u.type).join(', ')}.`); } }
      else if (w.kind === 'pds' && (planet.pds || 0) < TI.pdsCap() && TI.unitsLeft(state, p, 'pds') > 0) planet.pds = (planet.pds || 0) + 1;
      else continue;
      placed++;
      TI.log(state, `${p.name} builds a ${w.kind === 'dock' ? 'space dock' : 'PDS'} on ${planet.name}.`);
    }
    return placed;
  }

  const TECH_ORDER = ['antimass', 'gravity_drive', 'fleet_logistics', 'light_wave', 'sarween', 'graviton', 'transit_diodes', 'integrated_economy',
                      'neural', 'dacxive', 'hyper_metabolism', 'x89', 'plasma_scoring', 'magen', 'duranium', 'assault',
                      'fighter2', 'cruiser2', 'carrier2', 'destroyer2', 'dreadnought2', 'infantry2', 'pds2', 'spacedock2', 'war_sun'];

  async function research(state, agents, p, cost, label) {
    if (TI.faction(p).ability.propagation) {   // Nekro Virus: Propagation
      TI.log(state, `${p.name} cannot research: Propagation gives 3 command tokens instead.`);
      await TI.giveTokens(state, agents, p, 3);
      return;
    }
    const options = TECH_ORDER.concat(TI.faction(p).factionTechs || []).filter((t) => TI.canResearch(p, t, state));
    if (!options.length) return;
    const price = Math.max(0, cost - (TI.faction(p).ability.techDiscount || 0));
    if (price > 0 && TI.available(state, p).res + p.tg < price) return;
    const afford = (t) => !TI.researchPlan(state, p, t).inherit || TI.available(state, p).res + p.tg >= price + 2;
    for (let i = options.length - 1; i >= 0; i--) if (!afford(options[i])) options.splice(i, 1);
    if (!options.length) return;
    let pick = await ask(agents[p.id], 'chooseTech', (s, pl, opts) => opts[0], state, p, options, price);
    if (!options.includes(pick)) pick = pick === null ? null : options[0];
    if (!pick) return;
    const spec = TI.spendSpecialties(state, p, pick);           // exhaust planets whose specialty covers a missing prerequisite
    if (price > 0 && !TI.pay(state, p, price, 'res')) { spec.forEach((pl) => { pl.exhausted = false; }); return; }
    if (spec.length) TI.log(state, `${p.name} exhausts ${spec.map((pl) => pl.name).join(', ')} to ignore prerequisites.`);
    p.techs.push(pick);
    TI.refreshStats(p);
    TI.log(state, `${p.name} researches ${TI.TECHS[pick].name}${label ? ` (${label})` : ''}.`);
    if (TI.rules && TI.rules.antiResearch) {            // Anti-Intellectual Revolution
      const all = []; for (const id of state.map.order) (state.map.systems[id].ships[p.id] || []).forEach((u) => { if (u.type !== 'fighter') all.push({ id, u }); });
      if (all.length) {
        const list = all.map((x) => x.u);
        let u = agents && agents[p.id] && agents[p.id].chooseShipToDestroy ? await agents[p.id].chooseShipToDestroy(state, p, list) : null;
        if (!list.includes(u)) u = list.slice().sort((a, b) => TI.UNITS[a.type].cost - TI.UNITS[b.type].cost)[0];
        const at = all.find((x) => x.u === u), arr = state.map.systems[at.id].ships[p.id]; arr.splice(arr.indexOf(u), 1);
        TI.trimCargo(state, p, state.map.systems[at.id]);
        TI.log(state, `${p.name} must destroy a ${u.type} (Anti-Intellectual Revolution).`);
      }
    }
  }

  TI.research = research;
  TI.researchOptions = (state, p) => TECH_ORDER.concat(TI.faction(p).factionTechs || []).filter((t) => TI.canResearch(p, t, state));

  async function produceAtHome(state, agents, p) {
    const sysId = homeId(state, p);
    const order = (await agents[p.id].chooseProduction(state, p, sysId)) || [];
    const built = TI.produce(state, p, sysId, order);
    if (built.length) TI.log(state, `${p.name} produces ${built.map((u) => u.type).join(', ')} at home.`);
  }

  function ministerCommerce(s, p) {
    if (TI.lawOwner(s, 'minister_of_commerce') !== p.id) return;
    const n = TI.neighbors(s, p).length; if (n) { p.tg += n; TI.log(s, `${p.name}'s Minister of Commerce pays ${n} trade good${n === 1 ? '' : 's'}.`); }
  }
  const sciences = (s, p) => TI.lawOwner(s, 'minister_of_sciences') === p.id;

  const HANDLERS = {
    1: { // Leadership
      primary: async (s, a, p) => { await TI.giveTokens(s, a, p, 3); await buyTokens(s, a, p); },
      secondary: async (s, a, p) => { await buyTokens(s, a, p); },
    },
    2: { // Diplomacy: rivals place command tokens in a system you control, so they cannot activate it this round
      primary: async (s, a, p) => {
        const sys = await ask(a[p.id], 'chooseDiplomacySystem', (st, pl) => {
          // Default: the non-Mecatol system with a planet of ours that has the most enemy ships next door.
          const threat = (id) => st.map.systems[id].adj.reduce((n, nb) => n + st.players.filter((o) => o.id !== pl.id).reduce((m, o) => m + (st.map.systems[nb].ships[o.id] || []).length, 0), 0);
          const ids = st.map.order.filter((id) => id !== '0,0' && st.map.systems[id].planets.some((x) => x.owner === pl.id));
          return ids.sort((x, y) => threat(y) - threat(x))[0] || null;
        }, s, p);
        if (sys && s.map.systems[sys] && sys !== '0,0' && s.map.systems[sys].planets.some((x) => x.owner === p.id)) {
          const tk = TI.tokensOn(s.map.systems[sys]);
          for (const o of s.players) if (o.id !== p.id && !tk.includes(o.id)) tk.push(o.id);
          TI.log(s, `${p.name} uses Diplomacy: rivals place command tokens in ${sys} and cannot activate it this round.`);
        }
        readyPlanets(s, p, 2);
        await TI.peaceAccords(s, a, p);
      },
      secondary: async (s, a, p) => { readyPlanets(s, p, 2); await TI.peaceAccords(s, a, p); },
    },
    3: { // Politics
      primary: async (s, a, p) => {
        const pick = await ask(a[p.id], 'chooseSpeaker', (st, pl) => pl.id, s, p);
        if (s.players[pick]) { s.speaker = pick; TI.log(s, `${s.players[pick].name} becomes speaker.`); }
        if (TI.drawActionCards) await TI.drawActionCards(s, a, p, 2, 'Politics');
      },
      secondary: async (s, a, p) => { if (TI.drawActionCards) await TI.drawActionCards(s, a, p, 2, 'Politics'); },
    },
    4: { // Construction
      primary: async (s, a, p) => { await placeStructures(s, a, p, 2, { restSecond: 'pds' }); },
      secondary: async (s, a, p) => {
        // The spent token goes into the system where the structure is built (returned if you already have one there).
        const sysId = await ask(a[p.id], 'chooseConstructionSystem', (st, pl) => {
          const mine = TI.planetsOwned(st, pl).sort((x, y) => (y.res + y.inf) - (x.res + x.inf));
          const pick = mine.find((x) => !x.dock) || mine.find((x) => (x.pds || 0) < TI.pdsCap()) || mine[0];
          return pick ? pick.systemId : null;
        }, s, p);
        if (!sysId || !s.map.systems[sysId]) { p.tokens.strategy++; return; }
        const placed = await placeStructures(s, a, p, 1, { system: sysId });
        if (!placed) { p.tokens.strategy++; return; }
        const tk = TI.tokensOn(s.map.systems[sysId]);
        if (!tk.includes(p.id)) tk.push(p.id);
      },
    },
    5: { // Trade
      primary: async (s, a, p) => {
        p.tg += 3; TI.log(s, `${p.name} gains 3 trade goods.`);
        if (TI.pillage) TI.pillage(s, p);
        TI.replenish(s, p);
        const others = s.players.filter((o) => o.id !== p.id && TI.commOf(o) < TI.commMax(o));
        const pick = (await ask(a[p.id], 'chooseReplenish', (st, me) => TI.botReplenishTargets(st, me), s, p, others)) || [];
        for (const o of pick) if (others.includes(o)) { TI.replenish(s, o, true); TI.log(s, `${p.name} replenishes ${o.name}'s commodities.`); }
        ministerCommerce(s, p);
      },
      secondary: async (s, a, p) => { TI.replenish(s, p); ministerCommerce(s, p); },
    },
    6: { // Warfare: take one command token back from the board, then redistribute; the secondary produces at home
      primary: async (s, a, p) => {
        const sysId = await ask(a[p.id], 'chooseTokenReturn', (st, pl) =>
          st.map.order.find((id) => (st.map.systems[id].tokens || []).includes(pl.id)) || null, s, p);
        if (sysId && s.map.systems[sysId]) {
          const t = s.map.systems[sysId].tokens, i = t.indexOf(p.id);
          if (i >= 0) {
            t.splice(i, 1);
            TI.log(s, `${p.name} takes a command token back from ${sysId}.`);
            await TI.giveTokens(s, a, p, 1);          // the recovered token goes into the pool of the player's choice
          }
        }
        await TI.redistributeTokens(s, a, p);
      },
      secondary: async (s, a, p) => { await produceAtHome(s, a, p); },
    },
    7: { // Technology
      primary: async (s, a, p) => { await research(s, a, p, 0, 'free'); await research(s, a, p, sciences(s, p) ? 0 : 6); },
      secondary: async (s, a, p) => { await research(s, a, p, sciences(s, p) ? 0 : 4); },
    },
    8: { // Imperial
      primary: async (s, a, p) => {
        const el = TI.eligibleObjectives(s, p).pub;
        if (el.length) {
          const pick = await a[p.id].chooseScore(s, p, el, 'pub');
          if (pick && el.includes(pick)) await TI.scoreObjective(s, a, p, pick, 'Imperial');
        }
        if (s.winner !== null) return;
        if (TI.mecatolHeld(s, p) > 0) TI.addVP(s, p, 1, 'holds Mecatol Rex (Imperial)');
        else await TI.drawSecret(s, a, p);
      },
      secondary: async (s, a, p) => { await TI.drawSecret(s, a, p); },
    },
  };

  TI.useStrategyCard = async function (state, agents, p, cardId) {
    const card = state.cards.find((c) => c.id === cardId);
    card.used = true;
    const def = TI.STRATEGY_CARDS[cardId - 1];
    TI.log(state, `${p.name} uses ${def.name} (primary).`);
    await HANDLERS[cardId].primary(state, agents, p);
    const n = state.players.length;
    for (let i = 1; i < n && state.winner === null; i++) {
      const o = state.players[(p.id + i) % n];
      const ab = TI.faction(o).ability;
      const free = cardId === 1 || (cardId === 5 && ab.masterTrade); // Leadership (45.3) costs no token; Hacan: Masters of Trade
      if (o.tokens.strategy <= 0 && !free) continue;
      if (await agents[o.id].wantSecondary(state, o, cardId)) {
        if (!free) o.tokens.strategy--;
        const brilliant = cardId === 7 && ab.brilliant;          // Jol-Nar: Brilliant
        TI.log(state, `${o.name} follows with ${def.name} (${brilliant ? 'primary via Brilliant' : 'secondary'}).`);
        await HANDLERS[cardId][brilliant ? 'primary' : 'secondary'](state, agents, o);
      }
    }
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
