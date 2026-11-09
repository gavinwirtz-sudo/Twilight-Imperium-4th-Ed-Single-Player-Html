// Save/continue: play some turns, reload the page (as if the computer was closed), continue the saved game.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const ctxb = await browser.newContext({ viewport: { width: 1300, height: 800 } });
  const page = await ctxb.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  await page.goto(url);
  await page.waitForSelector('#modal-root:not([hidden])');
  await page.selectOption('#s-speed', '60'); await page.selectOption('#s-bots', '2');
  await page.locator('#modal-actions button', { hasText: 'Start game' }).click();
  // play until the human has taken two actions in round 1
  for (let i = 0; i < 400; i++) {
    const t = await page.evaluate(() => { const r = document.getElementById('modal-root'); const st = TI.ui.ctx.state; return { m: !r.hidden, title: document.getElementById('modal-title').textContent, turn: st ? st.turnNo : 0, round: st ? st.round : 0, phase: st ? st.phase : '' }; });
    if (t.phase === 'action' && t.turn >= 4 && t.m && t.title === 'Choose your action') break;
    if (!t.m) { await page.evaluate(() => { const c = TI.ui.ctx; if (c.mapOpts && c.mapOpts.pick) c.mapOpts.onPick([...c.mapOpts.pick][0]); }); await page.waitForTimeout(40); continue; }
    if (t.title.startsWith('Keep one secret') || t.title === 'Choose a strategy card') await page.locator('#modal-body .opt').first().click();
    else if (t.title === 'Choose your action') { const o = await page.locator('#modal-body .opt:not(.disabled)').allTextContents(); await page.locator('#modal-body .opt:not(.disabled)').nth(Math.max(0, o.findIndex((x) => x.startsWith('Strategic')))).click(); }
    else if (t.title === 'This action may accomplish nothing') await page.locator('#modal-actions button', { hasText: 'Activate anyway' }).click();
    else if (t.title.startsWith('Move ships')) await page.locator('#modal-actions button', { hasText: 'Move nothing' }).click();
    else if (t.title === 'Invasion') await page.locator('#modal-actions button', { hasText: 'Keep aboard' }).click();
    else if (t.title === 'Command tokens') {
      for (let k = 0; k < 6 && !(await page.locator('#modal-actions button', { hasText: 'Confirm' }).isEnabled()); k++) await page.locator('#modal-body button', { hasText: '+' }).first().click();
      await page.locator('#modal-actions button', { hasText: 'Confirm' }).click();
    }
    else if (/^Follow/.test(t.title)) await page.locator('#modal-actions button', { hasText: 'Follow' }).click();
    else if (await page.locator('#modal-body .opt').count()) await page.locator('#modal-body .opt').first().click().catch(() => {});
    else await page.locator('#modal-actions button').last().click().catch(() => {});
  }
  const before = await page.evaluate(() => { const st = TI.ui.ctx.state; return { round: st.round, turn: st.turnNo, vps: st.players.map((p) => p.vp), tg: st.players.map((p) => p.tg), pass: st.players.map((p) => p.passed) }; });
  await page.reload();
  await page.waitForSelector('#modal-root:not([hidden])');
  const title = await page.locator('#modal-title').textContent();
  if (title !== 'Saved game found') errors.push('expected the saved-game prompt, got: ' + title);
  await page.locator('#modal-actions button', { hasText: 'Continue saved game' }).click();
  await page.waitForFunction(() => TI.ui.ctx.state && !document.getElementById('modal-root').hidden && document.getElementById('modal-title').textContent === 'Choose your action', null, { timeout: 15000 });
  const after = await page.evaluate(() => { const st = TI.ui.ctx.state; return { round: st.round, turn: st.turnNo, vps: st.players.map((p) => p.vp), tg: st.players.map((p) => p.tg), pass: st.players.map((p) => p.passed), logLines: document.getElementById('log').children.length }; });
  console.log('before', JSON.stringify(before)); console.log('after ', JSON.stringify(after));
  if (after.round !== before.round) errors.push('round differs after continue');
  if (JSON.stringify(after.vps) !== JSON.stringify(before.vps) || JSON.stringify(after.tg) !== JSON.stringify(before.tg)) errors.push('player resources differ after continue');
  if (after.logLines < 10) errors.push('log was not restored');
  await browser.close();
  if (errors.length) { console.error('FAILED:\n' + errors.join('\n')); process.exit(1); }
  console.log('UI save/continue test passed');
})();
