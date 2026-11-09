// Test: šipky v detailu listují v pořadí řádků na obrazovce
// (LISTOVÁNÍ DETAILEM PODLE OBRAZOVKY) — hlavně v Prodáno, kde se seznam
// kreslí po měsících vyplacení a getFiltered řadí jinak.
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const DEN = 86400000;
const datum = (dnu) => new Date(Date.now() - dnu * DEN).toISOString().slice(0, 10);
// Data nákupu schválně v opačném pořadí než data vyplacení
const prodano = (id, nakupPred, vyplacenoPred) => ({ id, name: 'Kus ' + id, category: 'sneakers', buyPrice: 1000,
  buyCurrency: 'CZK', sellPrice: 2000, saleState: 'paid', soldWhere: 'Vinted', dateAdded: Date.now() - nakupPred * DEN,
  buyDate: datum(nakupPred), saleDate: datum(vyplacenoPred), payoutDate: datum(vyplacenoPred), tags: [] });
const SEED = [
  prodano('p1', 300, 1),    // vyplaceno nejnověji, koupeno nejdřív
  prodano('p2', 10, 2),
  prodano('p3', 200, 3),
  prodano('p4', 20, 4),
  { id: 's1', name: 'Sklad A', category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK', saleState: 'stock', location: 'Doma', dateAdded: 1, buyDate: datum(5), tags: [] },
  { id: 's2', name: 'Sklad B', category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK', saleState: 'stock', location: 'Doma', dateAdded: 2, buyDate: datum(9), tags: [] },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.route('**/firebasejs/**', r => r.abort());
  await ctx.addInitScript((s) => { if (!localStorage.getItem('sklad_v3')) localStorage.setItem('sklad_v3', JSON.stringify(s)); }, SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof navigateDetail === 'function' && Array.isArray(items) && items.length > 0, { timeout: 20000 });
  await page.waitForTimeout(500);

  const radky = () => page.evaluate(() => {
    const ids = [];
    document.querySelectorAll('#itemsGrid [data-action="detail"][data-id]').forEach(el => {
      const id = el.getAttribute('data-id'); if (ids.indexOf(id) < 0) ids.push(id);
    });
    return ids;
  });
  const projdi = (start, dir, kroku) => page.evaluate(({ start, dir, kroku }) => {
    openDetail(start);
    const cesta = [currentDetailId];
    for (let i = 0; i < kroku; i++) { navigateDetail(dir); cesta.push(currentDetailId); }
    cm('moDetail');
    return cesta;
  }, { start, dir, kroku });

  section('1) Prodáno: šipka jde na sousední řádek');
  await page.evaluate(() => { switchTab('sold'); });
  await page.waitForTimeout(300);
  const poradi = await radky();
  check('řádky jsou podle data vyplacení', poradi.join(',') === 'p1,p2,p3,p4', poradi.join(','));
  let cesta = await projdi(poradi[0], 1, 3);
  check('pravá šipka jde po řádcích dolů', cesta.join(',') === 'p1,p2,p3,p4', cesta.join(','));
  cesta = await projdi('p4', -1, 3);
  check('levá šipka jde po řádcích nahoru', cesta.join(',') === 'p4,p3,p2,p1', cesta.join(','));
  cesta = await projdi('p4', 1, 1);
  check('na konci se jde dokola', cesta.join(',') === 'p4,p1', cesta.join(','));

  section('2) Na skladě dál podle seznamu');
  await page.evaluate(() => { switchTab('stock'); });
  await page.waitForTimeout(300);
  const sklad = await radky();
  const filtr = await page.evaluate(() => getFiltered().map(i => i.id));
  check('řádky skladu odpovídají getFiltered', sklad.join(',') === filtr.join(','), sklad + ' / ' + filtr);
  cesta = await projdi(sklad[0], 1, 1);
  check('šipka jde na další řádek', cesta[1] === sklad[1], cesta.join(','));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
