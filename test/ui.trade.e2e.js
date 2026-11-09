// UI test for trading: the human (Hacan) proposes a swap to a bot from the action menu, and the treasury panel updates.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForSelector('#modal-root:not([hidden])');
  await page.selectOption('#s-speed', '60'); await page.selectOption('#s-bots', '2'); await page.selectOption('#s-fac', 'hacan');
  await page.locator('.b-fac').nth(0).selectOption('creuss'); await page.locator('.b-fac').nth(1).selectOption('yssaril');
  await page.locator('#modal-actions button', { hasText: 'Start game' }).click();
  let ok = false;
  for (let i = 0; i < 400 && !ok; i++) {
    const t = await page.evaluate(() => (document.getElementById('modal-root').hidden ? '' : document.getElementById('modal-title').textContent));
    if (t === 'Keep one secret objective' || t === 'Choose a strategy card') { await page.locator('#modal-body .opt').first().click(); continue; }
    if (t === 'Choose your action') { ok = true; break; }
    if (t) { const b = page.locator('#modal-actions button').last(); if (await b.count()) await b.click(); }
    await page.waitForTimeout(60);
  }
  if (!ok) throw new Error('never reached the action menu');
  const before = await page.evaluate(() => { const s = TI.ui.ctx.state; s.players[0].comm = 4; s.players.slice(1).forEach((p) => { p.tg = 6; }); TI.ui.redraw(); return s.players.map((p) => [p.tg, p.comm]); });
  assert(await page.locator('#left-body .treasury').count() === 1, 'treasury panel');
  await page.locator('#modal-body .opt', { hasText: 'Trade with a player' }).click();
  await page.locator('#modal-body .opt').first().click();                       // first partner
  const plus = page.locator('#modal-body button', { hasText: '+' });
  for (let i = 0; i < 3; i++) await plus.nth(1).click();                         // give 3 commodities
  for (let i = 0; i < 2; i++) await plus.nth(2).click();                         // get 2 trade goods
  await page.locator('#modal-actions button', { hasText: 'Propose' }).click();
  await page.waitForFunction(() => /Deal|declines/.test(document.getElementById('modal-title').textContent));
  const title = await page.evaluate(() => document.getElementById('modal-title').textContent);
  await page.locator('#modal-actions button', { hasText: 'OK' }).click();
  const after = await page.evaluate(() => TI.ui.ctx.state.players.map((p) => [p.tg, p.comm]));
  console.log('result:', title, JSON.stringify(before), '->', JSON.stringify(after));
  if (/Deal/.test(title)) { if (after[0][1] !== 1 || after[0][0] !== before[0][0] + 2) throw new Error('wrong balances after deal'); }
  const tre = await page.locator('#left-body .treasury').innerText();
  if (!/trade goods/.test(tre)) throw new Error('treasury text missing');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('trade e2e passed');
  await browser.close();
  function assert(c, m) { if (!c) throw new Error(m); }
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
