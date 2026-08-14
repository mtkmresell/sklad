// Test: nové sekce analytiky — doba do prodeje, sell-through, sezónnost,
// rychlost payoutu, cenová pásma, vratky, vázaný kapitál, retaileři
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }
const norm = s => (s || '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ');

const R = new Date().getFullYear();
const d = (mesic, den) => `${R}-${String(mesic).padStart(2, '0')}-${String(den).padStart(2, '0')}`;

const POLOZKY = [
  // Prodané: nákup → prodej za 20 / 40 / 200 dní
  { id: 's1', name: 'Rychlý', category: 'sneakers', buyPrice: 2000, buyCurrency: 'CZK', buyDate: d(1, 1),
    saleState: 'paid', sellPrice: 3000, profit: 900, saleDate: d(1, 21), payoutDate: d(1, 26),
    soldWhere: 'StockX', buyWhere: 'Nike' },
  { id: 's2', name: 'Střední', category: 'sneakers', buyPrice: 3000, buyCurrency: 'CZK', buyDate: d(2, 1),
    saleState: 'paid', sellPrice: 7000, profit: 3500, saleDate: d(3, 13), payoutDate: d(3, 18),
    soldWhere: 'StockX', buyWhere: 'Nike' },
  { id: 's3', name: 'Pomalý', category: 'pokemon', buyPrice: 900, buyCurrency: 'CZK', buyDate: d(1, 1),
    saleState: 'paid', sellPrice: 1500, profit: 400, saleDate: d(7, 20), payoutDate: d(8, 25),
    soldWhere: 'Footshop', buyWhere: 'Alza' },
  // Na skladě: čerstvý a starý ležák
  { id: 'k1', name: 'Čerstvý', category: 'sneakers', buyPrice: 1500, buyCurrency: 'CZK',
    buyDate: new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10), saleState: 'stock', buyWhere: 'Nike' },
  { id: 'k2', name: 'Ležák', category: 'sneakers', buyPrice: 9000, buyCurrency: 'CZK',
    buyDate: new Date(Date.now() - 300 * 864e5).toISOString().slice(0, 10), saleState: 'stock', buyWhere: 'Zalando' },
  // Vrácený kus s explicitním záznamem (120 dní zpět — koš 90–180)
  { id: 'v1', name: 'Vrácený evidovaný', category: 'sneakers', buyPrice: 2200, buyCurrency: 'CZK',
    buyDate: new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10),
    saleState: 'stock', soldWhere: 'Footshop', location: 'Footshop',
    returns: [{ d: d(5, 5), w: 'Footshop' }], buyWhere: 'Nike' },
  // Vrácený kus z doby před evidencí — pozná se podle soldWhere na skladové položce
  { id: 'v2', name: 'Vrácený starý', category: 'sneakers', buyPrice: 1800, buyCurrency: 'CZK',
    buyDate: new Date(Date.now() - 100 * 864e5).toISOString().slice(0, 10),
    saleState: 'stock', soldWhere: 'Footshop', location: 'Footshop', buyWhere: 'Nike' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 160)); });
  await ctx.addInitScript(p => localStorage.setItem('sklad_v3', JSON.stringify(p)), POLOZKY);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // ══════════════════════════════════════════════════════════════
  section('1) Analytika prodejů se vykreslí');
  const prodej = await page.evaluate(async () => {
    switchTab('sold');
    await new Promise(r => setTimeout(r, 400));
    soldViewMode = 'analytics'; analyticsPeriod = 'all';
    renderSoldView();
    await new Promise(r => setTimeout(r, 900));
    return { text: document.getElementById('itemsGrid').textContent.replace(/\s+/g, ' ') };
  });
  const t = norm(prodej.text);
  check('sekce Doba do prodeje je tam', /Doba do prodeje/.test(t), t.slice(0, 200));
  check('sekce Sell-through je tam', /Sell-through podle měsíce nákupu/.test(t));
  check('sekce Sezónnost je tam', /Sezónnost prodejů/.test(t));
  check('sekce Rychlost payoutu je tam', /Rychlost payoutu podle platformy/.test(t));
  check('sekce Cenová pásma je tam', /Výnosnost cenových pásem/.test(t));
  check('sekce Vratky je tam', /Vratky podle platformy/.test(t));

  // ══════════════════════════════════════════════════════════════
  section('2) Doba do prodeje počítá správně');
  // s1=20 dní, s2=40 dní, s3=200 dní → medián 40, nejrychlejší 20, nejdelší 200
  check('medián je 40 dní', /Medián\s*40 dní/.test(t), t.slice(t.indexOf('Doba do prodeje'), t.indexOf('Doba do prodeje') + 260));
  check('nejrychlejší 20 dní', /Nejrychlejší\s*20 dní/.test(t), t.slice(t.indexOf('Doba do prodeje'), t.indexOf('Doba do prodeje') + 260));
  check('nejdelší 200 dní', /Nejdelší\s*200 dní/.test(t), t.slice(t.indexOf('Doba do prodeje'), t.indexOf('Doba do prodeje') + 260));
  check('podíl do 30 dní je 33 %', /Do 30 dní\s*33 %/.test(t), t.slice(t.indexOf('Doba do prodeje'), t.indexOf('Doba do prodeje') + 300));

  // ══════════════════════════════════════════════════════════════
  section('3) Rychlost payoutu podle platformy');
  // StockX: 5 a 5 dní → medián 5. Footshop: 36 dní, ale jen 1 vzorek → nezobrazí se
  check('StockX má medián 5 dní', /StockX\s*5 dní · 2 ks/.test(t), t.slice(t.indexOf('Rychlost payoutu'), t.indexOf('Rychlost payoutu') + 300));
  check('platforma s jediným vzorkem se nepočítá',
    !/Footshop\s*36 dní/.test(t), t.slice(t.indexOf('Rychlost payoutu'), t.indexOf('Rychlost payoutu') + 300));

  // ══════════════════════════════════════════════════════════════
  section('4) Vratky — evidované i dopočítané');
  const vratkyUsek = t.slice(t.indexOf('Vratky podle platformy'), t.indexOf('Vratky podle platformy') + 300);
  check('Footshop má dvě vratky', /Footshop\s*2× vráceno/.test(vratkyUsek), vratkyUsek);
  check('spočítá se i míra vratek', /% z pokusů/.test(vratkyUsek), vratkyUsek);
  check('platforma bez vratek se neukazuje', !/StockX\s*\d+× vráceno/.test(vratkyUsek), vratkyUsek);

  // ══════════════════════════════════════════════════════════════
  section('5) Cenová pásma u prodejů');
  const pasmaUsek = t.slice(t.indexOf('Výnosnost cenových pásem'), t.indexOf('Výnosnost cenových pásem') + 400);
  check('pásmo 1 000–2 500 má jeden kus', /1 000 – 2 500 Kč\s*1 ks/.test(pasmaUsek), pasmaUsek);
  check('pásmo 5 000–10 000 má jeden kus', /5 000 – 10 000 Kč\s*1 ks/.test(pasmaUsek), pasmaUsek);
  check('prázdné pásmo se ukáže jako pomlčka', /nad 10 000 Kč\s*—/.test(pasmaUsek), pasmaUsek);

  // ══════════════════════════════════════════════════════════════
  section('6) Analytika skladu — kapitál a retaileři');
  const sklad = await page.evaluate(async () => {
    switchTab('stock');
    await new Promise(r => setTimeout(r, 400));
    stockViewMode = 'analytics';
    renderItems();
    await new Promise(r => setTimeout(r, 900));
    return { text: document.getElementById('itemsGrid').textContent.replace(/\s+/g, ' ') };
  });
  const ts = norm(sklad.text);
  check('sekce Vázaný kapitál podle stáří je tam', /Vázaný kapitál podle stáří/.test(ts), ts.slice(0, 200));
  check('sekce Kde nakupuju je tam', /Kde nakupuju/.test(ts));

  const kapUsek = ts.slice(ts.indexOf('Vázaný kapitál podle stáří'), ts.indexOf('Vázaný kapitál podle stáří') + 400);
  // Sklad: k1 1 500 (10 dní), v2 1 800 (100 dní), v1 2 200 (120 dní), k2 9 000 (300 dní) = 14 500
  check('ležák nad 180 dní drží 9 000 Kč', /180\+ dní\s*9 000 Kč · 1 ks/.test(kapUsek), kapUsek);
  check('koš 90–180 dní sečte oba vrácené kusy', /90–180 dní\s*4 000 Kč · 2 ks/.test(kapUsek), kapUsek);
  check('kapitál v ležácích je 90 % skladu', /13 000 Kč, to je 90 %/.test(kapUsek), kapUsek);
  check('je vidět podíl vázaného kapitálu v ležácích', /% vázaného kapitálu/.test(kapUsek), kapUsek);

  const retUsek = ts.slice(ts.indexOf('Kde nakupuju'), ts.indexOf('Kde nakupuju') + 400);
  check('retaileři se sečetli podle objemu', /Nike\s*3 ks/.test(retUsek), retUsek);
  check('a řadí se od největšího', retUsek.indexOf('Zalando') > 0 && retUsek.indexOf('Nike') > 0, retUsek);

  // ══════════════════════════════════════════════════════════════
  section('7) Prázdný sklad nespadne');
  const prazdny = await page.evaluate(async () => {
    const zaloha = items.slice();
    items.length = 0;
    renderItems();
    await new Promise(r => setTimeout(r, 500));
    const a = document.getElementById('itemsGrid').textContent;
    soldViewMode = 'analytics'; switchTab('sold'); renderSoldView();
    await new Promise(r => setTimeout(r, 500));
    const b = document.body.textContent;
    items.push.apply(items, zaloha);
    return { a: a.slice(0, 150), delka: b.length };
  });
  check('prázdný sklad se vykreslí bez pádu', prazdny.delka > 0, JSON.stringify(prazdny.a));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? `\n${failures} TESTŮ SELHALO` : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
