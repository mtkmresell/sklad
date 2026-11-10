// Test: okno Účetnictví (ÚČETNICTVÍ) — doklady za měsíc v jednom souboru
// a další přehledy pro účetního.
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const prodano = (id, payout, o) => Object.assign({ id, name: 'Kus ' + id, category: 'sneakers', sku: 'SKU-' + id, size: '42',
  buyPrice: 1000, buyCurrency: 'CZK', sellPrice: 2000, sellCurrency: 'CZK', saleState: 'paid', soldWhere: 'Vinted',
  saleDate: payout, payoutDate: payout, buyDate: '2026-01-05', dateAdded: 1, tags: [] }, o);
const SEED = [
  prodano('r1', '2026-09-03'),
  prodano('r2', '2026-09-20'),
  prodano('r3', '2026-09-11', { sellCurrency: 'EUR', sellPrice: 2500, sellPriceOrig: 100, payoutRateEur: 25, payoutRateCnb: true }),
  prodano('r4', '2026-10-02'),
  prodano('r5', '2026-09-15', { soldWhere: 'StockX' }),          // bez dokladu z aplikace
  prodano('r6', '2026-09-16', { personal: true }),               // osobní — doklad nemá
  prodano('w1', '', { saleState: 'waiting', saleDate: '2026-09-25', payoutDate: '' }),
  { id: 'n1', name: 'Nákup; s "uvozovkami"', category: 'sneakers', saleState: 'stock', buyPrice: 100, buyCurrency: 'EUR',
    buyRateEur: 24.5, buyDate: '2026-09-10', buyWhere: 'Facebook', from: 'Jan', dokladTyp: 'ks', dokladCislo: 'KS20260009',
    invoiceUrl: 'https://onedrive/ks9', dateAdded: 2, tags: [] },
  { id: 'n2', name: 'Osobní nákup', category: 'sneakers', saleState: 'stock', buyPrice: 500, buyCurrency: 'CZK',
    buyDate: '2026-09-12', personal: true, dateAdded: 3, tags: [] },
  // Druhý kus téže kupní smlouvy — jeden řádek s n1
  { id: 'n3', name: 'Druhý kus smlouvy', category: 'sneakers', saleState: 'stock', buyPrice: 50, buyCurrency: 'CZK',
    buyDate: '2026-09-11', dokladTyp: 'ks', dokladCislo: 'ks20260009', dateAdded: 4, tags: [] },
  { id: 'n4', name: 'Nákup bez odkazu', category: 'sneakers', saleState: 'stock', buyPrice: 700, buyCurrency: 'CZK',
    buyDate: '2026-09-20', buyWhere: 'Nike', orderNum: 'C123', dateAdded: 5, tags: [] },
  // Osobní kus, kterému se kdysi vystavil doklad — v řadě je, ale hlásí se
  prodano('r7', '2026-12-01', { personal: true, saleDocNum: '2026-050' }),
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.route('**/firebasejs/**', r => r.abort());
  await ctx.addInitScript((s) => {
    if (!localStorage.getItem('sklad_v3')) localStorage.setItem('sklad_v3', JSON.stringify(s));
    // StockX bez dokladu, Vinted prodejní doklad
    localStorage.setItem('sklad_plat_groups_v1', JSON.stringify({ platforms: ['StockX'], eshopy: [], local: ['Vinted'],
      platCategories: {}, platDoc: { StockX: 'nic', Vinted: 'doklad' } }));
  }, SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof openUcetnictvi === 'function' && Array.isArray(items) && items.length > 0, { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__okna = [];
    window.open = function() { const o = { html: '' }; window.__okna.push(o);
      return { document: { write: function(h) { o.html += h; }, close: function() {} } }; };
  });

  section('1) Doklady za měsíc');
  const sez = await page.evaluate(() => ucDokladyMesice(2026, 9).map(z => z.it.id + '=' + z.cislo));
  check('září: jen vyplacené prodeje s dokladem, podle čísla', sez.join(' ') === 'r1=2026-001 r3=2026-002 r2=2026-003', sez.join(' '));
  const ok = await page.evaluate(() => { openDokladyMesic(2026, 9); return window.__okna.pop(); });
  const h = ok ? ok.html : '';
  check('otevře se jedno okno', !!h);
  check('každý doklad ve vlastní stránce', (h.match(/<section class="dk">/g) || []).length === 3, String((h.match(/<section class="dk">/g) || []).length));
  check('stránkuje se při tisku', /page-break-after:always/.test(h));
  check('jsou tam všechna tři čísla', ['2026-001', '2026-002', '2026-003'].every(c => h.includes(c)));
  check('doklad z měsíce je stejný jako po jednom', await page.evaluate(() => {
    window.__okna = []; openSaleDocument('r3'); const jeden = window.__okna.pop().html;
    return jeden.includes(_dokladTelo(items.find(i => i.id === 'r3'), '2026-002'));
  }));
  const prazdny = await page.evaluate(() => { window.__okna = []; openDokladyMesic(2026, 3); return window.__okna.length; });
  check('prázdný měsíc okno neotevře', prazdny === 0, String(prazdny));

  section('3) Přehled za měsíc pro Excel');
  const rad = await page.evaluate(() => ucPrehledRadky(2026, 9));
  check('hlavička', rad[0].join('|') === 'Typ|Datum|Doklad|Položka|SKU|Velikost|Místo|Protistrana|Částka|Měna|Kurz|Kurz ČNB|Částka Kč|Odkaz na doklad', rad[0].join('|'));
  const prodeje = rad.filter(r => r[0] === 'Prodej'), nakupy = rad.filter(r => r[0] === 'Nákup');
  check('prodeje: vyplacené podnikatelské v září, i bez dokladu z aplikace', prodeje.map(r => r[3]).join(',') === 'Kus r1,Kus r3,Kus r5,Kus r2', prodeje.map(r => r[3]).join(','));
  const eur = prodeje.find(r => r[3] === 'Kus r3');
  check('eurový prodej: částka v eurech, uložený kurz, ČNB, Kč', eur && eur[8] === '100' && eur[9] === 'EUR' && eur[10] === '25,000' && eur[11] === 'ano' && eur[12] === '2500', JSON.stringify(eur));
  check('prodej nese číslo dokladu', eur && eur[2] === '2026-002');
  check('nákupy: jen podnikatelské podle data nákupu', nakupy.length === 3 && nakupy[0][3].startsWith('Nákup;') && !nakupy.some(r => r[3] === 'Osobní nákup'), JSON.stringify(nakupy));
  check('kus téže smlouvy bez odkazu dostane odkaz smlouvy', nakupy[1] && nakupy[1][13] === 'https://onedrive/ks9', JSON.stringify(nakupy[1]));
  check('nákup: kupní smlouva, protistrana, kurz a Kč', nakupy[0] && nakupy[0][2] === 'KS KS20260009' && nakupy[0][7] === 'Jan' && nakupy[0][10] === '24,500' && nakupy[0][12] === '2450' && nakupy[0][13] === 'https://onedrive/ks9', JSON.stringify(nakupy[0]));
  const csv = await page.evaluate(() => ucPrehledCsv(2026, 9));
  check('CSV začíná BOM a dělí středníkem', csv.charCodeAt(0) === 0xfeff && csv.split('\r\n')[0].split(';').length === 14);
  check('text se středníkem a uvozovkami je v uvozovkách', csv.includes('"Nákup; s ""uvozovkami"""'));
  const stazeno = await page.evaluate(() => new Promise(res => {
    const puv = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() { HTMLAnchorElement.prototype.click = puv; res(this.download); };
    stahniPrehledMesice(2026, 9);
  }));
  check('stáhne se soubor za měsíc', stazeno === 'ucetnictvi_2026-09.csv', stazeno);

  section('4) Nákupní doklady, řada a kurzy');
  const nd = await page.evaluate(() => ucNakupniDoklady(2026, 9).map(g => ({ ids: g.kusy.map(k => k.id).join('+'), odkaz: g.odkaz })));
  check('kusy téže smlouvy jsou jeden řádek', nd.some(g => g.ids === 'n1+n3' && g.odkaz === 'https://onedrive/ks9'), JSON.stringify(nd));
  check('nákup bez odkazu je vidět', nd.some(g => g.ids === 'n4' && !g.odkaz), JSON.stringify(nd));
  check('osobní nákup v seznamu není', !nd.some(g => g.ids.includes('n2')), JSON.stringify(nd));
  const rada = await page.evaluate(() => ucRadaRoku(2026));
  check('řada roku: počet a rozsah', rada.pocet === 5 && rada.od === '2026-001' && rada.do === '2026-005', JSON.stringify(rada));
  check('osobní kus v řadě se ohlásí', JSON.stringify(rada.osobni) === '["2026-005"]', JSON.stringify(rada.osobni));
  const kurzy = await page.evaluate(() => {
    const it = items.find(i => i.id === 'r3');
    const r = { s: ucKurzyBezCnb(2026, 9).length };
    delete it.payoutRateCnb; r.bez = ucKurzyBezCnb(2026, 9).map(i => i.id); it.payoutRateCnb = true;
    return r;
  });
  check('kurz z ČNB nic nehlásí', kurzy.s === 0, JSON.stringify(kurzy));
  check('eurový prodej bez ČNB se ohlásí', JSON.stringify(kurzy.bez) === '["r3"]', JSON.stringify(kurzy));

  section('2) Okno');
  await page.evaluate(() => { _ucObdobi = { rok: 2026, mesic: 9 }; openUcetnictvi(); });
  await page.waitForTimeout(200);
  const okno = await page.evaluate(() => {
    const ov = document.getElementById('ucetOv');
    return { je: !!ov, text: ov ? ov.textContent.replace(/\s+/g, ' ') : '',
      selecty: ov ? ov.querySelectorAll('.cs-wrap').length : 0 };
  });
  check('okno se otevře', okno.je);
  check('ukazuje počet a rozsah dokladů', /3 doklady · 2026-001 – 2026-003/.test(okno.text), okno.text.slice(0, 200));
  check('ukazuje počet prodejů a nákupů', /4 prodeje · 3 nákupy/.test(okno.text), okno.text.slice(0, 300));
  check('nákupní doklady: dva řádky, jeden bez odkazu', /2 doklady · 1 bez odkazu/.test(okno.text), okno.text.slice(0, 600));
  check('odkaz na nákupní doklad je faktura-link', await page.evaluate(() => !!document.querySelector('#ucetOv a.faktura-link[href="https://onedrive/ks9"]')));
  check('řada: 5 dokladů a osobní kus', /2026: 5 dokladů · 2026-001 – 2026-005/.test(okno.text) && /2026-005\) — osobní prodej/.test(okno.text), okno.text.slice(0, 900));
  check('kurzy: v pořádku', /Eurové prodeje měsíce mají kurz ČNB/.test(okno.text));
  check('majitel sekci Zaúčtováno nemá — je jen pro účetního', !/Zaúčtováno/.test(okno.text));
  check('výběr měsíce a roku má vlastní vzhled', okno.selecty === 2, String(okno.selecty));
  await page.evaluate(() => ucZmenObdobi(2026, 10));
  check('změna měsíce přepočítá', /1 doklad · 2026-004/.test(await page.evaluate(() => document.getElementById('ucetOv').textContent)));
  await page.keyboard.press('Escape');
  check('Escape okno zavře', await page.evaluate(() => !document.getElementById('ucetOv')));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
