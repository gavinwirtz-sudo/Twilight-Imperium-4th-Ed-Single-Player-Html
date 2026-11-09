// Unit stat table (game statistics only; flavor text and art are intentionally omitted).
// combat: roll >= value hits. dice: dice rolled per unit. cost: resources per purchase,
// batch: units produced per purchase. cap: capacity for carrying fighters/ground forces.
(function (root) {
  const TI = (root.TI = root.TI || {});

  TI.UNITS = {
    fighter:     { type: 'ship',   cost: 1,  batch: 2, combat: 9, dice: 1, move: 0, cap: 0, sustain: false },
    destroyer:   { type: 'ship',   cost: 1,  batch: 1, combat: 9, dice: 1, move: 2, cap: 0, sustain: false, afb: { value: 9, dice: 2 } },
    cruiser:     { type: 'ship',   cost: 2,  batch: 1, combat: 7, dice: 1, move: 2, cap: 0, sustain: false },
    carrier:     { type: 'ship',   cost: 3,  batch: 1, combat: 9, dice: 1, move: 1, cap: 4, sustain: false },
    dreadnought: { type: 'ship',   cost: 4,  batch: 1, combat: 5, dice: 1, move: 1, cap: 1, sustain: true,  bombard: { value: 5, dice: 1 } },
    warsun:      { type: 'ship',   cost: 12, batch: 1, combat: 3, dice: 3, move: 2, cap: 6, sustain: true,  bombard: { value: 3, dice: 3 } },
    // Each faction's flagship overrides these stats (see TI.FACTIONS[].flagship). One per player.
    flagship:    { type: 'ship',   cost: 8,  batch: 1, combat: 7, dice: 2, move: 1, cap: 3, sustain: true },
    infantry:    { type: 'ground', cost: 1,  batch: 2, combat: 8, dice: 1, move: 0, cap: 0, sustain: false },
    pds:         { type: 'struct', cost: 2,  batch: 1, combat: 0, dice: 0, move: 0, cap: 0, sustain: false, cannon: { value: 6, dice: 1 } },
    spacedock:   { type: 'struct', cost: 4,  batch: 1, combat: 0, dice: 0, move: 0, cap: 0, sustain: false },
  };

  TI.SHIP_TYPES = Object.keys(TI.UNITS).filter((k) => TI.UNITS[k].type === 'ship');

  // A unit instance: { type, damaged }. Helpers keep combat code readable.
  TI.makeUnit = (type) => ({ type, damaged: false });
  TI.unitsOf = (list, type) => list.filter((u) => u.type === type);
  TI.countOf = (list, type) => list.reduce((n, u) => n + (u.type === type ? 1 : 0), 0);

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
