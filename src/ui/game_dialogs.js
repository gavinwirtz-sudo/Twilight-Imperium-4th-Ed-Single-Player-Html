// Dialogs for the three multi-part decisions: movement, invasion, production.
(function (root) {
  const TI = (root.TI = root.TI || {});
  const ui = (TI.ui = TI.ui || {});
  const h = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
  const $ = (id) => document.getElementById(id);
  const label = (p, u) => ui.unitName(p, u.type) + (u.damaged ? ' (damaged)' : '');

  // ---- movement -----------------------------------------------------------------------------
  // -> { ships: [{from, unit}], ground: [{from, planetIdx, unit}] }
  ui.moveDialog = async function (state, p, targetId) {
    const S = state.map.systems, target = S[targetId], pid = p.id;
    const allMov = TI.movableShips(state, p, targetId);
    const legal = allMov.filter((m) => m.unit.type !== 'fighter');
    if (!allMov.length) return { ships: [], ground: [] };
    const distFrom = (src) => { const m = allMov.find((x) => x.from === src); return m ? m.dist : 1; };

    const existing = target.ships[pid] || [];
    const existingNon = existing.filter((u) => u.type !== 'fighter').length;
    const baseUsed = existing.filter((u) => u.type === 'fighter').length + TI.cargoOf(target, pid).length;
    const limit = TI.fleetLimit(p);

    const wrap = document.createElement('div');
    wrap.appendChild(h(`<div class="note">Activating <b>${ui.esc(ui.sysLabel(state, targetId))}</b>. Pick ships to send, then fighters and ground forces to carry. Ships in systems that already hold your command token can't move.</div>`));
    const status = h('<div class="group"></div>');
    const checks = [], fighterSteppers = [], groundSteppers = [], aboardSteppers = [];
    let confirmBtn = null;
    // Fighter II fighters (no transport needed) that can reach the target on their own.
    const soloFighters = new Set(allMov.filter((m) => m.unit.type === 'fighter').map((m) => m.from));
    const sources = [...new Set(legal.map((m) => m.from).concat([...soloFighters]))];

    const evaluate = () => {
      const chosen = checks.filter((c) => c.input.checked).map((c) => c.m);
      const fighters = [], ground = [];
      for (const fs of fighterSteppers) {
        const hasShip = chosen.some((m) => m.from === fs.src) || soloFighters.has(fs.src);
        fs.units.slice(0, hasShip ? fs.stepper.get() : 0).forEach((u) => fighters.push({ from: fs.src, unit: u }));
      }
      for (const gs of groundSteppers) {
        const hasShip = chosen.some((m) => m.from === gs.src);
        gs.units.slice(0, hasShip ? gs.stepper.get() : 0).forEach((u) => ground.push({ from: gs.src, planetIdx: gs.planetIdx, unit: u }));
      }
      const cargo = [];
      for (const as of aboardSteppers) as.units.slice(0, chosen.some((m) => m.from === as.src) ? as.stepper.get() : 0).forEach((u) => cargo.push({ from: as.src, unit: u }));
      const after = existing.concat(chosen.map((m) => m.unit), fighters.map((f) => f.unit));
      let nonF = existingNon + chosen.length;
      const cap = TI.cargoCapacity(p, after);
      let used = baseUsed + fighters.length + ground.length + cargo.length;
      if (p.stats.fighter.move > 0) {
        // Fighter II: fighters only take up fleet supply when they exceed the carrying capacity
        const groundUsed = TI.cargoOf(target, pid).length + ground.length + cargo.length, fightersAfter = existing.filter((u) => u.type === 'fighter').length + fighters.length;
        nonF += Math.max(0, fightersAfter - Math.max(0, cap - groundUsed));
        used = groundUsed;
      }
      let msg = '', ok = true;
      if (chosen.filter((m) => m.bonus).length > 1) { ok = false; msg = 'Gravity Drive helps only 1 ship.'; }
      else if (nonF > limit) { ok = false; msg = `Fleet supply exceeded (${nonF}/${limit}).`; }
      else if (used > cap) { ok = false; msg = `Over capacity (${used}/${cap}).`; }
      status.innerHTML = `Ships ${nonF}/${limit} fleet supply · Cargo ${used}/${cap} capacity` + (msg ? ` · <span class="warn">${msg}</span>` : '');
      // Ground forces left aboard in a system need a ship (with room) staying there.
      for (const as of aboardSteppers) {
        const gone = new Set(chosen.filter((m) => m.from === as.src).map((m) => m.unit));
        const rest = (S[as.src].ships[pid] || []).filter((u) => !gone.has(u));
        const left = as.units.length - cargo.filter((c) => c.from === as.src).length;
        const stay = Math.max(0, TI.cargoCapacity(p, rest) - rest.filter((u) => u.type === 'fighter').length);
        if (left > stay) { ok = false; msg = `${left - stay} ground force${left - stay > 1 ? 's' : ''} aboard in ${as.src} would be stranded: carry them or keep a ship with room.`; }
      }
      status.innerHTML = `Ships ${nonF}/${limit} fleet supply · Cargo ${used}/${cap} capacity` + (msg ? ` · <span class="warn">${msg}</span>` : '');
      return { ok, plan: { ships: chosen.map((m) => ({ from: m.from, unit: m.unit })).concat(fighters), ground, cargo } };
    };
    const refresh = () => { const r = evaluate(); if (confirmBtn) confirmBtn.disabled = !r.ok; };

    for (const src of sources) {
      const grp = h(`<div class="group"><h4>From ${ui.esc(ui.sysLabel(state, src))} (${distFrom(src)} jump${distFrom(src) > 1 ? 's' : ''})</h4></div>`);
      legal.filter((m) => m.from === src).forEach((m) => {
        const lab = document.createElement('label'); lab.className = 'check';
        const cb = document.createElement('input'); cb.type = 'checkbox';
        cb.addEventListener('change', refresh);
        lab.append(cb, document.createTextNode(` ${label(p, m.unit)} (move ${p.stats[m.unit.type].move}, cap ${p.stats[m.unit.type].cap})${m.bonus ? ' · needs Gravity Drive +1' : ''}`));
        grp.appendChild(lab);
        checks.push({ m, input: cb });
      });
      const fighters = (S[src].ships[pid] || []).filter((u) => u.type === 'fighter');
      if (fighters.length) {
        const row = h('<div class="row"><label>Fighters to carry</label></div>');
        const st = ui.stepper(0, fighters.length, 0, refresh);
        row.appendChild(st.node); grp.appendChild(row);
        fighterSteppers.push({ src, units: fighters, stepper: st });
      }
      const aboard = TI.cargoOf(S[src], pid);
      if (aboard.length) {
        const row = h('<div class="row"><label>Ground forces aboard (space area) to carry</label></div>');
        const st = ui.stepper(0, aboard.length, 0, refresh);
        row.appendChild(st.node); grp.appendChild(row);
        aboardSteppers.push({ src, units: aboard.slice(), stepper: st });
      }
      S[src].planets.forEach((pl, idx) => {
        if (pl.owner !== pid || !pl.ground.length) return;
        const row = h(`<div class="row"><label>Ground from ${ui.esc(pl.name)}</label></div>`);
        const st = ui.stepper(0, pl.ground.length, 0, refresh);
        row.appendChild(st.node); grp.appendChild(row);
        groundSteppers.push({ src, planetIdx: idx, units: pl.ground.slice(), stepper: st });
      });
      wrap.appendChild(grp);
    }
    wrap.appendChild(status);

    const apply = (plan) => {
      const ships = new Set(plan.ships.map((s) => s.unit));
      checks.forEach((c) => { c.input.checked = ships.has(c.m.unit); });
      fighterSteppers.forEach((fs) => fs.stepper.set(plan.ships.filter((s) => s.unit.type === 'fighter' && s.from === fs.src).length));
      groundSteppers.forEach((gs) => gs.stepper.set(plan.ground.filter((g) => g.from === gs.src && g.planetIdx === gs.planetIdx).length));
      aboardSteppers.forEach((as) => as.stepper.set((plan.cargo || []).filter((c) => c.from === as.src).length));
      refresh();
    };

    const m = ui.modal({ title: `Move ships to ${ui.sysLabel(state, targetId)}`, body: wrap, actions: [
      { label: 'Suggest', cls: 'secondary', value: () => 'suggest' },
      { label: 'Move nothing', cls: 'secondary', value: () => ({ ships: [], ground: [] }) },
      { label: 'Confirm move', value: () => evaluate().plan },
    ] });
    confirmBtn = m.buttons[2];
    // "Suggest" must not close the dialog: re-bind it
    m.buttons[0].replaceWith(m.buttons[0].cloneNode(true));
    const sug = document.getElementById('modal-actions').children[0];
    sug.addEventListener('click', () => apply(TI.botPlan(state, p, targetId, TI.BOT_STYLES.expander).plan));
    refresh();
    return m.promise;
  };

  // ---- invasion -----------------------------------------------------------------------------
  // -> [{ planetIdx, units }]
  ui.invasionDialog = async function (state, p, sysId) {
    const sys = state.map.systems[sysId], cargo = TI.cargoOf(sys, p.id).slice();
    if (!cargo.length) return [];
    const wrap = document.createElement('div');
    wrap.appendChild(h(`<div class="note">${cargo.length} ground force(s) in orbit at <b>${ui.esc(ui.sysLabel(state, sysId))}</b>. Choose how many to land on each planet. Anything left stays aboard.</div>`));
    const rows = [];
    const total = () => rows.reduce((n, r) => n + r.st.get(), 0);
    const sync = () => rows.forEach((r) => r.st.setMax(Math.min(r.cap, r.st.get() + cargo.length - total())));
    sys.planets.forEach((pl, idx) => {
      const owner = pl.owner === null ? 'unclaimed' : pl.owner === p.id ? 'yours' : state.players[pl.owner].name;
      const def = pl.owner !== null && pl.owner !== p.id ? ` · defenders ${pl.ground.length}${pl.pds ? ', PDS ' + pl.pds : ''}` : '';
      const custodians = pl.mecatol && state.custodians === null ? ` · <b>landing here removes the custodians token: spend 6 influence (you can pay ${TI.spendable(state, p, 'inf')}), then +1 VP</b>` : '';
      const row = h(`<div class="group"><h4>${ui.esc(pl.name)} · ${pl.res}R/${pl.inf}I · ${owner}${def}${custodians}</h4></div>`);
      const locked = pl.dmz || (pl.mecatol && state.custodians === null && !TI.canSpend(state, p, 'inf', 6));
      const st = ui.stepper(0, locked ? 0 : cargo.length, 0, sync);
      if (!pl.dmz && locked) row.querySelector('h4').insertAdjacentHTML('beforeend', ' · <b>cannot land: you need 6 influence to remove the custodians token</b>');
      if (pl.dmz) row.querySelector('h4').insertAdjacentHTML('beforeend', ' · <b>Demilitarized Zone: nobody can land here</b>');
      const line = h('<div class="row"><label>Land</label></div>'); line.appendChild(st.node); row.appendChild(line);
      wrap.appendChild(row);
      rows.push({ idx, st, cap: locked ? 0 : cargo.length });
    });
    const m = ui.modal({ title: 'Invasion', body: wrap, actions: [
      { label: 'Keep aboard', cls: 'secondary', value: () => [] },
      { label: 'Land', value: () => {
          const out = []; let i = 0;
          rows.forEach((r) => { const n = r.st.get(); if (n) { out.push({ planetIdx: r.idx, units: cargo.slice(i, i + n) }); i += n; } });
          return out;
        } },
    ] });
    return m.promise;
  };

  // ---- production ---------------------------------------------------------------------------
  // -> [{ unit }]
  ui.productionDialog = async function (state, p, sysId, opts) {
    opts = opts || {};
    const sys = state.map.systems[sysId];
    const dock = sys.planets.find((pl) => pl.owner === p.id && pl.dock) || (opts.noDock ? { name: opts.why || 'your ability', res: 0 } : null);
    if (!dock) return [];
    const budget = TI.available(state, p).res + p.tg;
    const limit = opts.noDock ? (opts.limit || 99) : dock.res + 2 + (TI.hasTechEffect(p, 'productionBonus') ? 1 : 0);
    const ships = sys.ships[p.id] || [];
    const slots = TI.fleetLimit(p) - ships.filter((u) => u.type !== 'fighter').length;
    const hasFlagship = TI.countShips(state, p, ['flagship']) > 0;
    const types = ['carrier', 'cruiser', 'destroyer', 'dreadnought', 'fighter', 'infantry']
      .concat(TI.canBuildWarsun(p) ? ['warsun'] : []).concat(hasFlagship ? [] : ['flagship']).filter((t) => !opts.types || opts.types.includes(t));
    const discount = TI.hasTechEffect(p, 'productionDiscount') ? 1 : 0;   // Sarween Tools
    const enemyHere = TI.hasOtherShips(sys, p.id);                       // no ships can be built while enemy ships sit here
    const leftOf = (t) => TI.unitsLeft(state, p, t);

    const wrap = document.createElement('div');
    if (slots <= 0) wrap.appendChild(h(`<div class="note warn"><b>Fleet supply is full here</b> (${TI.fleetLimit(p)} non-fighter ships per system), so only fighters and ground forces can be built. Move ships out first, or put more tokens in your fleet pool.</div>`));
    if (enemyHere) wrap.appendChild(h('<div class="note warn"><b>Enemy ships are in this system, so you cannot build ships here</b> (only ground forces).</div>'));
    wrap.appendChild(h(`<div class="note">${opts.noDock ? `<b>${ui.esc(dock.name)}</b>: produce up to ${limit} unit${limit === 1 ? '' : 's'} here (no space dock needed).` : `Space dock on <b>${ui.esc(dock.name)}</b> can produce up to ${limit} units.`} You can spend ${budget} resources (planets + trade goods). Fleet supply leaves room for ${Math.max(0, slots)} more non-fighter ship(s).${discount ? ' Sarween Tools: total cost -1.' : ''}</div>`));
    const status = h('<div class="group"></div>');
    const counts = {};
    let confirmBtn = null;
    const rows = types.map((t) => {
      const st = p.stats[t];
      const nm = ui.unitName(p, t), shown = nm[0].toUpperCase() + nm.slice(1);
      const lim = leftOf(t), shipBlocked = enemyHere && st.type === 'ship';
      const row = h(`<div class="row"><label>${ui.esc(shown)} — ${st.cost} res${st.batch > 1 ? ' for ' + st.batch : ''}${lim !== Infinity ? ` · <span class="note">${Math.max(0, lim)} left in reinforcements</span>` : ''}${shipBlocked ? ' · <span class="warn">blocked</span>' : ''}</label></div>`);
      const s = ui.stepper(0, shipBlocked ? 0 : t === 'flagship' ? Math.min(1, Math.max(0, lim)) : Math.min(8, Math.max(0, lim)), 0, evaluate);
      row.appendChild(s.node); wrap.appendChild(row); counts[t] = s;
      return row;
    });
    wrap.appendChild(status);

    function evaluate() {
      let cost = 0, units = 0, nonF = 0;
      for (const t of types) {
        const n = counts[t].get(), st = p.stats[t];
        cost += n * st.cost; units += n * st.batch;
        if (st.type === 'ship' && t !== 'fighter') nonF += n;
      }
      if (units > 0) cost = Math.max(0, cost - discount);
      let msg = '';
      if (cost > budget) msg = 'Not enough resources.';
      else if (units > limit) msg = 'Over the dock limit.';
      else if (nonF > Math.max(0, slots)) msg = 'Over fleet supply.';
      status.innerHTML = `Cost ${cost}/${budget} · Units ${units}/${limit}` + (msg ? ` · <span class="warn">${msg}</span>` : '');
      if (confirmBtn) confirmBtn.disabled = !!msg;
      return !msg;
    }
    const m = ui.modal({ title: opts.noDock ? `Produce at ${ui.sysLabel(state, sysId)} (${opts.why || 'special ability'})` : `Produce at ${ui.sysLabel(state, sysId)}`, body: wrap, actions: [
      { label: 'Build nothing', cls: 'secondary', value: () => [] },
      { label: 'Build', value: () => { const out = []; for (const t of types) for (let i = 0; i < counts[t].get(); i++) out.push({ unit: t }); return out; } },
    ] });
    confirmBtn = m.buttons[1];
    evaluate();
    return m.promise;
  };

  
  // ---- the human's trade dialog: pick a partner, set both sides, the partner answers at once -------------
  ui.openTrade = async function (fromAction) {
    const state = ui.ctx.state, me = state && state.players[ui.ctx.humanId];
    if (!me || (!fromAction && !$('modal-root').hidden)) return;
    if (state.turnPlayer !== me.id) { ui.setHint('<b>You can trade on your own turn.</b>'); setTimeout(() => ui.setHint(''), 2500); return; }
    for (;;) {
      const partners = TI.dealPartners(state, me);
      const opts = partners.map((o) => ({ label: `${o.name} (${TI.faction(o).name})`, sub: `${o.tg} trade goods · ${TI.commOf(o)} commodities${TI.cardsAllowed(me, o) ? ' · ' + o.hand.length + ' action cards' : ''}`, value: o }));
      if (!opts.length) { await ui.modal({ title: 'Trade', body: '<p>You have no one left to trade with this turn (one transaction per neighbor per turn, neighbors only unless you are Hacan).</p>', actions: [{ label: 'Close', value: true }] }).promise; return; }
      const to = await ui.choose('Trade with whom?', opts, { note: `Neighbors share or touch a system with you. One transaction per partner per turn. You have <b>${me.tg}</b> trade goods and <b>${TI.commOf(me)}</b> commodities.`, cancel: 'Close' });
      if (!to) return;
      const cards = TI.cardsAllowed(me, to);
      const body = document.createElement('div');
      const give = { tg: 0, comm: 0, cards: [] }, get = { tg: 0, comm: 0, cards: [] };
      const verdict = document.createElement('div'); verdict.className = 'note'; verdict.style.marginTop = '8px';
      const refresh = () => {
        const pr = TI.offerProblem(state, me, to, TI.makeOffer(give, get));
        verdict.innerHTML = pr ? ui.esc(pr) : `You give <b>${TI.describeSide(give)}</b> and receive <b>${TI.describeSide(get)}</b>.`;
      };
      const row = (label, obj, key, max) => {
        const r = document.createElement('div'); r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:4px 0';
        r.innerHTML = `<span>${label} <span class="note">(max ${max})</span></span>`;
        r.appendChild(ui.stepper(0, max, 0, (v) => { obj[key] = v; refresh(); }).node);
        return r;
      };
      const cardList = (obj, hand, title) => {
        const d = document.createElement('div');
        if (!cards || !hand.length) return d;
        d.innerHTML = `<div class="note" style="margin-top:4px">${title}</div>`;
        hand.forEach((id) => {
          const l = document.createElement('label'); l.style.display = 'block';
          l.innerHTML = `<input type="checkbox"> ${ui.esc(TI.ACTION_BY_ID[id].name)}`;
          l.querySelector('input').addEventListener('change', (e) => { if (e.target.checked) obj.cards.push(id); else obj.cards.splice(obj.cards.indexOf(id), 1); refresh(); });
          d.appendChild(l);
        });
        return d;
      };
      const h1 = document.createElement('h4'); h1.textContent = `You give to ${to.name}`;
      const h2 = document.createElement('h4'); h2.textContent = `${to.name} gives you`;
      body.append(h1, row('Trade goods', give, 'tg', me.tg), row('Commodities', give, 'comm', TI.commOf(me)), cardList(give, me.hand, 'Your action cards:'),
                  h2, row('Trade goods', get, 'tg', to.tg), row('Commodities', get, 'comm', TI.commOf(to)), cardList(get, to.hand, `${to.name}'s action cards:`), verdict);
      const n = document.createElement('div'); n.className = 'note'; n.textContent = 'Commodities you give become trade goods for the receiver. Both sides must give something.';
      body.prepend(n);
      refresh();
      const go = await ui.modal({ title: `Offer to ${to.name}`, body, actions: [{ label: 'Back', value: 'back', cls: 'secondary' }, { label: 'Propose', value: 'go' }, { label: 'Close', value: 'close', cls: 'secondary' }] }).promise;
      if (go === 'close') return;
      if (go !== 'go') continue;
      const offer = TI.makeOffer(give, get);
      const pr = TI.offerProblem(state, me, to, offer);
      if (pr) { await ui.modal({ title: 'Cannot propose that', body: `<p>${ui.esc(pr)}</p>`, actions: [{ label: 'OK', value: true }] }).promise; continue; }
      const ok = await TI.propose(state, ui.ctx.agents, me, to, offer);
      ui.refresh();
      await ui.modal({ title: ok ? 'Deal!' : `${to.name} declines`, body: `<p>${ok ? 'The trade goes through.' : ui.esc(to.name) + ' is not interested in that offer. Try sweetening it: bots like trade goods more than their own commodities, and will not help a player close to winning.'}</p>`, actions: [{ label: 'OK', value: true }] }).promise;
    }
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);
