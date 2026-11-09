// Trade: commodities, transactions between neighbors, and the bots' rule-based dealing.
//   p.comm            commodities held (0..faction commodity value). Given away, a commodity becomes a trade good.
//   state.traded      { [playerId]: true } for partners the active player has already dealt with this turn
//   offer             { give: {tg, comm, cards[]}, get: {tg, comm, cards[]} }  (from the proposer's point of view)
(function (root) {
  const TI = (root.TI = root.TI || {});

  const COMM_VALUE = 0.5;       // what a bot thinks a commodity it gives away is worth (it is only worth something once converted)
  const CARD_VALUE = 1.5;       // rough worth of an action card, in trade goods

  TI.commMax = (p) => TI.faction(p).commodities;
  TI.commOf = (p) => p.comm || 0;
  TI.replenish = function (state, p, quiet) {
    const was = TI.commOf(p), max = TI.commMax(p);
    p.comm = max;
    if (!quiet && max > was) TI.log(state, `${p.name} replenishes commodities (${was} → ${max}).`);
    TI.onReplenish && TI.onReplenish(state, p);
    return max - was;
  };

  const empty = () => ({ tg: 0, comm: 0, cards: [] });
  const norm = (s) => ({ tg: Math.max(0, s && s.tg | 0), comm: Math.max(0, s && s.comm | 0), cards: (s && s.cards ? s.cards : []).slice() });
  TI.makeOffer = (give, get) => ({ give: norm(give || empty()), get: norm(get || empty()) });
  const items = (s) => s.tg + s.comm + s.cards.length;

  // Who can negotiate with whom: neighbors, or anyone for Hacan (Guild Ships).
  TI.canDeal = function (state, a, b) {
    if (a.id === b.id) return false;
    if (TI.faction(a).ability.guildShips || TI.faction(b).ability.guildShips) return true;
    return TI.neighbors(state, a).some((o) => o.id === b.id);
  };
  TI.dealPartners = (state, p) => state.players.filter((o) => TI.canDeal(state, p, o) && !(state.traded && state.traded[o.id]));
  // Action cards may change hands only when Hacan (Arbiters) is one of the two.
  TI.cardsAllowed = (a, b) => !!(TI.faction(a).ability.arbiters || TI.faction(b).ability.arbiters);

  // Returns null when the offer is legal, otherwise the reason it is not.
  TI.offerProblem = function (state, from, to, offer) {
    if (!TI.canDeal(state, from, to)) return 'They are not your neighbor.';
    if (items(offer.give) + items(offer.get) === 0) return 'Nothing is offered.';
    if (items(offer.give) === 0 || items(offer.get) === 0) return 'Each side must give something.';
    if (offer.give.tg > from.tg || offer.give.comm > TI.commOf(from)) return `${from.name} cannot afford that.`;
    if (offer.get.tg > to.tg || offer.get.comm > TI.commOf(to)) return `${to.name} cannot afford that.`;
    if ((offer.give.cards.length || offer.get.cards.length) && !TI.cardsAllowed(from, to)) return 'Action cards can only be traded with Hacan.';
    if (offer.give.cards.some((c) => !from.hand.includes(c)) || offer.get.cards.some((c) => !to.hand.includes(c))) return 'A card in the offer is not in that hand.';
    return null;
  };

  const describe = (s) => {
    const out = [];
    if (s.tg) out.push(`${s.tg} trade good${s.tg > 1 ? 's' : ''}`);
    if (s.comm) out.push(`${s.comm} commodit${s.comm > 1 ? 'ies' : 'y'}`);
    s.cards.forEach(() => out.push('an action card'));
    return out.join(' + ') || 'nothing';
  };
  TI.describeSide = describe;

  TI.applyOffer = function (state, from, to, offer) {
    from.tg -= offer.give.tg; from.comm = TI.commOf(from) - offer.give.comm;
    to.tg += offer.give.tg + offer.give.comm;                          // commodities become trade goods
    to.tg -= offer.get.tg; to.comm = TI.commOf(to) - offer.get.comm;
    from.tg += offer.get.tg + offer.get.comm;
    for (const c of offer.give.cards) { from.hand.splice(from.hand.indexOf(c), 1); to.hand.push(c); }
    for (const c of offer.get.cards) { to.hand.splice(to.hand.indexOf(c), 1); from.hand.push(c); }
    state.traded = state.traded || {}; state.traded[to.id] = true;
    state.tradeLog = state.tradeLog || [];
    state.tradeLog.push({ round: state.round, from: from.id, to: to.id, give: describe(offer.give), get: describe(offer.get) });
    if (state.tradeLog.length > 40) state.tradeLog.shift();
    TI.log(state, `TRADE: ${from.name} gives ${describe(offer.give)} to ${to.name} for ${describe(offer.get)}.`);
    TI.onTransaction && TI.onTransaction(state, from, to, offer);
  };

  // ---- bots -------------------------------------------------------------------------------------
  // Value of an offer to `me` (the side that would be receiving `incoming` and paying `outgoing`).
  const valueFor = (incoming, outgoing) =>
    (incoming.tg + incoming.comm + incoming.cards.length * CARD_VALUE) - (outgoing.tg + outgoing.comm * COMM_VALUE + outgoing.cards.length * CARD_VALUE);
  TI.botAcceptsOffer = function (state, me, from, offer) {
    const net = valueFor(offer.give, offer.get);                       // they give → I receive
    if (from.vp >= state.vpToWin - 2 && net < 2) return false;         // do not feed a player about to win
    if (net >= 0.5) return true;
    return net > -0.01 && from.vp <= me.vp;                            // an even swap only helps a player who is not ahead of me
  };
  // A bot with commodities looks for a neighbor holding trade goods and offers a slightly sweetened swap.
  TI.botProposeOffer = function (state, p) {
    if (TI.commOf(p) < 1) return null;
    let best = null;
    for (const o of TI.dealPartners(state, p)) {
      if (o.tg < 1) continue;
      const get = Math.min(o.tg, TI.commOf(p) - 1 >= 1 ? TI.commOf(p) - 1 : 1);
      const give = Math.min(TI.commOf(p), get + 1);
      const offer = TI.makeOffer({ comm: give }, { tg: get });
      if (TI.offerProblem(state, p, o, offer)) continue;
      const mine = valueFor(offer.get, offer.give);
      if (mine < 0.5 || !TI.botAcceptsOffer(state, o, p, offer)) continue;
      const score = mine - o.vp * 0.1;
      if (!best || score > best.score) best = { to: o, offer, score };
    }
    return best;
  };

  // The active player's chance to deal at the start of a turn. Humans open the Trade dialog themselves (see ui).
  TI.negotiate = async function (state, agents, p) {
    state.traded = {}; state.turnPlayer = p.id;
    if (!p.bot) return;
    const agent = agents[p.id];
    for (let i = 0; i < 2; i++) {
      const prop = agent && agent.proposeTrade ? await agent.proposeTrade(state, p) : TI.botProposeOffer(state, p);
      if (!prop) break;
      await TI.propose(state, agents, p, prop.to, prop.offer);
    }
  };

  // Put an offer to a player and apply it if they agree. Returns true when the deal was made.
  TI.propose = async function (state, agents, from, to, offer) {
    if (TI.offerProblem(state, from, to, offer) || (state.traded && state.traded[to.id])) return false;
    const agent = agents && agents[to.id];
    const yes = agent && agent.wantTransaction ? await agent.wantTransaction(state, to, from, offer) : TI.botAcceptsOffer(state, to, from, offer);
    if (!yes) { TI.log(state, `${to.name} turns down ${from.name}'s offer of ${describe(offer.give)} for ${describe(offer.get)}.`); return false; }
    TI.applyOffer(state, from, to, offer);
    return true;
  };

  // ---- Mentak-style hook points are filled by abilities.js; Trade strategy card helpers --------------
  // Which other players a bot replenishes with its Trade primary: anyone not ahead of it (it wants trading partners, not rivals).
  TI.botReplenishTargets = (state, p) => state.players.filter((o) => o.id !== p.id && TI.commOf(o) < TI.commMax(o) && o.vp <= p.vp + 1);

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
