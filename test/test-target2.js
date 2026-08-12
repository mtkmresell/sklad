// Test: migrace při startu nesmí označit lokální data jako novější ani je poslat do cloudu
const { chromium } = require('playwright');
const path = require('path');
let failures = 0;
function check(n,c,e){ console.log((c?'PASS':'FAIL')+' — '+n+(c||e===undefined?'':' | '+e)); if(!c) failures++; }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
  const SAVED_AT = '2026-07-01T10:00:00.000Z';
  await ctx.addInitScript((savedAt) => {
    localStorage.setItem('sklad_v3', JSON.stringify([
      { id:'m1', name:'EUR cílovka', category:'sneakers', buyPrice:200, buyCurrency:'EUR', buyRateEur:24.17,
        saleState:'stock', location:'Doma', dateAdded:Date.now(), buyDate:'2026-06-01', tags:[],
        targetPrice:7251, targetCurrency:'EUR' },
    ]));
    localStorage.setItem('sklad_v3_savedAt', savedAt);
    localStorage.removeItem('sklad_v3_dirty');
  }, SAVED_AT);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(4000);

  const st = await page.evaluate(() => ({
    eur: items.find(x => x.id==='m1').targetPriceEur,
    persisted: (JSON.parse(localStorage.getItem('sklad_v3'))[0] || {}).targetPriceEur,
    savedAt: localStorage.getItem('sklad_v3_savedAt'),
    dirty: localStorage.getItem('sklad_v3_dirty'),
  }));
  check('migrace proběhla (300 €)', st.eur === 300, JSON.stringify(st));
  check('výsledek se uložil do prohlížeče', st.persisted === 300, JSON.stringify(st));
  check('savedAt se nezměnil', st.savedAt === '2026-07-01T10:00:00.000Z', st.savedAt);
  check('data nejsou označena jako rozpracovaná (dirty)', st.dirty === null, String(st.dirty));

  // Cloudová data přepíšou lokální → migrace se pustí i na ně
  const cloud = await page.evaluate(() => {
    var ok = _applyCloudData({
      items: [{ id:'c1', name:'Cloudová EUR cílovka', category:'sneakers', buyPrice:100, buyCurrency:'EUR', buyRateEur:25.30,
        saleState:'stock', location:'Doma', dateAdded:Date.now(), buyDate:'2025-11-01', tags:[],
        targetPrice:6325, targetCurrency:'EUR' }],
      savedAt: new Date().toISOString(),
    });
    return { ok, eur: items.find(x => x.id==='c1').targetPriceEur };
  });
  check('migrace se pustí i na data z cloudu (250 €)', cloud.ok && cloud.eur === 250, JSON.stringify(cloud));

  check('žádné JS chyby', errs.filter(e => !/keySplines/.test(e)).length === 0, JSON.stringify(errs.slice(0,3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
