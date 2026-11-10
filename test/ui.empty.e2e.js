// Regression: activating an empty (planet-less) system with fleets 1 and 2 jumps away must open the move dialog.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1300, height: 800 } });
  const errs=[]; page.on('pageerror',e=>errs.push('pageerror '+e.stack)); page.on('console',m=>{if(m.type()==='error')errs.push('console '+m.text());});
  await page.goto('file://' + require('path').resolve(__dirname, '..', 'index.html')); await page.waitForSelector('#modal-root:not([hidden])');
  await page.selectOption('#s-speed','60'); await page.selectOption('#s-bots','2');
  let injected=false, E=null, ok=false;
  for (let i=0;i<400;i++){
    const t = await page.evaluate(()=>{const r=document.getElementById('modal-root');const c=TI.ui.ctx;return {modal:!r.hidden,title:document.getElementById('modal-title').textContent,pick:c.mapOpts&&c.mapOpts.pick?[...c.mapOpts.pick]:null,round:c.state?c.state.round:0}});
    if(!t.modal&&t.pick){ if(injected){ console.log('picking',E); await page.evaluate(id=>TI.ui.ctx.mapOpts.onPick(id),E); await page.waitForTimeout(1500);
        if(/Move ships/.test(await page.locator('#modal-title').textContent())) ok=true; console.log('after pick:', JSON.stringify(await page.evaluate(()=>({modal:!document.getElementById('modal-root').hidden,title:document.getElementById('modal-title').textContent, log:TI.ui.ctx.state.log.slice(-3)})))); console.log(errs.join('\n')); break;}
      await page.evaluate(id=>TI.ui.ctx.mapOpts.onPick(id),t.pick[0]); continue;}
    if(!t.modal){await page.waitForTimeout(40);continue;}
    const clickBtn=(x)=>page.locator('#modal-actions button',{hasText:x}).first().click();
    if(t.title==='New game') await clickBtn('Start game');
    else if(t.title==='Choose a strategy card') await page.locator('#modal-body .opt').first().click();
    else if(t.title==='Choose your action'){
      if(!injected){ const r=await page.evaluate(()=>{const st=TI.ui.ctx.state,S=st.map.systems;
          const dist=(a)=>{const d={[a]:0},q=[a];while(q.length){const x=q.shift();for(const n of S[x].adj){if(!(n in d)){d[n]=d[x]+1;q.push(n);}}}return d;};
          for(const e of st.map.order){const s=S[e]; if(s.planets.length||s.anomaly||s.home!==undefined&&s.home!==null)continue; const d=dist(e);
            const n1=st.map.order.find(i=>d[i]===1&&!S[i].planets.some(p=>p.owner!==null&&p.owner!==0)&&!S[i].anomaly&&S[i].home==null);
            const n2=st.map.order.find(i=>d[i]===2&&!S[i].anomaly&&S[i].home==null&&!(S[i].ships[1]||[]).length&&!(S[i].ships[2]||[]).length);
            if(n1&&n2&&!(S[n1].ships[1]||[]).length){ const home=st.map.order.find(i=>S[i].home===0); const ships=S[home].ships[0]; const c=ships.filter(u=>u.type==='carrier'); S[n1].ships[0]=[c[0],...ships.filter(u=>u.type==='fighter')]; const d=ships.find(u=>u.type==='destroyer'); S[n2].ships[0]=[c[1],d]; S[home].ships[0]=[]; return {e,n1,n2};}}
          return null;}); console.log('setup',r); E=r.e; injected=true; await page.evaluate(()=>TI.ui.redraw()); }
      const opts=await page.locator('#modal-body .opt:not(.disabled)').allTextContents(); const k=opts.findIndex(o=>o.startsWith('Tactical')); await page.locator('#modal-body .opt:not(.disabled)').nth(k).click(); }
    else if(t.title==='This action may accomplish nothing'){ console.log('WARNING SHOWN'); await clickBtn('Activate anyway'); }
    else if(t.title.startsWith('Keep one secret')) await page.locator('#modal-body .opt').first().click();
    else { console.log('dialog',t.title); if(t.title.startsWith('Move ships')){console.log('MOVE DIALOG OK');ok=true;break;} await page.locator('#modal-body .opt').first().click().catch(()=>clickBtn('Confirm')); }
  }
  await b.close(); if(!ok||errs.length){console.error('FAILED: no move dialog for empty system, or errors:\n'+errs.join('\n'));process.exit(1);} console.log('empty-system move dialog test passed');
})();
