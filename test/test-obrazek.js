// Test: odkaz na obrázek se rozšíří na kusy se stejným názvem a SKU
// (SPOLEČNÝ OBRÁZEK POLOŽKY) — formulářem Upravit i oknem obrázku.
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const FOTKA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const kus = (id, o) => Object.assign({ id, category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
  saleState: 'stock', location: 'Doma', dateAdded: Date.now(), tags: [] }, o);
const SEED = [
  kus('a1', { name: 'Nike Dunk Low Panda', sku: 'DD1391-100', size: '42' }),
  kus('a2', { name: ' nike dunk low panda ', sku: 'dd1391-100', size: '43' }),   // jinak psané
  kus('a3', { name: 'Nike Dunk Low Panda', sku: '', size: '44' }),              // bez SKU, stejný název
  kus('a4', { name: 'Nike Dunk Low Panda', sku: 'DD1391-100', size: '45', imgUrl: FOTKA }), // nahraná fotka
  kus('a5', { name: 'Nike Dunk Low Panda', sku: 'DD1391-100', size: '46', hasPhoto: 1 }),   // fotka v cloudu
  kus('a6', { name: 'Nike Dunk Low Panda', sku: 'DD1391-100', size: '47', saleState: 'paid', sellPrice: 3000 }),
  kus('b1', { name: 'Nike Dunk Low Panda', sku: 'DD1503-101', size: '38' }),    // jiné SKU (dámská)
  kus('b2', { name: 'Nike Dunk Low', sku: 'DD1391-100', size: '42' }),          // jiný název
  kus('c1', { name: 'Yeezy Slide Onyx', sku: '', size: '43', imgUrl: 'https://img/onyx.jpg' }),
  kus('c2', { name: 'Yeezy Slide Onyx', sku: '', size: '44' }),
  kus('c3', { name: 'Yeezy Slide Onyx', sku: '', size: '45' }),
  kus('d1', { name: 'Samba OG', sku: 'B75806', size: '42', imgUrl: 'https://img/A.jpg' }),
  kus('d2', { name: 'Samba OG', sku: 'B75806', size: '43', imgUrl: 'https://img/B.jpg' }),
  kus('d3', { name: 'Samba OG', sku: 'B75806', size: '44' }),
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.route('**/firebasejs/**', r => r.abort());
  // obrázky z testu nikam nevedou — ať se nic nenačítá ze sítě
  await page.route(/^https?:\/\/img\//, r => r.abort());
  await ctx.addInitScript((s) => { if (!localStorage.getItem('sklad_v3')) localStorage.setItem('sklad_v3', JSON.stringify(s)); }, SEED);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof saveItem === 'function' && Array.isArray(items) && items.length > 0, { timeout: 20000 });
  await page.waitForTimeout(500);

  const uprav = (id, url) => page.evaluate(async ({ id, url }) => {
    openEdit(id);
    await new Promise(r => setTimeout(r, 150));
    if (url !== null) document.getElementById('fImgUrl').value = url;
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
  }, { id, url });
  const obr = () => page.evaluate(() => { const o = {}; items.forEach(i => { o[i.id] = i.imgUrl || ''; }); return o; });

  section('1) Formulář: nový odkaz dostanou kusy se stejným názvem a SKU');
  const U1 = 'https://img/panda.jpg';
  await uprav('a1', U1);
  let o = await obr();
  check('stejný název i SKU (jinak psané) obrázek dostal', o.a2 === U1, JSON.stringify(o));
  check('kus bez SKU se stejným názvem taky', o.a3 === U1);
  check('prodaný kus taky', o.a6 === U1);
  check('nahraná fotka se nepřepíše', o.a4 === FOTKA);
  check('kus s fotkou v cloudu se nepřepíše', o.a5 === '');
  check('jiné SKU ne', o.b1 === '');
  check('jiný název ne', o.b2 === '');
  const ulozeno = await page.evaluate(() => (JSON.parse(localStorage.getItem('sklad_v3')).find(x => x.id === 'a2') || {}).imgUrl);
  check('a je to uložené', ulozeno === U1, ulozeno);

  section('2) Změna odkazu se rozšíří, smazání ne');
  const U2 = 'https://img/panda2.jpg';
  await uprav('a2', U2);
  o = await obr();
  check('nový odkaz přepsal starý u celé skupiny', o.a1 === U2 && o.a3 === U2, JSON.stringify(o));
  await uprav('a1', '');
  o = await obr();
  check('smazání obrázku se ostatním nerozšíří', o.a1 === '' && o.a2 === U2 && o.a3 === U2, JSON.stringify(o));

  section('3) Starší odkaz: doplní se a převezme při uložení');
  await uprav('c1', null);
  o = await obr();
  check('uložení beze změny doplní prázdné', o.c2 === 'https://img/onyx.jpg' && o.c3 === 'https://img/onyx.jpg', JSON.stringify(o));
  await page.evaluate(() => { items.find(x => x.id === 'c3').imgUrl = ''; });
  await uprav('c3', null);
  o = await obr();
  check('kus bez obrázku si ho převezme', o.c3 === 'https://img/onyx.jpg', JSON.stringify(o));
  await uprav('d1', null);
  o = await obr();
  check('bez změny se jiný odkaz nepřepíše', o.d2 === 'https://img/B.jpg', JSON.stringify(o));
  await page.evaluate(() => { items.find(x => x.id === 'd3').imgUrl = ''; });
  await uprav('d3', null);
  o = await obr();
  check('dva různé odkazy — nic se nepřevezme', o.d3 === '', JSON.stringify(o));

  section('4) Okno obrázku');
  const U3 = 'https://img/panda3.jpg';
  await page.evaluate(async (u) => {
    imgModalId = 'a3';
    document.getElementById('imgUrlInput').value = u;
    document.getElementById('imgPreview').dataset.pending = '';
    window.resolveImgUrl = function (x, cb) { cb(x); };
    saveImgUrl();
    await new Promise(r => setTimeout(r, 100));
  }, U3);
  o = await obr();
  check('odkaz z okna obrázku dostanou i ostatní', o.a2 === U3 && o.a1 === U3, JSON.stringify(o));
  check('nahraná fotka zůstala', o.a4 === FOTKA);
  await page.evaluate(async () => {
    imgModalId = 'b2';
    document.getElementById('imgPreview').dataset.pending = 'data:image/png;base64,AAAA';
    saveImgUrl();
    await new Promise(r => setTimeout(r, 100));
  });
  o = await obr();
  check('nahraný soubor se nekopíruje', o.a1 === U3 && o.b2.startsWith('data:'), JSON.stringify(o));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
