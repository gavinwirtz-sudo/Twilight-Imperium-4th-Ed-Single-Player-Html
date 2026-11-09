// Static game data: factions, strategy cards, technologies, objectives.
// Factions are transcribed from the "TI4 Factions Overview & Strategy Guide" booklet (base game).
// The engine reads only these fields; see src/abilities.js for what each ability key does.
(function (root) {
  const TI = (root.TI = root.TI || {});

  TI.VP_TO_WIN = 10;

  const inf = (n) => Array.from({ length: n }, () => 'infantry');
  const rep = (t, n) => Array.from({ length: n }, () => t);

  // Fields:
  //  planets/commodities/start/techs  home system and starting units (flagship is built, not started with)
  //  ability        engine keys for faction abilities (extraTokens, armada, combatMod, masterTrade, ...)
  //  flagship       stat patch for the 'flagship' unit; extra keys are flagship abilities
  //  units          stat patches for the faction's special "I" level units (replaced by their II tech)
  //  factionTechs   ids in TI.TECHS that only this faction can research
  //  techPlan       faction techs (and a few unit upgrades) the bots slot in after their first three general picks
  //  sheet          display text for the faction sheet (modeled: true/false says whether the engine runs it)
  TI.FACTIONS = [
    { id: 'sol', name: 'Federation of Sol', difficulty: 'Low',
      blurb: 'Mobile infantry swarm; best at taking and holding Mecatol Rex.',
      planets: [{ name: 'Jord', res: 4, inf: 2 }], commodities: 4,
      start: { ships: ['carrier', 'carrier', 'fighter', 'fighter', 'fighter', 'destroyer'], ground: inf(5) },
      techs: ['antimass', 'neural'],
      ability: { extraTokens: 1 },
      flagship: { name: 'Genesis', cost: 8, combat: 5, dice: 2, move: 1, cap: 12, sustain: true, statusInfantry: true },
      units: { infantry: { combat: 7 }, carrier: { cap: 6 } },
      unitNames: { infantry: 'Spec Ops Infantry', carrier: 'Advanced Carrier' },
      factionTechs: ['spec_ops2', 'adv_carrier2'],
      techPlan: ['spec_ops2', 'adv_carrier2', 'dreadnought2', 'fighter2'],
      sheet: [
        { name: 'Orbital Drop', text: 'Action: spend 1 token from your strategy pool to place 2 infantry on 1 planet you control.', modeled: true },
        { name: 'Versatile', text: 'When you gain command tokens in the status phase, gain 1 additional.', modeled: true },
        { name: 'Genesis (flagship)', text: 'Cost 8, combat 5x2, move 1, capacity 12, sustain damage. At the end of the status phase place 1 infantry in this system\'s space area.', modeled: true },
        { name: 'Spec Ops Infantry', text: 'Cost 1(2), combat 7. Spec Ops II (GG): combat 6; after it is destroyed roll 1 die, on 5+ it returns to your home system at the start of your next turn.', modeled: true },
        { name: 'Advanced Carrier', text: 'Cost 3, combat 9, move 1, capacity 6. Advanced Carrier II (BB): move 2, capacity 8, sustain damage.', modeled: true },
        { name: 'Starting techs', text: 'Antimass Deflector, Neural Motivator.', modeled: true },
        { name: 'Military Support (promissory note)', text: 'Not modeled (promissory notes).', modeled: false },
      ] },

    { id: 'hacan', name: 'Emirates of Hacan', difficulty: 'High',
      blurb: 'Trade empire: 6 commodities, free Trade secondary, can gift trade goods to steer the game.',
      planets: [{ name: 'Arretze', res: 2, inf: 1 }, { name: 'Kamdorn', res: 0, inf: 1 }, { name: 'Hercant', res: 1, inf: 1 }], commodities: 6,
      start: { ships: ['carrier', 'carrier', 'cruiser', 'fighter', 'fighter'], ground: inf(4) },
      techs: ['antimass', 'sarween'],
      ability: { masterTrade: true, guildShips: true, arbiters: true },
      flagship: { name: 'Wrath of Kenara', cost: 8, combat: 7, dice: 2, move: 1, cap: 3, sustain: true, tgBoost: true },
      units: {}, unitNames: {},
      factionTechs: ['production_biomes', 'quantum_datahub'],
      techPlan: ['production_biomes', 'quantum_datahub', 'dreadnought2', 'carrier2'],
      sheet: [
        { name: 'Masters of Trade', text: 'You do not have to spend a command token to resolve the secondary ability of the Trade strategy card.', modeled: true },
        { name: 'Guild Ships', text: 'You can negotiate transactions with players who are not your neighbor.', modeled: true },
        { name: 'Arbiters', text: 'Action cards can be exchanged in transactions you are part of.', modeled: true },
        { name: 'Wrath of Kenara (flagship)', text: 'Cost 8, combat 7x2, move 1, capacity 3, sustain damage. After you roll a die in a space combat in this system you may spend 1 trade good to apply +1 to the result (automatic here: spent only when it turns a near-miss into a hit).', modeled: true },
        { name: 'Production Biomes (GG)', text: 'Action: exhaust this card and spend 1 strategy token to gain 4 trade goods and choose another player, who gains 2 trade goods.', modeled: true },
        { name: 'Quantum Datahub Node (YYY)', text: 'At the end of the strategy phase, spend 1 strategy token and give another player 3 trade goods; swap 1 strategy card with that player.', modeled: true },
        { name: 'Starting techs', text: 'Antimass Deflector, Sarween Tools.', modeled: true },
        { name: 'Trade Convoys (promissory note)', text: 'Not modeled.', modeled: false },
      ] },

    { id: 'letnev', name: 'Barony of Letnev', difficulty: 'Low',
      blurb: 'Big fleets of big ships, bombardment, and trade goods spent on re-rolls.',
      planets: [{ name: 'Arc Prime', res: 4, inf: 0 }, { name: 'Wren Terra', res: 2, inf: 1 }], commodities: 2,
      start: { ships: ['carrier', 'destroyer', 'fighter', 'dreadnought'], ground: inf(3) },
      techs: ['antimass', 'plasma_scoring'],
      ability: { armada: 2, munitions: true },
      flagship: { name: 'Arc Secundus', cost: 8, combat: 5, dice: 2, move: 1, cap: 3, sustain: true, bombard: { value: 5, dice: 3 }, repair: true },
      units: {}, unitNames: {},
      factionTechs: ['l4_disruptors', 'non_euclidean'],
      techPlan: ['l4_disruptors', 'non_euclidean', 'carrier2', 'dreadnought2'],
      sheet: [
        { name: 'Munitions Reserves', text: 'At the start of each round of space combat you may spend 2 trade goods: you may re-roll any number of your dice during that combat round (automatic here when you have 2+ trade goods and 3+ dice).', modeled: true },
        { name: 'Armada', text: 'The maximum number of non-fighter ships your fleet can have in each system is equal to 2 more than the number of tokens in your fleet pool.', modeled: true },
        { name: 'Arc Secundus (flagship)', text: 'Cost 8, combat 5x2, move 1, capacity 3, sustain damage, bombard 5x3. At the start of each space combat round repair this ship. (Other players\' units losing planetary shield: not modeled, there are no planetary shields yet.)', modeled: true },
        { name: 'L4 Disruptors (Y)', text: 'During an invasion, units cannot use Space Cannon against your units.', modeled: true },
        { name: 'Non-Euclidean Shielding (RR)', text: 'When one of your units uses Sustain Damage, cancel 2 hits instead of 1.', modeled: true },
        { name: 'Starting techs', text: 'Antimass Deflector, Plasma Scoring.', modeled: true },
        { name: 'War Funding (promissory note)', text: 'Not modeled.', modeled: false },
      ] },

    { id: 'jolnar', name: 'Universities of Jol-Nar', difficulty: 'Low',
      blurb: 'Best start, most tech, but every combat roll is at -1.',
      planets: [{ name: 'Nar', res: 2, inf: 3 }, { name: 'Jol', res: 1, inf: 2 }], commodities: 4,
      start: { ships: ['carrier', 'carrier', 'fighter', 'dreadnought'], ground: inf(2), pds: 2 },
      techs: ['antimass', 'neural', 'sarween', 'plasma_scoring'],
      ability: { combatMod: -1, brilliant: true, analytical: true },
      flagship: { name: 'J.N.S. Hylarim', cost: 8, combat: 6, dice: 2, move: 1, cap: 3, sustain: true, hitsOn: 9, extraHits: 2 },
      units: {}, unitNames: {},
      factionTechs: ['spacial_conduit', 'eres_siphons'],
      techPlan: ['eres_siphons', 'spacial_conduit', 'pds2', 'dreadnought2'],
      sheet: [
        { name: 'Fragile', text: 'Apply -1 to the result of each of your unit\'s combat rolls.', modeled: true },
        { name: 'Brilliant', text: 'When you spend a command token to resolve the secondary ability of the Technology strategy card, you may resolve the primary ability instead.', modeled: true },
        { name: 'Analytical', text: 'When you research a technology that is not a unit upgrade technology, you may ignore 1 prerequisite.', modeled: true },
        { name: 'J.N.S. Hylarim (flagship)', text: 'Cost 8, combat 6x2, move 1, capacity 3, sustain damage. When making a combat roll for this ship, each result of 9 or 10, before applying modifiers, produces 2 additional hits.', modeled: true },
        { name: 'Spacial Conduit Cylinder (BB)', text: 'You may exhaust this card after you activate a system that contains 1 or more of your units; that system is adjacent to all systems that contain 1 or more of your units during this activation (used automatically when it lets more ships reach the system).', modeled: true },
        { name: 'E-Res Siphons (YY)', text: 'After another player activates a system that contains 1 or more of your ships, gain 4 trade goods.', modeled: true },
        { name: 'Starting techs', text: 'Antimass Deflector, Neural Motivator, Sarween Tools, Plasma Scoring.', modeled: true },
        { name: 'Research Agreement (promissory note)', text: 'Not modeled.', modeled: false },
      ] },

    { id: 'sardakk', name: 'Sardakk N\'orr', difficulty: 'Average',
      blurb: '+1 on every combat roll, cheap flagship, strong dreadnoughts; starts with no tech.',
      planets: [{ name: 'Quinarra', res: 3, inf: 1 }, { name: 'Trenlak', res: 1, inf: 0 }], commodities: 3,
      start: { ships: ['carrier', 'carrier', 'cruiser'], ground: inf(5), pds: 1 },
      techs: [],
      ability: { combatMod: 1 },
      flagship: { name: 'C\'morran N\'orr', cost: 6, combat: 6, dice: 2, move: 1, cap: 3, sustain: true, boostOthers: 1 },
      units: { dreadnought: { bombard: { value: 4, dice: 2 } } },
      unitNames: { dreadnought: 'Exotrireme Dreadnought' },
      factionTechs: ['exotrireme2', 'valkyrie'],
      techPlan: ['exotrireme2', 'valkyrie', 'infantry2', 'fighter2'],
      sheet: [
        { name: 'Unrelenting', text: 'Apply +1 to the result of each of your unit\'s combat rolls.', modeled: true },
        { name: 'C\'morran N\'orr (flagship)', text: 'Cost 6, combat 6x2, move 1, capacity 3, sustain damage. Apply +1 to the result of each of your other ships\' combat rolls in this system.', modeled: true },
        { name: 'Exotrireme Dreadnought', text: 'Cost 4, combat 5, move 1, capacity 1, sustain damage, bombard 4x2. Exotrireme II (BBY): move 2; after a round of space combat you may destroy this unit to destroy up to 2 ships in the system (automatic when it kills at least 4 resources of ships).', modeled: true },
        { name: 'Valkyrie Particle Weave (RR)', text: 'After making combat rolls during a round of ground combat, if your opponent produced 1 or more hits, you produce 1 additional hit.', modeled: true },
        { name: 'Starting techs', text: 'None.', modeled: true },
        { name: 'Tekklar Legion (promissory note)', text: 'Not modeled.', modeled: false },
      ] },

    { id: 'xxcha', name: 'Xxcha Kingdom', difficulty: 'Low',
      blurb: 'Defensive diplomats: ranged space cannon flagship, can freeze enemy turns, peaceful land grabs.',
      planets: [{ name: 'Archon Ren', res: 2, inf: 3 }, { name: 'Archon Tau', res: 1, inf: 1 }], commodities: 4,
      start: { ships: ['carrier', 'fighter', 'fighter', 'fighter', 'cruiser', 'cruiser'], ground: inf(4), pds: 1 },
      techs: ['graviton'],
      ability: { peaceAccords: true, quash: true },
      flagship: { name: 'Loncara Ssodu', cost: 8, combat: 7, dice: 2, move: 1, cap: 3, sustain: true, cannon: { value: 5, dice: 3 }, cannonAdjacent: true },
      units: {}, unitNames: {},
      factionTechs: ['instinct_training', 'nullification'],
      techPlan: ['nullification', 'pds2', 'infantry2', 'instinct_training'],
      sheet: [
        { name: 'Peace Accords', text: 'After you resolve the primary or secondary ability of the Diplomacy strategy card, you may gain control of 1 planet other than Mecatol Rex that does not contain any units, in a system adjacent to a planet you control.', modeled: true },
        { name: 'Quash', text: 'After an agenda is revealed, you may exhaust and spend 1 strategy token: discard it and reveal another. (Bots do not use it.)', modeled: true },
        { name: 'Loncara Ssodu (flagship)', text: 'Cost 8, combat 7x2, move 1, capacity 3, sustain damage, space cannon 5x3. You may use this unit\'s Space Cannon against ships in adjacent systems.', modeled: true },
        { name: 'Graviton Laser System (Y)', text: 'When 1 or more units use Space Cannon, hits produced must be assigned to non-fighter ships if able.', modeled: true },
        { name: 'Nullification Field (YY)', text: 'After another player activates a system that contains 1 or more of your ships, you may exhaust this card and spend 1 strategy token: immediately end that player\'s turn.', modeled: true },
        { name: 'Instinct Training (G)', text: 'Exhaust and spend a strategy token to cancel an action card.', modeled: true },
        { name: 'Starting techs', text: 'Graviton Laser System.', modeled: true },
        { name: 'Political Favor (promissory note)', text: 'Not modeled.', modeled: false },
      ] },
  ];

  // Strategy cards in initiative order. primary: active player; secondary: others (costs a strategy token).
  TI.STRATEGY_CARDS = [
    { id: 1, name: 'Leadership',   primary: 'Gain 3 command tokens, then buy more with influence (3 influence each).',
                                   secondary: 'Buy command tokens with influence (3 influence each).' },
    { id: 2, name: 'Diplomacy',    primary: 'Ready 2 exhausted planets. Choose a system: rivals lose their command tokens there.',
                                   secondary: 'Ready 2 exhausted planets.' },
    { id: 3, name: 'Politics',     primary: 'Choose the new speaker and draw 2 action cards. (The agenda look is not modeled.)',
                                   secondary: 'Spend a strategy token to draw 2 action cards.' },
    { id: 4, name: 'Construction', primary: 'Place a space dock or PDS on a planet you control, plus one more PDS.',
                                   secondary: 'Place one PDS or space dock on a planet you control.' },
    { id: 5, name: 'Trade',        primary: 'Gain 3 trade goods, replenish your commodities, and choose players to replenish theirs.',
                                   secondary: 'Replenish your commodities.' },
    { id: 6, name: 'Warfare',      primary: 'Regain a command token from the board, then produce at your home system.',
                                   secondary: 'Produce at your home system.' },
    { id: 7, name: 'Technology',   primary: 'Research one technology free and a second for 6 resources.',
                                   secondary: 'Research one technology for 4 resources.' },
    { id: 8, name: 'Imperial',     primary: 'Score one extra public objective you qualify for; gain 1 VP if you hold Mecatol Rex, otherwise draw a secret objective.',
                                   secondary: 'Draw a secret objective.' },
  ];

  // Technologies. color: blue/yellow/green/red. prereq: count of techs of each color needed.
  // Generic techs are simplified (this is not the printed tech deck); the starting techs of the six
  // factions and all faction techs follow the faction sheets.
  //  faction: only that faction can research it.  replaces: the generic tech a faction tech stands in for.
  TI.TECHS = {
    // ---- generic technologies (Tech V3 Omega list). Unit upgrades grant no color symbol. ----
    // Propulsion (blue)
    antimass:      { name: 'Antimass Deflectors', color: 'blue', prereq: {},            effect: { throughAsteroids: true, cannonResist: 1 }, text: 'Move into and through asteroid fields. Apply -1 to Space Cannon rolls against you.' },
    gravity_drive: { name: 'Gravity Drive',       color: 'blue', prereq: { blue: 1 },   effect: { gravityDrive: true }, text: 'After activating a system, +1 to the movement of 1 ship during this tactical action.' },
    fleet_logistics: { name: 'Fleet Logistics',   color: 'blue', prereq: { blue: 2 },   effect: { twoActions: true }, text: 'Take two actions per turn instead of 1.' },
    light_wave:    { name: 'Light/Wave Deflector', color: 'blue', prereq: { blue: 3 },  effect: { throughShips: true }, text: 'Your ships may move through systems that contain other players\' ships.' },
    // Cybernetic (yellow)
    sarween:       { name: 'Sarween Tools',       color: 'yellow', prereq: {},          effect: { productionDiscount: 1 }, text: 'When 1 or more units use Production, reduce the total combined cost by 1.' },
    graviton:      { name: 'Graviton Laser System', color: 'yellow', prereq: { yellow: 1 }, effect: { cannonNonFighter: true }, text: 'When 1 or more units use Space Cannon, hits produced must be assigned to non-fighter ships if able.' },
    transit_diodes: { name: 'Transit Diodes',     color: 'yellow', prereq: { yellow: 2 }, effect: { action: true }, text: 'Action (exhaust): remove up to 4 of your ground forces from the board and place them on 1 or more planets you control.' },
    integrated_economy: { name: 'Integrated Economy', color: 'yellow', prereq: { yellow: 3 }, effect: { integrated: true }, text: 'After winning a planet, produce any number of units on that planet (combined cost up to the planet\'s resource value).' },
    // Biotic (green)
    neural:        { name: 'Neural Motivator',    color: 'green', prereq: {},           effect: { neural: true }, text: 'Draw 2 action cards instead of 1 during the status phase.' },
    dacxive:       { name: 'Dacxive Animators',   color: 'green', prereq: { green: 1 }, effect: { dacxive: true }, text: 'After ground combat victory, place 1 infantry from reinforcements on that planet.' },
    hyper_metabolism: { name: 'Hyper Metabolism', color: 'green', prereq: { green: 2 }, effect: { extraTokens: 1 }, text: 'Gain 3 command tokens instead of 2 in the status phase.' },
    x89:           { name: 'X-89 Bacterial Weapon (Ω)', color: 'green', prereq: { green: 3 }, effect: { x89: true }, text: 'After 1 or more of your units use Bombard against a planet, if at least 1 opponent infantry was destroyed, destroy all infantry.' },
    // Warfare (red)
    plasma_scoring:{ name: 'Plasma Scoring',      color: 'red', prereq: {},             effect: { plasma: true }, text: 'When 1 or more units use Bombard or Space Cannon, 1 unit may roll 1 additional die.' },
    magen:         { name: 'Magen Defense Grid (Ω)', color: 'red', prereq: { red: 1 }, effect: { magen: true }, text: 'At the start of ground combat on a planet that contains your structure(s), you may produce 1 hit and assign it to 1 of your opponent\'s ground forces.' },
    duranium:      { name: 'Duranium Armor',      color: 'red', prereq: { red: 2 },     effect: { duranium: true }, text: 'Each combat round, after hits are assigned, repair 1 unit that did not use Sustain Damage this round.' },
    assault:       { name: 'Assault Cannon',      color: 'red', prereq: { red: 3 },     effect: { assaultCannon: true }, text: 'At the start of space combat, if you have 3 or more non-fighter ships, your opponent must destroy 1 of their non-fighter ships.' },
    // Unit upgrades
    fighter2:      { name: 'Fighter II',   color: null, prereq: { blue: 1, green: 1 },  effect: { upgrade: { fighter: { combat: 8, move: 2 } } }, text: '+1 combat, +2 move (no transport needed; fighters in excess of capacity count against the fleet limit).' },
    cruiser2:      { name: 'Cruiser II',   color: null, prereq: { green: 1, red: 1, yellow: 1 }, effect: { upgrade: { cruiser: { combat: 6, move: 3, cap: 1 } } }, text: '+1 combat, +1 move, +1 capacity.' },
    carrier2:      { name: 'Carrier II',   color: null, prereq: { blue: 2 },            effect: { upgrade: { carrier: { move: 2, cap: 6 } } }, text: '+1 move, +2 capacity.' },
    destroyer2:    { name: 'Destroyer II', color: null, prereq: { red: 2 },             effect: { upgrade: { destroyer: { combat: 8, afb: { value: 6, dice: 3 } } } }, text: '+1 combat. Anti-Fighter Barrage 6 (x3).' },
    dreadnought2:  { name: 'Dreadnought II', color: null, prereq: { blue: 2, yellow: 1 }, effect: { upgrade: { dreadnought: { move: 2 } } }, text: '+1 move (no "Direct Hit").' },
    infantry2:     { name: 'Infantry II',  color: null, prereq: { green: 2 },           effect: { upgrade: { infantry: { combat: 7, revive: 6 } } }, text: '+1 combat. After this unit is destroyed, roll 1 die; on 6+ it returns to your home system at the start of your next turn.' },
    pds2:          { name: 'PDS II',       color: null, prereq: { red: 1, yellow: 1 },  effect: { upgrade: { pds: { cannon: { value: 5, dice: 1 }, range: 1 } } }, text: '+1 range (also fires at ships in adjacent systems), Space Cannon 5.' },
    spacedock2:    { name: 'Space Dock II', color: null, prereq: { yellow: 2 },          effect: { productionBonus: 2 }, text: '+2 production.' },
    war_sun:       { name: 'War Sun',      color: null, prereq: { red: 3, yellow: 1 },   effect: { unlock: 'warsun' }, text: 'Unlocks the War Sun: combat 3 (x3), move 2, capacity 6, sustain damage, bombard 3 (x3).' },

    // ---- faction technologies ----
    spec_ops2:     { faction: 'sol', replaces: 'infantry2', name: 'Spec Ops II', color: null, prereq: { green: 2 },
                     effect: { upgrade: { infantry: { combat: 6, revive: 5 } } }, text: 'Cost 1(2), combat 6. After this unit is destroyed, roll 1 die; on 5+ it returns to your home system at the start of your next turn.' },
    adv_carrier2:  { faction: 'sol', replaces: 'carrier2', name: 'Advanced Carrier II', color: null, prereq: { blue: 2 },
                     effect: { upgrade: { carrier: { move: 2, cap: 8, sustain: true } } }, text: 'Cost 3, combat 9, move 2, capacity 8, sustain damage.' },
    production_biomes: { faction: 'hacan', name: 'Production Biomes', color: 'green', prereq: { green: 2 },
                     effect: { action: true }, text: 'Action: exhaust and spend 1 strategy token to gain 4 trade goods; choose another player, who gains 2.' },
    quantum_datahub: { faction: 'hacan', name: 'Quantum Datahub Node', color: 'yellow', prereq: { yellow: 3 },
                     effect: { datahub: true }, text: 'End of the strategy phase: spend 1 strategy token, give another player 3 trade goods, swap 1 strategy card with them.' },
    l4_disruptors: { faction: 'letnev', name: 'L4 Disruptors', color: 'yellow', prereq: { yellow: 1 },
                     effect: { noCannonDefense: true }, text: 'During an invasion, units cannot use Space Cannon against your units.' },
    non_euclidean: { faction: 'letnev', name: 'Non-Euclidean Shielding', color: 'red', prereq: { red: 2 },
                     effect: { sustainCancel: 2 }, text: 'When one of your units uses Sustain Damage, cancel 2 hits instead of 1.' },
    spacial_conduit: { faction: 'jolnar', name: 'Spacial Conduit Cylinder', color: 'blue', prereq: { blue: 2 },
                     effect: { conduit: true }, text: 'After you activate a system that contains your units, exhaust: that system is adjacent to every system containing your units this activation.' },
    eres_siphons:  { faction: 'jolnar', name: 'E-Res Siphons', color: 'yellow', prereq: { yellow: 2 },
                     effect: { siphons: true }, text: 'After another player activates a system that contains 1 or more of your ships, gain 4 trade goods.' },
    exotrireme2:   { faction: 'sardakk', replaces: 'dreadnought2', name: 'Exotrireme II', color: null, prereq: { blue: 2, yellow: 1 },
                     effect: { upgrade: { dreadnought: { move: 2, selfDestruct: true } } }, text: 'Cost 4, combat 5, move 2, capacity 1, sustain, bombard 4x2. After a round of space combat you may destroy this unit to destroy up to 2 ships in the system.' },
    valkyrie:      { faction: 'sardakk', name: 'Valkyrie Particle Weave', color: 'red', prereq: { red: 2 },
                     effect: { valkyrie: true }, text: 'After making combat rolls in a round of ground combat, if your opponent produced 1 or more hits, you produce 1 additional hit.' },
    instinct_training: { faction: 'xxcha', name: 'Instinct Training', color: 'green', prereq: { green: 1 },
                     effect: { instinct: true }, text: 'When another player plays an action card, exhaust and spend 1 strategy token: cancel that action card.' },
    nullification: { faction: 'xxcha', name: 'Nullification Field', color: 'yellow', prereq: { yellow: 2 },
                     effect: { nullify: true }, text: 'After another player activates a system containing your ships, exhaust and spend 1 strategy token: that player\'s turn ends immediately.' },
  };
  TI.TECH_COST = 6; // base resource cost of a technology when not discounted by a strategy card

  // Objectives: the 40 base-game cards (20 secret, 10 stage I, 10 stage II), worded as on the printed list.
  //   timing  'status' (scored in the status phase) or 'action' (scored the moment the event happens)
  //   spend   { kind: 'res'|'inf'|'tg'|'tokens'|'cards', n } paid when the objective is scored
  //   progress(state, player) -> [have, need] for the counting objectives (drives the UI meters and the bots)
  //   check(state, player)    -> true when the requirement is met (spend objectives: and affordable)
  //   event   (action-timing only) key of the combat event that scores it, see TI.actionObjectives
  //   needs   a rule the game does not model yet; such cards are left out of the decks
  const Q = {
    planets:   (s, p) => TI.planetsOwned(s, p),
    abroad:    (s, p) => TI.planetsOwned(s, p).filter((x) => s.map.systems[x.systemId].home === null),
    trait:     (s, p, t) => TI.planetsOwned(s, p).filter((x) => x.trait === t).length,
    bestTrait: (s, p) => Math.max(0, ...['cultural', 'hazardous', 'industrial'].map((t) => Q.trait(s, p, t))),
    specs:     (s, p) => TI.planetsOwned(s, p).filter((x) => x.tech).length,
    upgrades:  (p) => p.techs.filter((t) => TI.TECHS[t].color === null).length,
    colors:    (p, per) => Object.values(TI.techCountByColor(p)).filter((n) => n >= per).length,
    bestColor: (p) => Math.max(...Object.values(TI.techCountByColor(p))),
    factionTechs: (p) => p.techs.filter((t) => TI.TECHS[t].faction).length,
  };
  TI.objectiveQueries = Q;
  const count = (id, stage, vp, name, text, get, need, extra) =>
    Object.assign({ id, stage, vp, name, text, timing: 'status', progress: (s, p) => [get(s, p), need], check: (s, p) => get(s, p) >= need }, extra);
  const spend = (id, stage, vp, name, text, kind, n) =>
    ({ id, stage, vp, name, text, timing: 'status', spend: { kind, n }, check: (s, p) => TI.canSpend(s, p, kind, n),
       progress: (s, p) => [TI.spendable(s, p, kind), n] });
  const act = (id, vp, name, text, event) => ({ id, stage: 'secret', vp, name, text, timing: 'action', event, check: () => false });

  TI.OBJECTIVES = [
    // ---- Stage I (1 VP) ----
    count('s1_corner',   1, 1, 'Corner the Market',         'Control 4 planets that each have the same planet trait.', Q.bestTrait, 4),
    count('s1_weaponry', 1, 1, 'Develop Weaponry',          'Own 2 unit upgrade technologies.',                         (s, p) => Q.upgrades(p), 2),
    count('s1_diversify',1, 1, 'Diversify Research',        'Own 2 technologies in each of 2 colors.',                  (s, p) => Q.colors(p, 2), 2),
    spend('s1_monument', 1, 1, 'Erect a Monument',          'Spend 8 resources.', 'res', 8),
    count('s1_borders',  1, 1, 'Expand Borders',            'Control 6 planets in non-home systems.',                   (s, p) => Q.abroad(s, p).length, 6),
    count('s1_outposts', 1, 1, 'Found Research Outposts',   'Control 3 planets that have technology specialties.',      Q.specs, 3),
    count('s1_council',  1, 1, 'Intimidate the Council',    'Have 1 or more ships in 2 systems that are adjacent to Mecatol Rex.', (s, p) => TI.shipSystems(s, p).filter((id) => s.map.systems['0,0'].adj.includes(id)).length, 2),
    spend('s1_front',    1, 1, 'Lead from the Front',       'Spend a total of 3 tokens from your tactic and/or strategy pools.', 'tokens', 3),
    spend('s1_routes',   1, 1, 'Negotiate Trade Routes',    'Spend 5 trade goods.', 'tg', 5),
    spend('s1_sway',     1, 1, 'Sway the Council',          'Spend 8 influence.', 'inf', 8),
    // ---- Stage II (2 VP) ----
    spend('s2_trade',    2, 2, 'Centralize Galactic Trade', 'Spend 10 trade goods.', 'tg', 10),
    { id: 's2_weak', stage: 2, vp: 2, name: 'Conquer the Weak', text: "Control 1 planet that is in another player's home system.", timing: 'status',
      progress: (s, p) => [TI.holdsForeignHome(s, p) ? 1 : 0, 1], check: (s, p) => TI.holdsForeignHome(s, p) },
    count('s2_brain',    2, 2, 'Form Galactic Brain Trust', 'Control 5 planets that have technology specialties.',      Q.specs, 5),
    spend('s2_age',      2, 2, 'Found a Golden Age',        'Spend 16 resources.', 'res', 16),
    spend('s2_galvanize',2, 2, 'Galvanize the People',      'Spend a total of 6 tokens from your tactic and/or strategy pools.', 'tokens', 6),
    spend('s2_law',      2, 2, 'Manipulate Galactic Law',   'Spend 16 influence.', 'inf', 16),
    count('s2_sciences', 2, 2, 'Master of Sciences',        'Own 2 technologies in each of 4 colors.',                  (s, p) => Q.colors(p, 2), 4),
    count('s2_warfare',  2, 2, 'Revolutionize Warfare',     'Own 3 unit upgrade technologies.',                         (s, p) => Q.upgrades(p), 3),
    count('s2_subdue',   2, 2, 'Subdue the Galaxy',         'Control 11 planets in non-home systems.',                  (s, p) => Q.abroad(s, p).length, 11),
    count('s2_unify',    2, 2, 'Unify the Colonies',        'Control 6 planets that each have the same planet trait.',  Q.bestTrait, 6),
    // ---- Secret (1 VP) ----
    count('x_adapt',     'secret', 1, 'Adapt New Strategies', 'Own 2 faction technologies.',                            (s, p) => Q.factionTechs(p), 2),
    count('x_gatekeeper','secret', 1, 'Become the Gatekeeper', 'Have 1 or more ships in both an alpha wormhole system and a beta wormhole system.',
          (s, p) => ['alpha', 'beta'].filter((w) => TI.shipSystems(s, p).some((id) => s.map.systems[id].wormhole === w)).length, 2),
    count('x_region',    'secret', 1, 'Control the Region',  'Have 1 or more ships in 6 systems.',                          (s, p) => TI.shipSystems(s, p).length, 6),
    count('x_supply',    'secret', 1, 'Cut Supply Lines',    "Have 1 or more ships in the same system as another player's space dock.",
          (s, p) => TI.shipSystems(s, p).some((id) => s.map.systems[id].planets.some((pl) => pl.dock && pl.owner !== null && pl.owner !== p.id)) ? 1 : 0, 1),
    act('x_greatest',    1, 'Destroy Their Greatest Ship',   "Action: Destroy another player's war sun or flagship.", 'bigKill'),
    count('x_perimeter', 'secret', 1, 'Establish a Perimeter', 'Have 4 PDS units on the game board.',                   (s, p) => TI.structureCount(s, p, 'pds'), 4),
    count('x_alliance',  'secret', 1, 'Forge an Alliance',   'Control 4 cultural planets.',                              (s, p) => Q.trait(s, p, 'cultural'), 4),
    spend('x_spy',      'secret', 1, 'Form a Spy Network',  'Discard 5 action cards.', 'cards', 5),
    count('x_machine',   'secret', 1, 'Fuel the War Machine', 'Have 3 space docks on the game board.',                  (s, p) => TI.structureCount(s, p, 'dock'), 3),
    count('x_fleet',     'secret', 1, 'Gather a Mighty Fleet', 'Have 5 dreadnoughts on the game board.',                (s, p) => TI.countShips(s, p, ['dreadnought']), 5),
    count('x_cosmos',    'secret', 1, 'Learn the Secrets of the Cosmos', 'Have 1 or more ships in 3 systems that are each adjacent to an anomaly.',
          (s, p) => TI.shipSystems(s, p).filter((id) => s.map.systems[id].adj.some((n) => s.map.systems[n].anomaly)).length, 3),
    act('x_example',     1, 'Make an Example of Their World', "Action: Use Bombardment to destroy all of a player's ground forces on a planet.", 'bombWipe'),
    count('x_physics',   'secret', 1, 'Master of the Laws of Physics', 'Own 4 technologies of the same color.',         (s, p) => Q.bestColor(p), 4),
    count('x_minerals',  'secret', 1, 'Mine Rare Minerals',  'Control 4 hazardous planets.',                             (s, p) => Q.trait(s, p, 'hazardous'), 4),
    count('x_production','secret', 1, 'Monopolize Production', 'Control 4 industrial planets.',                         (s, p) => Q.trait(s, p, 'industrial'), 4),
    { id: 'x_seat', stage: 'secret', vp: 1, name: 'Occupy the Seat of the Empire', text: 'Control Mecatol Rex and have 3 or more ships in its system.', timing: 'status',
      progress: (s, p) => [TI.mecatolHeld(s, p) > 0 ? (s.map.systems['0,0'].ships[p.id] || []).length : 0, 3],
      check: (s, p) => TI.mecatolHeld(s, p) > 0 && (s.map.systems['0,0'].ships[p.id] || []).length >= 3 },
    act('x_rebellion',   1, 'Spark a Rebellion',             'Action: Win a combat against a player who has the most victory points.', 'beatLeader'),
    count('x_threaten',  'secret', 1, 'Threaten Enemies',    "Have 1 or more ships in a system adjacent to another player's home system.",
          (s, p) => TI.shipSystems(s, p).some((id) => s.map.systems[id].adj.some((n) => { const h = s.map.systems[n].home; return h !== null && h !== p.id; })) ? 1 : 0, 1),
    act('x_dust',        1, 'Turn Their Fleets to Dust',     "Action: Use Space Cannon to destroy the last of a player's ships in a system.", 'cannonWipe'),
    act('x_flagship',    1, 'Unveil Flagship',               'Action: Win a space combat in a system with your flagship without it being destroyed.', 'flagshipWin'),
  ];
  // Which objectives actually go in the decks (cards whose rules are not modeled stay out).
  TI.deckObjectives = (stage) => TI.OBJECTIVES.filter((o) => o.stage === stage && !o.needs);

  TI.objectiveById = (id) => TI.OBJECTIVES.find((o) => o.id === id);

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
