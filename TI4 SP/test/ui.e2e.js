// End-to-end UI test: loads index.html in headless Chromium and plays a whole game as the human by
// clicking through the real dialogs. Fails on any page error or console error.
// Usage: node test/ui.e2e.js   (needs playwright; see README)
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForSelector('#modal-root:not([hidden])');
  await page.selectOption('#s-speed', '60');
  await page.selectOption('#s-bots', '2');
  const FACTION = process.env.FACTION || 'sol';
  await page.selectOption('#s-fac', FACTION);
  // opponents: the other factions that exercise the most hooks
  const rivals = ['hacan', 'xxcha', 'jolnar', 'letnev', 'sardakk', 'sol'].filter((f) => f !== FACTION).slice(0, 2);
  const botSel = page.locator('.b-fac');
  for (let i = 0; i < 2; i++) await botSel.nth(i).selectOption(rivals[i]);

  const seen = {};
  const cardNames = await page.evaluate(() => TI.ACTION_CARDS.map((c) => c.name));
  const abilityUsed = {};
  let tacticalsThisRound = {};
  let done = false, steps = 0;
  const shots = [];

  while (!done && steps < 3000) {
    steps++;
    const info = await page.evaluate(() => {
      const root = document.getElementById('modal-root');
      const ctx = TI.ui.ctx;
      const st = ctx.state;
      return {
        modal: !root.hidden, title: document.getElementById('modal-title').textContent,
        pick: ctx.mapOpts && ctx.mapOpts.pick ? [...ctx.mapOpts.pick] : null,
        round: st ? st.round : 0, phase: st ? st.phase : '', tactic: st ? st.players[0].tokens.tactic : 0,
        home: st ? st.map.order.find((id) => st.map.systems[id].home === 0) : null,
        nbrs: st ? st.map.systems[st.map.order.find((id) => st.map.systems[id].home === 0)].adj.filter((id) => st.map.systems[id].planets.length && !st.map.systems[id].anomaly) : [],
        tokens: st ? st.map.systems[st.map.order.find((id) => st.map.systems[id].home === 0)].tokens || [] : [],
      };
    });

    if (!info.modal && info.pick) {
      // choose a system: prefer our home (activating it to produce is always legal when untokened)
      // first tactical each round: a neighbour (exercises move + invade); second: home (production)
      const n = tacticalsThisRound[info.round] || 0;
      const nb = info.nbrs.find((x) => info.pick.includes(x));
      const id = n <= 1 && nb ? nb : info.pick.includes(info.home) ? info.home : info.pick[0];
      await page.evaluate((id) => TI.ui.ctx.mapOpts.onPick(id), id);
      seen['pickSystem'] = (seen['pickSystem'] || 0) + 1;
      continue;
    }
    if (!info.modal) { await page.waitForTimeout(40); continue; }

    const t = info.title;
    seen[t.replace(/[0-9,\-]+/g, '#')] = (seen[t.replace(/[0-9,\-]+/g, '#')] || 0) + 1;
    const clickBtn = (text) => page.locator('#modal-actions button', { hasText: text }).first().click();

    if (t === 'New game') await clickBtn('Start game');
    else if (t === 'Choose a strategy card' && !seen.injected) {
      seen.injected = 1; await page.evaluate(() => { TI.ui.ctx.state.players[0].hand = ['uprising', 'war_effort', 'rise_of_a_messiah']; TI.ui.redraw(); });
      await page.locator('#modal-body .opt').first().click();
    }
    else if (t === 'Choose a strategy card') await page.locator('#modal-body .opt').first().click();
    else if (t === 'Choose your action') {
      if (!seen.lockShot && await page.evaluate(() => { const st = TI.ui.ctx.state; return st.map.order.some((id) => (st.map.systems[id].tokens || []).includes(0) && (st.map.systems[id].ships[0] || []).length); })) { seen.lockShot = 1; await page.locator('#modal-peek').click(); await page.screenshot({ path: path.resolve(__dirname, 'locked.png') }); await page.locator('#peek-tab').click(); }
      const key = info.round + ':' + info.phase;
      const opts = await page.locator('#modal-body .opt:not(.disabled)').allTextContents();
      const tactical = opts.findIndex((o) => o.startsWith('Tactical'));
      const strategic = opts.findIndex((o) => o.startsWith('Strategic'));
      const pass = opts.findIndex((o) => o.startsWith('Pass'));
      const ability = opts.findIndex((o) => o.startsWith('Faction action'));
      const acard = opts.findIndex((o) => o.startsWith('Action card'));
      tacticalsThisRound[info.round] = (tacticalsThisRound[info.round] || 0);
      let idx;
      if (acard >= 0 && !seen.acPlayed) { idx = acard; seen.acPlayed = 1; }
      else if (ability >= 0 && !abilityUsed[info.round]) { idx = ability; abilityUsed[info.round] = 1; seen['ability used'] = (seen['ability used'] || 0) + 1; }
      else if (tactical >= 0 && tacticalsThisRound[info.round] < 2) { idx = tactical; tacticalsThisRound[info.round]++; }
      else if (strategic >= 0) idx = strategic;
      else idx = pass;
      await page.locator('#modal-body .opt:not(.disabled)').nth(idx).click();
    }
    else if (t.startsWith('Move ships')) {
      await clickBtn('Suggest');
      await page.waitForTimeout(30);
      const ok = await page.locator('#modal-actions button', { hasText: 'Confirm move' }).isEnabled();
      await clickBtn(ok ? 'Confirm move' : 'Move nothing');
    }
    else if (t === 'Invasion') await clickBtn('Land');
    else if (t.startsWith('Produce')) {
      const plus = page.locator('#modal-body button', { hasText: '+' });
      await plus.nth(0).click();            // one carrier
      await plus.nth(5).click();            // one infantry (6th stepper)
      const ok = await page.locator('#modal-actions button', { hasText: 'Build' }).last().isEnabled();
      await clickBtn(ok ? 'Build' : 'Build nothing');
    }
    else if (t.startsWith('Follow')) await clickBtn('Follow');
    else if (t === 'Command tokens') {
      for (let i = 0; i < 6; i++) {
        if (await page.locator('#modal-actions button', { hasText: 'Confirm' }).isEnabled()) break;
        await page.locator('#modal-body button', { hasText: '+' }).first().click();
      }
      await clickBtn('Confirm');
    }
    else if (t.startsWith('Keep one secret') || t.startsWith('Return a secret') || /^Pay \d+ command tokens/.test(t)) await page.locator('#modal-body .opt').first().click();
    else if (/ — round \d+$/.test(t)) { if (!seen.pre) { seen.pre = 1; await page.screenshot({ path: path.resolve(__dirname, 'combat_pre.png') }); } await clickBtn('Roll dice'); }
    else if (/ — round \d+ results$/.test(t)) {
      if (await page.locator('.cb-tools').count()) await page.locator('.cb-tools button', { hasText: 'Auto-assign' }).click();
      if (!seen.res) { seen.res = 1; await page.waitForTimeout(1500); await page.screenshot({ path: path.resolve(__dirname, 'combat_res.png') }); }
      await clickBtn(/Confirm casualties|Continue/.test(await page.locator('#modal-actions button').first().textContent()) ? await page.locator('#modal-actions button').first().textContent() : 'Continue');
    }
    else if (t.startsWith('Redistribute command tokens')) await clickBtn('Keep as is');
    else if (/: retreat\?$/.test(t)) await page.locator('#modal-body .opt', { hasText: 'Keep fighting' }).first().click();
    else if (t.startsWith('Score')) await page.locator('#modal-body .opt').first().click();
    else if (t.startsWith('Research')) await page.locator('#modal-body .opt').first().click();
    else if (t === 'Buy command tokens') await clickBtn('Confirm');
    else if (t.startsWith('Choose the new speaker')) await page.locator('#modal-body .opt').first().click();
    else if (t.startsWith('Place structure')) await page.locator('#modal-body .opt').first().click();
    else if (/^(Orbital Drop|Production Biomes|Peace Accords|Quantum Datahub)/.test(t)) await page.locator('#modal-body .opt').first().click();
    else if (t === 'Nullification Field') await clickBtn('Nullify');
    else if (/wins|You win/.test(t)) { done = true; if (!shots.length) { await page.screenshot({ path: path.resolve(__dirname, 'final.png') }); shots.push(1); } await clickBtn('Close'); }
    else if (t === 'Cancel this action card?' || t === 'Play an action card?') {
      seen.cardDlg = (seen.cardDlg || 0) + 1;
      if (seen.cardDlg % 2 === 1) await page.locator('#modal-body .opt').first().click();
      else await page.locator('#modal-body .opt', { hasText: "Don't play a card" }).first().click();
    }
    else if (t === 'This action may accomplish nothing') await clickBtn('Activate anyway');
    else if (t.startsWith('Vote: ')) await page.locator('#modal-body .opt').first().click();
    else if (t.startsWith('How many votes')) await clickBtn('Cast votes');
    else if (/: you decide$/.test(t) || t === 'Imperial Arbiter: swap strategy cards') await page.locator('#modal-body .opt').first().click();
    else if (['Quash', 'The Crown of Thalnos', 'Minister of Peace', 'Minister of War', 'Committee Formation', 'Imperial Arbiter'].includes(t)) await page.locator('#modal-actions button').first().click();
    else if (t.startsWith('Hand limit') || t.startsWith('Choose one of your ships')) await page.locator('#modal-body .opt').first().click();
    else if (cardNames.includes(t)) await page.locator('#modal-body .opt').first().click();
    else if (t.startsWith('Trade offer')) await clickBtn(seen['tradeAccepted'] ? 'Decline' : 'Accept'), seen['tradeAccepted'] = 1;
    else if (t === 'Replenish other players?') await clickBtn('Done');
    else if (t === 'Foresight') await page.locator('#modal-body .opt').last().click();
    else if (t === 'Galactic Threat') await page.locator('#modal-body .opt').first().click();
    else if (t === 'Bioplasmosis') await page.locator('#modal-body .opt').first().click();
    else { errors.push('unhandled dialog: ' + t); break; }

    if (steps === 60) await page.screenshot({ path: path.resolve(__dirname, 'mid.png') });
  }

  const final = await page.evaluate(() => { const s = TI.ui.ctx.state; return { round: s.round, vps: s.players.map((p) => p.vp), winner: s.winner, logLines: s.log.length }; });
  console.log('faction', FACTION, 'vs', rivals.join(', '));
  console.log('dialogs seen:', JSON.stringify(seen));
  console.log('final:', JSON.stringify(final), 'steps:', steps);
  await browser.close();
  if (!done) errors.push('game did not finish within the step budget');
  if (errors.length) { console.error('\nFAILED:\n' + errors.join('\n')); process.exit(1); }
  console.log('UI end-to-end test passed');
})();
