// Test: tabulka Per platforma se řadí kliknutím na hlavičku sloupce
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }

const D = '2026-06-05';
// Záměrně různé pořadí dle jednotlivých sloupců, ať jde řazení rozeznat
const SEED = [
  // Alfa: 3 prodeje, tržby 30 000, zisk 9 000, ROI 43 %
  { id:'a1', name:'A1', category:'sneakers', soldWhere:'Alfa', buyPrice:7000, buyCurrency:'CZK', sellPrice:10000, profit:3000, saleState:'paid', saleDate:D, payoutDate:D, dateAdded:1, buyDate:D, tags:[] },
  { id:'a2', name:'A2', category:'sneakers', soldWhere:'Alfa', buyPrice:7000, buyCurrency:'CZK', sellPrice:10000, profit:3000, saleState:'paid', saleDate:D, payoutDate:D, dateAdded:2, buyDate:D, tags:[] },
  { id:'a3', name:'A3', category:'sneakers', soldWhere:'Alfa', buyPrice:7000, buyCurrency:'CZK', sellPrice:10000, profit:3000, saleState:'paid', saleDate:D, payoutDate:D, dateAdded:3, buyDate:D, tags:[] },
  // Zeta: 1 prodej, tržby 50 000, zisk 20 000, ROI 67 %
  { id:'z1', name:'Z1', category:'sneakers', soldWhere:'Zeta', buyPrice:30000, buyCurrency:'CZK', sellPrice:50000, profit:20000, saleState:'paid', saleDate:D, payoutDate:D, dateAdded:4, buyDate:D, tags:[] },
  // Beta: 5 prodejů, tržby 12 500, zisk 2 500, ROI 25 %
  ...[1,2,3,4,5].map(function(i){ return { id:'b'+i, name:'B'+i, category:'sneakers', soldWhere:'Beta', buyPrice:2000, buyCurrency:'CZK', sellPrice:2500, profit:500, saleState:'paid', saleDate:D, payoutDate:D, dateAdded:10+i, buyDate:D, tags:[] }; }),
  // Gama: 2 prodeje, tržby 6 000, zisk 4 000, ROI 200 % (nejvyšší ROI, nejnižší tržby)
  { id:'g1', name:'G1', category:'sneakers', soldWhere:'Gama', buyPrice:1000, buyCurrency:'CZK', sellPrice:3000, profit:2000, saleState:'paid', saleDate:D, payoutDate:D, dateAdded:20, buyDate:D, tags:[] },
  { id:'g2', name:'G2', category:'sneakers', soldWhere:'Gama', buyPrice:1000, buyCurrency:'CZK', sellPrice:3000, profit:2000, saleState:'paid', saleDate:D, payoutDate:D, dateAdded:21, buyDate:D, tags:[] },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
  await ctx.addInitScript((seed) => { localStorage.setItem('sklad_v3', JSON.stringify(seed)); }, SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  await page.evaluate(() => { switchTab('sold'); soldViewMode = 'analytics'; renderSoldView(); });
  await page.waitForTimeout(900);

  const order = () => page.evaluate(() => {
    var th = document.querySelector('[data-plat-sort]');
    if (!th) return null;
    var table = th.closest('table');
    return [...table.querySelectorAll('tbody tr')].map(r => r.cells[0].textContent.trim());
  });
  const headers = () => page.evaluate(() => [...document.querySelectorAll('[data-plat-sort]')].map(t => ({
    key: t.dataset.platSort, txt: t.textContent.trim(), active: t.classList.contains('active'),
  })));
  async function clickHeader(key) {
    await page.evaluate((k) => document.querySelector('[data-plat-sort="' + k + '"]').click(), key);
    await page.waitForTimeout(700);
  }

  // ── 1) Popisky sloupců
  const h = await headers();
  check('sloupec se jmenuje Prodeje, ne Prodejů', h.some(x => x.key === 'count' && /^Prodeje/.test(x.txt)), JSON.stringify(h.map(x => x.txt)));
  check('všech 5 hlaviček je klikacích', h.length === 5 && ['name','count','rev','profit','roi'].every(k => h.some(x => x.key === k)), JSON.stringify(h.map(x => x.key)));

  // ── 2) Výchozí řazení dle zisku (Zeta 20k > Alfa 9k > Gama 4k > Beta 2,5k)
  check('výchozí řazení dle zisku sestupně', JSON.stringify(await order()) === JSON.stringify(['Zeta','Alfa','Gama','Beta']), JSON.stringify(await order()));
  check('aktivní je sloupec Zisk se šipkou dolů', h.find(x => x.key === 'profit').active && /▼/.test(h.find(x => x.key === 'profit').txt), JSON.stringify(h.find(x => x.key === 'profit')));

  // ── 3) Řazení dle počtu prodejů (Beta 5 > Alfa 3 > Gama 2 > Zeta 1)
  await clickHeader('count');
  check('řazení dle Prodeje', JSON.stringify(await order()) === JSON.stringify(['Beta','Alfa','Gama','Zeta']), JSON.stringify(await order()));

  // ── 4) Druhý klik otočí směr
  await clickHeader('count');
  check('druhý klik otočí pořadí', JSON.stringify(await order()) === JSON.stringify(['Zeta','Gama','Alfa','Beta']), JSON.stringify(await order()));
  const hUp = await headers();
  check('šipka se přepne nahoru', /▲/.test(hUp.find(x => x.key === 'count').txt), hUp.find(x => x.key === 'count').txt);

  // ── 5) Řazení dle ROI (Gama 200 % > Zeta 67 % > Alfa 43 % > Beta 25 %)
  await clickHeader('roi');
  check('řazení dle ROI', JSON.stringify(await order()) === JSON.stringify(['Gama','Zeta','Alfa','Beta']), JSON.stringify(await order()));

  // ── 6) Řazení dle tržeb (Zeta 50k > Alfa 30k > Beta 12,5k > Gama 6k)
  await clickHeader('rev');
  check('řazení dle Tržby', JSON.stringify(await order()) === JSON.stringify(['Zeta','Alfa','Beta','Gama']), JSON.stringify(await order()));

  // ── 7) Řazení dle názvu platformy (abecedně vzestupně)
  await clickHeader('name');
  check('řazení dle Platforma abecedně', JSON.stringify(await order()) === JSON.stringify(['Alfa','Beta','Gama','Zeta']), JSON.stringify(await order()));
  await clickHeader('name');
  check('opačně abecedně', JSON.stringify(await order()) === JSON.stringify(['Zeta','Gama','Beta','Alfa']), JSON.stringify(await order()));

  // ── 8) Jen jedna hlavička je aktivní
  const hAct = await headers();
  check('aktivní je vždy jen jeden sloupec', hAct.filter(x => x.active).length === 1, JSON.stringify(hAct.map(x => ({ k: x.key, a: x.active }))));

  // ── 9) Volba přežije překreslení analytiky
  await page.evaluate(() => renderSoldView());
  await page.waitForTimeout(700);
  check('řazení zůstane po překreslení', JSON.stringify(await order()) === JSON.stringify(['Zeta','Gama','Beta','Alfa']), JSON.stringify(await order()));

  // ── 10) Čísla v řádcích sedí (řazení nepřeházelo hodnoty)
  const rowData = await page.evaluate(() => {
    var th = document.querySelector('[data-plat-sort]');
    return [...th.closest('table').querySelectorAll('tbody tr')].map(r => ({
      plat: r.cells[0].textContent.trim(),
      pocet: r.cells[1].textContent.trim(),
      roi: r.cells[4].textContent.trim(),
    }));
  });
  const beta = rowData.find(r => r.plat === 'Beta');
  const gama = rowData.find(r => r.plat === 'Gama');
  check('hodnoty zůstaly u svých platforem', beta.pocet === '5' && gama.pocet === '2' && gama.roi === '+200%', JSON.stringify(rowData));

  check('žádné JS chyby', errs.filter(e => !/keySplines/.test(e)).length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
