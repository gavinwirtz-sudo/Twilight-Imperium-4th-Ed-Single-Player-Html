// UI test: tech tree / faction sheets / rules open while the decision box is hidden (See board), without disturbing it; tech dots show.
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
  await page.locator('#modal-peek').click();                                       // See board
  for (const [btn, title] of [['#btn-tech', 'Technology tree'], ['#btn-factions', 'Faction sheets'], ['#btn-rules', 'Rules notes']]) {
    await page.locator(btn).click();
    await page.waitForSelector('#viewer-root:not([hidden])');
    const t = await page.locator('#viewer-title').innerText();
    assert(t === title, 'viewer shows ' + title + ' got ' + t);
    assert((await page.locator('#viewer-body').innerText()).length > 50, 'viewer has content');
    await page.locator('#viewer-close').click();
    assert(await page.locator('#viewer-root').isHidden(), 'viewer closes');
  }
  const pending = await page.evaluate(() => document.getElementById('modal-title').textContent);
  assert(pending === 'Choose your action', 'the decision is still pending: ' + pending);
  await page.locator('#peek-tab').click();                                         // back to the decision
  await page.locator('#btn-tech').click();                                        // also works over the open decision box
  await page.waitForSelector('#viewer-root:not([hidden])');
  await page.keyboard.press('Escape');
  assert(await page.locator('#viewer-root').isHidden(), 'Esc closes the viewer');
  const dots = await page.locator('#players .tdot').count();
  assert(dots > 0, 'tech colour dots in the player panels');
  console.log('viewer e2e: dots', dots);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('viewer e2e passed');
  await browser.close();
  function assert(c, m) { if (!c) throw new Error(m); }
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
