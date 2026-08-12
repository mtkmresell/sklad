// Kouřový test: appka nastartuje, sekce a klíčová okna fungují
const { chromium } = require('playwright');
const path = require('path');
let failures = 0;
function check(n, c, e) { console.log((c?'PASS':'FAIL')+' — '+n+(c||e===undefined?'':' | '+e)); if(!c) failures++; }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message)));
  await ctx.addInitScript(() => {
    localStorage.setItem('sklad_v3', JSON.stringify([
      { id:'a1', name:'Nike Dunk', sku:'DD1391-100', category:'sneakers', buyPrice:2000, buyCurrency:'CZK', saleState:'stock', location:'Doma', dateAdded:Date.now(), buyDate:'2026-06-01', tags:[] },
      { id:'a2', name:'Jordan 4', category:'sneakers', buyPrice:3000, buyCurrency:'CZK', sellPrice:6000, saleState:'paid', saleDate:'2026-06-05', payoutDate:'2026-06-10', dateAdded:Date.now()-1000, buyDate:'2026-05-01', tags:[] },
    ]));
  });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(3500);

  for (const t of ['stock','waiting','sold','customers','wishlist']) {
    const ok = await page.evaluate((tab) => { switchTab(tab); return true; }, t);
    await page.waitForTimeout(250);
    check('sekce '+t+' se přepne', ok);
  }
  await page.evaluate(() => switchTab('stock'));
  await page.waitForTimeout(300);
  check('položky se vykreslily', await page.evaluate(() => document.getElementById('itemsGrid').textContent.includes('Nike Dunk')));

  // Nastavení + nástroje z něj
  await page.evaluate(() => openSettings());
  await page.waitForTimeout(400);
  check('Nastavení se otevře', await page.evaluate(() => document.getElementById('moSettings').classList.contains('open')));
  await page.evaluate(() => openDropdownsEditor());
  await page.waitForTimeout(400);
  check('editor dropdownů se otevře z Nastavení', await page.evaluate(() => /Payout na|Sklad umístění|Dropdowny/.test(document.body.textContent)));
  await page.evaluate(() => { document.querySelectorAll('.mo.open').forEach(m => m.classList.remove('open')); document.querySelectorAll('body > div[style*="fixed"]').forEach(d => d.remove()); });
  await page.waitForTimeout(200);

  // Detail zákazníka
  const cid = await page.evaluate(() => {
    var id = _crmCreateMinimal('Smoke Zák', 'b2c');
    customers.find(x => x.id===id).contacts = [{type:'instagram', value:'smoke', primary:true}];
    switchTab('customers'); openCustomerDetail(id); return id;
  });
  await page.waitForTimeout(400);
  check('detail zákazníka se otevře', await page.evaluate(() => document.getElementById('customerDetailModal').classList.contains('open')));
  for (const tb of ['contacts','prefs','behavior','followup','history','overview']) {
    await page.evaluate((t) => crmDetailTab(t), tb);
    await page.waitForTimeout(250);
  }
  check('všechny záložky detailu projdou bez chyby', true);
  await page.evaluate(() => closeCustomerDetail());

  // Přidat položku
  await page.evaluate(() => openAddModal());
  await page.waitForTimeout(500);
  check('okno Přidat položku se otevře', await page.evaluate(() => document.getElementById('moAdd').classList.contains('open')));

  check('žádné JS chyby', errs.filter(e => !/keySplines/.test(e)).length === 0, JSON.stringify(errs.slice(0,3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
