// UI test for Undo: abandon a half-made action with the Undo button and land back on the action menu with the game rewound.
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
  const btnOn = await page.evaluate(() => !document.getElementById('btn-undo').disabled);
  const base = await page.evaluate(() => TI.ui.ctx.state.players[0].tg);
  await page.locator('#modal-body .opt', { hasText: 'Tactical action' }).click();
  await page.waitForSelector('#hint-cancel');                                     // now choosing a system
  await page.evaluate(() => { TI.ui.ctx.state.players[0].tg += 9; });             // stand-in for something the action changed
  await page.waitForFunction(() => !document.getElementById('btn-undo').disabled);
  await page.locator('#btn-undo').click();
  let back = false;
  for (let i = 0; i < 100 && !back; i++) {
    back = await page.evaluate(() => !document.getElementById('modal-root').hidden && document.getElementById('modal-title').textContent === 'Choose your action');
    if (!back) await page.waitForTimeout(60);
  }
  assert(back, 'back at the action menu after undo');
  const tg = await page.evaluate(() => TI.ui.ctx.state.players[0].tg);
  assert(tg === base, 'state rewound: ' + tg + ' vs ' + base);
  const logTxt = await page.locator('#log').innerText();
  assert(/Undo: back/.test(logTxt), 'log notes the undo');
  console.log('undo e2e: button was enabled at the menu:', btnOn, 'tg', base, '->', tg);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('undo e2e passed');
  await browser.close();
  function assert(c, m) { if (!c) throw new Error(m); }
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
