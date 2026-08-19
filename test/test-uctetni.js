// Test: pohled účetního — cizí kóje, osekané rozhraní, žádný zápis.
//
// Účetní se přihlásí vlastním účtem, ve své kóji má jen ukazatel na majitele
// a aplikace se musí přepnout na jeho data. Kontroluje se obojí: že vidí to,
// co má, a hlavně že nevidí a nezmění to, co nemá.

const { chromium } = require('playwright');
const path = require('path');
const installFakeFirestore = require('./fakefs.js');

let failures = 0;
function check(n, c, e) { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || e === undefined ? '' : ' | ' + e)); if (!c) failures++; }
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }

const MAJITEL = 'majitel1';
const UCETNI = 'uctetni1';

const POLOZKY = [
  { id: 's1', name: 'Dunk Low Panda', category: 'sneakers', buyPrice: 2400, buyCurrency: 'CZK',
    saleState: 'stock', location: 'Doma', dateAdded: 101, buyDate: '2026-01-05', tags: [],
    stockxUrl: 'https://stockx.com/dunk-low-panda' },
  { id: 's2', name: 'Osobni Pikachu', category: 'pokemon', buyPrice: 850, buyCurrency: 'CZK',
    saleState: 'stock', personal: true, location: 'Doma', dateAdded: 102, buyDate: '2026-02-05', tags: [] },
  { id: 'w1', name: 'Ceka LEGO', category: 'lego', buyPrice: 3200, buyCurrency: 'CZK',
    saleState: 'waiting', sellPrice: 4600, saleDate: '2026-07-01', soldWhere: 'Vinted',
    dateAdded: 103, buyDate: '2026-03-05', tags: [] },
  { id: 'p1', name: 'Jordan 1 Chicago', category: 'sneakers', buyPrice: 5200, buyCurrency: 'CZK',
    saleState: 'paid', sellPrice: 8900, profit: 3700, saleDate: '2026-05-01', payoutDate: '2026-05-10',
    soldWhere: 'StockX', dateAdded: 104, buyDate: '2026-01-01', tags: [] },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 200)); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.evaluate(installFakeFirestore);

  const prihlas = async (uid) => {
    await page.evaluate((u) => {
      window._fbUser = { uid: u, email: u + '@test.cz' };
      document.dispatchEvent(new CustomEvent('fb-auth', { detail: { user: { uid: u } } }));
    }, uid);
    await page.waitForTimeout(250);
  };
  const emit = async () => { await page.evaluate(() => window.__emitSnapshot && window.__emitSnapshot()); await page.waitForTimeout(400); };
  const vidi = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    return getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
  }, sel);

  // ══════════════════════════════════════════════════════════════
  section('1) Účetní se přepne na kóji majitele');
  await page.evaluate((d) => {
    localStorage.clear();
    items = [];
    window.__store = {};
    // Účetní má ve své kóji jen ukazatel — žádné položky
    window.__store['users/' + d.UCETNI + '/sklad/data'] = { uctujePro: d.MAJITEL, savedAt: '2026-08-01T10:00:00.000Z' };
    // Data majitele
    window.__store['users/' + d.MAJITEL + '/sklad/data'] = { items: JSON.parse(JSON.stringify(d.POLOZKY)), savedAt: '2026-08-02T10:00:00.000Z' };
    window.__store['users/' + d.MAJITEL + '/crm/main'] = { customers: [{ id: 'c1', name: 'Tajny Zakaznik' }], partners: [] };
  }, { MAJITEL, UCETNI, POLOZKY });

  await prihlas(UCETNI);
  await emit();          // snímek vlastní kóje — aplikace v něm najde ukazatel a přepne se
  await emit();          // snímek kóje majitele; skutečný Firestore ho po přihlášení
                         // k odběru pošle sám, falešný se musí vyvolat
  await page.waitForTimeout(300);

  const stav = await page.evaluate(() => ({
    rezim: jeUctetni(),
    ctenyUid: _datovyUid(),
    trida: document.body.classList.contains('uctetni'),
    pocet: items.length,
  }));
  check('režim účetního se zapnul', stav.rezim === true, JSON.stringify(stav));
  check('čte se kóje majitele, ne vlastní', stav.ctenyUid === MAJITEL, stav.ctenyUid);
  check('body nese třídu uctetni', stav.trida === true);
  check('data majitele dorazila', stav.pocet === POLOZKY.length, 'položek: ' + stav.pocet);

  // ══════════════════════════════════════════════════════════════
  section('2) Vidí jen Na skladě a Prodáno');
  check('Na skladě zůstává', await vidi('#btnTab_stock'));
  check('Prodáno zůstává', await vidi('#btnTab_sold'));
  check('Čeká je pryč', !(await vidi('#btnTab_waiting')));
  check('Zákazníci jsou pryč', !(await vidi('#btnTab_customers')));
  check('Wishlist je pryč', !(await vidi('#btnTab_wishlist')));
  check('přepínač profilů je pryč', !(await vidi('#profileSwitch')));

  section('3) Ovládání, které účetní nepotřebuje');
  check('přidávání je pryč', !(await vidi('#btnAdd')));
  check('hromadný výběr je pryč', !(await vidi('#btnBulkMode')));
  check('kalkulačka marže je pryč', !(await vidi('#btnCalc')));
  check('chybějící listingy jsou pryč', !(await vidi('#btnMissingList')));
  check('hledání napříč sekcemi zůstává', await vidi('#btnGlobalSearch'));
  check('nastavení zůstává', await vidi('#btnSettings'));

  section('4) Pohled je označený');
  check('lišta účetního je vidět', await vidi('#uctetniLista'));
  const listaText = await page.evaluate(() => (document.getElementById('uctetniLista') || {}).textContent || '');
  check('lišta říká, o jaký pohled jde', /Pohled účetního/.test(listaText), listaText.slice(0, 60));

  // ══════════════════════════════════════════════════════════════
  section('5) Osobní položky se nezobrazují');
  const vykreslene = await page.evaluate(() => {
    const t = document.getElementById('itemsGrid');
    return t ? t.textContent : '';
  });
  check('podnikatelská položka je vidět', /Dunk Low Panda/.test(vykreslene));
  check('osobní položka není vidět', !/Osobni Pikachu/.test(vykreslene), vykreslene.slice(0, 200));
  const profTest = await page.evaluate(() => {
    // I kdyby se profil přepnul jinudy, filtr musí držet
    activeProfile = 'all';
    return { osobni: profMatch({ personal: true }), podnikani: profMatch({ personal: false }) };
  });
  check('filtr profilu drží i při activeProfile=all', profTest.osobni === false && profTest.podnikani === true, JSON.stringify(profTest));

  // ══════════════════════════════════════════════════════════════
  section('6) Do skrytých sekcí se nedostane ani jinudy');
  await page.evaluate(() => switchTab('customers'));
  await page.waitForTimeout(200);
  check('switchTab na zákazníky odkloní na sklad', (await page.evaluate(() => tab)) === 'stock');
  await page.evaluate(() => switchTab('wishlist'));
  await page.waitForTimeout(200);
  check('switchTab na wishlist odkloní na sklad', (await page.evaluate(() => tab)) === 'stock');
  const anal = await page.evaluate(() => { stockViewMode = 'analytics'; renderItems(); return stockViewMode; });
  check('analytika skladu se přepne zpět na tabulku', anal === 'table', anal);

  section('7) CRM se vůbec nenačte');
  const crm = await page.evaluate(() => { loadCrmFromFirestore(); return { z: customers.length, p: partners.length }; });
  check('zákazníci zůstávají prázdní', crm.z === 0 && crm.p === 0, JSON.stringify(crm));

  // ══════════════════════════════════════════════════════════════
  section('8) Nic se nedá zapsat');
  const predZapisem = await page.evaluate(() => JSON.stringify(window.__store));
  await page.evaluate(() => { items.push({ id: 'podvrh', name: 'Nemá projít', saleState: 'stock' }); sv(); });
  await page.waitForTimeout(900);
  await page.evaluate(() => { fbSaveToCloud(); });
  await page.waitForTimeout(600);
  const poZapisu = await page.evaluate(() => JSON.stringify(window.__store));
  check('sv() ani fbSaveToCloud() nic nezapsaly', predZapisem === poZapisu);
  const dirty = await page.evaluate(() => localStorage.getItem('sklad_v3_dirty'));
  check('neoznačí se ani neuložené změny', !dirty, String(dirty));

  await page.evaluate(() => { saveCrmToFirestore(); });
  await page.waitForTimeout(300);
  check('CRM se taky nezapíše', (await page.evaluate(() => JSON.stringify(window.__store))) === predZapisem);

  section('9) Nastavení má jen odhlášení a manuál');
  await page.evaluate(() => { document.getElementById('moSettings').classList.add('open'); });
  await page.waitForTimeout(200);
  const nastaveni = await page.evaluate(() => {
    const bloky = Array.from(document.querySelectorAll('#moSettings .fs'));
    return {
      videt: bloky.filter(b => getComputedStyle(b).display !== 'none').length,
      uctetniBlok: bloky.some(b => b.classList.contains('fs-uctetni') && getComputedStyle(b).display !== 'none'),
    };
  });
  check('viditelný je jediný blok', nastaveni.videt === 1, JSON.stringify(nastaveni));
  check('a je to ten pro účetního', nastaveni.uctetniBlok === true);
  await page.evaluate(() => { document.getElementById('moSettings').classList.remove('open'); });

  section('10) Manuál se otevře a něco vysvětlí');
  await page.evaluate(() => otevriUctetniManual());
  await page.waitForTimeout(200);
  const manual = await page.evaluate(() => {
    const el = document.getElementById('moUctetniManual');
    return { otevreno: el.classList.contains('open'), text: el.textContent };
  });
  check('manuál se otevřel', manual.otevreno === true);
  check('vysvětluje měny', /kurz/i.test(manual.text));
  check('říká, co tu není', /Zákazníci/.test(manual.text));
  await page.evaluate(() => cm('moUctetniManual'));

  section('11) Odkazy ven nefungují');
  const odkaz = await page.evaluate(() => {
    const a = document.querySelector('#itemsGrid a[target="_blank"]');
    if (!a) return { zadny: true };
    return { zadny: false, klikatelny: getComputedStyle(a).pointerEvents !== 'none', text: a.textContent };
  });
  check('odkaz na StockX se nedá kliknout', odkaz.zadny || odkaz.klikatelny === false, JSON.stringify(odkaz));
  if (!odkaz.zadny) check('ale název položky zůstal čitelný', !!odkaz.text);

  // ══════════════════════════════════════════════════════════════
  section('12) Běžného uživatele se to nedotkne');
  await page.evaluate(() => location.reload());
  await page.waitForTimeout(3500);
  await page.evaluate(installFakeFirestore);
  await page.evaluate((d) => {
    localStorage.clear();
    items = [];
    window.__store = {};
    window.__store['users/' + d.MAJITEL + '/sklad/data'] = { items: JSON.parse(JSON.stringify(d.POLOZKY)), savedAt: '2026-08-02T10:00:00.000Z' };
  }, { MAJITEL, POLOZKY });
  await prihlas(MAJITEL);
  await emit();
  await page.waitForTimeout(300);

  const majitelStav = await page.evaluate(() => ({
    rezim: jeUctetni(),
    uid: _datovyUid(),
    trida: document.body.classList.contains('uctetni'),
    pocet: items.length,
  }));
  check('režim účetního se nezapnul', majitelStav.rezim === false, JSON.stringify(majitelStav));
  check('čte svoji vlastní kóji', majitelStav.uid === MAJITEL);
  check('žádná třída na body', majitelStav.trida === false);
  check('data se načetla normálně', majitelStav.pocet === POLOZKY.length, 'položek: ' + majitelStav.pocet);
  check('všechny záložky jsou zpátky', await vidi('#btnTab_customers'));
  check('přepínač profilů je zpátky', await vidi('#profileSwitch'));
  check('přidávání je zpátky', await vidi('#btnAdd'));
  check('lišta účetního není', !(await vidi('#uctetniLista')));

  const zapisMajitele = await page.evaluate(async () => {
    const pred = JSON.stringify(window.__store);
    items.push({ id: 'novy', name: 'Majitel smí', saleState: 'stock', buyPrice: 1, tags: [] });
    sv();
    await new Promise(r => setTimeout(r, 900));
    return pred !== JSON.stringify(window.__store);
  });
  check('majitel pořád může ukládat', zapisMajitele === true);

  // ══════════════════════════════════════════════════════════════
  if (errs.length) { console.log('\n' + errs.slice(0, 5).join('\n')); failures += errs.length; }
  await browser.close();
  console.log(failures ? '\n' + failures + ' KONTROL SELHALO' : '\nVŠECHNY TESTY PROŠLY');
  process.exit(failures ? 1 : 0);
})();
