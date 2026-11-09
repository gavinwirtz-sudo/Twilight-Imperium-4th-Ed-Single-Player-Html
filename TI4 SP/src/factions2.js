// The other eleven base-game factions, transcribed from the same faction booklet as data.js.
// Engine hooks for their abilities live in src/abilities2.js; anything not run by the engine says so in its sheet entry.
(function (root) {
  const TI = (root.TI = root.TI || {});
  const inf = (n) => Array.from({ length: n }, () => 'infantry');
  const rep = (t, n) => Array.from({ length: n }, () => t);
  const NOTE = 'Not modeled.';

  const F = [
    { id: 'arborec', name: 'Arborec', difficulty: 'High',
      blurb: 'Slow start, grows an infantry carpet: a free infantry every status phase, tough to dislodge.',
      planets: [{ name: 'Nestphar', res: 3, inf: 2 }], commodities: 3,
      start: { ships: ['carrier', 'fighter', 'fighter', 'cruiser'], ground: inf(4), pds: 1 },
      techs: ['magen'],
      ability: { mitosis: true, noDockInfantry: true },
      flagship: { name: 'Duha Menaimon', cost: 8, combat: 7, dice: 2, move: 1, cap: 5, sustain: true, production: 5 },
      units: {}, unitNames: { infantry: 'Letani Warrior' },
      factionTechs: ['letani2', 'bioplasmosis'],
      techPlan: ['letani2', 'sarween', 'cruiser2', 'pds2'],
      sheet: [
        { name: 'Mitosis', text: 'Your space docks cannot produce infantry. At the start of the status phase place 1 infantry from reinforcements on any planet you control.', modeled: true },
        { name: 'Duha Menaimon (flagship)', text: 'Cost 8, combat 7x2, move 1, capacity 5, sustain damage. After you activate this system you may produce up to 5 units in this system (no space dock needed; ground forces need a planet of yours there).', modeled: true },
        { name: 'Letani Warrior', text: 'Cost 1(2), combat 8, Production 1 (the Production part is not modeled). Letani Warrior II (GG): combat 7; after it is destroyed roll 1 die, on 6+ it returns to your home system at the start of your next turn.', modeled: true },
        { name: 'Bioplasmosis (GG)', text: 'At the end of the status phase you may remove any number of infantry from planets you control and place them on 1 or more planets you control in the same or adjacent systems.', modeled: true },
        { name: 'Starting techs', text: 'Magen Defense Grid.', modeled: true },
        { name: 'Stymie (promissory note)', text: NOTE, modeled: false },
      ] },

    { id: 'saar', name: 'Clan of Saar', difficulty: 'High',
      blurb: 'Nomads: no home to defend, a trade good for every planet taken, a flagship with a heavy fighter barrage.',
      planets: [{ name: 'Ragh', res: 2, inf: 1 }, { name: 'Lisis II', res: 1, inf: 0 }], commodities: 3,
      start: { ships: ['carrier', 'carrier', 'fighter', 'fighter', 'cruiser'], ground: inf(4) },
      techs: ['antimass'],
      ability: { scavenge: true, nomadic: true },
      flagship: { name: 'Son of Ragh', cost: 8, combat: 5, dice: 2, move: 1, cap: 3, sustain: true, afb: { value: 6, dice: 4 } },
      units: {}, unitNames: {},
      factionTechs: ['floating_factory2', 'chaos_mapping'],
      techPlan: ['chaos_mapping', 'sarween', 'carrier2', 'floating_factory2'],
      sheet: [
        { name: 'Scavenge', text: 'After you gain control of a planet, gain 1 trade good.', modeled: true },
        { name: 'Nomadic', text: 'You can score objectives even if you do not control the planets in your home system.', modeled: true },
        { name: 'Son of Ragh (flagship)', text: 'Cost 8, combat 5x2, move 1, capacity 3, sustain damage, anti-fighter barrage 6x4.', modeled: true },
        { name: 'Floating Factory', text: 'A space unit with Production 5 that moves like a ship (Floating Factory II (YY): move 2, capacity 5, production 7). Not modeled: Saar builds with ordinary space docks.', modeled: false },
        { name: 'Chaos Mapping (B)', text: 'At the start of your turn in the action phase you may produce 1 unit in a system that contains a unit of yours with Production. (The asteroid-field blockade part is not modeled.)', modeled: true },
        { name: 'Starting techs', text: 'Antimass Deflectors.', modeled: true },
        { name: 'Ragh\'s Call (promissory note)', text: NOTE, modeled: false },
      ] },

    { id: 'muaat', name: 'Embers of Muaat', difficulty: 'High',
      blurb: 'Begins with a war sun; forges extra ships, sails through supernovas.',
      planets: [{ name: 'Muaat', res: 4, inf: 1 }], commodities: 4,
      start: { ships: ['warsun', 'fighter', 'fighter'], ground: inf(4) },
      techs: ['plasma_scoring'],
      ability: { warsunStart: true, gashlai: true, starForge: true },
      flagship: { name: 'The Inferno', cost: 8, combat: 5, dice: 2, move: 1, cap: 3, sustain: true, inferno: true },
      units: { warsun: { cost: 12, combat: 3, dice: 3, move: 1, cap: 6, sustain: true, bombard: { value: 3, dice: 3 } } },
      unitNames: { warsun: 'Prototype War Sun' },
      factionTechs: ['prototype_war_sun2', 'magmus_reactor'],
      techPlan: ['magmus_reactor', 'prototype_war_sun2', 'sarween', 'dreadnought2'],
      sheet: [
        { name: 'Star Forge', text: 'Action: spend 1 token from your strategy pool to place either 2 fighters or 1 destroyer from your reinforcements in a system that contains 1 or more of your war suns.', modeled: true },
        { name: 'Gashlai Physiology', text: 'Your ships can move through supernovas.', modeled: true },
        { name: 'The Inferno (flagship)', text: 'Cost 8, combat 5x2, move 1, capacity 3, sustain damage. Action: spend 1 token from your strategy pool to place 1 cruiser in this unit\'s system.', modeled: true },
        { name: 'Prototype War Sun', text: 'Cost 12, combat 3x3, move 1, capacity 6, sustain damage, bombard 3x3. You can build it without researching War Sun. Prototype War Sun II (RRRY): cost 10, move 3. (Other players\' planetary shields: there are none in this game.)', modeled: true },
        { name: 'Magmus Reactor (RR)', text: 'Your ships can move into supernovas. After 1 or more of your units use Production in a system that contains a war sun or is adjacent to a supernova, gain 1 trade good.', modeled: true },
        { name: 'Starting techs', text: 'Plasma Scoring.', modeled: true },
        { name: 'Fires of the Gashlai (promissory note)', text: NOTE, modeled: false },
      ] },

    { id: 'creuss', name: 'Ghosts of Creuss', difficulty: 'High',
      blurb: 'Wormhole masters: their own wormhole (Delta) links systems, and ships starting at a wormhole move farther.',
      planets: [{ name: 'Creuss', res: 4, inf: 2 }], commodities: 4,
      start: { ships: ['carrier', 'fighter', 'fighter', 'destroyer', 'destroyer'], ground: inf(4) },
      techs: ['gravity_drive'],
      ability: { entangle: true, slipstream: true, creussHome: true },
      flagship: { name: 'Hil Colish', cost: 8, combat: 5, dice: 1, move: 1, cap: 3, sustain: true, wormhole: true },
      units: {}, unitNames: {},
      factionTechs: ['wormhole_generator', 'dimensional_splicer'],
      techPlan: ['wormhole_generator', 'dimensional_splicer', 'carrier2', 'dreadnought2'],
      sheet: [
        { name: 'Quantum Entanglement', text: 'You treat all systems that contain either an alpha or a beta wormhole as adjacent to each other.', modeled: true },
        { name: 'Slipstream', text: 'During your tactical actions, apply +1 to the move value of each of your ships that starts its movement in your home system or in a system that contains an alpha or beta wormhole.', modeled: true },
        { name: 'Creuss Gate', text: 'The real game places the Creuss Gate where a home would be and the home system off the board. Here your home system sits on the board as usual and carries a Delta wormhole that every player\'s ships can use.', modeled: false },
        { name: 'Hil Colish (flagship)', text: 'Cost 8, combat 5x1, move 1, capacity 3, sustain damage. The system that contains it counts as having a Delta wormhole, so it links to your home and every other Delta system. (The move-order part is not modeled.)', modeled: true },
        { name: 'Wormhole Generator (BB)', text: 'At the start of the status phase, place or move a Delta wormhole token into a system that contains a planet you control or a non-home system with no other player\'s ships.', modeled: true },
        { name: 'Dimensional Splicer (R)', text: 'At the start of a space combat in a system that contains a wormhole and 1 or more of your ships, you may produce 1 hit and assign it to 1 of your opponent\'s ships.', modeled: true },
        { name: 'Starting techs', text: 'Gravity Drive.', modeled: true },
        { name: 'Creuss IFF (promissory note)', text: NOTE, modeled: false },
      ] },

    { id: 'l1z1x', name: 'L1Z1X Mindnet', difficulty: 'Low',
      blurb: 'Dreadnought swarm: cheap Super-Dreadnoughts, bombardment during ground fights, assimilates captured structures.',
      planets: [{ name: 'Mindnet', res: 5, inf: 0 }], commodities: 2,
      start: { ships: ['carrier', 'fighter', 'fighter', 'fighter', 'dreadnought'], ground: inf(5), pds: 1 },
      techs: ['neural', 'plasma_scoring'],
      ability: { assimilate: true, harrow: true },
      flagship: { name: '0.0.1', cost: 8, combat: 5, dice: 2, move: 1, cap: 5, sustain: true, nonFighterHits: true },
      units: { dreadnought: { cap: 2 } }, unitNames: { dreadnought: 'Super-Dreadnought' },
      factionTechs: ['super_dreadnought2', 'inheritance_systems'],
      techPlan: ['super_dreadnought2', 'sarween', 'cruiser2', 'carrier2'],
      sheet: [
        { name: 'Assimilate', text: 'When you gain control of a planet, replace each PDS and space dock on that planet with a matching unit from your reinforcements.', modeled: true },
        { name: 'Harrow', text: 'After each round of ground combat, your ships in the active system may use their bombardment ability against your opponent\'s ground forces on the planet.', modeled: true },
        { name: '0.0.1 (flagship)', text: 'Cost 8, combat 5x2, move 1, capacity 5, sustain damage. During a space combat hits produced by this ship and by your dreadnoughts must be assigned to non-fighter ships if able. (Approximated: while the flagship is in the fight, all your hits go to non-fighter ships first.)', modeled: true },
        { name: 'Super-Dreadnought', text: 'Cost 4, combat 5, move 1, capacity 2, sustain damage, bombard 5. Super-Dreadnought II (BBY): combat 4, move 2.', modeled: true },
        { name: 'Inheritance Systems (YY)', text: 'You may exhaust this card and spend 2 resources when you research a technology: ignore all of that technology\'s prerequisites. (Applied automatically when you would otherwise lack a prerequisite and can pay.)', modeled: true },
        { name: 'Starting techs', text: 'Neural Motivator, Plasma Scoring.', modeled: true },
        { name: 'Cybernetic Enhancements (promissory note)', text: NOTE, modeled: false },
      ] },

    { id: 'mentak', name: 'Mentak Coalition', difficulty: 'Average',
      blurb: 'Pirates: ambush at the start of combat and pillage trade goods from rich neighbors.',
      planets: [{ name: 'Moll Primus', res: 4, inf: 1 }], commodities: 2,
      start: { ships: ['carrier', 'fighter', 'fighter', 'fighter', 'cruiser', 'cruiser'], ground: inf(4), pds: 1 },
      techs: ['sarween', 'plasma_scoring'],
      ability: { ambush: true, pillage: true },
      flagship: { name: 'Fourth Moon', cost: 8, combat: 7, dice: 2, move: 1, cap: 3, sustain: true, noEnemySustain: true },
      units: {}, unitNames: {},
      factionTechs: ['salvage_operations', 'mirror_computing'],
      techPlan: ['salvage_operations', 'mirror_computing', 'pds2', 'cruiser2'],
      sheet: [
        { name: 'Ambush', text: 'At the start of a space combat, you may roll 1 die for each of up to 2 of your cruisers or destroyers in the system. For each result equal to or greater than that ship\'s combat value, produce 1 hit. Your opponent must assign it to one of his ships.', modeled: true },
        { name: 'Pillage', text: 'After one of your neighbors gains trade goods or resolves a transaction: if he has 3 or more trade goods you may take 1 of his trade goods or commodities. (Here: after a transaction or the Trade primary. A bot neighbor always counts.)', modeled: true },
        { name: 'Fourth Moon (flagship)', text: 'Cost 8, combat 7x2, move 1, capacity 3, sustain damage. Other players\' ships in this system cannot use Sustain Damage.', modeled: true },
        { name: 'Salvage Operations (YY)', text: 'After you win or lose a space combat, gain 1 trade good. If you won, you may also produce 1 ship of a type destroyed in the combat.', modeled: true },
        { name: 'Mirror Computing (YYY)', text: 'When you spend trade goods, each trade good is worth 2 resources or influence instead of 1.', modeled: true },
        { name: 'Starting techs', text: 'Sarween Tools, Plasma Scoring.', modeled: true },
        { name: 'Promise of Protection (promissory note)', text: NOTE, modeled: false },
      ] },

    { id: 'naalu', name: 'Naalu Collective', difficulty: 'Average',
      blurb: 'Always first in initiative order, a deadly flagship and sharp fighters, and a sixth sense for incoming fleets.',
      planets: [{ name: 'Druaa', res: 3, inf: 1 }, { name: 'Maaluuk', res: 0, inf: 2 }], commodities: 3,
      start: { ships: ['carrier', 'fighter', 'fighter', 'fighter', 'cruiser'], ground: inf(4) },
      techs: ['neural', 'sarween'],
      ability: { telepathic: true, foresight: true },
      flagship: { name: 'Matriarch', cost: 8, combat: 9, dice: 2, move: 1, cap: 6, sustain: true },
      units: { fighter: { combat: 8 } }, unitNames: { fighter: 'Hybrid Crystal Fighter' },
      factionTechs: ['hybrid_crystal2', 'neuroglaive'],
      techPlan: ['hybrid_crystal2', 'neuroglaive', 'carrier2', 'dreadnought2'],
      sheet: [
        { name: 'Telepathic', text: 'You are first in initiative order (as if your strategy card were numbered 0).', modeled: true },
        { name: 'Foresight', text: 'After another player moves ships into a system that contains 1 or more of your ships, you may place 1 token from your strategy pool in an adjacent system that does not contain another player\'s ships: move your ships from the active system into that system.', modeled: true },
        { name: 'Matriarch (flagship)', text: 'Cost 8, combat 9x2, move 1, capacity 6, sustain damage. During an invasion you may commit fighters to planets as if they were ground forces. (The fighter landing is not modeled.)', modeled: false },
        { name: 'Hybrid Crystal Fighter', text: 'Cost 1(2), combat 8. Hybrid Crystal Fighter II (GB): combat 7, move 2, moves without a transport. (The half-fleet-supply rule for excess fighters is not modeled.)', modeled: true },
        { name: 'Neuroglaive (GGG)', text: 'After another player activates a system that contains 1 or more of your ships, that player removes 1 token from his fleet pool and returns it to his reinforcements.', modeled: true },
        { name: 'Starting techs', text: 'Neural Motivator, Sarween Tools.', modeled: true },
        { name: 'Gift of Prescience (promissory note)', text: NOTE, modeled: false },
      ] },

    { id: 'nekro', name: 'Nekro Virus', difficulty: 'High',
      blurb: 'Cannot research: steals technology by destroying enemy units; gains command tokens instead.',
      planets: [{ name: 'Mordai II', res: 4, inf: 0 }], commodities: 3,
      start: { ships: ['carrier', 'fighter', 'fighter', 'cruiser', 'dreadnought'], ground: inf(2) },
      techs: ['dacxive'],
      ability: { propagation: true, noVote: true, techSingularity: true },
      flagship: { name: 'The Alastor', cost: 8, combat: 9, dice: 2, move: 1, cap: 3, sustain: true },
      units: {}, unitNames: {},
      factionTechs: [],
      techPlan: [],
      sheet: [
        { name: 'Galactic Threat', text: 'You cannot vote on agendas. Once per agenda phase after an agenda is revealed you may predict its outcome; a correct prediction gains a technology owned by a player who voted that way.', modeled: true },
        { name: 'Technology Singularity', text: 'Once per combat, after you destroy an enemy unit, you may gain 1 technology owned by that player. (Here: once you win a combat in which you destroyed something, you gain one random technology that player owns and you lack.)', modeled: true },
        { name: 'Propagation', text: 'You cannot research technology. When you would research a technology, gain 3 command tokens instead.', modeled: true },
        { name: 'The Alastor (flagship)', text: 'Cost 8, combat 9x2, move 1, capacity 3, sustain damage. At the start of a space combat your ground forces in the system may fight as if they were ships. (Not modeled.)', modeled: false },
        { name: 'Valefactor Assimilator X / Y', text: 'Lets you copy another player\'s faction technology. (Here: Technology Singularity and Galactic Threat can hand you other factions\' faction technologies, which then work for you.)', modeled: true },
        { name: 'Starting techs', text: 'Dacxive Animators.', modeled: true },
        { name: 'Antivirus (promissory note)', text: NOTE, modeled: false },
      ] },

    { id: 'winnu', name: 'Winnu', difficulty: 'Average',
      blurb: 'Heirs to Mecatol Rex: no cost to claim it, and a free dock and PDS when they take it.',
      planets: [{ name: 'Winnu', res: 3, inf: 4 }], commodities: 3,
      start: { ships: ['carrier', 'fighter', 'fighter', 'cruiser'], ground: inf(2), pds: 1 },
      techs: ['sarween'],
      ability: { bloodTies: true, reclamation: true },
      flagship: { name: 'Salai Sai Corian', cost: 8, combat: 7, dice: 1, move: 1, cap: 3, sustain: true, diceOpp: true },
      units: {}, unitNames: {},
      factionTechs: ['lazax_gate_folding', 'hegemonic_trade_policy'],
      techPlan: ['lazax_gate_folding', 'sarween', 'carrier2', 'dreadnought2'],
      sheet: [
        { name: 'Blood Ties', text: 'You do not have to spend influence to remove the custodians token from Mecatol Rex.', modeled: true },
        { name: 'Reclamation', text: 'After you resolve a tactical action during which you gained control of Mecatol Rex, you may place 1 PDS and 1 space dock from your reinforcements on Mecatol Rex.', modeled: true },
        { name: 'Salai Sai Corian (flagship)', text: 'Cost 8, combat 7, move 1, capacity 3, sustain damage. When it makes a combat roll it rolls a number of dice equal to the number of your opponent\'s non-fighter ships in the system.', modeled: true },
        { name: 'Lazax Gate Folding (BB)', text: 'If you do not control Mecatol Rex, treat its system as if it contains both an alpha and beta wormhole (for your ships\' movement). Action: if you control Mecatol Rex, exhaust this card to place 1 infantry on Mecatol Rex.', modeled: true },
        { name: 'Hegemonic Trade Policy (YY)', text: 'When 1 or more of your units use Production, exhaust this card to swap the resource and influence values of 1 planet you control until the end of your turn. (Not modeled.)', modeled: false },
        { name: 'Starting techs', text: 'Choose any 1 technology with no prerequisites: the engine picks Sarween Tools.', modeled: true },
        { name: 'Acquiescence (promissory note)', text: NOTE, modeled: false },
      ] },

    { id: 'yin', name: 'Yin Brotherhood', difficulty: 'Average',
      blurb: 'Fanatics: convert enemy infantry, sacrifice cruisers for hits, and a flagship that takes everyone with it.',
      planets: [{ name: 'Darien', res: 4, inf: 4 }], commodities: 2,
      start: { ships: ['carrier', 'carrier', 'fighter', 'fighter', 'fighter', 'fighter', 'destroyer'], ground: inf(4) },
      techs: ['sarween'],
      ability: { indoctrination: true, devotion: true },
      flagship: { name: 'Van Hauge', cost: 8, combat: 9, dice: 2, move: 1, cap: 3, sustain: true, suicide: true },
      units: {}, unitNames: {},
      factionTechs: ['impulse_core', 'yin_spinner'],
      techPlan: ['yin_spinner', 'impulse_core', 'carrier2', 'dreadnought2'],
      sheet: [
        { name: 'Indoctrination', text: 'At the start of a ground combat, you may spend 2 influence to replace 1 of your opponent\'s participating infantry with 1 infantry from your reinforcements. (Used automatically when you can pay.)', modeled: true },
        { name: 'Devotion', text: 'After each space combat round, you may destroy 1 of your cruisers or destroyers to produce 1 hit and assign it to 1 of your opponent\'s ships. (Automatic for bots; for you it happens when it kills a ship worth at least as much.)', modeled: true },
        { name: 'Van Hauge (flagship)', text: 'Cost 8, combat 9x2, move 1, capacity 3, sustain damage. When this ship is destroyed, destroy all ships in this system.', modeled: true },
        { name: 'Impulse Core (YY)', text: 'At the start of a space combat, you may destroy 1 of your cruisers or destroyers in the active system to produce 1 hit against your opponent\'s ships; your opponent must assign it to a non-fighter ship if able.', modeled: true },
        { name: 'Yin Spinner (GG)', text: 'After 1 or more of your units use Production, place 1 infantry from your reinforcements on a planet you control in that system.', modeled: true },
        { name: 'Starting techs', text: 'Sarween Tools.', modeled: true },
        { name: 'Greyfire Mutagen (promissory note)', text: NOTE, modeled: false },
      ] },

    { id: 'yssaril', name: 'Yssaril Tribes', difficulty: 'Low',
      blurb: 'Schemers: extra action cards, no hand limit, steal cards from rivals, a flagship that slips past blockades.',
      planets: [{ name: 'Retillion', res: 2, inf: 3 }, { name: 'Shalloq', res: 1, inf: 2 }], commodities: 3,
      start: { ships: ['carrier', 'carrier', 'fighter', 'fighter', 'cruiser'], ground: inf(5), pds: 1 },
      techs: ['neural'],
      ability: { scheming: true, crafty: true, stallTactics: true },
      flagship: { name: 'Y\'sia Y\'ssrila', cost: 8, combat: 5, dice: 2, move: 2, cap: 3, sustain: true, passShips: true },
      units: {}, unitNames: {},
      factionTechs: ['transparasteel_plating', 'mageon_implants'],
      techPlan: ['mageon_implants', 'sarween', 'carrier2', 'dreadnought2'],
      sheet: [
        { name: 'Stall Tactics', text: 'Action: discard 1 action card from your hand.', modeled: true },
        { name: 'Scheming', text: 'When you draw 1 or more action cards, draw 1 additional action card. Then choose and discard 1 action card from your hand.', modeled: true },
        { name: 'Crafty', text: 'You can have any number of action cards in your hand.', modeled: true },
        { name: 'Y\'sia Y\'ssrila (flagship)', text: 'Cost 8, combat 5x2, move 2, capacity 3, sustain damage. This ship can move through systems that contain other players\' ships.', modeled: true },
        { name: 'Transparasteel Plating (G)', text: 'During your turn of the action phase, players that have passed cannot play action cards.', modeled: true },
        { name: 'Mageon Implants (GGG)', text: 'Action: exhaust this card to look at another player\'s hand of action cards. Choose 1 of those cards and add it to your hand.', modeled: true },
        { name: 'Starting techs', text: 'Neural Motivator.', modeled: true },
        { name: 'Spy Net (promissory note)', text: NOTE, modeled: false },
      ] },
  ];
  TI.FACTIONS.push(...F);

  const T = (id, faction, name, color, prereq, effect, text, extra) =>
    (TI.TECHS[id] = Object.assign({ faction, name, color, prereq, effect, text }, extra || {}));
  T('letani2', 'arborec', 'Letani Warrior II', null, { green: 2 }, { upgrade: { infantry: { combat: 7, revive: 6 } } }, 'Cost 1(2), combat 7. After this unit is destroyed, roll 1 die; on 6+ it returns to your home system at the start of your next turn.', { replaces: 'infantry2' });
  T('bioplasmosis', 'arborec', 'Bioplasmosis', 'green', { green: 2 }, { bioplasmosis: true }, 'End of the status phase: move any number of infantry between your planets in the same or adjacent systems.');
  T('floating_factory2', 'saar', 'Floating Factory II', null, { yellow: 2 }, {}, 'Move 2, capacity 5, Production 7. (Not modeled.)');
  T('chaos_mapping', 'saar', 'Chaos Mapping', 'blue', { blue: 1 }, { chaos: true }, 'At the start of your turn you may produce 1 unit in a system with one of your units that has Production.');
  T('prototype_war_sun2', 'muaat', 'Prototype War Sun II', null, { red: 3, yellow: 1 }, { upgrade: { warsun: { cost: 10, move: 3 } } }, 'Cost 10, combat 3x3, move 3, capacity 6, sustain damage, bombard 3x3.', { replaces: 'war_sun' });
  T('magmus_reactor', 'muaat', 'Magmus Reactor', 'red', { red: 2 }, { magmus: true }, 'Your ships can move into supernovas. After your units use Production in a system with a war sun or next to a supernova, gain 1 trade good.');
  T('wormhole_generator', 'creuss', 'Wormhole Generator', 'blue', { blue: 2 }, { wormholeGen: true }, 'Start of the status phase: place or move a Delta wormhole token into a system with a planet you control or a non-home system with no other player\'s ships.');
  T('dimensional_splicer', 'creuss', 'Dimensional Splicer', 'red', { red: 1 }, { splicer: true }, 'At the start of a space combat in a system with a wormhole and your ships, produce 1 hit and assign it to 1 of your opponent\'s ships.');
  T('super_dreadnought2', 'l1z1x', 'Super-Dreadnought II', null, { blue: 2, yellow: 1 }, { upgrade: { dreadnought: { combat: 4, move: 2 } } }, 'Cost 4, combat 4, move 2, capacity 2, sustain damage, bombard 4.', { replaces: 'dreadnought2' });
  T('inheritance_systems', 'l1z1x', 'Inheritance Systems', 'yellow', { yellow: 2 }, { inherit: true }, 'Exhaust and spend 2 resources when you research: ignore that technology\'s prerequisites.');
  T('salvage_operations', 'mentak', 'Salvage Operations', 'yellow', { yellow: 2 }, { salvage: true }, 'After you win or lose a space combat, gain 1 trade good.');
  T('mirror_computing', 'mentak', 'Mirror Computing', 'yellow', { yellow: 3 }, { mirror: true }, 'Each trade good you spend is worth 2 resources or influence.');
  T('hybrid_crystal2', 'naalu', 'Hybrid Crystal Fighter II', null, { green: 1, blue: 1 }, { upgrade: { fighter: { combat: 7, move: 2 } } }, 'Cost 1(2), combat 7, move 2; moves without a transport.', { replaces: 'fighter2' });
  T('neuroglaive', 'naalu', 'Neuroglaive', 'green', { green: 3 }, { neuroglaive: true }, 'After another player activates a system with your ships, that player returns 1 fleet token to reinforcements.');
  T('lazax_gate_folding', 'winnu', 'Lazax Gate Folding', 'blue', { blue: 2 }, { lazax: true }, 'Action: if you control Mecatol Rex, exhaust to place 1 infantry on it. While you do not control Mecatol Rex your ships treat it as an alpha and beta wormhole.');
  T('hegemonic_trade_policy', 'winnu', 'Hegemonic Trade Policy', 'yellow', { yellow: 2 }, {}, 'Swap a planet\'s resources and influence when you produce. (Not modeled.)');
  T('impulse_core', 'yin', 'Impulse Core', 'yellow', { yellow: 2 }, { impulse: true }, 'At the start of a space combat destroy 1 of your cruisers or destroyers in the system to produce 1 hit against a non-fighter ship.');
  T('yin_spinner', 'yin', 'Yin Spinner', 'green', { green: 2 }, { spinner: true }, 'After your units use Production, place 1 infantry on a planet you control in that system.');
  T('transparasteel_plating', 'yssaril', 'Transparasteel Plating', 'green', { green: 1 }, { transparasteel: true }, 'Players that have passed cannot play action cards during your turn.');
  T('mageon_implants', 'yssaril', 'Mageon Implants', 'green', { green: 3 }, { action: true, mageon: true }, 'Action: exhaust to look at another player\'s action cards and take 1.');

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
