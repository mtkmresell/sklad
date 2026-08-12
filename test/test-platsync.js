// Reprodukce hlášené chyby: úprava platforem se ztratí, když dorazí data z cloudu
const { chromium } = require('playwright');
const path = require('path');
let failures = 0;
function check(n,c,e){ console.log((c?'PASS':'FAIL')+' — '+n+(c||e===undefined?'':' | '+e)); if(!c) failures++; }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
  await ctx.addInitScript(() => {
    localStorage.setItem('sklad_v3', JSON.stringify([
      { id:'i1', name:'Bota', category:'sneakers', buyPrice:2000, buyCurrency:'CZK',
        saleState:'stock', location:'Doma', dateAdded:Date.now(), buyDate:'2026-06-01', tags:[] },
    ]));
  });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(3500);

  // Uprav platformy a zachyť, co by se poslalo do cloudu
  const sent = await page.evaluate(async () => {
    window._fbUser = { uid:'test' };
    var captured = null;
    var orig = window.fbSaveToCloud;
    window.fbSaveToCloud = function(){ captured = _buildCloudPayload(); };
    openPlatMgr();
    await new Promise(r => setTimeout(r, 300));
    _tmpGroups = getPlatGroups();
    _tmpGroups.eshopy = _tmpGroups.eshopy.filter(function(p){ return p !== 'Sellect'; });
    _tmpGroups.eshopy.push('MujNovyEshop');
    savePlatMgr();
    await new Promise(r => setTimeout(r, 900));
    window.fbSaveToCloud = orig; window._fbUser = null;
    if (!captured) return null;
    var pg = typeof captured.platGroups === 'string' ? JSON.parse(captured.platGroups) : captured.platGroups;
    return { added: pg.eshopy.includes('MujNovyEshop'), removed: !pg.eshopy.includes('Sellect') };
  });
  check('do cloudu odešel upravený seznam', sent && sent.added && sent.removed, JSON.stringify(sent));

  // Teď přijde snapshot z cloudu — nese už tu novou verzi, takže nic nepřepíše
  const afterSnapshot = await page.evaluate((s) => {
    var g = getPlatGroups();
    _applyCloudData({
      items: [{ id:'i1', name:'Bota', category:'sneakers', buyPrice:2000, buyCurrency:'CZK',
        saleState:'stock', location:'Doma', dateAdded:Date.now(), buyDate:'2026-06-01', tags:[] }],
      platGroups: JSON.stringify(g),
      savedAt: new Date().toISOString(),
    });
    var after = getPlatGroups();
    return { added: after.eshopy.includes('MujNovyEshop'), removed: !after.eshopy.includes('Sellect') };
  });
  check('snapshot z cloudu úpravu nepřepíše', afterSnapshot.added && afterSnapshot.removed, JSON.stringify(afterSnapshot));

  // Kontrola staré chyby: snapshot se starým seznamem by úpravu smazal
  const oldBehavior = await page.evaluate(() => {
    var stale = getDefaultGroups(); // "starý" seznam z cloudu (bez úpravy)
    _applyCloudData({
      items: [{ id:'i1', name:'Bota', category:'sneakers', buyPrice:2000, buyCurrency:'CZK',
        saleState:'stock', location:'Doma', dateAdded:Date.now(), buyDate:'2026-06-01', tags:[] }],
      platGroups: JSON.stringify(stale),
      savedAt: new Date().toISOString(),
    });
    var after = getPlatGroups();
    return { added: after.eshopy.includes('MujNovyEshop'), removed: !after.eshopy.includes('Sellect') };
  });
  check('potvrzení příčiny: starý seznam z cloudu úpravu skutečně přepíše',
    !oldBehavior.added && !oldBehavior.removed, JSON.stringify(oldBehavior));

  check('žádné JS chyby', errs.filter(e => !/keySplines/.test(e)).length === 0, JSON.stringify(errs.slice(0,3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
