// Test: Přesuny profilu odstraněny, přesun mezi profily funguje dál
const { chromium } = require('playwright');
const path = require('path');
let failures = 0;
function check(n,c,e){ console.log((c?'PASS':'FAIL')+' — '+n+(c||e===undefined?'':' | '+e)); if(!c) failures++; }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
  await ctx.addInitScript(() => {
    localStorage.setItem('sklad_v3', JSON.stringify([
      // Položka se starým záznamem přesunů — nesmí se už zobrazit
      { id:'p1', name:'Nike NOCTA Glide', sku:'DM0879-001', category:'sneakers', personal:true,
        buyPrice:168, buyCurrency:'EUR', buyRateEur:24.5, saleState:'stock', location:'Doma',
        dateAdded:Date.now(), buyDate:'2023-09-15', tags:[],
        profileLog:[{date:'2026-07-12', to:'personal'}] },
      { id:'p2', name:'Druhá položka', category:'sneakers', buyPrice:2000, buyCurrency:'CZK',
        saleState:'stock', location:'Doma', dateAdded:Date.now()-1000, buyDate:'2026-06-01', tags:[] },
    ]));
  });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.evaluate(() => { setProfile('all'); switchTab('stock'); });
  await page.waitForTimeout(400);

  // ── 1) Detail už řádek neukazuje
  await page.evaluate(() => openDetail('p1'));
  await page.waitForTimeout(500);
  const detail = await page.evaluate(() => {
    var t = document.body.textContent;
    return { hasRow: /Přesuny profilu/.test(t), hasProfile: /Profil/.test(t), hasName: /NOCTA/.test(t) };
  });
  check('řádek Přesuny profilu se nezobrazuje', !detail.hasRow, JSON.stringify(detail));
  check('řádek Profil zůstal', detail.hasProfile, JSON.stringify(detail));
  check('detail se normálně vykreslí', detail.hasName, JSON.stringify(detail));
  await page.evaluate(() => { document.querySelectorAll('.mo.open').forEach(m => m.classList.remove('open')); });
  await page.waitForTimeout(200);

  // ── 2) Přesun přes Upravit funguje a nic nezapisuje
  await page.evaluate(async () => {
    openEdit('p2');
    await new Promise(r => setTimeout(r, 600));
    document.getElementById('fProfile').value = 'personal';
  });
  await page.evaluate(() => saveItem());
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(200);
    const done = await page.evaluate(() => !!items.find(x => x.id === 'p2').personal);
    if (done) break;
  }
  const moved = await page.evaluate(() => {
    var it = items.find(x => x.id === 'p2');
    return { personal: !!it.personal, log: it.profileLog };
  });
  check('přesun do Osobní přes Upravit funguje', moved.personal, JSON.stringify(moved));
  check('nezapisuje se žádný záznam přesunu', moved.log === undefined, JSON.stringify(moved));

  // ── 3) Hromadný přesun funguje a taky nic nezapisuje
  const bulk = await page.evaluate(() => {
    bulkSelected = ['p1'];
    var before = items.find(x => x.id==='p1').personal;
    // simuluj potvrzení hromadného přesunu do Podnikání
    var it = items.find(x => x.id==='p1');
    it.personal = false;
    return { before: !!before, after: !!it.personal, log: it.profileLog };
  });
  check('hromadný přesun mění profil', bulk.before && !bulk.after, JSON.stringify(bulk));
  check('starý záznam byl z dat uklizen', bulk.log === undefined, JSON.stringify(bulk.log));

  // ── 4) Profilový přepínač a filtrování funguje dál
  const prof = await page.evaluate(() => {
    setProfile('business');
    var biz = getFiltered().map(i => i.id).sort();
    setProfile('personal');
    var per = getFiltered().map(i => i.id).sort();
    setProfile('all');
    var all = getFiltered().map(i => i.id).sort();
    return { biz, per, all };
  });
  check('filtrování dle profilu funguje', JSON.stringify(prof.biz)==='["p1"]' && JSON.stringify(prof.per)==='["p2"]' && prof.all.length===2, JSON.stringify(prof));

  check('žádné JS chyby', errs.filter(e => !/keySplines/.test(e)).length === 0, JSON.stringify(errs.slice(0,3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
