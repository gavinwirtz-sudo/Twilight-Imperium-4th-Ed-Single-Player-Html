// Unit pictograms. Every icon is drawn in a 14x14 box centred on (0,0) and filled with the owner's colour,
// so the same markup works on the map (<g>) and in the inspector / legend (standalone <svg>).
(function (root) {
  const TI = (root.TI = root.TI || {});
  const ui = (TI.ui = TI.ui || {});

  const INK = '#05080f';
  const SHAPES = {
    fighter:     '<path d="M0,-5 L3.6,4.5 L0,2.2 L-3.6,4.5 Z"/>',
    destroyer:   '<path d="M0,-6.2 L2.6,-0.5 L2.2,5.4 L0,3.8 L-2.2,5.4 L-2.6,-0.5 Z"/><path class="ln" d="M0,-3 L0,2"/>',
    cruiser:     '<path d="M0,-6.4 L3.4,-1.5 L3,2.6 L5,5.6 L0,4 L-5,5.6 L-3,2.6 L-3.4,-1.5 Z"/><path class="ln" d="M0,-3 L0,2.5"/>',
    carrier:     '<path d="M-3,-6 L3,-6 L5,-3 L5,5.8 L-5,5.8 L-5,-3 Z"/><path class="ln" d="M-2.5,-1 L2.5,-1 M-2.5,2 L2.5,2"/>',
    dreadnought: '<path d="M0,-6.8 L2.6,-4.4 L4.2,-4.4 L5,5.8 L-5,5.8 L-4.2,-4.4 L-2.6,-4.4 Z"/><circle class="ln" cx="0" cy="-0.5" r="1.6"/><circle class="ln" cx="0" cy="3.4" r="1.2"/>',
    warsun:      '<circle cx="0" cy="0" r="5.2"/><ellipse class="ln" cx="0" cy="0" rx="6.6" ry="2.2" transform="rotate(-25)"/><circle class="ln" cx="0" cy="0" r="2"/>',
    flagship:    '<path d="M0,-7 L1.9,-2.4 L6.8,-2.1 L3,1.1 L4.2,6 L0,3.3 L-4.2,6 L-3,1.1 L-6.8,-2.1 L-1.9,-2.4 Z"/>',
    infantry:    '<circle cx="0" cy="-4" r="2"/><path d="M-3,6 L-2.4,-1.4 L2.4,-1.4 L3,6 Z"/>',
    pds:         '<path d="M-4.5,6 L-3.4,-0.5 L3.4,-0.5 L4.5,6 Z"/><circle cx="0" cy="-3" r="2.6"/><path class="ln" d="M0,-3 L4.5,-6.5"/>',
    spacedock:   '<path d="M-6,-2.4 L-2.4,-6 L2.4,-6 L6,-2.4 L6,2.4 L2.4,6 L-2.4,6 L-6,2.4 Z"/><rect class="ln" x="-2.6" y="-2.6" width="5.2" height="5.2"/>',
  };
  ui.ICON_TYPES = Object.keys(SHAPES);

  // Inner SVG markup for one icon.
  ui.iconMarkup = function (type, color, opts) {
    opts = opts || {};
    const shape = SHAPES[type] || SHAPES.infantry;
    const stroke = type === 'flagship' ? '#ffd45e' : INK;
    const crack = opts.damaged ? '<path d="M-4,-5 L-1,-1 L-3,1 L2,6" fill="none" stroke="#ff4d4d" stroke-width="1.4"/>' : '';
    return `<g fill="${color}" stroke="${stroke}" stroke-width="0.9" stroke-linejoin="round" class="uicon">${shape}${crack}</g>`;
  };

  // Standalone <svg> for HTML (inspector, legend).
  ui.iconSvg = function (type, color, px, opts) {
    px = px || 22;
    return `<svg class="uicon-svg" width="${px}" height="${px}" viewBox="-7.5 -7.5 15 15" aria-hidden="true">${ui.iconMarkup(type, color, opts)}</svg>`;
  };

  // Legend as HTML.
  ui.legendHtml = function () {
    const names = { fighter: 'Fighter', destroyer: 'Destroyer', cruiser: 'Cruiser', carrier: 'Carrier', dreadnought: 'Dreadnought',
      warsun: 'War Sun', flagship: 'Flagship (gold outline)', infantry: 'Infantry / ground force', pds: 'PDS', spacedock: 'Space dock' };
    return '<div class="legend">' + ui.ICON_TYPES.map((t) => `<div class="lg">${ui.iconSvg(t, '#9fb4ff', 30)}<span>${names[t]}</span></div>`).join('') +
      `<div class="lg">${ui.iconSvg('cruiser', '#9fb4ff', 30, { damaged: true })}<span>Damaged unit (red crack)</span></div></div>
      <p class="note"><b>Greyed with a red slash:</b> that fleet is in a system holding its owner's command token (it was activated or moved into this round), so it cannot leave until the status phase clears the tokens. Icons take the owner's colour. A number after an icon is how many there are. Ground forces sit on their planet; ground forces riding in a ship's hold appear next to the fleet with a small <b>▲</b>. Click any system to inspect it; scroll to zoom, drag to pan.</p>`;
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
