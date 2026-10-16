// Test: okno hromadného mazání vypíše, které položky se mažou
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  const dnes = new Date().toISOString().slice(0, 10);
  await ctx.addInitScript((dnes) => localStorage.setItem('sklad_v3', JSON.stringify([
    { id: 'a', name: 'Nike Mind 001 Slide', sku: 'HQ4307-302', size: '44', buyPrice: 2199, buyCurrency: 'CZK', saleState: 'stock', category: 'sneakers', buyDate: dnes, location: 'Doma' },
    { id: 'b', name: 'Vans <b>OTW</b> Old Skool', sku: 'VN000E8VHLE', size: '41', buyPrice: 124.38, buyCurrency: 'EUR', saleState: 'stock', category: 'sneakers', buyDate: dnes, location: 'Doma' },
    { id: 'c', name: 'Zůstane mi', sku: 'KEEP-1', size: 'M', buyPrice: 500, buyCurrency: 'CZK', saleState: 'stock', category: 'obleceni', buyDate: dnes, location: 'Doma' },
  ])), dnes);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  section('1) Okno vypíše vybrané položky');
  const okno = await page.evaluate(() => {
    bulkSelected.clear(); bulkSelected.add('a'); bulkSelected.add('b');
    bulkDelete();
    const s = document.getElementById('_bdSeznam');
    return { nadpis: s ? s.parentNode.textContent : '', radky: s ? [...s.querySelectorAll('.bd-radek')].map(r => r.textContent.replace(/\s+/g, ' ')) : [],
      html: s ? s.innerHTML : '' };
  });
  check('je tam seznam se dvěma řádky', okno.radky.length === 2, JSON.stringify(okno.radky));
  check('s názvy položek', okno.radky.some(r => /Nike Mind 001 Slide/.test(r)) && okno.radky.some(r => /Vans <b>OTW<\/b> Old Skool/.test(r)), JSON.stringify(okno.radky));
  check('se SKU, velikostí a cenou', /HQ4307-302 · 44 · 2\s?199 Kč/.test(okno.radky.join('|')) && /124,38\s€/.test(okno.radky.join('|')), JSON.stringify(okno.radky));
  check('nevybraná položka v seznamu není', !okno.radky.some(r => /Zůstane mi/.test(r)));
  check('název se neinterpretuje jako HTML', !/<b>OTW<\/b>/.test(okno.html), okno.html.slice(0, 200));
  check('nadpis skloňuje', /Smazat 2 položky\?/.test(okno.nadpis), okno.nadpis.slice(0, 40));

  section('2) Zrušit nic nesmaže, potvrzení smaže jen vybrané');
  await page.click('#_bdNo');
  check('po zrušení jsou všechny tři', await page.evaluate(() => items.length) === 3);
  await page.evaluate(() => { bulkSelected.clear(); bulkSelected.add('a'); bulkSelected.add('b'); bulkDelete(); });
  await page.click('#_bdYes');
  await page.waitForTimeout(200);
  const zbylo = await page.evaluate(() => items.map(i => i.id));
  check('smazaly se jen vybrané', JSON.stringify(zbylo) === '["c"]', JSON.stringify(zbylo));

  section('3) Jedna položka');
  const jedna = await page.evaluate(() => {
    bulkSelected.clear(); bulkSelected.add('c'); bulkDelete();
    const t = document.getElementById('_bdSeznam').parentNode.textContent;
    document.getElementById('_bdNo').click();
    return t;
  });
  check('„Smazat 1 položku?"', /Smazat 1 položku\?/.test(jedna), jedna.slice(0, 40));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
