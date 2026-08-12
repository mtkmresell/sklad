// Test: Správa platforem — přidání/odebrání se uloží a nepřepíše se z cloudu
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
  await ctx.addInitScript(() => {
    localStorage.setItem('sklad_v3', JSON.stringify([
      { id:'i1', name:'Testovací bota', category:'sneakers', buyPrice:2000, buyCurrency:'CZK',
        saleState:'stock', location:'Doma', dateAdded:Date.now(), buyDate:'2026-06-01', tags:[],
        platforms:['Sellect'] },
    ]));
  });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // ── 1) Odebrání a přidání komisního eshopu se uloží
  const saved = await page.evaluate(async () => {
    openPlatMgr();
    await new Promise(r => setTimeout(r, 400));
    // odeber existující eshop
    _tmpGroups = getPlatGroups();
    _tmpGroups.eshopy = _tmpGroups.eshopy.filter(function(p){ return p !== 'Sellect'; });
    // přidej nový
    _tmpGroups.eshopy.push('NovýEshop');
    savePlatMgr();
    await new Promise(r => setTimeout(r, 300));
    var g = getPlatGroups();
    var stored = JSON.parse(localStorage.getItem('sklad_plat_groups_v1'));
    return {
      removedGone: !g.eshopy.includes('Sellect'),
      addedThere: g.eshopy.includes('NovýEshop'),
      storedRemoved: !stored.eshopy.includes('Sellect'),
      storedAdded: stored.eshopy.includes('NovýEshop'),
    };
  });
  check('odebraný eshop zmizel', saved.removedGone && saved.storedRemoved, JSON.stringify(saved));
  check('přidaný eshop se uložil', saved.addedThere && saved.storedAdded, JSON.stringify(saved));

  // ── 2) Změna se hlásí do cloudu (jádro chyby — dřív se neposílala vůbec)
  const pushed = await page.evaluate(async () => {
    window._fbUser = { uid: 'test' };
    var calls = 0;
    var origSave = window.fbSaveToCloud;
    window.fbSaveToCloud = function(){ calls++; };
    _svCloudTimer = null;
    openPlatMgr();
    await new Promise(r => setTimeout(r, 300));
    _tmpGroups = getPlatGroups();
    _tmpGroups.eshopy.push('DalsiEshop');
    savePlatMgr();
    var timerSet = !!_svCloudTimer;
    await new Promise(r => setTimeout(r, 900));
    window.fbSaveToCloud = origSave;
    window._fbUser = null;
    return { timerSet, calls };
  });
  check('uložení spustí synchronizaci do cloudu', pushed.timerSet && pushed.calls === 1, JSON.stringify(pushed));

  // ── 3) Odchozí data do cloudu nesou nový seznam
  const payload = await page.evaluate(() => {
    var p = _buildCloudPayload();
    var pg = typeof p.platGroups === 'string' ? JSON.parse(p.platGroups) : p.platGroups;
    return { added: pg.eshopy.includes('NovýEshop'), removed: !pg.eshopy.includes('Sellect') };
  });
  check('data do cloudu obsahují upravený seznam', payload.added && payload.removed, JSON.stringify(payload));

  // ── 4) Kategorie u platforem se uloží taky
  const cats = await page.evaluate(async () => {
    openPlatMgr();
    await new Promise(r => setTimeout(r, 300));
    _tmpGroups = getPlatGroups();
    _tmpGroups.platCategories['NovýEshop'] = ['sneakers'];
    savePlatMgr();
    await new Promise(r => setTimeout(r, 300));
    return getPlatGroups().platCategories['NovýEshop'];
  });
  check('kategorie platformy se uloží', JSON.stringify(cats) === JSON.stringify(['sneakers']), JSON.stringify(cats));

  // ── 5) Změna přežije znovunačtení stránky
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Čekej na dokončení startu, ne na pevný čas — pod zátěží se 3,5 s nemusí stihnout
  await page.waitForFunction(() => typeof getPlatGroups === 'function' && !!document.getElementById('itemsGrid'), null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const afterReload = await page.evaluate(() => {
    var g = getPlatGroups();
    return { added: g.eshopy.includes('NovýEshop'), removed: !g.eshopy.includes('Sellect'), cat: g.platCategories['NovýEshop'] };
  });
  check('po znovunačtení: přidaný eshop tam je', afterReload.added, JSON.stringify(afterReload));
  check('po znovunačtení: odebraný eshop tam není', afterReload.removed, JSON.stringify(afterReload));
  check('po znovunačtení: kategorie zůstaly', JSON.stringify(afterReload.cat) === JSON.stringify(['sneakers']), JSON.stringify(afterReload.cat));

  // ── 6) Zrušení (Zpět) změny neuloží
  const cancelled = await page.evaluate(async () => {
    openPlatMgr();
    await new Promise(r => setTimeout(r, 300));
    _tmpGroups = getPlatGroups();
    _tmpGroups.eshopy.push('NeulozenyEshop');
    // uživatel klikne „← Zpět"
    _tmpGroups = null; cm('moPlatMgr');
    await new Promise(r => setTimeout(r, 200));
    return getPlatGroups().eshopy.includes('NeulozenyEshop');
  });
  check('zrušení dialogu změnu neuloží', !cancelled, String(cancelled));

  // ── 7) Filtry a nabídka platforem u položky odpovídají novému seznamu
  const uiSync = await page.evaluate(() => {
    var el = document.getElementById('filterListingPlatform');
    var opts = el ? [...el.options].map(o => o.text) : [];
    return { hasNew: opts.some(o => /NovýEshop/.test(o)), hasOld: opts.some(o => /Sellect/.test(o)), n: opts.length };
  });
  check('filtr platforem zná nový eshop', uiSync.hasNew, JSON.stringify(uiSync));

  check('žádné JS chyby', errs.filter(e => !/keySplines/.test(e)).length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
