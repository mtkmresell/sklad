// Test: odkaz na nákupní doklad se rozšíří na kusy ze stejného nákupu
// (SPOLEČNÝ NÁKUPNÍ DOKLAD) — stejné místo + číslo objednávky, nebo u výkupu
// stejné číslo FP / kupní smlouvy.
const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const DEN = 86400000;
const datum = (dnu) => new Date(Date.now() - dnu * DEN).toISOString().slice(0, 10);
const kus = (id, o) => Object.assign({ id, name: 'Kus ' + id, category: 'sneakers', buyPrice: 1000, buyCurrency: 'CZK',
  saleState: 'stock', location: 'Doma', dateAdded: Date.now(), buyDate: datum(10), tags: [] }, o);
const SEED = [
  kus('a1', { buyWhere: 'Nike', orderNum: 'C0415156' }),
  // stejná objednávka, jiný den (dorazila po kusech), jinak psané
  kus('a2', { buyWhere: ' nike ', orderNum: 'c0415156', buyDate: datum(3) }),
  // stejná objednávka, ale prodaný kus — i ten má mít doklad
  kus('a3', { buyWhere: 'Nike', orderNum: 'C0415156', saleState: 'paid', sellPrice: 2000, saleDate: datum(1), payoutDate: datum(1) }),
  kus('b1', { buyWhere: 'Nike', orderNum: 'JINA-123' }),            // jiné číslo objednávky
  kus('b2', { buyWhere: 'Zalando', orderNum: 'C0415156' }),         // stejné číslo, jiný obchod
  kus('b3', { buyWhere: 'Nike', orderNum: '' }),                    // bez čísla
  kus('b4', { buyWhere: 'Nike' }),                                  // bez čísla
  kus('k1', { from: 'Honza', dokladTyp: 'ks', dokladCislo: 'KS20260007' }),
  kus('k2', { from: 'Honza', dokladTyp: 'ks', dokladCislo: 'ks20260007 ' }),
  kus('k3', { from: 'Honza', dokladTyp: 'ks', dokladCislo: 'KS20260008' }),
  kus('f1', { dokladTyp: 'fp', fpCislo: 'FP-2026-11' }),
  kus('f2', { dokladTyp: 'fp', fpCislo: 'FP-2026-11' }),
  kus('f3', { dokladTyp: 'ks', dokladCislo: 'FP-2026-11' }),        // stejné číslo, ale kupní smlouva
  kus('n1', { dokladTyp: 'ks', dokladCislo: '' }),
  kus('n2', { dokladTyp: 'ks', dokladCislo: '' }),
  // Ostrá data (KS20260007): odkaz u jednoho kusu ze tří, vložený dřív,
  // než spojování existovalo
  kus('r1', { buyWhere: 'Facebook', from: 'Jan', dokladTyp: 'ks', dokladCislo: 'KS20260009', invoiceUrl: 'https://onedrive.live.com/ks9' }),
  kus('r2', { buyWhere: 'Facebook', from: 'Jan', dokladTyp: 'ks', dokladCislo: 'KS20260009' }),
  kus('r3', { buyWhere: 'Facebook', from: 'Jan', dokladTyp: 'ks', dokladCislo: 'KS20260009' }),
  kus('s1', { dokladTyp: 'ks', dokladCislo: 'KS20260010', invoiceUrl: 'https://onedrive.live.com/ks10' }),
  kus('s2', { dokladTyp: 'ks', dokladCislo: 'KS20260010' }),
  kus('t1', { dokladTyp: 'ks', dokladCislo: 'KS20260011', invoiceUrl: 'https://x/A' }),
  kus('t2', { dokladTyp: 'ks', dokladCislo: 'KS20260011', invoiceUrl: 'https://x/B' }),
  kus('t3', { dokladTyp: 'ks', dokladCislo: 'KS20260011' }),
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
  await page.waitForFunction(() => typeof saveItem === 'function' && Array.isArray(items) && items.length > 0, { timeout: 20000 });
  await page.waitForTimeout(500);

  // Úprava přes formulář, jak to dělá majitel
  const uprav = (id, url) => page.evaluate(async ({ id, url }) => {
    openEdit(id);
    await new Promise(r => setTimeout(r, 150));
    if (url !== null) document.getElementById('fInvoiceUrl').value = url;
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
  }, { id, url });
  const odkazy = () => page.evaluate(() => {
    const o = {};
    items.forEach(i => { o[i.id] = i.invoiceUrl || ''; });
    return o;
  });
  const ulozeno = () => page.evaluate(() => {
    const o = {};
    JSON.parse(localStorage.getItem('sklad_v3') || '[]').forEach(i => { o[i.id] = i.invoiceUrl || ''; });
    return o;
  });

  section('1) Stejné místo nákupu a číslo objednávky');
  const URL1 = 'https://drive.google.com/faktura-nike';
  await uprav('a1', URL1);
  let o = await odkazy();
  check('ostatní kusy objednávky odkaz dostaly (i jinak psané, jiný den, prodaný)', o.a2 === URL1 && o.a3 === URL1, JSON.stringify(o));
  check('jiné číslo objednávky ne', o.b1 === '');
  check('stejné číslo v jiném obchodě ne', o.b2 === '');
  check('kusy bez čísla objednávky se nespojí', o.b3 === '' && o.b4 === '');
  check('kupní smlouvy a FP se netkne', o.k1 === '' && o.f1 === '');
  let u = await ulozeno();
  check('a je to uložené hned, ne až s další změnou', u.a2 === URL1 && u.a3 === URL1, JSON.stringify(u));

  section('2) Úprava kusu bez změny odkazu nic nepřepíše');
  /* Dřív se rozšiřovala hodnota při každém uložení: kus bez odkazu,
     upravený třeba kvůli ceně, by odkaz ostatním smazal. */
  await page.evaluate(() => { const i = items.find(x => x.id === 'b1'); i.orderNum = 'C0415156'; i.invoiceUrl = ''; });
  await uprav('b1', null);
  o = await odkazy();
  check('ostatním odkaz zůstal', o.a1 === URL1 && o.a2 === URL1 && o.a3 === URL1, JSON.stringify(o));
  check('upravený kus bez odkazu si ho od objednávky převzal', o.b1 === URL1, JSON.stringify(o));
  await page.evaluate(() => { const i = items.find(x => x.id === 'b1'); i.orderNum = 'JINA-123'; i.invoiceUrl = ''; });

  section('3) Smazání odkazu se taky rozšíří');
  await uprav('a2', '');
  o = await odkazy();
  check('odkaz zmizel celé objednávce', o.a1 === '' && o.a2 === '' && o.a3 === '', JSON.stringify(o));

  section('4) Výkup — stejné číslo kupní smlouvy');
  const URL2 = 'https://drive.google.com/ks-honza';
  await uprav('k1', URL2);
  o = await odkazy();
  check('kus se stejnou smlouvou (jinak psanou) odkaz dostal', o.k2 === URL2, JSON.stringify(o));
  check('jiná smlouva ne', o.k3 === '');
  check('FP se stejným číslem ne — jiný druh dokladu', o.f3 === '');

  section('5) Výkup — stejné číslo faktury přijaté');
  const URL3 = 'https://drive.google.com/fp-2026-11';
  await uprav('f2', URL3);
  o = await odkazy();
  check('kus se stejnou FP odkaz dostal', o.f1 === URL3, JSON.stringify(o));
  check('kupní smlouva se stejným číslem ne', o.f3 === '');
  check('úprava kusu číslo FP nesmaže, i když FP není mezi otevřenými',
    (await page.evaluate(() => items.find(x => x.id === 'f2').fpCislo)) === 'FP-2026-11');

  section('6) Prázdné číslo dokladu nespojuje');
  await uprav('n1', 'https://drive.google.com/x');
  o = await odkazy();
  check('druhý kus bez čísla smlouvy odkaz nedostal', o.n2 === '', JSON.stringify(o));

  section('7) Nový kus s odkazem doplní zbytek objednávky');
  await page.evaluate(() => { items.find(x => x.id === 'a1').invoiceUrl = ''; items.find(x => x.id === 'a2').invoiceUrl = ''; items.find(x => x.id === 'a3').invoiceUrl = ''; });
  await page.evaluate(async () => {
    openAddModal();
    await new Promise(r => setTimeout(r, 150));
    document.getElementById('fName').value = 'Nový kus z téže objednávky';
    document.getElementById('fBuy').value = '1200';
    document.getElementById('fWhere').value = 'Nike';
    document.getElementById('fOrder').value = 'C0415156';
    document.getElementById('fInvoiceUrl').value = 'https://drive.google.com/nova';
    await saveItem();
    await new Promise(r => setTimeout(r, 150));
  });
  o = await odkazy();
  check('starší kusy objednávky odkaz dostaly', o.a1 === 'https://drive.google.com/nova' && o.a3 === 'https://drive.google.com/nova', JSON.stringify(o));

  section('8) Odkaz vložený dřív se doplní při dalším uložení');
  await uprav('r1', null);
  o = await odkazy();
  check('uložení kusu s odkazem (beze změny) ho doplní ostatním kusům smlouvy',
    o.r2 === 'https://onedrive.live.com/ks9' && o.r3 === 'https://onedrive.live.com/ks9', JSON.stringify(o));
  await uprav('s2', null);
  o = await odkazy();
  check('kus bez odkazu si ho při uložení převezme od ostatních', o.s2 === 'https://onedrive.live.com/ks10', JSON.stringify(o));
  u = await ulozeno();
  check('převzatý odkaz je uložený', u.s2 === 'https://onedrive.live.com/ks10');
  await uprav('t1', null);
  o = await odkazy();
  check('jiný vyplněný odkaz se bez změny nepřepíše', o.t2 === 'https://x/B', JSON.stringify(o));
  check('prázdný se doplní', o.t3 === 'https://x/A', JSON.stringify(o));
  await page.evaluate(() => { items.find(x => x.id === 't3').invoiceUrl = ''; });
  await uprav('t3', null);
  o = await odkazy();
  check('dva různé odkazy u ostatních — nic se nepřevezme', o.t3 === '', JSON.stringify(o));

  section('9) Formulář: u kupní smlouvy není číslo objednávky');
  const pole = () => page.evaluate(() => {
    const vid = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; };
    return { obj: vid('fOrderWrap'), ks: vid('fDokladCisloWrap'), fp: vid('fFpCisloWrap'),
      stitek: document.querySelector('#fDokladCisloWrap label').textContent.trim(),
      poradi: !!(document.getElementById('fDokladTyp').compareDocumentPosition(document.getElementById('fDokladCisloWrap')) & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
  await page.evaluate(async () => { openAddModal(); await new Promise(r => setTimeout(r, 100)); });
  let p = await pole();
  check('nová položka: číslo objednávky vidět, smlouva ne', p.obj && !p.ks && !p.fp, JSON.stringify(p));
  await page.evaluate(() => { const s = document.getElementById('fDokladTyp'); s.value = 'ks'; onDokladTypChange(); });
  p = await pole();
  check('Kupní smlouva: číslo objednávky zmizí, je tu Číslo smlouvy', !p.obj && p.ks && p.stitek === 'Číslo smlouvy', JSON.stringify(p));
  check('číslo smlouvy je pod typem dokladu', p.poradi);
  await page.evaluate(() => { const s = document.getElementById('fDokladTyp'); s.value = 'id'; onDokladTypChange(); });
  p = await pole();
  check('zpátky na doklad ID: číslo objednávky se vrátí', p.obj && !p.ks, JSON.stringify(p));
  await page.evaluate(() => cm('moAdd'));
  await page.evaluate(async () => { openEdit('k1'); await new Promise(r => setTimeout(r, 100)); });
  p = await pole();
  check('úprava kusu s kupní smlouvou: číslo objednávky schované', !p.obj && p.ks, JSON.stringify(p));
  await page.evaluate(() => cm('moAdd'));
  await page.evaluate(async () => { openEdit('a1'); await new Promise(r => setTimeout(r, 100)); });
  p = await pole();
  check('úprava běžného kusu: číslo objednávky vidět', p.obj && !p.ks, JSON.stringify(p));
  await page.evaluate(() => cm('moAdd'));

  check('žádné JS chyby', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
