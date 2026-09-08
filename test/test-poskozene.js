// Test: poškozený kus se nesmí označit jako vystavený tam, kam nepatří.
//
// „Poškozené" neznamená obnošené — je to vada, se kterou by kus neprošel
// ověřením nebo by ho zákazník vrátil. Na komisi ani na platformě, která
// zboží ověřuje, se proto nabízet nedá: skončilo by to vrácením a
// u komise ještě pokutou za nedodání.
//
// Zbývá prodej napřímo (Vinted, Facebook, Bazoše, Instagram) a tři místa,
// kde se poškozené zboží prodávat smí.
//
// Odškrtnout jde vždycky. Když kus někde visí, ta fajfka je pravda a
// majitel potřebuje inzerát nejdřív stáhnout — kdyby šla jen zaškrtnout,
// nešel by ten stav vůbec opravit.

const { chromium } = require('playwright');
const path = require('path');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const SOUBOR = 'file://' + path.resolve(__dirname, '..', 'index.html');

const POLOZKY = [
  { id: 'vadny', name: 'Vadné boty', sku: 'PK-1', size: '42', category: 'sneakers',
    condition: 'poskozene', buyPrice: 1000, saleState: 'stock', location: 'Doma',
    dateAdded: 1, platforms: [], tags: [] },
  { id: 'dobry', name: 'Dobré boty', sku: 'DB-1', size: '43', category: 'sneakers',
    condition: 'DS', buyPrice: 2000, saleState: 'stock', location: 'Doma',
    dateAdded: 2, platforms: [], tags: [] },
  // Poškozený kus, který u komisionáře už visí — tu fajfku musí jít zrušit
  { id: 'visi', name: 'Vadné a vystavené', sku: 'PK-2', size: '44', category: 'sneakers',
    condition: 'poskozene', buyPrice: 3000, saleState: 'stock', location: 'Doma',
    dateAdded: 3, platforms: ['Pikastore'], tags: [] },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.route('**/firebasejs/**', route => route.abort());
  await ctx.addInitScript((s) => localStorage.setItem('sklad_v3', JSON.stringify(s)), POLOZKY);
  await page.goto(SOUBOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof platformaProPoskozene === 'function'
    && Array.isArray(items) && items.length > 0, { timeout: 20000 });

  // ══════════════════════════════════════════════════════════════
  section('1) Kam poškozený kus smí a kam ne');
  const kam = await page.evaluate(() => {
    const out = {};
    ['StockX', 'Hypeboost', 'Pikastore', 'Purekickz', 'TheBeast', 'Sneakerstore',
      'Klekt', 'Alias', 'Cardmarket', 'Vinted', 'Facebook', 'Bazoš.cz', 'Instagram']
      .forEach(p => { out[p] = platformaProPoskozene(p); });
    return out;
  });
  // Komise a ověřované platformy — tam by kus neprošel
  ['StockX', 'Hypeboost', 'Pikastore', 'Purekickz', 'TheBeast', 'Sneakerstore']
    .forEach(p => check(p + ' ne', kam[p] === false, String(kam[p])));
  // Tady se poškozené zboží prodávat smí
  ['Klekt', 'Alias', 'Cardmarket'].forEach(p => check(p + ' ano', kam[p] === true, String(kam[p])));
  // Prodej napřímo — vlastní hodnota (Instagram) taky, stejně jako u kupujícího
  ['Vinted', 'Facebook', 'Bazoš.cz', 'Instagram']
    .forEach(p => check(p + ' ano', kam[p] === true, String(kam[p])));

  // ══════════════════════════════════════════════════════════════
  section('2) Zaškrtnout to nejde');
  const zaskrt = await page.evaluate(() => {
    const vysledky = {};
    vysledky.komise = togglePlatItem('vadny', 'Pikastore');
    vysledky.overovana = togglePlatItem('vadny', 'StockX');
    vysledky.povolena = togglePlatItem('vadny', 'Klekt');
    vysledky.lokalni = togglePlatItem('vadny', 'Vinted');
    vysledky.plats = (items.find(x => x.id === 'vadny').platforms || []).slice();
    return vysledky;
  });
  check('na komisi to neprojde', zaskrt.komise === false, String(zaskrt.komise));
  check('na ověřovanou platformu taky ne', zaskrt.overovana === false, String(zaskrt.overovana));
  check('kde se poškozené smí, projde', zaskrt.povolena === true, String(zaskrt.povolena));
  check('a přímý prodej taky', zaskrt.lokalni === true, String(zaskrt.lokalni));
  check('zapsalo se jen povolené', JSON.stringify(zaskrt.plats) === JSON.stringify(['Klekt', 'Vinted']),
    JSON.stringify(zaskrt.plats));

  // ══════════════════════════════════════════════════════════════
  section('3) Nepoškozeného kusu se to netýká');
  const dobry = await page.evaluate(() => {
    const ok = togglePlatItem('dobry', 'Pikastore');
    return { ok, plats: (items.find(x => x.id === 'dobry').platforms || []).slice() };
  });
  check('zdravý kus na komisi projde', dobry.ok === true && dobry.plats.includes('Pikastore'),
    JSON.stringify(dobry));

  // ══════════════════════════════════════════════════════════════
  section('4) Odškrtnout jde vždycky');
  /* Když kus u komisionáře opravdu visí, ta fajfka je pravda. Kdyby
     šla jen zaškrtnout, nešlo by ten stav nikdy uklidit. */
  const odskrt = await page.evaluate(() => {
    const ok = togglePlatItem('visi', 'Pikastore');
    return { ok, plats: (items.find(x => x.id === 'visi').platforms || []).slice() };
  });
  check('fajfku z komise jde zrušit', odskrt.ok === true, String(odskrt.ok));
  check('a opravdu zmizela', odskrt.plats.length === 0, JSON.stringify(odskrt.plats));
  const znovu = await page.evaluate(() => togglePlatItem('visi', 'Pikastore'));
  check('zpátky už ji zaškrtnout nejde', znovu === false, String(znovu));

  // ══════════════════════════════════════════════════════════════
  section('5) Skupina stejných kusů');
  /* Zaškrtnutí se rozlévá na celou skupinu (stejný model a velikost).
     Poškozený sourozenec ho dostat nesmí, i když se klikalo na zdravém. */
  const skupina = await page.evaluate(() => {
    items.push({ id: 'dvojce', name: 'Dobré boty', sku: 'DB-1', size: '43',
      category: 'sneakers', condition: 'poskozene', buyPrice: 2000, saleState: 'stock',
      location: 'Doma', dateAdded: 4, platforms: [], tags: [] });
    togglePlatItem('dobry', 'Purekickz');
    return {
      zdravy: (items.find(x => x.id === 'dobry').platforms || []).slice(),
      vadny: (items.find(x => x.id === 'dvojce').platforms || []).slice(),
    };
  });
  check('zdravý kus fajfku dostal', skupina.zdravy.includes('Purekickz'),
    JSON.stringify(skupina.zdravy));
  check('poškozený sourozenec ne', !skupina.vadny.includes('Purekickz'),
    JSON.stringify(skupina.vadny));

  // ══════════════════════════════════════════════════════════════
  section('6) V mřížce je to poznat předem');
  /* Bez tohohle by se na zablokovanou fajfku muselo klikat, aby člověk
     zjistil, že to nejde. */
  const mrizka = await page.evaluate(async () => {
    // Sloupce platforem jsou ve výchozím stavu sbalené do počtu
    platExpanded.platforms = true;
    platExpanded.eshopy = true;
    renderItems();
    await new Promise(r => setTimeout(r, 200));
    const bunka = (id, plat) => document.querySelector(
      '[data-action="toggleplat"][data-id="' + id + '"][data-plat="' + plat + '"]');
    const vadna = bunka('vadny', 'Pikastore');
    const zdrava = bunka('dobry', 'Hypeboost');
    return {
      nasel: !!vadna && !!zdrava,
      vadnaKurzor: vadna && vadna.style.cursor,
      vadnaTip: vadna && vadna.getAttribute('data-tip'),
      zdravaKurzor: zdrava && zdrava.style.cursor,
    };
  });
  check('buňky se našly', mrizka.nasel);
  check('u poškozeného je zakázaná', mrizka.vadnaKurzor === 'not-allowed', mrizka.vadnaKurzor);
  check('a napoví proč', /poškozený kus/.test(mrizka.vadnaTip || ''), mrizka.vadnaTip);
  check('u zdravého zůstala klikací', mrizka.zdravaKurzor === 'pointer', mrizka.zdravaKurzor);

  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
