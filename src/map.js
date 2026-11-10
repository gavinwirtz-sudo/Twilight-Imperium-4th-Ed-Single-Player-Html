// Galaxy: a 3-ring hex map (37 systems) with Mecatol Rex at the centre and home systems on
// the outer corners. System contents are generated here (original names, balanced stat mix).
(function (root) {
  const TI = (root.TI = root.TI || {});

  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const hkey = (q, r) => q + ',' + r;

  // Hexes at distance n from the centre, walking the ring from corner 0.
  function ring(n) {
    if (n === 0) return [[0, 0]];
    const out = [];
    let q = n, r = 0;
    for (let side = 0; side < 6; side++) {
      const d = DIRS[(side + 2) % 6];
      for (let i = 0; i < n; i++) { out.push([q, r]); q += d[0]; r += d[1]; }
    }
    return out;
  }
  TI.hexRing = ring;

  // ---- procedural system contents -------------------------------------------------------
  const SYL_A = ['Ar', 'Bel', 'Cor', 'Dra', 'El', 'Fen', 'Gal', 'Hes', 'Ist', 'Jor', 'Kal', 'Lor',
                 'Mir', 'Nar', 'Ost', 'Pol', 'Quen', 'Rhe', 'Sol', 'Tav', 'Ul', 'Vor', 'Wen', 'Xan', 'Yor', 'Zan'];
  const SYL_B = ['dun', 'ria', 'tos', 'vex', 'mar', 'lis', 'pha', 'nor', 'quil', 'thar', 'den', 'sa', 'kor', 'lyn'];
  const SYL_C = ['', ' Prime', ' II', ' III', ' Minor', ' Reach'];

  function nameGen(rng) {
    const used = new Set();
    return () => {
      for (let i = 0; i < 500; i++) {
        const n = rng.pick(SYL_A) + rng.pick(SYL_B) + rng.pick(SYL_C);
        if (!used.has(n)) { used.add(n); return n; }
      }
      return 'Planet' + used.size;
    };
  }

  // [resources, influence] with rough frequency weights (balanced like the real tile mix).
  const PLANET_STATS = [[1, 1], [2, 0], [0, 2], [1, 2], [2, 1], [3, 0], [0, 3], [2, 2], [4, 0], [1, 0], [0, 1]];
  const PLANET_W = [4, 4, 4, 3, 3, 2, 2, 2, 1, 2, 2];

  function pickStats(rng, small) {
    for (;;) {
      let t = rng.int(PLANET_W.reduce((a, b) => a + b, 0)), i = 0;
      while (t >= PLANET_W[i]) { t -= PLANET_W[i]; i++; }
      const s = PLANET_STATS[i];
      if (!small || s[0] + s[1] <= 2) return s;
    }
  }

  function buildSystemPool(rng, count) {
    const name = nameGen(rng);
    const planet = (small) => { const s = pickStats(rng, small); return { name: name(), res: s[0], inf: s[1], owner: null, ground: [], pds: 0, dock: false, exhausted: false }; };
    const specs = [];
    for (let i = 0; i < 18; i++) specs.push({ planets: [planet(false)] });
    for (let i = 0; i < 6; i++) specs.push({ planets: [planet(true), planet(true)] });
    for (let i = 0; i < 3; i++) specs.push({ planets: [], anomaly: 'asteroid' });
    for (let i = 0; i < 2; i++) specs.push({ planets: [], anomaly: 'nebula' });
    specs.push({ planets: [], anomaly: 'supernova' });
    specs.push({ planets: [], wormhole: 'alpha' }, { planets: [], wormhole: 'alpha' });
    specs.push({ planets: [], wormhole: 'beta' }, { planets: [], wormhole: 'beta' });
    // 18+6+3+2+1+4 = 34 so far; two empty deep-space systems make it 36.
    specs.push({ planets: [] }, { planets: [] });
    return rng.shuffle(specs).slice(0, count);
  }

  // ---- real galaxy: preset maps, random setups and balancing -----------------------------------
  // Tiles come from TI.REAL_TILES (src/tiles.js). Three modes for 3-6 players:
  //   'preset'   the booklet's printed galaxy (pp. 22-23)
  //   'random'   the same slot shape with the tiles shuffled, obeying the setup rules
  //              (no two anomalies adjacent, no two matching wormholes adjacent)
  //   'balanced' random, then improved by swapping tiles until every home system has a similar
  //              score (a port of the Map Lab "home value" evaluation)
  const ANOMALY_NAME = { asteroid_field: 'asteroid', gravity_rift: 'rift', nebula: 'nebula', supernova: 'supernova' };
  const tileById = (id) => TI.REAL_TILES.find((t) => t.id === id);
  const planetOf = (p) => ({ name: p.name, res: p.res, inf: p.inf, trait: p.trait, tech: p.tech, owner: null, ground: [], pds: 0, dock: false, exhausted: false });
  const tileSpec = (t) => ({
    tile: t.id,
    planets: t.planets.map((p) => Object.assign(planetOf(p), t.id === 18 ? { mecatol: true } : {})),
    anomaly: t.anomaly ? ANOMALY_NAME[t.anomaly] : null,
    wormhole: t.wormhole || null,
    mecatol: t.id === 18,
  });
  const HEX_DIST = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[0] + a[1] - b[0] - b[1]));
  const NEIGH = DIRS;

  // Seats are dealt clockwise (as the table sees the board) from the top-left home.
  function sortHomes(homes) {
    const ang = (h) => { const x = Math.sqrt(3) * (h[0] + h[1] / 2), y = 1.5 * h[1]; return (Math.atan2(y, x) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI); };
    return homes.slice().sort((a, b) => ang(a) - ang(b));
  }

  // ---- balance evaluation (Map Lab "Joebrew" weights) ----
  const EV = {
    base: -1, res: 3, inf: 2, tech: 5, nonzero: 1, multi: 1, matching: 1, mecatol: 6,
    distBase: 2, distNebula: 1, distEmptyWormhole: 1,
    mult: [6, 6, 6, 4, 4, 2, 1, 0, 0, 0, 0],
  };
  function planetValue(p) {
    const t = p.tech ? EV.tech : 0;
    let v = EV.base + Math.max(p.res * EV.res, p.inf * EV.inf, t);
    if (p.res > 0) v += EV.nonzero;
    if (p.inf > 0) v += EV.nonzero;
    return v;
  }
  function systemValue(sys) {
    let v = 0;
    for (const p of sys.planets) v += planetValue(p);
    if (sys.planets.length === 2) { v += EV.multi; if (sys.planets[0].trait && sys.planets[0].trait === sys.planets[1].trait) v += EV.matching; }
    if (sys.mecatol) v += EV.mecatol;
    return v;
  }
  // Cost of passing through / ending in a system, or null if ships cannot enter it.
  function stepCost(sys, viaWormhole) {
    if (sys.anomaly === 'supernova' || sys.anomaly === 'asteroid') return null;
    let c = EV.distBase;
    if (sys.anomaly === 'nebula') c += EV.distNebula;
    else if (!sys.anomaly && !sys.planets.length && viaWormhole && sys.wormhole) c += EV.distEmptyWormhole;
    return c;
  }
  // Score of one home system: sum of (system value x weight for its travel cost) over nearby systems.
  TI.homeValue = function (map, homeId) {
    const S = map.systems, home = S[homeId], best = { [homeId]: 0 }, queue = [homeId];
    while (queue.length) {
      queue.sort((a, b) => best[a] - best[b]);
      const id = queue.shift(), here = S[id];
      if (id !== homeId && (here.home !== null || here.anomaly === 'nebula')) continue; // other homes and nebulae end a route
      for (const n of here.adj) {
        const t = S[n];
        if (t.home !== null) continue;
        const wh = !(Math.abs(t.q - here.q) <= 1 && Math.abs(t.r - here.r) <= 1 && Math.abs(t.q - here.q + t.r - here.r) <= 1);
        const c = stepCost(t, wh);
        if (c === null) continue;
        const nd = best[id] + c;
        if (best[n] === undefined || nd < best[n]) { best[n] = nd; queue.push(n); }
      }
    }
    let total = 0;
    for (const id of Object.keys(best)) {
      if (id === homeId) continue;
      const t = S[id];
      if (HEX_DIST([home.q, home.r], [t.q, t.r]) >= 5) continue;
      const v = systemValue(t);
      if (v > 0) total += EV.mult[Math.min(EV.mult.length - 1, best[id])] * v;
    }
    return total;
  };
  TI.homeValues = (map) => map.order.filter((id) => map.systems[id].home !== null).map((id) => TI.homeValue(map, id));
  TI.mapSpread = function (values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return mean ? (Math.max(...values) - Math.min(...values)) / mean : 0;
  };
  // Setup-rule violations: adjacent anomaly pairs plus adjacent same-type wormhole pairs.
  TI.mapViolations = function (map) {
    let n = 0;
    for (const a of map.order) {
      const A = map.systems[a];
      for (const b of A.adj) {
        if (b <= a) continue;
        const B = map.systems[b];
        const hex = Math.abs(B.q - A.q) <= 1 && Math.abs(B.r - A.r) <= 1 && Math.abs(B.q - A.q + B.r - A.r) <= 1;
        if (!hex) continue; // wormhole links are not tile adjacency
        if (A.anomaly && B.anomaly) n++;
        if (A.wormhole && A.wormhole === B.wormhole) n++;
      }
    }
    return n;
  };

  // Choose which tiles are in the game: the printed galaxy for the player count decides how many blue
  // and red tiles are used; anything left over is dropped at random (wormhole tiles are always kept in pairs).
  function pickTiles(n, rng) {
    const slots = TI.REAL_PRESETS[n].filter((h) => h[2] !== 0 && h[2] !== 18);
    const presetIds = slots.map((h) => h[2]);
    const blueNeed = presetIds.filter((id) => tileById(id).kind === 'blue').length;
    const redNeed = presetIds.length - blueNeed;
    const keep = (kind, need, pinned) => {
      const all = TI.REAL_TILES.filter((t) => t.kind === kind).map((t) => t.id);
      const pin = all.filter((id) => pinned.includes(id)), rest = rng.shuffle(all.filter((id) => !pinned.includes(id)));
      return pin.concat(rest).slice(0, need);
    };
    return keep('blue', blueNeed, [25, 26]).concat(keep('red', redNeed, [39, 40]));
  }

  // Build a { q,r -> spec } placement from a tile list, shuffled into the free slots.
  function shuffledPlacement(n, rng) {
    const preset = TI.REAL_PRESETS[n];
    const free = preset.filter((h) => h[2] !== 0 && h[2] !== 18).map((h) => [h[0], h[1]]);
    const ids = rng.shuffle(pickTiles(n, rng));
    const placement = {};
    free.forEach((h, i) => { placement[hkey(h[0], h[1])] = ids[i]; });
    return placement;
  }

  function buildRealMap(n, rng, homePlanets, mode) {
    const preset = TI.REAL_PRESETS[n];
    const homesAll = sortHomes(preset.filter((h) => h[2] === 0).map((h) => [h[0], h[1]]));
    const rot = rng.int(homesAll.length); // which table position seat 0 takes
    const homeFor = (seat) => homesAll[(seat + rot) % homesAll.length];
    const homeAt = {};
    homesAll.forEach((h, i) => { homeAt[hkey(h[0], h[1])] = ((i - rot) % homesAll.length + homesAll.length) % homesAll.length; });

    const assemble = (placement) => {
      const systems = {}, order = [];
      const add = (q, r, extra) => {
        const id = hkey(q, r);
        systems[id] = Object.assign({ id, q, r, planets: [], anomaly: null, wormhole: null, home: null, ships: {} }, extra);
        order.push(id);
      };
      for (const h of preset) {
        const id = hkey(h[0], h[1]);
        if (h[2] === 18) add(h[0], h[1], tileSpec(tileById(18)));
        else if (h[2] === 0) {
          const seat = homeAt[id];
          const planets = (homePlanets[seat] || [{ name: 'Home ' + seat, res: 2, inf: 0 }]).map((p) =>
            Object.assign({ owner: null, ground: [], pds: 0, dock: false, exhausted: false }, p));
          add(h[0], h[1], { planets, home: seat });
        } else add(h[0], h[1], tileSpec(tileById(placement[id] !== undefined ? placement[id] : h[2])));
      }
      const map = { systems, order, playerCount: n, mode };
      TI.buildAdjacency(map);
      return map;
    };

    let placement = {};
    if (mode === 'preset') preset.forEach((h) => { if (h[2] !== 0 && h[2] !== 18) placement[hkey(h[0], h[1])] = h[2]; });
    else {
      placement = shuffledPlacement(n, rng);
      const cost = (pl) => {
        const m = assemble(pl);
        const viol = TI.mapViolations(m);
        if (mode === 'random') return viol * 1000;
        return viol * 1000 + TI.mapSpread(TI.homeValues(m)) * 100;
      };
      const keys = Object.keys(placement);
      let cur = cost(placement), temp = 4;
      const iters = mode === 'random' ? 1500 : 2500;
      for (let it = 0; it < iters; it++) {
        if (mode === 'random' && cur === 0) break;
        const a = keys[rng.int(keys.length)], b = keys[rng.int(keys.length)];
        if (a === b) continue;
        [placement[a], placement[b]] = [placement[b], placement[a]];
        const c = cost(placement);
        if (c <= cur || rng.next() < Math.exp((cur - c) / temp)) cur = c;
        else [placement[a], placement[b]] = [placement[b], placement[a]];
        temp = Math.max(0.05, temp * 0.998);
      }
    }
    const map = assemble(placement);
    map.homeValues = TI.homeValues(map);
    map.spread = TI.mapSpread(map.homeValues);
    const bonus = (TI.HOME_BONUS && TI.HOME_BONUS[n]) || {};
    map.homeBonus = {};
    for (const [key, seat] of Object.entries(homeAt)) if (bonus[key]) map.homeBonus[seat] = bonus[key];
    return map;
  }

  // ---- map construction --------------------------------------------------------------------
  // homePlanets[i] = array of {name,res,inf} for player i's home system.
  // opts.mode: 'preset' (default) | 'random' | 'balanced' for 3-6 players; two-player games use a generated galaxy.
  TI.generateMap = function (playerCount, rng, homePlanets, opts) {
    const mode = (opts && opts.mode) || 'preset';
    if (playerCount >= 3 && playerCount <= 6 && TI.REAL_PRESETS) return buildRealMap(playerCount, rng, homePlanets, mode);
    const systems = {};
    const order = []; // ids
    const add = (q, r, extra) => {
      const id = hkey(q, r);
      systems[id] = Object.assign({ id, q, r, planets: [], anomaly: null, wormhole: null, home: null, ships: {} }, extra);
      order.push(id);
      return systems[id];
    };

    // Mecatol Rex
    add(0, 0, { planets: [{ name: 'Mecatol Rex', res: 1, inf: 6, owner: null, ground: [], pds: 0, dock: false, exhausted: false, mecatol: true }], mecatol: true });

    const cornerSeats = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] }[playerCount];
    if (!cornerSeats) throw new Error('Supported player counts: 2-6');
    const corners = new Set(cornerSeats.map((i) => hkey(...ring(3).filter((_, idx) => idx % 3 === 0)[i])));

    const others = [];
    for (const n of [1, 2, 3]) for (const [q, r] of ring(n)) if (!corners.has(hkey(q, r))) others.push([q, r]);
    const pool = buildSystemPool(rng, others.length);
    others.forEach(([q, r], i) => {
      const spec = pool[i];
      add(q, r, {
        planets: spec.planets.map((p) => Object.assign({}, p)),
        anomaly: spec.anomaly || null,
        wormhole: spec.wormhole || null,
      });
    });

    // Home systems
    cornerSeats.forEach((cornerIdx, seat) => {
      const [q, r] = ring(3).filter((_, idx) => idx % 3 === 0)[cornerIdx];
      const planets = (homePlanets[seat] || [{ name: 'Home ' + seat, res: 2, inf: 0 }]).map((p) =>
        Object.assign({ owner: null, ground: [], pds: 0, dock: false, exhausted: false }, p));
      add(q, r, { planets, home: seat });
    });

    const map = { systems, order, playerCount };
    TI.buildAdjacency(map);
    return map;
  };

  // Adjacency = hex neighbours + paired wormholes of the same type.
  TI.buildAdjacency = function (map) {
    const S = map.systems;
    for (const id of map.order) {
      const s = S[id];
      s.adj = [];
      for (const [dq, dr] of DIRS) {
        const n = hkey(s.q + dq, s.r + dr);
        if (S[n]) s.adj.push(n);
      }
    }
    for (const a of map.order) {
      if (!S[a].wormhole && !S[a].delta && !S[a].flagDelta) continue;
      for (const b of map.order) {
        if (a === b || S[a].adj.includes(b)) continue;
        if ((S[a].wormhole && S[b].wormhole === S[a].wormhole) || ((S[a].delta || S[a].flagDelta) && (S[b].delta || S[b].flagDelta))) S[a].adj.push(b);   // delta: Creuss wormhole tokens
      }
    }
  };

  const shipsIn = (sys, player) => (sys.ships[player] || []);
  const hasOther = (sys, player) => Object.keys(sys.ships).some((p) => +p !== player && sys.ships[p].length > 0);
  TI.shipsIn = shipsIn;
  TI.hasOtherShips = hasOther;

  // All systems a ship with `move` can reach from `fromId`.
  //  - cannot pass through (or into) asteroid fields (unless opts.throughAsteroids) or supernovas
  //  - nebulae can be entered only as the final stop
  //  - cannot pass through systems holding another player's ships (can end there to fight)
  //  - opts.freeWormhole: hopping along a wormhole link costs no movement
  // Returns { systemId: distance }.
  TI.reachable = function (map, fromId, move, player, opts) {
    opts = opts || {};
    const S = map.systems, dist = { [fromId]: 0 };
    const isHex = (a, b) => Math.abs(a.q - b.q) <= 1 && Math.abs(a.r - b.r) <= 1 && Math.abs((a.q - b.q) + (a.r - b.r)) <= 1;
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of Object.keys(dist)) {
        const d = dist[id], here = S[id];
        if (d > move) continue;
        if (id !== fromId && ((here.anomaly === 'nebula' && !(TI.rules && TI.rules.nebulaThrough)) || (hasOther(here, player) && !opts.throughShips))) continue;
        if (opts.avoidRift && here.anomaly === 'rift') continue; // route planning that must not touch a rift
        let nbrs = here.adj;
        const R = TI.rules || {};
        if (R.noWormholes) nbrs = nbrs.filter((k) => isHex(here, S[k]));                        // Enforced Travel Ban
        if (R.wormholeLink && here.wormhole) opts = Object.assign({}, opts, { wormholeLink: true });   // Wormhole Reconstruction
        // Winnu Lazax Gate Folding: Mecatol Rex counts as an alpha and beta wormhole (the player passes opts.lazax while it is not theirs).
        if (opts.lazax) {
          if (here.wormhole) nbrs = nbrs.concat(['0,0'].filter((k) => k !== id && !here.adj.includes(k)));
          if (id === '0,0') nbrs = nbrs.concat(Object.keys(S).filter((k) => S[k].wormhole && !here.adj.includes(k)));
        }
        // Lost Star Chart: alpha and beta wormhole systems count as adjacent to each other.
        if (opts.wormholeLink && here.wormhole) nbrs = nbrs.concat(Object.keys(S).filter((k) => S[k].wormhole && S[k].wormhole !== here.wormhole && !here.adj.includes(k)));
        for (const n of nbrs) {
          const t = S[n];
          if ((t.anomaly === 'supernova' && !opts.throughSupernova) || (t.anomaly === 'asteroid' && !opts.throughAsteroids)) continue;
          const wormholeHop = opts.freeWormhole && !(TI.rules && TI.rules.noWormholes) && here.wormhole && here.wormhole === t.wormhole && !isHex(here, t);
          // Gravity rift: a ship moving out of or through it gets +1 movement (the hop out is free).
          const nd = d + (wormholeHop || (here.anomaly === 'rift' && !opts.avoidRift) ? 0 : 1);
          if (nd <= move && (dist[n] === undefined || nd < dist[n])) { dist[n] = nd; changed = true; }
        }
      }
    }
    return dist;
  };

  // Does a ship moving fromId -> targetId have to leave or cross a gravity rift? (Then it rolls: 1-3 is destroyed.)
  TI.riftExposure = function (map, fromId, targetId, move, player, opts) {
    if (map.systems[fromId].anomaly === 'rift') return true;
    const safe = TI.reachable(map, fromId, move, player, Object.assign({}, opts, { avoidRift: true }));
    return safe[targetId] === undefined;
  };

  TI.systemDistance = function (map, a, b) {
    const S = map.systems, seen = { [a]: 0 }, q = [a];
    while (q.length) {
      const id = q.shift();
      if (id === b) return seen[id];
      for (const n of S[id].adj) if (seen[n] === undefined) { seen[n] = seen[id] + 1; q.push(n); }
    }
    return Infinity;
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
