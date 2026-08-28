// Test: datum zaškrtnutí Bazoše.
//
// Inzerát na Bazoši žije 60 dní a aktivních smí být 50. Aplikace si proto
// u každé položky pamatuje, kdy se platforma zaškrtla. Když to datum chybí,
// položka se do limitu počítá, ale expirace ji přeskočí — drží místo
// napořád a nikdo se to nedozví.
//
// Datum se zapisovalo jen tomu kusu, který uživatel odškrtl. Kopírovalo se
// ale na tři další místa bez něj: na sourozence ve skupině, při vrácení
// na sklad a při duplikaci.

const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const DEN = 24 * 60 * 60 * 1000;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // ══════════════════════════════════════════════════════════════
  section('1) Doplnění chybějícího data');

  const doplneni = await page.evaluate((DEN) => {
    localStorage.clear();
    const ted = Date.now();
    /* Data nákupu se počítají ode dneška, ne pevně. Dřív tu stály
       konkrétní dny a test tichounce tikal: byly zvolené tak, aby při
       psaní vyšly do očekávaného rozmezí, a jak kalendář popolezl,
       vypadly z něj a test spadl bez jediné změny v kódu. */
    const pred = (dnu) => new Date(ted - dnu * DEN).toISOString().slice(0, 10);
    items = [
      // starý kus bez data — inzerát je dávno mrtvý, pozná se podle nákupu
      { id: 'a1', name: 'Stara cepice', buyDate: pred(500), dateAdded: ted - 500 * DEN,
        saleState: 'stock', platforms: ['Bazoš.cz'], tags: [] },
      // čerstvý kus bez data
      { id: 'a2', name: 'Nova bota', buyDate: pred(20), dateAdded: ted - 20 * DEN,
        saleState: 'stock', platforms: ['Bazoš.cz'], tags: [] },
      // kus, který datum má — nesmí se přepsat
      { id: 'a3', name: 'Ma datum', buyDate: pred(27), dateAdded: ted - 5 * DEN,
        saleState: 'stock', platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': ted - 3 * DEN }, tags: [] },
      // kus bez Bazoše — nemá se ho to týkat
      { id: 'a4', name: 'Jen Vinted', buyDate: pred(88), dateAdded: ted - 40 * DEN,
        saleState: 'stock', platforms: ['Vinted'], tags: [] },
    ];
    const puvodniA3 = items[2].bazosCheckedAt['Bazoš.cz'];
    const doplneno = healBazosCheckedAt();
    const dej = (id) => { const it = items.find(i => i.id === id); return it.bazosCheckedAt && it.bazosCheckedAt['Bazoš.cz']; };
    return {
      doplneno,
      a1: dej('a1'), a2: dej('a2'), a3: dej('a3'), a4: dej('a4'),
      a3Puvodni: puvodniA3,
      stariA1: Math.round((ted - dej('a1')) / DEN),
      stariA2: Math.round((ted - dej('a2')) / DEN),
    };
  }, DEN);

  check('doplnilo se jen tam, kde datum chybělo', doplneni.doplneno === 2, 'doplněno: ' + doplneni.doplneno);
  check('starý kus dostal staré datum', doplneni.stariA1 > 400, doplneni.stariA1 + ' dní');
  check('čerstvý kus dostal čerstvé datum', doplneni.stariA2 > 15 && doplneni.stariA2 < 30, doplneni.stariA2 + ' dní');
  check('existující datum se nepřepsalo', doplneni.a3 === doplneni.a3Puvodni);
  check('položky bez Bazoše se to netýká', !doplneni.a4);

  section('2) Po doplnění expirace zabere');
  const poExpiraci = await page.evaluate(() => {
    bazosExpireCheck();
    const ma = (id) => (items.find(i => i.id === id).platforms || []).includes('Bazoš.cz');
    return { a1: ma('a1'), a2: ma('a2'), a3: ma('a3') };
  });
  check('starý inzerát se odškrtl', poExpiraci.a1 === false);
  check('čerstvý zůstal', poExpiraci.a2 === true);
  check('a ten s vlastním datem taky', poExpiraci.a3 === true);

  section('3) Počítadlo limitu je po úklidu poctivé');
  const pocty = await page.evaluate((DEN) => {
    const ted = Date.now();
    // Zase ode dneška — „živý" inzerát musí zůstat pod šedesáti dny,
    // a pevné datum by se pod tu hranici jednou propadlo samo
    const dnyZpet = (dnu) => new Date(ted - dnu * DEN).toISOString().slice(0, 10);
    items = [
      { id: 'b1', name: 'Ziva 1', sku: 'S1', saleState: 'stock', platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': ted - 5 * DEN }, tags: [] },
      { id: 'b2', name: 'Mrtva', sku: 'S2', buyDate: dnyZpet(700), dateAdded: ted - 700 * DEN, saleState: 'stock', platforms: ['Bazoš.cz'], tags: [] },
      { id: 'b3', name: 'Ziva 2', sku: 'S3', buyDate: dnyZpet(18), dateAdded: ted - 9 * DEN, saleState: 'stock', platforms: ['Bazoš.cz'], tags: [] },
    ];
    const pred = bazosActiveCount('Bazoš.cz');
    healBazosCheckedAt();
    bazosExpireCheck();
    return { pred, po: bazosActiveCount('Bazoš.cz') };
  }, DEN);
  check('před úklidem se počítal i mrtvý inzerát', pocty.pred === 3, String(pocty.pred));
  check('po úklidu už ne', pocty.po === 2, String(pocty.po));

  // ══════════════════════════════════════════════════════════════
  section('4) Datum jde se skupinou, s vrácením i s duplikací');

  const skupina = await page.evaluate(() => {
    localStorage.clear();
    // Skupina je stejné SKU i velikost — tedy dva identické kusy,
    // které na Bazoši pokryje jeden inzerát (viz platGroupKey)
    items = [
      { id: 'g1', name: 'Dunk Low Panda', sku: 'DD1391', size: '42', saleState: 'stock', platforms: [], tags: [] },
      { id: 'g2', name: 'Dunk Low Panda', sku: 'DD1391', size: '42', saleState: 'stock', platforms: [], tags: [] },
    ];
    togglePlatItem('g1', 'Bazoš.cz');
    const dej = (id) => { const it = items.find(i => i.id === id); return it.bazosCheckedAt && it.bazosCheckedAt['Bazoš.cz']; };
    return {
      g1ma: (items[0].platforms || []).includes('Bazoš.cz'),
      g2ma: (items[1].platforms || []).includes('Bazoš.cz'),
      g1datum: !!dej('g1'),
      g2datum: !!dej('g2'),
      stejne: dej('g1') === dej('g2'),
    };
  });
  check('platforma se propsala na sourozence', skupina.g1ma && skupina.g2ma, JSON.stringify(skupina));
  check('a datum se propsalo taky', skupina.g2datum === true, JSON.stringify(skupina));
  check('obě mají stejné datum', skupina.stejne === true);

  const odskrtnuti = await page.evaluate(() => {
    togglePlatItem('g1', 'Bazoš.cz');
    const it2 = items.find(i => i.id === 'g2');
    return {
      g2ma: (it2.platforms || []).includes('Bazoš.cz'),
      g2datum: !!(it2.bazosCheckedAt && it2.bazosCheckedAt['Bazoš.cz']),
    };
  });
  check('odškrtnutí sundá platformu i sourozenci', odskrtnuti.g2ma === false);
  check('a smaže mu i datum', odskrtnuti.g2datum === false);

  const vraceni = await page.evaluate(() => {
    const ted = Date.now();
    items = [
      { id: 'v1', name: 'Vracena bota', sku: 'VB1', size: '42', saleState: 'stock', platforms: [], tags: [] },
      { id: 'v2', name: 'Vracena bota', sku: 'VB1', size: '42', saleState: 'stock',
        platforms: ['Bazoš.cz'], bazosCheckedAt: { 'Bazoš.cz': ted - 7 * 24 * 3600 * 1000 }, tags: [] },
    ];
    onReturnToStock(items[0]);
    return {
      ma: (items[0].platforms || []).includes('Bazoš.cz'),
      datum: !!(items[0].bazosCheckedAt && items[0].bazosCheckedAt['Bazoš.cz']),
    };
  });
  check('vrácený kus dostane platformy ze skupiny', vraceni.ma === true);
  check('a s nimi i datum', vraceni.datum === true, JSON.stringify(vraceni));

  // ══════════════════════════════════════════════════════════════
  section('5) Po opravě už nevzniká nic bez data');
  const bezData = await page.evaluate(() => {
    return (items || []).filter(function (it) {
      return (it.platforms || []).some(function (p) { return p.indexOf('Bazoš') === 0; })
        && !(it.bazosCheckedAt && Object.keys(it.bazosCheckedAt).length);
    }).length;
  });
  check('žádná položka s Bazošem nezůstala bez data', bezData === 0, 'bez data: ' + bezData);

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
