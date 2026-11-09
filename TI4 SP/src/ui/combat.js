// Combat screens for battles you fight in. Two steps per round:
//   1. "before the roll": every unit on both sides with the number it needs to hit, and a Roll button
//   2. "results": every die with its result, then you pick which of your units take the hits
(function (root) {
  const TI = (root.TI = root.TI || {});
  const ui = (TI.ui = TI.ui || {});
  const h = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

  const where = (q) => (q.ground ? `Ground battle on ${ui.esc(q.planet.name)}` : `Space battle at ${ui.esc(ui.sysLabel(ui.ctx.state, q.sysId))}`);
  const roleOf = (q, p) => (q.attacker.id === p.id ? 'attacker' : 'defender');
  const unitLabel = (pl, u) => ui.esc(ui.unitName(pl, u.type));

  // Group identical units into one row: [{ type, damaged, units: [...], need, dice }]
  function groups(items) {
    const out = [];
    items.forEach((it) => {
      const g = out.find((x) => x.type === it.unit.type && x.damaged === !!it.unit.damaged && x.need === it.need && x.dice === it.dice);
      if (g) g.units.push(it.unit); else out.push({ type: it.unit.type, damaged: !!it.unit.damaged, need: it.need, dice: it.dice, units: [it.unit] });
    });
    return out;
  }
  const needText = (n) => (n <= 1 ? '1+ (always hits)' : n >= 10 ? '10 only' : n + '+');

  function sideBlock(state, pl, items, heading) {
    const col = ui.COLORS[pl.id];
    const rows = groups(items).map((g) => `<div class="cb-row">${ui.iconSvg(g.type, col, 30, { damaged: g.damaged })}
        <div class="cb-name"><b>${g.units.length > 1 ? '×' + g.units.length + ' ' : ''}${unitLabel(pl, { type: g.type })}</b>${g.damaged ? ' <span class="chip">damaged</span>' : ''}</div>
        <div class="cb-need">hits on <b>${needText(g.need)}</b>${g.dice > 1 ? ` <span class="note">(${g.dice} dice each)</span>` : ''}</div></div>`).join('');
    const dice = items.reduce((n, it) => n + it.dice, 0);
    return `<div class="cb-side"><div class="cb-head" style="border-color:${col}">${ui.esc(heading)}</div>${rows || '<div class="note">no units that can fire</div>'}<div class="note">${dice} dice to roll</div></div>`;
  }

  // Step 1: returns when you press Roll.
  ui.combatPre = function (state, p, q) {
    const me = p, foe = q.attacker.id === p.id ? q.defender : q.attacker, mySide = roleOf(q, p), foeSide = mySide === 'attacker' ? 'defender' : 'attacker';
    const notes = [];
    if (q.round === 1 && !q.ground) {
      const k = q.afb || { attacker: 0, defender: 0 };
      // afb.defender = fighters the attacker's barrage destroyed; afb.attacker = fighters the defender's barrage destroyed
      const mine = mySide === 'attacker' ? k.attacker : k.defender, theirs = mySide === 'attacker' ? k.defender : k.attacker;
      if (mine) notes.push(`Anti-fighter barrage destroyed ${mine} of your fighter(s).`);
      if (theirs) notes.push(`Your anti-fighter barrage destroyed ${theirs} enemy fighter(s).`);
      const ac = q.assaultCannon || {};
      if (ac[mySide === 'attacker' ? 'defender' : 'attacker']) notes.push('Assault Cannon destroyed one of your ships.');
      if (ac[mySide]) notes.push('Your Assault Cannon destroyed one of their ships.');
    }
    if (q.retreating !== null && q.retreating !== undefined) notes.push(`${ui.esc(state.players[q.retreating].name)} announced a retreat: they still take this round's hits, then leave.`);
    const wrap = document.createElement('div');
    wrap.appendChild(h(`<div class="note">Round ${q.round}. Roll a d10 for each die: a roll equal to or higher than the number shown is a hit. You are the <b>${mySide}</b> against <b>${ui.esc(foe.name)}</b>.</div>`));
    notes.forEach((n) => wrap.appendChild(h(`<div class="note cb-note">${n}</div>`)));
    wrap.appendChild(h(`<div class="cb-cols">${sideBlock(state, me, q.preview[mySide], `You — ${me.name}`)}${sideBlock(state, foe, q.preview[foeSide], foe.name)}</div>`));
    ui.setStatus(`${where(q).replace(/<[^>]+>/g, '')}: round ${q.round}`);
    return ui.modal({ title: `${where(q)} — round ${q.round}`, body: wrap, actions: [{ label: '🎲 Roll dice', value: true }] }).promise;
  };

  // Dice for one side, grouped by unit group.
  function diceBlock(state, pl, roll, heading) {
    const col = ui.COLORS[pl.id];
    const byUnit = new Map();
    roll.dice.forEach((d) => { if (!byUnit.has(d.unit)) byUnit.set(d.unit, []); byUnit.get(d.unit).push(d); });
    let delay = 0;
    const rows = [...byUnit.entries()].map(([u, ds]) => {
      const chips = ds.map((d) => {
        const shown = d.reroll !== null ? `<s>${d.r}</s>→${d.reroll}` : d.r;
        const cls = d.hit ? 'hit' : 'miss';
        return `<span class="die ${cls}" style="animation-delay:${(delay++ * 70)}ms" title="needs ${d.need}+">${shown}${d.boosted ? '★' : ''}${d.extra ? ' +' + d.extra : ''}</span>`;
      }).join('');
      return `<div class="cb-row">${ui.iconSvg(u.type, col, 26, { damaged: u.damaged })}<div class="cb-name">${unitLabel(pl, u)} <span class="note">needs ${needText(ds[0].need)}</span></div><div class="dice">${chips}</div></div>`;
    }).join('');
    const exp = roll.dice.filter((d) => !d.extra).reduce((n, d) => n + Math.max(0, Math.min(10, 11 - d.need)) / 10, 0);
    const bonus = (roll.bonus ? ` (+${roll.bonus} Valkyrie Particle Weave)` : '') + ` <span class="note" title="Average hits for these dice">expected ${exp.toFixed(1)}</span>`;
    return `<div class="cb-side"><div class="cb-head" style="border-color:${col}">${ui.esc(heading)} — <b>${roll.hits} hit${roll.hits === 1 ? '' : 's'}</b>${bonus}</div>${rows || '<div class="note">nothing rolled</div>'}</div>`;
  }

  // Step 2: shows the dice, then lets you pick casualties. Returns an array of units (one per hit).
  ui.combatResult = function (state, p, q) {
    const mySide = roleOf(q, p), foeSide = mySide === 'attacker' ? 'defender' : 'attacker';
    const foe = mySide === 'attacker' ? q.defender : q.attacker;
    const force = q.force.slice(), stats = q.stats, col = ui.COLORS[p.id];
    const plan = [];
    const wrap = document.createElement('div');
    wrap.appendChild(h(`<div class="cb-cols">${diceBlock(state, p, q.roll[mySide], `You — ${p.name}`)}${diceBlock(state, foe, q.roll[foeSide], foe.name)}</div>`));
    const assign = document.createElement('div'); assign.className = 'cb-assign';
    wrap.appendChild(assign);
    const info = { btn: null };
    const sust = (u) => stats[u.type].sustain && !u.damaged;
    const cost = (u) => (sust(u) && plan.indexOf(u) < 0 ? (stats[u.type].sustainCancel || 1) : 1);
    const used = () => plan.reduce((n, u, i) => { const first = plan.indexOf(u) === i; return n + (first && sust(u) ? (stats[u.type].sustainCancel || 1) : 1); }, 0);
    const state_ = (u) => { const c = plan.filter((x) => x === u).length; return sust(u) ? (c === 0 ? 'ok' : c === 1 ? 'dmg' : 'dead') : (c === 0 ? 'ok' : 'dead'); };
    const capacity = () => force.reduce((n, u) => n + (sust(u) ? 1 + (stats[u.type].sustainCancel || 1) : 1), 0);   // rough upper bound
    const left = () => q.hits - used();
    const auto = () => {
      plan.length = 0;
      const sorted = force.slice().sort((a, b) => lossRank(a) - lossRank(b));
      let hits = q.hits;
      for (const u of sorted) { if (hits <= 0) break; if (sust(u)) { plan.push(u); hits -= stats[u.type].sustainCancel || 1; } }
      for (const u of sorted) { if (hits <= 0) break; if (!sust(u) && plan.indexOf(u) < 0) { plan.push(u); hits--; } }
      for (const u of sorted) { if (hits <= 0) break; if (sust(u) && plan.filter((x) => x === u).length === 1) { plan.push(u); hits--; } }
    };
    const lossRank = (u) => { const s = stats[u.type]; return (sust(u) ? -1 : s.cost / s.batch + (u.damaged ? -0.5 : 0)); };
    const canHit = () => (q.hits > 0 && left() > 0);
    const draw = () => {
      if (q.hits === 0) { assign.innerHTML = '<div class="note cb-note">No hits against you this round.</div>'; if (info.btn) info.btn.disabled = false; return; }
      const done = left() <= 0 || force.every((u) => state_(u) === 'dead');
      assign.innerHTML = `<div class="cb-head" style="border-color:${col}">Assign ${q.hits} hit${q.hits === 1 ? '' : 's'} to your units — <b>${Math.max(0, left())} left</b></div>
        <div class="note">Click a unit to put a hit on it. Units that can sustain damage take the first hit as damage (click again to destroy them).</div><div class="cb-units"></div>
        <div class="cb-tools"><button class="secondary" data-a="auto">Auto-assign</button><button class="secondary" data-a="undo">Undo</button><button class="secondary" data-a="reset">Reset</button></div>`;
      const box = assign.querySelector('.cb-units');
      force.forEach((u) => {
        const st = state_(u);
        const b = document.createElement('button');
        b.className = 'cb-unit ' + st;
        b.innerHTML = `${ui.iconSvg(u.type, col, 34, { damaged: u.damaged || st === 'dmg' })}<span>${unitLabel(p, u)}</span><span class="note">${st === 'dead' ? 'destroyed' : st === 'dmg' ? 'damaged' : u.damaged ? 'already damaged' : sust(u) ? 'can sustain' : ''}</span>`;
        b.addEventListener('click', () => { if (st === 'dead' || !canHit()) return; if (st === 'dmg' && !(left() >= 1)) return; plan.push(u); draw(); });
        box.appendChild(b);
      });
      assign.querySelector('[data-a="auto"]').addEventListener('click', () => { auto(); draw(); });
      assign.querySelector('[data-a="undo"]').addEventListener('click', () => { plan.pop(); draw(); });
      assign.querySelector('[data-a="reset"]').addEventListener('click', () => { plan.length = 0; draw(); });
      if (info.btn) info.btn.disabled = !done;
    };
    ui.setStatus(`${where(q).replace(/<[^>]+>/g, '')}: round ${q.round} results`);
    const m = ui.modal({ title: `${where(q)} — round ${q.round} results`, body: wrap, actions: [{ label: q.hits ? 'Confirm casualties' : 'Continue', value: () => plan.slice() }] });
    info.btn = m.buttons[0];
    draw();
    return m.promise;
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
